'use strict';

/**
 * Pure position-key and wire-format helpers for the WS-1 band-meta shard
 * pipeline (the WS-1 spec section 2.1 -- "Contract
 * A: band meta, keyed by position"). Node + browser safe: no fs, no fetch,
 * no DOM. The crawler (scripts/buildBandShards.js) and the runtime reader
 * (src/browser/bandData.client.js) both go through this module so the
 * encode/decode shape is defined exactly once, in exactly one place.
 */

const { Chess } = require('chess.js');
const { fenToEpd, posKeyFromEpd } = require('./ingest/positionWalk');
// buildPackCore.js, not buildPack.js -- the latter requires ./explorerSource
// (fs/path) at module load, which breaks any browser bundle needing this
// pure helper. This module is required by src/browser/bandData.client.js,
// so it must stay on the browser-safe import path -- see
// src/buildPackCore.js's own header comment for the full explanation.
const { applyExplorerUci } = require('./buildPackCore');

const SCHEMA_VERSION = 1;
const SOURCE_EXPLORER = 'lichess-opening-explorer';
const SOURCE_DUMP = 'lichess-db-dump';

/**
 * Replays a UCI move list from the standard starting position and returns
 * this project's canonical position identity for the resulting position --
 * the SAME fenToEpd/posKeyFromEpd scheme src/ingest/positionWalk.js already
 * uses for the database-dump pipeline. Spec 4.2: using the same key means
 * (a) transpositions merge for free, and (b) swapping this module's data
 * source from the live Explorer to the dump pipeline later is a source
 * change, not a re-key of every stored shard/leak/card.
 *
 * Uses buildPack.js's applyExplorerUci rather than chess.js's own `.move()`
 * directly, because every `play` array this module is handed comes from (or
 * is validated against) the Lichess Opening Explorer, which encodes
 * castling as king-captures-own-rook UCI -- see that function's own header
 * comment for the full explanation and the "verified today" discipline it
 * documents. Throws if `play` contains an illegal move -- every caller in
 * this codebase builds `play` either from the crawler's own frontier
 * (itself built from Explorer responses) or from a real chess.js board a
 * visitor has actually played legal moves on (src/bandData.client.js's
 * callers), never from unvalidated free text; an illegal `play` array here
 * is a real bug in the caller, not untrusted visitor input.
 *
 * @param {string[]} [play] UCI moves from the starting position.
 * @returns {{fen: string, epd: string, posKey: string}}
 */
function posKeyFor(play = []) {
  const chess = new Chess();
  for (const uci of play) {
    applyExplorerUci(chess, uci);
  }
  const fen = chess.fen();
  const epd = fenToEpd(fen);
  return { fen, epd, posKey: posKeyFromEpd(epd) };
}

/**
 * The shard a position's `play` path is stored under -- the first TWO plies
 * of the path, because that key is computable client-side from the current
 * path with zero lookups (spec 2.1). `"root"` covers ply 0-2 (0, 1, or 2
 * moves played so far); any deeper path shards on its first two UCI moves
 * joined by a hyphen, e.g. `"e2e4-e7e5"`.
 *
 * @param {string[]} [play]
 * @returns {string} `"root"` or `"<uci1>-<uci2>"`
 */
function shardKeyFor(play = []) {
  if (play.length <= 2) return 'root';
  return `${play[0]}-${play[1]}`;
}

/**
 * Builds one compact PositionRecord from an explorerSource.fetchMoves()-
 * shaped response (spec 2.1's wire format -- arrays, not objects, no SAN
 * stored, since SAN is cheaply derivable client-side from the FEN via
 * chess.js and storing it would roughly double shard size for a value
 * that's always derivable).
 *
 * @param {{white?:number, draws?:number, black?:number,
 *   moves?:Array<{uci:string, white?:number, draws?:number, black?:number,
 *   averageRating?:number}>}} response
 * @returns {PositionRecord} `[w, d, b, [[uci, mw, md, mb, avgRating], ...]]`
 */
function positionRecordFrom(response) {
  const w = response.white || 0;
  const d = response.draws || 0;
  const b = response.black || 0;
  const moves = (response.moves || []).map((m) => [
    m.uci,
    m.white || 0,
    m.draws || 0,
    m.black || 0,
    Number.isFinite(m.averageRating) ? m.averageRating : 0,
  ]);
  return [w, d, b, moves];
}

/**
 * Inverse of positionRecordFrom -- expands a compact wire-format
 * PositionRecord back into named fields, for a consumer that wants to read
 * one rather than pass it straight through. Not required on the crawler's
 * write path (shards are written exactly as positionRecordFrom produces
 * them) but used by bandData.client.js's lookup() and by this module's own
 * tests.
 *
 * @param {PositionRecord} record
 * @returns {{w:number, d:number, b:number, moves: Array<{uci:string,
 *   w:number, d:number, b:number, avgRating:number}>}}
 */
function decodePositionRecord(record) {
  const [w, d, b, moves] = record;
  return {
    w,
    d,
    b,
    moves: (moves || []).map(([uci, mw, md, mb, avgRating]) => ({ uci, w: mw, d: md, b: mb, avgRating })),
  };
}

/**
 * @param {{band:string, pool:string, retrieved:string, source?:string,
 *   minGames:number, positions: Object<string, PositionRecord>}} args
 * @returns {object} a Shard object, spec 2.1's exact shape, `v` always the
 *   current SCHEMA_VERSION.
 */
function buildShard({ band, pool, retrieved, source = SOURCE_EXPLORER, minGames, positions }) {
  return { v: SCHEMA_VERSION, band, pool, retrieved, source, minGames, positions };
}

/**
 * Shape-validates a Shard object read from disk/network -- a stale cached
 * shard from a previous schema version, or a genuinely corrupt file, is a
 * real non-adversarial failure mode (spec 3.7 N4: "same-origin and
 * generated by our own build ... still try/catch the parse and shape-check
 * v === 1"). Every reader (bandData.client.js and this module's own tests)
 * checks this before trusting anything else in the object.
 *
 * @param {*} candidate
 * @returns {boolean}
 */
function isValidShard(candidate) {
  return Boolean(candidate)
    && typeof candidate === 'object'
    && candidate.v === SCHEMA_VERSION
    && typeof candidate.band === 'string'
    && typeof candidate.pool === 'string'
    && typeof candidate.positions === 'object' && candidate.positions !== null;
}

module.exports = {
  SCHEMA_VERSION,
  SOURCE_EXPLORER,
  SOURCE_DUMP,
  posKeyFor,
  shardKeyFor,
  positionRecordFrom,
  decodePositionRecord,
  buildShard,
  isValidShard,
};
