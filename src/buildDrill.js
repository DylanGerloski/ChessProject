'use strict';

/**
 * Data builder for the single-opening progressive recall drill (beta pilot).
 *
 * buildRepertoire.js branches at the user's own plies, because it's a browse
 * tool and the user is choosing between real alternatives. A drill instead
 * needs exactly one graded answer per user ply, and gets its variety from
 * the OPPONENT's replies instead -- so this module mirrors that recursion
 * with branching moved to the opponent's plies. It does not modify
 * buildRepertoire.js or any of the already-shipped repertoire pages; the
 * shared logic it reuses lives in fetchOpeningExplorer.js and
 * processRepertoire.js.
 *
 * Tree shape (per rating band), matching the drill's alternating structure:
 *   oppNode  = { replies: [ { uci, san, games, playedPct, node: userNode } ] }
 *   userNode = { candidates: [ {uci,san,games,playedPct,winPct,drawPct,lossPct} ], answerUci, then: oppNode | null }
 * `answerUci` is always candidates[0].uci -- the most-played move in that
 * position, which is what the user is graded against (see drillLogic.js).
 * `then` is null at the deepest user ply; otherwise it's the next oppNode.
 */

const { RATING_BANDS, DEFAULT_SPEEDS, moveStatsFromExplorerResponse } = require('./processRepertoire');
const { getOpening } = require('./openings');
const { PIECE_GLYPH } = require('./renderContent');
const { fetchMoves, AGGREGATES_DIR } = require('./explorerSource');
const { slugifyFamilyName } = require('./ecoFamilies');

// How many of the user's own decision points the drill covers. Each is
// preceded by one opponent ply (auto-played and shown to the user).
const DRILL_USER_DEPTH = 4;

// How many replies the opponent branches into at each of its plies, indexed
// 0..DRILL_USER_DEPTH-1. This is the sole source of tree variety -- the user
// side always follows the single most-played ("band-typical") move. With
// this exact array, one rating band costs 25 Explorer requests to build
// (1 + 2 + 2 + 4 + 4 + 4 + 4 + 4); changing it changes that cost.
const DRILL_OPPONENT_BREADTH = [2, 2, 1, 1];

// How many candidate moves are shown to the user at each of their plies.
const DRILL_CANDIDATES = 4;

/**
 * Builds the drill tree for a single rating band, starting from the position
 * after `prefixPlay` (where the opponent is to move).
 *
 * @param {object} opts
 * @param {string} opts.ratingBand one of the RATING_BANDS keys
 * @param {'white'|'black'} [opts.color] which side the user plays
 * @param {string[]} [opts.speeds]
 * @param {string[]} opts.prefixPlay UCI moves from the start position up to
 *   the drill's root (opponent to move)
 * @param {number} [opts.userDepth]
 * @param {number[]} [opts.opponentBreadth]
 * @param {number} [opts.candidateCount]
 * @param {number} [opts.movesPerRequest]
 * @param {Function} [opts.fetchImpl] forwarded to the live-Explorer fallback only.
 * @param {string} [opts.familySlug] the opening's ECO family slug (see
 *   ecoFamilies.js's slugifyFamilyName) -- REQUIRED once aggregate data is
 *   present: unlike buildRepertoireTree's shallow walk, the drill's
 *   prefixPlay (up to 5 plies) plus up to `userDepth`*2 more plies can go
 *   well past root.json's ply<=ROOT_MAX_PLY coverage (3 as of the
 *   2026-08-15 shard-size fix, src/ingest/aggregate.js), so a position here
 *   often needs the family shard. Silently ignored on the live-API fallback
 *   path.
 * @param {string} [opts.aggregatesDir] see src/explorerSource.js's `dir` param.
 * @returns {Promise<object>} the root oppNode
 */
async function buildDrillTree({
  ratingBand,
  color = 'white',
  speeds = DEFAULT_SPEEDS,
  prefixPlay,
  userDepth = DRILL_USER_DEPTH,
  opponentBreadth = DRILL_OPPONENT_BREADTH,
  candidateCount = DRILL_CANDIDATES,
  movesPerRequest = 8,
  fetchImpl = fetch,
  familySlug = null,
  aggregatesDir = AGGREGATES_DIR,
} = {}) {
  const ratings = RATING_BANDS[ratingBand];
  if (!ratings) {
    throw new Error(`buildDrillTree: unknown rating band "${ratingBand}". Valid bands: ${Object.keys(RATING_BANDS).join(', ')}`);
  }
  if (color !== 'white' && color !== 'black') {
    throw new Error(`buildDrillTree: color must be "white" or "black", got "${color}"`);
  }
  if (!Array.isArray(prefixPlay) || prefixPlay.length === 0) {
    throw new Error('buildDrillTree: prefixPlay must be a non-empty array of UCI moves');
  }
  if (!Array.isArray(opponentBreadth) || opponentBreadth.length < userDepth) {
    throw new Error('buildDrillTree: opponentBreadth must have at least userDepth entries');
  }

  const userColor = color;
  const opponentColor = color === 'white' ? 'black' : 'white';
  const ctx = { ratings, speeds, userColor, opponentColor, opponentBreadth, candidateCount, userDepth, movesPerRequest, fetchImpl };

  async function expandOpponent(play, oppDepth) {
    const response = await fetchMoves({ play, band: ratingBand, ratings, speeds, moves: ctx.movesPerRequest, familySlug, fetchImpl: ctx.fetchImpl, dir: aggregatesDir });
    const candidates = moveStatsFromExplorerResponse(response, opponentColor);
    if (candidates.length === 0) {
      throw new Error(`buildDrillTree: zero candidate moves at opponent ply ${oppDepth} (play=${play.join(',')})`);
    }
    const breadth = ctx.opponentBreadth[oppDepth];
    const top = candidates.slice(0, breadth);

    const replies = [];
    for (const mv of top) {
      const nextPlay = [...play, mv.uci];
      const node = await expandUser(nextPlay, oppDepth);
      replies.push({ uci: mv.uci, san: mv.san, games: mv.games, playedPct: mv.playedPct, node });
    }
    return { replies };
  }

  async function expandUser(play, oppDepth) {
    const response = await fetchMoves({ play, band: ratingBand, ratings, speeds, moves: ctx.movesPerRequest, familySlug, fetchImpl: ctx.fetchImpl, dir: aggregatesDir });
    const allCandidates = moveStatsFromExplorerResponse(response, userColor);
    if (allCandidates.length === 0) {
      throw new Error(`buildDrillTree: zero candidate moves at user ply ${oppDepth} (play=${play.join(',')})`);
    }
    const candidates = allCandidates.slice(0, ctx.candidateCount);
    const top = candidates[0];
    if (top.games === 0) {
      throw new Error(`buildDrillTree: top candidate has zero games at user ply ${oppDepth} (play=${play.join(',')})`);
    }
    const answerUci = top.uci;
    if (answerUci.length === 5) {
      throw new Error(`buildDrillTree: answer move "${answerUci}" is a promotion, which the drill has no UI for (user ply ${oppDepth}, play=${play.join(',')})`);
    }

    let then = null;
    if (oppDepth + 1 < ctx.userDepth) {
      const nextPlay = [...play, answerUci];
      then = await expandOpponent(nextPlay, oppDepth + 1);
    }
    return { candidates, answerUci, then };
  }

  return expandOpponent(prefixPlay, 0);
}

/**
 * Builds the full drill payload (all rating bands) for one opening, ready to
 * be baked into a static page as JSON.
 *
 * @param {object} opts
 * @param {string} [opts.openingSlug] must name a white-side opening in openings.js
 * @param {string[]} [opts.speeds]
 * @param {string[]} [opts.bands] which RATING_BANDS keys to build; defaults to all
 * @param {number} [opts.userDepth]
 * @param {number[]} [opts.opponentBreadth]
 * @param {number} [opts.candidateCount]
 * @param {Function} [opts.fetchImpl]
 * @param {string} [opts.aggregatesDir] see src/explorerSource.js's `dir` param.
 * @returns {Promise<object>} { version, opening, prefix, speeds, retrieved, glyphs, bands }
 */
async function buildDrillData({
  openingSlug = 'italian-game',
  speeds = DEFAULT_SPEEDS,
  bands = Object.keys(RATING_BANDS),
  userDepth = DRILL_USER_DEPTH,
  opponentBreadth = DRILL_OPPONENT_BREADTH,
  candidateCount = DRILL_CANDIDATES,
  fetchImpl = fetch,
  aggregatesDir = AGGREGATES_DIR,
} = {}) {
  const opening = getOpening(openingSlug);
  if (!opening) {
    throw new Error(`buildDrillData: unknown opening slug "${openingSlug}"`);
  }
  if (opening.side !== 'white') {
    throw new Error(`buildDrillData: only a white-side opening is supported by this pilot drill, got "${opening.side}" for "${openingSlug}"`);
  }

  const familySlug = slugifyFamilyName(opening.name);
  const prefixPlay = opening.line.map((ply) => ply.uci);
  const bandsOut = {};
  for (const band of bands) {
    bandsOut[band] = await buildDrillTree({
      ratingBand: band,
      color: 'white',
      speeds,
      prefixPlay,
      userDepth,
      opponentBreadth,
      candidateCount,
      fetchImpl,
      familySlug,
      aggregatesDir,
    });
  }

  return {
    version: 1,
    opening: { slug: opening.slug, name: opening.name, eco: opening.ecoHint, side: opening.side },
    prefix: opening.line.map((ply) => ({ uci: ply.uci, san: ply.san })),
    speeds,
    retrieved: new Date().toISOString(),
    glyphs: PIECE_GLYPH,
    bands: bandsOut,
  };
}

module.exports = {
  DRILL_USER_DEPTH,
  DRILL_OPPONENT_BREADTH,
  DRILL_CANDIDATES,
  buildDrillTree,
  buildDrillData,
};
