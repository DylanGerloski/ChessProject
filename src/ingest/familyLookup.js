'use strict';

const { buildEcoDataset } = require('../ecoData');
const { slugifyFamilyName } = require('../ecoFamilies');

/**
 * Maps a game's own ECO/Opening headers to the family-shard slug its
 * positions should be sharded under (see src/ingest/aggregate.js: output is
 * sharded by ECO family, not by a hash prefix, so a client walking one
 * opening's tree only ever needs to fetch one file).
 *
 * A bulk-dump game record carries only an ECO code and an Opening name
 * string, not a family slug -- this module is the mapping from those two
 * headers to one of this site's existing ~150 ECO families (reusing the
 * same grouping src/ecoFamilies.js already builds for the family hub
 * pages), built once from the same vendored ECO dataset those pages read,
 * not a second, independent classification.
 */

/**
 * @param {{dataDir?: string, readFileImpl?: Function}} [opts] forwarded to
 *   buildEcoDataset (see src/ecoData.js) -- injectable for tests.
 * @returns {Map<string, string>} ECO code ("C50") -> family slug
 *   ("italian-game"). An ECO code is NOT always exclusive to one family in
 *   the real vendored dataset -- verified: C50 carries 22 "Italian Game"
 *   lines and 1 "Four Knights Game: Italian Variation" line. Majority vote
 *   by line count per code (tie-broken alphabetically by slug) is what
 *   makes this resolve to the family that code overwhelmingly means in
 *   practice, rather than to whichever family happens to sort first.
 */
function buildEcoCodeToFamilySlug(opts = {}) {
  const { lines } = buildEcoDataset(opts);
  const countsByCode = new Map(); // eco -> Map<slug, lineCount>
  for (const line of lines) {
    const slug = slugifyFamilyName(line.family);
    if (!countsByCode.has(line.eco)) countsByCode.set(line.eco, new Map());
    const bySlug = countsByCode.get(line.eco);
    bySlug.set(slug, (bySlug.get(slug) || 0) + 1);
  }
  const map = new Map();
  for (const [eco, bySlug] of countsByCode.entries()) {
    let bestSlug = null;
    let bestCount = -1;
    for (const [slug, count] of [...bySlug.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (count > bestCount) {
        bestSlug = slug;
        bestCount = count;
      }
    }
    map.set(eco, bestSlug);
  }
  return map;
}

/**
 * Resolves one game's family slug. Primary path: its ECO header against the
 * lookup map. Fallback (ECO code missing, or not one of the 149 vendored
 * families -- e.g. an obscure/irregular code with too few lines to have
 * been grouped): derive a slug directly from the Opening header's family
 * portion (text before the first colon), using the exact same
 * slugifyFamilyName() the real families were slugged with, so an unmapped
 * game still buckets under a stable, guessable slug instead of being
 * dropped from every family shard.
 *
 * @param {{ecoCodeToFamilySlug: Map<string,string>, ecoHeader?: string,
 *   openingHeader?: string}} args
 * @returns {string|null}
 */
function familySlugForGame({ ecoCodeToFamilySlug, ecoHeader, openingHeader }) {
  if (typeof ecoHeader === 'string' && ecoHeader.trim()) {
    const slug = ecoCodeToFamilySlug.get(ecoHeader.trim().toUpperCase());
    if (slug) return slug;
  }
  if (typeof openingHeader === 'string' && openingHeader.trim()) {
    const familyPart = openingHeader.split(':')[0].trim();
    if (familyPart) return slugifyFamilyName(familyPart);
  }
  return null;
}

module.exports = {
  buildEcoCodeToFamilySlug,
  familySlugForGame,
};
