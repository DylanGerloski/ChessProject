'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Data-fetch module for Lichess's Opening Explorer API
 * (https://lichess.org/api#tag/Opening-Explorer). This queries the
 * "lichess" database (aggregated stats over all rated Lichess games),
 * not the masters or per-player databases.
 *
 * As of 2026-08-11 Lichess requires a personal access token for this
 * endpoint specifically (anonymous requests get 401).
 * The token is read once, in order: LICHESS_API_TOKEN env var, then a local
 * `.lichess-token` file in the project root (gitignored, never committed).
 * Neither is required to import this module -- fetchExplorerMoves() only
 * throws if a request is actually attempted with no token available.
 *
 * Like fetchLichess.js, every exported function accepts an injectable
 * `fetchImpl` (defaulting to the global `fetch`) so tests can supply a fake
 * implementation backed by fixture JSON instead of hitting the live network.
 */

const EXPLORER_BASE_URL = 'https://explorer.lichess.org/lichess';
const MASTERS_BASE_URL = 'https://explorer.lichess.org/masters';
const TOKEN_FILE_PATH = path.join(__dirname, '..', '.lichess-token');

function readLocalToken() {
  try {
    return fs.readFileSync(TOKEN_FILE_PATH, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function getApiToken() {
  const envToken = process.env.LICHESS_API_TOKEN && process.env.LICHESS_API_TOKEN.trim();
  return envToken || readLocalToken();
}

// Standard chess starting position.
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

class ExplorerRateLimitError extends Error {
  constructor(retryAfter) {
    super(`Lichess Opening Explorer rate limit hit${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`);
    this.name = 'ExplorerRateLimitError';
    this.retryAfter = retryAfter || null;
  }
}

class ExplorerApiError extends Error {
  constructor(status, statusText, url) {
    super(`Opening Explorer API request failed: ${status} ${statusText} (${url})`);
    this.name = 'ExplorerApiError';
    this.status = status;
  }
}

class ExplorerAuthError extends Error {
  constructor() {
    super(
      'Lichess Opening Explorer requires a personal access token. Set the LICHESS_API_TOKEN ' +
      `environment variable, or put the token (and nothing else) in ${TOKEN_FILE_PATH}.`
    );
    this.name = 'ExplorerAuthError';
  }
}

async function handleExplorerErrors(response, url) {
  if (response.status === 401) {
    throw new ExplorerAuthError();
  }
  if (response.status === 429) {
    const retryAfter = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('retry-after')
      : null;
    throw new ExplorerRateLimitError(retryAfter);
  }
  if (!response.ok) {
    throw new ExplorerApiError(response.status, response.statusText, url);
  }
}

/**
 * GET https://explorer.lichess.org/lichess (or /masters) -> aggregated move
 * stats for a position. The lichess database is restricted to the given
 * rating bucket(s) and speed(s); the masters database (real
 * grandmaster-level games) ignores rating/speed entirely (Lichess's API
 * itself ignores those params for /masters -- verified against a live probe).
 *
 * @param {object} opts
 * @param {string} [opts.fen] FEN of the position to query (defaults to the
 *   standard starting position).
 * @param {string[]} [opts.play] UCI moves played so far from `fen`, used to
 *   walk forward to a deeper position without computing FENs ourselves.
 * @param {'lichess'|'masters'} [opts.database] which Explorer database to
 *   query. Defaults to 'lichess' -- existing callers are unaffected.
 * @param {number[]} [opts.ratings] Rating bucket lower-bounds, e.g. [1600].
 *   Valid Lichess buckets: 0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500.
 *   Passing more than one combines those buckets into one aggregate result.
 *   Required (non-empty) when database is 'lichess'; ignored for 'masters'.
 * @param {string[]} [opts.speeds] Game speeds to include, e.g.
 *   ['blitz', 'rapid']. Valid values: ultraBullet, bullet, blitz, rapid,
 *   classical, correspondence. Ignored for 'masters'.
 * @param {number} [opts.moves] Max number of candidate moves to return.
 * @param {number} [opts.topGames] Max number of master-level top games to
 *   include (0 by default -- existing callers keep byte-identical behavior).
 * @param {number} [opts.recentGames] Max number of recent games to include
 *   (0 by default -- existing callers keep byte-identical behavior).
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{white:number, draws:number, black:number,
 *   moves: Array<{uci:string, san:string, averageRating:number,
 *   white:number, draws:number, black:number, opening?:{eco:string,name:string}}>,
 *   opening: {eco:string, name:string}|null,
 *   topGames?: Array, recentGames?: Array}>}
 */
async function fetchExplorerMoves({
  fen = START_FEN,
  play = [],
  database = 'lichess',
  ratings,
  speeds = ['blitz', 'rapid'],
  moves = 8,
  topGames = 0,
  recentGames = 0,
  fetchImpl = fetch,
} = {}) {
  if (database !== 'lichess' && database !== 'masters') {
    throw new Error(`fetchExplorerMoves: database must be "lichess" or "masters", got "${database}"`);
  }
  if (database === 'lichess' && (!Array.isArray(ratings) || ratings.length === 0)) {
    throw new Error('fetchExplorerMoves requires a non-empty `ratings` array');
  }

  const params = new URLSearchParams();
  params.set('fen', fen);
  if (Array.isArray(play) && play.length > 0) {
    params.set('play', play.join(','));
  }
  if (database === 'lichess') {
    params.set('ratings', ratings.join(','));
    params.set('speeds', speeds.join(','));
  }
  params.set('moves', String(moves));
  params.set('topGames', String(topGames));
  params.set('recentGames', String(recentGames));

  const baseUrl = database === 'masters' ? MASTERS_BASE_URL : EXPLORER_BASE_URL;
  const url = `${baseUrl}?${params.toString()}`;
  const headers = { Accept: 'application/json' };
  const token = getApiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(url, { headers });
  await handleExplorerErrors(response, url);
  return response.json();
}

module.exports = {
  EXPLORER_BASE_URL,
  MASTERS_BASE_URL,
  START_FEN,
  fetchExplorerMoves,
  ExplorerRateLimitError,
  ExplorerApiError,
  ExplorerAuthError,
  getApiToken,
};
