'use strict';

/**
 * Pure processing functions for the rating-band opening-repertoire explorer.
 * No I/O here -- everything takes plain data in and returns plain data out,
 * same convention as process.js.
 */

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
 *   averageRating:number|null}>} sorted by games played, descending
 */
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

      return {
        uci: m.uci,
        san: m.san,
        games,
        playedPct: total > 0 ? Number(((games / total) * 100).toFixed(1)) : null,
        winPct: games > 0 ? Number(((winForMover / games) * 100).toFixed(1)) : null,
        drawPct: games > 0 ? Number(((draws / games) * 100).toFixed(1)) : null,
        lossPct: games > 0 ? Number(((lossForMover / games) * 100).toFixed(1)) : null,
        averageRating: typeof m.averageRating === 'number' ? m.averageRating : null,
      };
    })
    .sort((a, b) => b.games - a.games);
}

module.exports = {
  RATING_BANDS,
  DEFAULT_SPEEDS,
  moveStatsFromExplorerResponse,
};
