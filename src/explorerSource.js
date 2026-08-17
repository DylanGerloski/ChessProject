'use strict';

const fs = require('fs');
const path = require('path');
const { loadAggregates, explorerShapedResponse, resultingPositionBalanced } = require('./aggregateSource');
const { fetchExplorerMoves } = require('./fetchOpeningExplorer');

/**
 * The single call site every WS-3.1-migrated builder (buildRepertoire.js,
 * buildContent.js, buildDrill.js, buildEcoPages.js) routes its lichess-
 * database move lookups through, in place of calling
 * fetchOpeningExplorer.js's fetchExplorerMoves() directly. Returns the SAME
 * response shape (spec section 1.9), so every existing consumer funnelling
 * through src/processRepertoire.js's moveStatsFromExplorerResponse() needs
 * no change at all.
 *
 * database:'masters' calls are NOT routed through this module -- spec
 * section 1.8's decision (i) keeps the masters database as the one narrow,
 * named live-API exception (a genuinely different dataset -- real
 * grandmaster games -- with no equivalent in the dump pipeline). Callers
 * keep calling fetchExplorerMoves({database: 'masters', ...}) directly for
 * that one call site (src/buildContent.js's fetchOpeningData).
 *
 * FALLBACK, stated plainly: this repo's first human-gated live dump ingest
 * (WS-3 B2) has not run yet, so data/aggregates/manifest.json does not
 * exist on disk in production today, and B2 is explicitly a separate,
 * later, human-approved task (spec section 1.7's "BUILD-AUTHORISATION
 * BOUNDARY", section 7's B2 estimate). Flipping every builder to REQUIRE
 * aggregate data that doesn't exist yet would hard-fail every production
 * deploy the moment this change lands, which is the opposite of this
 * workstream's own "delete nothing / migration order matters" instruction
 * (spec section 1.8) -- a migration that breaks the thing it's migrating
 * isn't a migration, it's an outage. So: when aggregate data is present at
 * `dir` (a real ingest, or a checked-in fixture directory passed by a
 * test), this function issues zero live Explorer requests. When it is
 * absent, it falls back to the live Explorer API exactly as every builder
 * already did before this module existed -- so today's production build
 * keeps working unchanged. Once WS-3 B2 lands and data/aggregates exists,
 * every migrated call site switches over automatically, with no further
 * code change and no flag to flip.
 */

const AGGREGATES_DIR = path.join(__dirname, '..', 'data', 'aggregates');

// The single pool this site displays after migration (spec section 1.3):
// blitz alone. Before this migration, the default band's numbers came from
// DEFAULT_SPEEDS = ['blitz', 'rapid'] passed together to the Explorer API,
// which merges the two speeds into one aggregate -- the actual cause of
// audit finding #8 (a blitz+rapid-blended draw rate the site never
// disclosed as blended). The dump aggregate schema stores blitz and
// rapid_classical as separate pools with no "merged" option (spec 1.3: "the
// dumps are single-stream zstd... a prefix is the only sampling method
// available"; merging pools back together at read time would require
// re-deriving a blended interval this codebase doesn't have a formula for
// yet). Spec 1.3 resolves this explicitly: "blitz is the default
// specifically because it is what the site's existing numbers already
// are" -- so this migration also fixes finding #8 as a side effect,
// disclosed here rather than silently: numbers sourced through this module
// are blitz-only, not blitz+rapid-blended, once real aggregate data lands.
const DEFAULT_POOL = 'blitz';

const cacheByDir = new Map();

/**
 * @param {string} [dir]
 * @returns {boolean} true iff a loadable ingest output exists at `dir`.
 */
function aggregatesAvailable(dir = AGGREGATES_DIR) {
  return fs.existsSync(path.join(dir, 'manifest.json')) && fs.existsSync(path.join(dir, 'root.json'));
}

/**
 * loadAggregates() is a real fs read + JSON.parse of (potentially) several
 * files -- cached per directory so a build that calls fetchMoves() dozens
 * of times (every builder does) only pays that cost once. Not exported;
 * tests that need a fresh read should use a fresh temp directory (the
 * existing test/aggregateSource.test.js convention) rather than reaching
 * into this cache.
 */
function loadAggregatesCached(dir) {
  if (!cacheByDir.has(dir)) {
    cacheByDir.set(dir, loadAggregates({ dir }));
  }
  return cacheByDir.get(dir);
}

/**
 * @param {object} args
 * @param {string[]} [args.play] UCI moves from the starting position.
 * @param {string} args.band a RATING_BANDS/gameFilter.BANDS key, e.g. '1600-1800'.
 *   Every existing call site already has this string in scope (the loop
 *   variable it currently does `RATING_BANDS[band]` with), so switching a
 *   call site to this module means passing `band` instead of `ratings`.
 * @param {string} [args.pool] defaults to DEFAULT_POOL ('blitz').
 * @param {string} [args.familySlug] forwarded to aggregateSource.js's
 *   explorerShapedResponse -- required for any position deeper than
 *   ROOT_MAX_PLY (root.json only covers ply <= ROOT_MAX_PLY, 3 as of the
 *   2026-08-15 shard-size fix, src/ingest/aggregate.js); pass
 *   ecoFamilies.js's slugifyFamilyName(openingName) or an already-known
 *   family slug.
 * @param {number} [args.moves] max candidate moves returned, matching
 *   fetchExplorerMoves' own `moves` param -- applied by slicing the
 *   aggregate's already-sorted (most-played-first) move list, since the
 *   aggregate path has no server-side "moves" limit to pass through.
 * @param {number[]} [args.ratings] forwarded to the live-API fallback only.
 * @param {string[]} [args.speeds] forwarded to the live-API fallback only.
 * @param {number} [args.recentGames] forwarded to the live-API fallback
 *   only -- silently has no effect on the aggregate path (the dump
 *   aggregate stores position/move counts only, never individual game
 *   records, so there is no per-game data to return; see
 *   src/buildContent.js's fetchLineWithValidation for the one call site
 *   that uses this and how the resulting empty recentGames degrades).
 * @param {number} [args.topGames] forwarded to the live-API fallback only
 *   (same "no per-game data" reasoning as recentGames above).
 * @param {Function} [args.fetchImpl] forwarded to the live-API fallback only.
 * @param {string} [args.dir] aggregate directory to check/read; defaults to
 *   the real data/aggregates/. Tests pass a fixture directory here.
 * @returns {Promise<{white:number, draws:number, black:number, moves:Array,
 *   opening: object|null, balanced?: object, posKey?: string}>}
 */
async function fetchMoves({
  play = [],
  band,
  pool = DEFAULT_POOL,
  familySlug,
  moves,
  ratings,
  speeds,
  recentGames,
  topGames,
  fetchImpl,
  dir = AGGREGATES_DIR,
} = {}) {
  if (aggregatesAvailable(dir)) {
    const aggregates = loadAggregatesCached(dir);
    const response = explorerShapedResponse({ aggregates, play, band, pool, familySlug });
    // Enriches each candidate move with the BALANCED totals of the position
    // that move LEADS TO (WS-3.3 condition 4, the transposition check) --
    // only possible on the aggregate path, since it needs a second
    // position lookup this module already has every argument for right
    // here (aggregates/band/pool/familySlug/play). `resultingBalanced` is
    // an additive field, same "unknown fields are ignored" convention as
    // aggregateSource.js's own `balanced`/`posKey` -- absent entirely on
    // the live-Explorer fallback below, which src/processOpenings.js's
    // findCommonMistakes() must treat as "no data" (skip the check), never
    // as a zero.
    const enrichedMoves = (response.moves || []).map((m) => ({
      ...m,
      resultingBalanced: resultingPositionBalanced({ aggregates, play, uci: m.uci, band, pool, familySlug }),
    }));
    const limitedMoves = typeof moves === 'number' && enrichedMoves.length > moves
      ? enrichedMoves.slice(0, moves)
      : enrichedMoves;
    return { ...response, moves: limitedMoves };
  }
  return fetchExplorerMoves({ play, ratings, speeds, moves, recentGames, topGames, fetchImpl });
}

/**
 * Single source of truth for "which speeds pool did THIS build actually
 * use", for every caller that discloses it to a reader (pack.json's
 * `speeds` field, README.txt, and repertoire-packs/<id>.html's on-page
 * copy previously each hardcoded their own `['blitz', 'rapid']` literal
 * regardless of which path fetchMoves() actually took -- the same
 * site-wide "blitz & rapid" mislabeling this module's DEFAULT_POOL comment
 * above already documents for the opening pages). Mirrors
 * renderMethodologyPage's own manifest-presence branch (src/renderContent.js).
 *
 * @param {string} [dir]
 * @returns {string[]} `[DEFAULT_POOL]` (blitz only) when this build is
 *   sourced from real aggregate data at `dir` (fetchMoves() ignores the
 *   `speeds` argument entirely on that path -- see its own doc above), or
 *   `['blitz', 'rapid']` -- the same literal src/processRepertoire.js's
 *   DEFAULT_SPEEDS holds, forwarded to the live-API fallback -- when it isn't.
 */
function actualPoolSpeeds(dir = AGGREGATES_DIR) {
  return aggregatesAvailable(dir) ? [DEFAULT_POOL] : ['blitz', 'rapid'];
}

module.exports = {
  fetchMoves,
  aggregatesAvailable,
  actualPoolSpeeds,
  AGGREGATES_DIR,
  DEFAULT_POOL,
};
