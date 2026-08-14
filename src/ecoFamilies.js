'use strict';

/**
 * Groups src/ecoData.js's flat 3,810-line dataset into families (T1) and
 * ECO volumes (T2): ~64 family hubs (families with >=8 lines, ~94% of the
 * dataset) plus 5 ECO volume indexes (A-E) and a paginated family/all-codes
 * browse index.
 *
 * Pure functions only -- takes buildEcoDataset()'s `lines` array in,
 * returns plain data out. No I/O, no network. Family/variation grouping
 * uses each line's already-computed `family`/`segments` fields (see
 * ecoData.js's parseFamilyVariation) rather than re-parsing names.
 */

// Measured against the real vendored dataset: exactly 64 of 149 families
// have >=8 lines, covering 3,607/3,810 lines (~94.7%). This constant is
// the single source of truth for that cut
// -- change it here, not at call sites, if the threshold is ever revisited.
const MIN_T1_LINES = 8;

/**
 * URL-safe kebab-case slug for a family name. Strips diacritics (Réti ->
 * Reti, Grünfeld -> Grunfeld, Kádas -> Kadas) via Unicode NFD decomposition
 * so the slug is plain ASCII, same convention as this project's existing
 * hand-picked slugs (src/openings.js). Commas (used for deeper segment
 * text that occasionally leaks into a bare family name, e.g. "Queen's
 * Indian Defense, with e3") and apostrophes both become a plain hyphen
 * boundary, collapsed with everything else non-alphanumeric.
 */
function slugifyFamilyName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Apostrophes are DROPPED, not turned into a hyphen boundary -- matches
    // this project's existing hand-picked slugs (src/openings.js: "Queen's
    // Gambit" -> "queens-gambit", "King's Indian Defense" ->
    // "kings-indian-defense"), so a family slug never disagrees with a T0
    // opening slug's own convention for the same apostrophe.
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Picks the one line that best represents a family for the family hub's
 * board diagram and 4-band Explorer stats (spec 3.2: "the family's main
 * line only"). Prefers the family-root row (no colon in its name, i.e.
 * `variation === null` -- 60 of the 64 T1 families have one); falls back to
 * the shortest line (fewest plies -- the earliest branch point) for the 4
 * that don't, tie-broken by ECO code then source row for determinism.
 */
function pickMainLine(linesForFamily) {
  // Prefer a family-root line (no colon in its name) when one exists, but
  // NEVER just the first one found in file order -- the vendored dataset's
  // own README documents that "multiple entries may exist for one opening
  // so common transpositions resolve" (verified against the real data:
  // Sicilian Defense alone has 4 distinct root-level rows, B20 through
  // B50, at 2 through 6 plies each), so explicitly picking the shortest
  // is what actually guarantees the canonical, earliest-branch-point line
  // rather than relying on incidental row order.
  const roots = linesForFamily.filter((l) => l.variation === null);
  const candidates = roots.length > 0 ? roots : linesForFamily;
  return candidates
    .slice()
    .sort((a, b) => (
      a.plies.length - b.plies.length
      || a.eco.localeCompare(b.eco)
      || a.sourceRow - b.sourceRow
    ))[0];
}

/**
 * A main line's "side", for feeding into the same win/draw/loss-for-side
 * math this project already uses (processOpenings.js's scoreFor). Derived
 * from the color of the line's LAST ply -- verified against every one of
 * src/openings.js's 10 hand-picked entries, whose own `side` field always
 * matches this exact rule (e.g. Sicilian Defense's line ends on Black's
 * c5 -> side "black"; English Opening's ends on White's c4 -> side
 * "white"), so this is the same heuristic a human editor already applied
 * by hand, not a novel guess.
 */
function sideForLine(line) {
  const last = line.plies[line.plies.length - 1];
  return last ? last.color : 'white';
}

/**
 * @param {Array} lines buildEcoDataset().lines
 * @returns {Array<{family:string, slug:string, lines:Array, lineCount:number,
 *   ecoCodes:string[], volumes:string[], mainLine:object, mainLineSide:string}>}
 *   sorted by family name. `volumes` is the sorted, deduped set of ECO
 *   volume letters (first character of each line's eco code) this family's
 *   lines actually span -- most families sit in exactly one volume, but see
 *   this module's own test fixtures for the ones (Van Geet Opening, English
 *   Opening, etc.) that measurably span more than one.
 */
function buildFamilyIndex(lines) {
  const byFamily = new Map();
  for (const line of lines) {
    if (!byFamily.has(line.family)) byFamily.set(line.family, []);
    byFamily.get(line.family).push(line);
  }
  return [...byFamily.entries()]
    .map(([family, familyLines]) => {
      const mainLine = pickMainLine(familyLines);
      const ecoCodes = [...new Set(familyLines.map((l) => l.eco))].sort();
      const volumes = [...new Set(ecoCodes.map((c) => c[0]))].sort();
      return {
        family,
        slug: slugifyFamilyName(family),
        lines: familyLines,
        lineCount: familyLines.length,
        ecoCodes,
        volumes,
        mainLine,
        mainLineSide: sideForLine(mainLine),
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * @param {Array} familyIndex buildFamilyIndex() output
 * @returns {Array} the subset with >= MIN_T1_LINES lines -- the T1 family
 *   hub set (measured: exactly 64 against the real vendored dataset).
 */
function t1Families(familyIndex) {
  return familyIndex.filter((f) => f.lineCount >= MIN_T1_LINES);
}

/**
 * Builds one family's lines into a nested tree keyed by `segments` (the
 * comma-separated path after the family name's colon, already parsed by
 * ecoData.js's parseFamilyVariation -- never re-parsed here). Each node is
 * `{ label, lines: Array, children: Map<string, node> }`; `lines` holds
 * EVERY dataset row whose segments path lands exactly here -- an array,
 * not a single line, because the vendored dataset's own README documents
 * that "multiple entries may exist for one opening so common transpositions
 * resolve": verified against the real data, 31 distinct segment paths in
 * the Sicilian Defense family alone carry more than one row (different
 * move orders reaching the same named position). An earlier version of
 * this function stored a single `line` and silently dropped 64 of the
 * Sicilian's 391 real rows to a last-write-wins overwrite -- `lines` (an
 * array, possibly empty for a pure grouping node with no line of its own)
 * is what keeps every row. The family's own root-level line(s) (no colon,
 * `segments.length === 0`) attach directly to the returned root node.
 *
 * @param {Array} linesForFamily
 * @returns {{label:null, lines:Array, children:Map}}
 */
function buildVariationTree(linesForFamily) {
  const root = { label: null, lines: [], children: new Map() };
  for (const line of linesForFamily) {
    if (line.segments.length === 0) {
      root.lines.push(line);
      continue;
    }
    let node = root;
    for (const seg of line.segments) {
      if (!node.children.has(seg)) {
        node.children.set(seg, { label: seg, lines: [], children: new Map() });
      }
      node = node.children.get(seg);
    }
    node.lines.push(line);
  }
  return root;
}

// Suffix applied to every T1 family hub filename (`${slug}-variations.html`),
// never just `${slug}.html`. Required, not stylistic: measured against the
// real vendored data, 8 of the 64 T1 family slugs collide exactly with an
// existing T0 opening page's own slug (src/openings.js) -- e.g. both the
// "Sicilian Defense" T0 page and the "Sicilian Defense" T1 family hub would
// otherwise both want sicilian-defense.html. Applying the suffix
// unconditionally (not just to the 8 colliding families) keeps one uniform
// URL pattern across all 64 pages, so a future addition to openings.js can
// never silently reintroduce this collision for a 65th family.
const T1_FILENAME_SUFFIX = '-variations';

function familyHubFilename(slug) {
  return `${slug}${T1_FILENAME_SUFFIX}.html`;
}

module.exports = {
  MIN_T1_LINES,
  T1_FILENAME_SUFFIX,
  slugifyFamilyName,
  familyHubFilename,
  pickMainLine,
  sideForLine,
  buildFamilyIndex,
  t1Families,
  buildVariationTree,
};
