'use strict';

/**
 * Data-fetch module for the Lichess public API (https://lichess.org/api).
 * No API key is required for the endpoints used here.
 *
 * Every exported function accepts an options object with an injectable
 * `fetchImpl` (defaulting to the global `fetch`) specifically so tests can
 * supply a fake implementation backed by fixture JSON instead of hitting
 * the live network.
 */

const BASE_URL = 'https://lichess.org';

class LichessNotFoundError extends Error {
  constructor(username) {
    super(`Lichess user not found: ${username}`);
    this.name = 'LichessNotFoundError';
    this.username = username;
  }
}

class LichessRateLimitError extends Error {
  constructor(retryAfter) {
    super(`Lichess API rate limit hit${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`);
    this.name = 'LichessRateLimitError';
    this.retryAfter = retryAfter || null;
  }
}

class LichessApiError extends Error {
  constructor(status, statusText, url) {
    super(`Lichess API request failed: ${status} ${statusText} (${url})`);
    this.name = 'LichessApiError';
    this.status = status;
  }
}

/**
 * Shared response handling: maps HTTP status codes to typed errors.
 */
async function handleErrors(response, url, username) {
  if (response.status === 404) {
    throw new LichessNotFoundError(username);
  }
  if (response.status === 429) {
    const retryAfter = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('retry-after')
      : null;
    throw new LichessRateLimitError(retryAfter);
  }
  if (!response.ok) {
    throw new LichessApiError(response.status, response.statusText, url);
  }
}

/**
 * GET /api/user/:username -> profile JSON (includes perfs, counts, etc).
 */
async function fetchUserProfile(username, { fetchImpl = fetch } = {}) {
  const url = `${BASE_URL}/api/user/${encodeURIComponent(username)}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  await handleErrors(response, url, username);
  return response.json();
}

/**
 * GET /api/user/:username/rating-history -> array of
 * { name: <variant>, points: [[year, month0Indexed, day, rating], ...] }
 */
async function fetchRatingHistory(username, { fetchImpl = fetch } = {}) {
  const url = `${BASE_URL}/api/user/${encodeURIComponent(username)}/rating-history`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  await handleErrors(response, url, username);
  return response.json();
}

/**
 * GET /api/games/user/:username -> newline-delimited JSON (one game per line)
 * when Accept: application/x-ndjson is sent.
 */
async function fetchRecentGames(username, { max = 10, fetchImpl = fetch } = {}) {
  const url = `${BASE_URL}/api/games/user/${encodeURIComponent(username)}?max=${encodeURIComponent(max)}&moves=false`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/x-ndjson' } });
  await handleErrors(response, url, username);
  const text = await response.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

module.exports = {
  BASE_URL,
  fetchUserProfile,
  fetchRatingHistory,
  fetchRecentGames,
  LichessNotFoundError,
  LichessRateLimitError,
  LichessApiError,
};
