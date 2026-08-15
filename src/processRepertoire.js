'use strict';

/**
 * Pure processing functions for the rating-band opening-repertoire explorer.
 * No I/O here -- everything takes plain data in and returns plain data out,
 * same convention as process.js.
 */

const { wilsonInterval } = require('./stats');

// Rating bands offered by the explorer page, mapped to the Opening Explorer
// API's fixed rating-bucket lower-bounds (0, 1000, 1200, 1400, 1600, 1800,
// 2000, 2200, 2500). Listing more than one bucket combines them into one
// aggregate result, which is how "2000+" is built from three buckets.
const RATING_BANDS = {
  '1400-1600': [1400],
  '1600-1800': [1600],
  '1800-2000': [1800],
  '2000+': [2000, 2200, 2500],
};

const DEFAULT_SPEEDS = ['blitz', 'rapid'];

/**
 * Turn one Opening Explorer response into a sorted, per-move stats array.
 *
 * @param {{white:number, draws:number, black:number, moves:Array}} response
 * @param {'white'|'black'} moverColor the color making these candidate moves
 * @returns {Array<{uci:string, san:string, games:number, playedPct:number|null,
 *   winPct:number|null, drawPct:number|null, lossPct:number|null,
 *   winCI:number|null, drawCI:number|null, lossCI:number|null,
 *   averageRating:number|null, balanced:{white:number,draws:number,black:number}|null,
 *   balancedGames:number, resultingBalanced:{white:number,draws:number,black:number}|null}>}
 *   sorted by games played, descending. `winCI`/`drawCI`/`lossCI` are Wilson
 *   half-widths in PERCENTAGE POINTS (spec WS-3.3 section 3.1 -- the right
 *   interval for a binomial rate; see src/stats.js's module doc for why
 *   score, computed elsewhere, uses a different formula). `balanced` is the
 *   SAME move's rating-gap-<=50 counts (only present when this response
 *   came from src/aggregateSource.js -- null on the live-Explorer-API
 *   fallback, which carries no such split); `resultingBalanced` is the
 *   position this move LEADS TO, forwarded unchanged from
 *   src/explorerSource.js's enrichment (also null on the live fallback).
 *   Both are additive/pass-through fields existing callers can ignore.
 */
/** Wilson interval for k/n, in PERCENTAGE POINTS (not a fraction), or all-null when n <= 0. */
function wilsonPct(k, n) {
  if (!(n > 0)) return { half: null, low: null, high: null };
  const { low, high, half } = wilsonInterval(k, n);
  return { half: Number((half * 100).toFixed(1)), low: Number((low * 100).toFixed(1)), high: Number((high * 100).toFixed(1)) };
}

function moveStatsFromExplorerResponse(response, moverColor) {
  if (moverColor !== 'white' && moverColor !== 'black') {
    throw new Error(`moverColor must be "white" or "black", got "${moverColor}"`);
  }
  const moves = response && Array.isArray(response.moves) ? response.moves : [];
  const total = response ? (response.white || 0) + (response.draws || 0) + (response.black || 0) : 0;

  return moves
    .map((m) => {
      const white = m.white || 0;
      const draws = m.draws || 0;
      const black = m.black || 0;
      const games = white + draws + black;
      const winForMover = moverColor === 'white' ? white : black;
      const lossForMover = moverColor === 'white' ? black : white;

      const balanced = m.balanced ? { white: m.balanced.white || 0, draws: m.balanced.draws || 0, black: m.balanced.black || 0 } : null;
      const balancedGames = balanced ? balanced.white + balanced.draws + balanced.black : 0;

      const winInterval = wilsonPct(winForMover, games);
      const drawInterval = wilsonPct(draws, games);
      const lossInterval = wilsonPct(lossForMover, games);

      return {
        uci: m.uci,
        san: m.san,
        games,
        playedPct: total > 0 ? Number(((games / total) * 100).toFixed(1)) : null,
        winPct: games > 0 ? Number(((winForMover / games) * 100).toFixed(1)) : null,
        drawPct: games > 0 ? Number(((draws / games) * 100).toFixed(1)) : null,
        lossPct: games > 0 ? Number(((lossForMover / games) * 100).toFixed(1)) : null,
        winCI: winInterval.half,
        drawCI: drawInterval.half,
        lossCI: lossInterval.half,
        // Exact Wilson bounds (not a symmetric pct+/-half approximation) --
        // used by src/renderContent.js's sr-only interval text so an
        // assistive-tech reader gets the real (slightly asymmetric) bounds,
        // not a reconstruction.
        winLow: winInterval.low,
        winHigh: winInterval.high,
        drawLow: drawInterval.low,
        drawHigh: drawInterval.high,
        lossLow: lossInterval.low,
        lossHigh: lossInterval.high,
        averageRating: typeof m.averageRating === 'number' ? m.averageRating : null,
        balanced,
        balancedGames,
        resultingBalanced: m.resultingBalanced || null,
      };
    })
    .sort((a, b) => b.games - a.games);
}

module.exports = {
  RATING_BANDS,
  DEFAULT_SPEEDS,
  moveStatsFromExplorerResponse,
};
