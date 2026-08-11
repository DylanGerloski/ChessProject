'use strict';

/**
 * Rating-band opening-repertoire tree builder + static-site entry point.
 *
 * buildRepertoireTree() walks the Opening Explorer position-by-position:
 * at the chosen color's own plies it branches into the top `breadth`
 * most-played moves (so the user sees real alternatives at their rating);
 * at the opponent's plies it follows only their single most-played reply
 * (the user doesn't choose the opponent's moves, so there's nothing to
 * branch on). This keeps the number of live API calls small and bounded
 * by `breadth` and `maxUserPlies` instead of growing as a full move tree.
 *
 * Usage: node src/buildRepertoire.js <rating-band> <color>
 *   e.g. node src/buildRepertoire.js 1600-1800 white
 */

const fs = require('fs');
const path = require('path');
const { fetchExplorerMoves, ExplorerRateLimitError, ExplorerApiError } = require('./fetchOpeningExplorer');
const { RATING_BANDS, DEFAULT_SPEEDS, moveStatsFromExplorerResponse } = require('./processRepertoire');
const { renderRepertoirePage } = require('./render');

/**
 * @param {object} opts
 * @param {string} opts.ratingBand one of the RATING_BANDS keys
 * @param {'white'|'black'} [opts.color]
 * @param {string[]} [opts.speeds]
 * @param {number} [opts.breadth] candidate moves shown at the user's own plies
 * @param {number} [opts.maxUserPlies] how many of the user's own decision
 *   points to expand (each is followed by one opponent reply)
 * @param {number} [opts.movesPerRequest] moves requested per API call
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ratingBand, ratings, color, speeds, opening, totals, tree}>}
 */
async function buildRepertoireTree({
  ratingBand,
  color = 'white',
  speeds = DEFAULT_SPEEDS,
  breadth = 3,
  maxUserPlies = 2,
  movesPerRequest = 8,
  fetchImpl = fetch,
} = {}) {
  const ratings = RATING_BANDS[ratingBand];
  if (!ratings) {
    throw new Error(`Unknown rating band: "${ratingBand}". Valid bands: ${Object.keys(RATING_BANDS).join(', ')}`);
  }
  if (color !== 'white' && color !== 'black') {
    throw new Error(`color must be "white" or "black", got "${color}"`);
  }

  let rootTotals = null;
  let rootOpening = null;

  async function expand(play, userPliesRemaining) {
    const response = await fetchExplorerMoves({ play, ratings, speeds, moves: movesPerRequest, fetchImpl });

    if (play.length === 0) {
      rootTotals = { white: response.white || 0, draws: response.draws || 0, black: response.black || 0 };
      rootOpening = response.opening || null;
    }

    const whiteToMove = play.length % 2 === 0;
    const userToMove = whiteToMove === (color === 'white');
    const moverColor = userToMove ? color : (color === 'white' ? 'black' : 'white');
    const candidates = moveStatsFromExplorerResponse(response, moverColor);

    if (userToMove) {
      const top = candidates.slice(0, breadth);
      const nodes = [];
      for (const mv of top) {
        const children = userPliesRemaining > 0
          ? await expand([...play, mv.uci], userPliesRemaining - 1)
          : null;
        nodes.push({ ...mv, ply: play.length, mover: moverColor, children });
      }
      return nodes;
    }

    // Opponent to move: follow only their single most-played reply.
    const top = candidates.slice(0, 1);
    if (top.length === 0) return [];
    const mv = top[0];
    const children = userPliesRemaining > 0
      ? await expand([...play, mv.uci], userPliesRemaining)
      : null;
    return [{ ...mv, ply: play.length, mover: moverColor, children }];
  }

  const tree = await expand([], maxUserPlies);
  return { ratingBand, ratings, color, speeds, opening: rootOpening, totals: rootTotals, tree };
}

async function main() {
  const [band, color] = process.argv.slice(2);
  if (!band || !color) {
    console.error('Usage: node src/buildRepertoire.js <rating-band> <color>');
    console.error(`  rating-band: one of ${Object.keys(RATING_BANDS).join(', ')}`);
    console.error('  color: white | black');
    process.exitCode = 1;
    return;
  }

  try {
    const data = await buildRepertoireTree({ ratingBand: band, color });
    const html = renderRepertoirePage(data);
    const outDir = path.join(__dirname, '..', 'dist');
    fs.mkdirSync(outDir, { recursive: true });
    const safeBand = band.replace(/[^\w-]/g, '');
    const outFile = path.join(outDir, `repertoire-${safeBand}-${color}.html`);
    fs.writeFileSync(outFile, html, 'utf8');
    console.log(`Wrote ${outFile}`);
    console.log('Open it in a browser, e.g.:');
    console.log(`  start "" "${outFile}"`);
  } catch (err) {
    if (err instanceof ExplorerRateLimitError) {
      console.error('Lichess Opening Explorer rate limit hit, try again shortly.');
    } else if (err instanceof ExplorerApiError) {
      console.error('Opening Explorer API request failed:', err.message);
    } else {
      console.error('Build failed:', err.message);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildRepertoireTree };
