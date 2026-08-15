'use strict';

/**
 * Build-time content for /drill-reference.html (WS-1 spec section 3.3):
 * real, sourced opening lines with band data, generated from the COMMITTED
 * band shards (data/rep/, produced by W0's scripts/buildBandShards.js) --
 * never a live network call, so this runs deterministically at build time
 * against whatever crawl the repo currently carries.
 *
 * REWRITE, stated for anyone comparing this to the pre-WS-1 version: this
 * module used to bake ONE hardcoded Italian-Game tree per rating band by
 * calling the LIVE Lichess Opening Explorer (buildDrillTree/buildDrillData,
 * src/explorerSource.js's fetchMoves()). That approach is now Contract A's
 * job (WS-1 spec section 2.1): band meta is pre-baked into
 * src/bandShards.js-shaped shards, read at RUNTIME by
 * src/browser/bandData.client.js for every interactive surface (the drill
 * hub's own live seeding, the Repertoire Builder's reply table, the
 * Opening Report). This module's new job is narrower and purely
 * server-side: walk those same already-crawled shard files, offline, to
 * produce the informational full-line reference content the SPOILER RULE
 * requires living on its own page (drill-reference.html), separate from
 * the interactive drill. It supersedes buildDrillTree/buildDrillData
 * entirely -- neither symbol is exported anymore; nothing in
 * src/buildStatic.js called them (that pilot's own bundle/page write was
 * already dead code by the time this task started -- see
 * src/renderDrillHub.js's header comment).
 */

const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const { isValidShard, decodePositionRecord } = require('./bandShards');
const { applyExplorerUci } = require('./buildPack');
const { scoreInterval } = require('./stats');
const { OPENINGS } = require('./openings');
const { fenToEpd, posKeyFromEpd } = require('./ingest/positionWalk');

const REP_DATA_DIR = path.join(__dirname, '..', 'data', 'rep');

// Same statistical floor the rest of WS-1 uses (spec 3.2.3 / bandShards.js's
// own minGames convention) -- a reference line built from under 300 games
// at a node is more noise than signal, so the walk stops there rather than
// padding the page with a thin sample.
const MIN_REFERENCE_GAMES = 300;

/**
 * @param {string} repDataDir
 * @param {string} band
 * @param {string} shardKey
 * @returns {object|null} the parsed, shape-valid Shard, or null on any
 *   read/parse/shape failure -- same "collapses to no data" contract
 *   src/browser/bandData.client.js's fetchShard() follows, just synchronous
 *   and filesystem-backed instead of networked.
 */
function readShardSync(repDataDir, band, shardKey) {
  const file = path.join(repDataDir, band, `${shardKey}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isValidShard(json) ? json : null;
  } catch (err) {
    return null;
  }
}

function shardKeyForPlay(play) {
  return play.length <= 2 ? 'root' : `${play[0]}-${play[1]}`;
}

/**
 * Looks up one position's decoded record + SAN-annotated moves directly
 * from the committed shard files -- the same shape
 * src/browser/bandData.client.js's lookup() returns, but synchronous.
 *
 * @param {string} repDataDir
 * @param {string} band
 * @param {string[]} play
 * @returns {{coverage:'in'|'out-of-book', games:number,
 *   moves:Array<{uci:string, san:string, games:number, score:number,
 *   scoreLo:number, scoreHi:number}>}}
 */
function lookupSync(repDataDir, band, play) {
  const shard = readShardSync(repDataDir, band, shardKeyForPlay(play));
  if (!shard) return { coverage: 'out-of-book', games: 0, moves: [] };

  const chess = new Chess();
  for (const uci of play) {
    try {
      applyExplorerUci(chess, uci);
    } catch (err) {
      return { coverage: 'out-of-book', games: 0, moves: [] };
    }
  }
  const fen = chess.fen();
  // Re-derive the posKey the same way bandShards.posKeyFor does, without
  // paying for a second chess.js replay -- fenToEpd/posKeyFromEpd are pure
  // string transforms of the FEN we already have in hand.
  const posKey = posKeyFromEpd(fenToEpd(fen));
  const record = shard.positions[posKey];
  if (!record) return { coverage: 'out-of-book', games: 0, moves: [] };

  const decoded = decodePositionRecord(record);
  const games = decoded.w + decoded.d + decoded.b;
  const sideToMove = chess.turn();
  const moves = decoded.moves.map((m) => {
    const moveGames = m.w + m.d + m.b;
    const interval = sideToMove === 'w' ? scoreInterval(m.w, m.d, m.b) : scoreInterval(m.b, m.d, m.w);
    let san = m.uci;
    try {
      const result = applyExplorerUci(chess, m.uci);
      if (result) {
        san = result.san;
        chess.undo();
      }
    } catch (err) {
      // leave san as the raw uci -- one bad record degrades a single row.
    }
    return { uci: m.uci, san, games: moveGames, score: interval.score, scoreLo: interval.low, scoreHi: interval.high };
  });

  return { coverage: 'in', games, moves };
}

/**
 * Walks one opening's own line, best-first by game count, to `maxPlies`
 * beyond the opening's prefix, branching into the top `breadth` replies at
 * each ply. Returns each root-to-leaf path as a plain, printable line.
 *
 * @param {object} opts
 * @param {string} opts.band
 * @param {object} opts.opening one of src/openings.js's OPENINGS entries.
 * @param {string} [opts.repDataDir]
 * @param {number} [opts.maxPlies]
 * @param {number} [opts.breadth]
 * @returns {Array<{totalGames:number, plies:Array<{san:string, games:number,
 *   score:number}>}>}
 */
function buildReferenceLines({ band, opening, repDataDir = REP_DATA_DIR, maxPlies = 6, breadth = 2 }) {
  const startPlay = opening.line.map((p) => p.uci);
  const lines = [];

  function walk(play, plies) {
    if (play.length - startPlay.length >= maxPlies) {
      if (plies.length > 0) lines.push({ totalGames: plies[plies.length - 1].games, plies });
      return;
    }
    const result = lookupSync(repDataDir, band, play);
    const eligible = result.moves.filter((m) => m.games >= MIN_REFERENCE_GAMES).sort((a, b) => b.games - a.games);
    if (eligible.length === 0) {
      if (plies.length > 0) lines.push({ totalGames: plies[plies.length - 1].games, plies });
      return;
    }
    const top = eligible.slice(0, breadth);
    for (const mv of top) {
      walk([...play, mv.uci], [...plies, { san: mv.san, games: mv.games, score: mv.score }]);
    }
  }

  walk(startPlay, []);
  // Longest, best-supported lines first.
  return lines.sort((a, b) => b.plies.length - a.plies.length || b.totalGames - a.totalGames).slice(0, breadth ** 2);
}

/**
 * Builds the full drill-reference.html content: for every real rating band
 * (spec 3.4's scope boundary -- no sub-1400 band exists to crawl) and
 * every opening with actual coverage in the committed shards, the lines
 * buildReferenceLines() produces. Openings with zero coverage at a given
 * band are OMITTED for that band (spec Non-Negotiable 4: no locked/empty
 * content that pretends to exist) rather than rendered as an empty section.
 *
 * @param {{bands?:string[], openings?:object[], repDataDir?:string,
 *   maxPlies?:number, breadth?:number}} [opts]
 * @returns {Array<{band:string, openings:Array<{slug:string, name:string,
 *   eco:string, lines:Array<object>}>}>}
 */
function buildDrillReferenceData({ bands = ['1400-1600', '1600-1800', '1800-2000', '2000+'], openings = OPENINGS, repDataDir = REP_DATA_DIR, maxPlies = 6, breadth = 2 } = {}) {
  return bands.map((band) => {
    const openingEntries = openings
      .map((opening) => {
        const lines = buildReferenceLines({ band, opening, repDataDir, maxPlies, breadth });
        return { slug: opening.slug, name: opening.name, eco: opening.ecoHint, side: opening.side, lines };
      })
      .filter((entry) => entry.lines.length > 0);
    return { band, openings: openingEntries };
  });
}

/**
 * Reads data/rep/manifest.json (spec 2.1: "every number the site later
 * prints from a shard must be traceable to this manifest"). Never throws --
 * a missing/unparseable manifest is a real build-state possibility (a
 * checkout with no crawl run yet) and callers degrade to an honest "no data
 * yet" message rather than a stack trace.
 *
 * @param {string} [repDataDir]
 * @returns {{retrieved:string, pool:string, source:string}|null}
 */
function readManifest(repDataDir = REP_DATA_DIR) {
  const file = path.join(repDataDir, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof json.retrieved !== 'string') return null;
    return { retrieved: json.retrieved, pool: json.pool, source: json.source };
  } catch (err) {
    return null;
  }
}

module.exports = {
  REP_DATA_DIR,
  MIN_REFERENCE_GAMES,
  readShardSync,
  readManifest,
  lookupSync,
  buildReferenceLines,
  buildDrillReferenceData,
};
