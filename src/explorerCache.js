'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Build-time on-disk cache for Opening Explorer requests. Authoring this
 * content build means rebuilding many times while iterating; without a
 * cache each rebuild re-issues ~60 rate-limited requests. Keyed by the full
 * request URL (which already encodes fen/play/ratings/speeds/database/
 * moves/topGames/recentGames), stored as one JSON file per request under
 * <project>/.cache/explorer/<sha1 of url>.json.
 *
 * This wraps a `fetchImpl`-shaped function, so any caller that supplies its
 * own fetchImpl for testing bypasses this cache entirely -- same pattern as
 * buildStatic.js's politeFetch. It caches API *responses* only, never the
 * token, and it lives outside dist/ so assertNoTokenLeak's scope (dist/
 * only) is unchanged.
 */

const CACHE_DIR = path.join(__dirname, '..', '.cache', 'explorer');

function cacheKeyFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function cachePathFor(url) {
  return path.join(CACHE_DIR, `${cacheKeyFor(url)}.json`);
}

/**
 * @param {Function} fetchImpl the real fetch to wrap (e.g. politeFetch)
 * @param {{enabled?: boolean, cacheDir?: string}} [opts]
 * @returns {Function} a fetch-shaped function: (url, options) -> Response-like
 */
function withExplorerCache(fetchImpl, { enabled = true, cacheDir = CACHE_DIR } = {}) {
  if (!enabled) return fetchImpl;

  return async function cachedFetch(url, options) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${cacheKeyFor(url)}.json`);

    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return {
        ok: true,
        status: 200,
        statusText: 'OK (cached)',
        headers: { get: () => null },
        json: async () => cached,
      };
    }

    const response = await fetchImpl(url, options);
    if (response.ok) {
      const body = await response.json();
      fs.writeFileSync(cachePath, JSON.stringify(body), 'utf8');
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        json: async () => body,
      };
    }
    return response;
  };
}

module.exports = {
  CACHE_DIR,
  cacheKeyFor,
  cachePathFor,
  withExplorerCache,
};
