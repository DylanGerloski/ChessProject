'use strict';

/**
 * Pure processing/aggregation functions. No I/O here at all -- everything
 * takes plain data in and returns plain data out, which is what makes these
 * unit-testable against static fixture JSON.
 */

/**
 * Summarize a rating-history payload (as returned by
 * fetchLichess.fetchRatingHistory) into one row per variant with the stats
 * a stats page would actually want to show.
 *
 * @param {Array<{name: string, points: Array<[number, number, number, number]>}>} history
 * @returns {Array<{variant: string, current: number|null, peak: number|null,
 *   low: number|null, gamesRecorded: number, firstDate: string|null,
 *   lastDate: string|null, change: number|null}>}
 */
function summarizeRatingHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .map((variant) => {
      const points = Array.isArray(variant.points) ? variant.points : [];
      if (points.length === 0) {
        return {
          variant: variant.name,
          current: null,
          peak: null,
          low: null,
          gamesRecorded: 0,
          firstDate: null,
          lastDate: null,
          change: null,
        };
      }

      const ratings = points.map((p) => p[3]);
      const first = points[0];
      const last = points[points.length - 1];

      return {
        variant: variant.name,
        current: last[3],
        peak: Math.max(...ratings),
        low: Math.min(...ratings),
        gamesRecorded: points.length,
        firstDate: pointToDateString(first),
        lastDate: pointToDateString(last),
        change: last[3] - first[3],
      };
    })
    // Drop variants Lichess reports with zero history points -- nothing to show.
    .filter((row) => row.gamesRecorded > 0);
}

function pointToDateString([year, month0, day]) {
  // Lichess months are 0-indexed (0 = January).
  const mm = String(month0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Summarize a list of recent games (as returned by
 * fetchLichess.fetchRecentGames) relative to a given username: win/loss/draw
 * counts, win rate, average opponent rating, and a flat per-game result list
 * ready for rendering.
 *
 * @param {Array<object>} games
 * @param {string} username
 * @returns {{totalGames: number, wins: number, losses: number, draws: number,
 *   winRate: number|null, avgOpponentRating: number|null,
 *   results: Array<{opponent: string, opponentRating: number|null,
 *     result: 'win'|'loss'|'draw', color: 'white'|'black', variant: string,
 *     speed: string, date: string|null}>}}
 */
function summarizeGames(games, username) {
  if (!Array.isArray(games) || !username) {
    return { totalGames: 0, wins: 0, losses: 0, draws: 0, winRate: null, avgOpponentRating: null, results: [] };
  }

  const lowerUsername = username.toLowerCase();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let opponentRatingSum = 0;
  let opponentRatingCount = 0;

  const results = games.map((game) => {
    const players = game.players || {};
    const white = players.white || {};
    const black = players.black || {};
    const whiteName = ((white.user && white.user.name) || 'anonymous').toLowerCase();
    const isWhite = whiteName === lowerUsername;
    const me = isWhite ? white : black;
    const opponent = isWhite ? black : white;

    let result;
    if (!game.winner) {
      result = 'draw';
      draws += 1;
    } else if (game.winner === (isWhite ? 'white' : 'black')) {
      result = 'win';
      wins += 1;
    } else {
      result = 'loss';
      losses += 1;
    }

    const opponentRating = typeof opponent.rating === 'number' ? opponent.rating : null;
    if (opponentRating !== null) {
      opponentRatingSum += opponentRating;
      opponentRatingCount += 1;
    }

    return {
      opponent: (opponent.user && opponent.user.name) || 'Anonymous',
      opponentRating,
      result,
      color: isWhite ? 'white' : 'black',
      variant: game.variant || 'standard',
      speed: game.speed || 'unknown',
      date: game.createdAt ? new Date(game.createdAt).toISOString().slice(0, 10) : null,
    };
  });

  const totalGames = games.length;
  return {
    totalGames,
    wins,
    losses,
    draws,
    winRate: totalGames > 0 ? Number(((wins / totalGames) * 100).toFixed(1)) : null,
    avgOpponentRating: opponentRatingCount > 0 ? Math.round(opponentRatingSum / opponentRatingCount) : null,
    results,
  };
}

module.exports = {
  summarizeRatingHistory,
  summarizeGames,
};
