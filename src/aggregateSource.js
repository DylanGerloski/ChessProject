'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');
const { fenToEpd, posKeyFromEpd } = require('./ingest/positionWalk');

/**
 * The adapter that lets buildRepertoire.js, buildContent.js, buildDrill.js
 * and buildEcoPages.js switch their data source from the live Opening
 * Explorer API to this project's own dump-backed aggregates with a
 * one-line change, because it returns THE SAME shape
 * src/fetchOpeningExplorer.js's fetchExplorerMoves() already does:
 * `{white, draws, black, moves: [{uci, san, averageRating, white, draws,
 * black}], opening}`. Every existing consumer already funnels through
 * src/processRepertoire.js's moveStatsFromExplorerResponse(), so matching
 * that shape exactly is what keeps this a source swap, not a rewrite.
 *
 * That flip has since happened (spec WS-3.2): all four builders now route
 * their lichess-database move lookups through src/explorerSource.js's
 * fetchMoves(), which calls explorerShapedResponse() below when aggregate
 * data is present at data/aggregates/ and falls back to the live Explorer
 * API otherwise (data/aggregates/ doesn't exist on disk until this repo's
 * first human-gated live dump ingest has actually run -- see
 * explorerSource.js's own header comment for why that fallback exists and
 * what it means for today's production build). This module itself stays
 * unchanged either way -- it's still built and tested standalone; the
 * routing/fallback decision lives entirely in explorerSource.js, not here.
 *
 * `balanced: {white, draws, black}` and `posKey` are NEW fields the live
 * Explorer response never had -- existing consumers ignore unknown fields
 * on the object they destructure, so this is additive, not a shape
 * mismatch. `averageRating` on the top-level Explorer response is a
 * NOOP -- the live API returns it per game family/opening lookup, which
 * this dataset doesn't reproduce; only per-move averageRating (derivable
 * from the stored rating sum/count -- see src/ingest/aggregate.js's
 * `_toJsonRecord` comment) is populated here.
 */

/**
 * Loads one ingest run's output directory. Throws loudly (not a silent
 * empty-data fallback) if the manifest is missing -- any renderer printing
 * a number derived from a shard should fail the build rather than publish
 * a number with no traceable source/retrieval date behind it. Manifest
 * freshness/malformed checks belong to a separate data-sanity script; this
 * function only guarantees the manifest exists and parses.
 *
 * @param {{dir: string}} args
 * @returns {{manifest: object, root: object, family: (slug: string) => object|null, dir: string}}
 */
function loadAggregates({ dir }) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`aggregateSource.loadAggregates: no manifest.json at ${manifestPath} -- run scripts/ingestDump.js first`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`aggregateSource.loadAggregates: manifest.json at ${manifestPath} is not valid JSON: ${err.message}`);
  }

  const rootPath = path.join(dir, 'root.json');
  if (!fs.existsSync(rootPath)) {
    throw new Error(`aggregateSource.loadAggregates: no root.json at ${rootPath} -- run scripts/ingestDump.js first`);
  }
  const root = JSON.parse(fs.readFileSync(rootPath, 'utf8'));

  const familyCache = new Map();
  function family(slug) {
    if (!slug) return null;
    if (familyCache.has(slug)) return familyCache.get(slug);
    const familyPath = path.join(dir, 'f', `${slug}.json`);
    const data = fs.existsSync(familyPath) ? JSON.parse(fs.readFileSync(familyPath, 'utf8')) : null;
    familyCache.set(slug, data);
    return data;
  }

  return { manifest, root, family, dir };
}

function positionRecordFrom(positionsByBand, band, pool, posKey) {
  return positionsByBand && positionsByBand[band] && positionsByBand[band][pool]
    ? positionsByBand[band][pool][posKey] || null
    : null;
}

/**
 * Resolves one (band, pool, posKey) position record, checking root.json
 * first, then the given family shard. A position at ply <= ROOT_MAX_PLY
 * (src/ingest/aggregate.js, 3 as of the 2026-08-15 shard-size fix) always
 * lives in root.json (src/ingest/aggregate.js's shard-assignment rule); a
 * `familySlug` is only needed for deeper positions.
 */
function findPositionRecord({ aggregates, band, pool, posKey, familySlug }) {
  const fromRoot = positionRecordFrom(aggregates.root.positions, band, pool, posKey);
  if (fromRoot) return fromRoot;
  if (familySlug) {
    const familyData = aggregates.family(familySlug);
    const fromFamily = familyData ? positionRecordFrom(familyData.positions, band, pool, posKey) : null;
    if (fromFamily) return fromFamily;
  }
  return null;
}

/** SAN for a UCI move from a given position, via a throwaway chess.js clone. */
function sanForUci(fen, uci) {
  const clone = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const moveResult = clone.move({ from, to, promotion });
  return moveResult ? moveResult.san : uci;
}

/**
 * Replays `play` (a UCI move list from the starting position) to find the
 * resulting FEN/EPD/posKey. Pure chess.js replay -- does not touch the
 * aggregate data, so it works identically whether or not the target
 * position exists in this dataset.
 */
function resolvePosition(play) {
  const chess = new Chess();
  for (const uci of play) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    let moveResult;
    try {
      moveResult = chess.move({ from, to, promotion });
    } catch (err) {
      moveResult = null;
    }
    if (!moveResult) {
      throw new Error(`aggregateSource.resolvePosition: illegal move "${uci}" in play list [${play.join(',')}]`);
    }
  }
  const fen = chess.fen();
  const epd = fenToEpd(fen);
  return { fen, epd, posKey: posKeyFromEpd(epd) };
}

/**
 * The shape-matching entry point. Returns the SAME object shape
 * fetchExplorerMoves() returns, so every existing consumer that already
 * funnels through moveStatsFromExplorerResponse() keeps working unchanged
 * once a caller switches which of these two functions it calls.
 *
 * @param {object} args
 * @param {{manifest: object, root: object, family: Function}} args.aggregates
 *   loadAggregates() output.
 * @param {string[]} [args.play] UCI moves from the starting position.
 * @param {string} args.band one of gameFilter.BANDS' keys.
 * @param {string} args.pool one of 'bullet'|'blitz'|'rapid_classical'.
 * @param {string} [args.familySlug] required to resolve any position deeper
 *   than ROOT_MAX_PLY (root.json only carries ply <= ROOT_MAX_PLY, 3 as of
 *   the 2026-08-15 shard-size fix) -- the caller (a
 *   family-scoped page builder) always knows which family it's building.
 * @returns {{white:number, draws:number, black:number,
 *   moves: Array<{uci:string, san:string, averageRating:number|null,
 *   white:number, draws:number, black:number}>,
 *   opening: null, balanced: {white:number, draws:number, black:number},
 *   posKey: string}}
 */
function explorerShapedResponse({ aggregates, play = [], band, pool, familySlug }) {
  if (!band || !pool) {
    throw new Error('aggregateSource.explorerShapedResponse: band and pool are required');
  }
  const { fen, posKey } = resolvePosition(play);
  const record = findPositionRecord({ aggregates, band, pool, posKey, familySlug });

  if (!record) {
    return {
      white: 0, draws: 0, black: 0, moves: [], opening: null,
      balanced: { white: 0, draws: 0, black: 0 }, posKey,
    };
  }

  const [w, d, l, bw, bd, bl, movesObj] = record;
  const moves = Object.entries(movesObj || {})
    .map(([uci, arr]) => {
      const [mw, md, ml, mbw, mbd, mbl, ratingSum, ratingCount] = arr;
      return {
        uci,
        san: sanForUci(fen, uci),
        averageRating: ratingCount > 0 ? Math.round(ratingSum / ratingCount) : null,
        white: mw,
        draws: md,
        black: ml,
        // Rating-diff-controlled (rating gap <= 50) counts for this SAME
        // move, alongside the all-games counts above -- WS-3.3 condition 2
        // ("common mistake" rebuild) scores a candidate move on this subset,
        // not on the all-games totals. Additive field: existing consumers
        // that destructure only {uci, san, averageRating, white, draws,
        // black} are unaffected (module doc's "additive, not a shape
        // mismatch" rule, same as the position-level `balanced` field
        // already was before this change).
        balanced: { white: mbw, draws: mbd, black: mbl },
      };
    })
    .sort((a, b) => (b.white + b.draws + b.black) - (a.white + a.draws + a.black));

  return {
    white: w,
    draws: d,
    black: l,
    moves,
    opening: null,
    balanced: { white: bw, draws: bd, black: bl },
    posKey,
  };
}

/**
 * The RESULTING position's own balanced (rating gap <= 50) W/D/L totals
 * after playing `uci` from `play` -- WS-3.3 condition 4 (transposition
 * check). Because this module keys by POSITION rather than by move path
 * (spec WS-3.1 section 1.4), the record returned here is already merged
 * across every move order that reaches that position, not just this one --
 * that merge is what makes "does this move just transpose into a position
 * that's actually fine?" answerable at all, and it comes for free from the
 * schema rather than needing any extra bookkeeping here.
 *
 * @param {object} args same shape as explorerShapedResponse's, plus:
 * @param {string} args.uci the candidate move to play from `play`.
 * @returns {{white:number, draws:number, black:number}|null} null when the
 *   resulting position isn't present in this dataset (below MIN_GAMES, or
 *   outside the stored ply depth) -- callers must treat that as "no data",
 *   never as a zero, the same "don't invent a number" rule as the rest of
 *   this module.
 */
function resultingPositionBalanced({ aggregates, play = [], uci, band, pool, familySlug }) {
  if (!uci) return null;
  const { posKey } = resolvePosition([...play, uci]);
  const record = findPositionRecord({ aggregates, band, pool, posKey, familySlug });
  if (!record) return null;
  const [, , , bw, bd, bl] = record;
  return { white: bw, draws: bd, black: bl };
}

module.exports = {
  loadAggregates,
  findPositionRecord,
  resolvePosition,
  explorerShapedResponse,
  resultingPositionBalanced,
};
