'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_T1_LINES,
  T1_FILENAME_SUFFIX,
  slugifyFamilyName,
  familyHubFilename,
  pickMainLine,
  sideForLine,
  buildFamilyIndex,
  t1Families,
  buildVariationTree,
} = require('../src/ecoFamilies');
const { buildEcoDataset } = require('../src/ecoData');
const { OPENINGS } = require('../src/openings');

// ---------------------------------------------------------------------------
// slugifyFamilyName / familyHubFilename
// ---------------------------------------------------------------------------

test('slugifyFamilyName: strips diacritics, drops apostrophes, hyphenates the rest', () => {
  assert.equal(slugifyFamilyName('Réti Opening'), 'reti-opening');
  assert.equal(slugifyFamilyName('Grünfeld Defense'), 'grunfeld-defense');
  assert.equal(slugifyFamilyName("King's Gambit Accepted"), 'kings-gambit-accepted');
  assert.equal(slugifyFamilyName("Queen's Indian Defense, with e3"), 'queens-indian-defense-with-e3');
});

test("slugifyFamilyName: matches src/openings.js's own hand-picked slug convention for the same family names", () => {
  // Every T0 opening whose name is also a family name in the CC0 dataset
  // must slugify to the exact same string a human editor already chose --
  // otherwise ecoFamilies.js's own apostrophe-handling has silently
  // diverged from the site's existing URL convention.
  const matchable = OPENINGS.filter((o) => ['Sicilian Defense', 'French Defense', 'Caro-Kann Defense', "King's Indian Defense", 'Ruy Lopez', 'Scandinavian Defense', 'Scotch Game', 'Italian Game'].includes(o.name));
  assert.ok(matchable.length >= 6);
  for (const o of matchable) {
    assert.equal(slugifyFamilyName(o.name), o.slug);
  }
});

test('familyHubFilename: applies the -variations suffix, never a bare slug', () => {
  assert.equal(familyHubFilename('sicilian-defense'), 'sicilian-defense-variations.html');
  assert.equal(T1_FILENAME_SUFFIX, '-variations');
});

// ---------------------------------------------------------------------------
// pickMainLine / sideForLine
// ---------------------------------------------------------------------------

function line(overrides) {
  return {
    eco: 'A00', name: 'Test', family: 'Test', variation: null, subvariation: null, segments: [],
    sourceFile: 'a.tsv', sourceRow: 2, plies: [{ ply: 1, color: 'white', san: 'e4', uci: 'e2e4', fen: 'x' }], finalFen: 'x', inSourceB: false,
    ...overrides,
  };
}

test('pickMainLine: prefers the family-root line (variation === null) when one exists', () => {
  const root = line({ variation: null, plies: [{ color: 'white' }, { color: 'black' }] });
  const deep = line({ variation: 'Deep', plies: [{ color: 'white' }] });
  assert.equal(pickMainLine([deep, root]), root);
});

test('pickMainLine: falls back to the shortest line when no family-root line exists', () => {
  const long = line({ eco: 'B02', variation: 'Long', plies: [{ color: 'white' }, { color: 'black' }, { color: 'white' }] });
  const short = line({ eco: 'B01', variation: 'Short', plies: [{ color: 'white' }] });
  assert.equal(pickMainLine([long, short]), short);
});

test('pickMainLine: ties on ply count broken by ECO code ascending', () => {
  const b = line({ eco: 'B02', variation: 'B', plies: [{ color: 'white' }] });
  const a = line({ eco: 'A01', variation: 'A', plies: [{ color: 'white' }] });
  assert.equal(pickMainLine([b, a]), a);
});

test('sideForLine: derives side from the color of the LAST ply', () => {
  assert.equal(sideForLine(line({ plies: [{ color: 'white' }, { color: 'black' }] })), 'black');
  assert.equal(sideForLine(line({ plies: [{ color: 'white' }] })), 'white');
});

test('sideForLine: matches src/openings.js\'s own hand-picked `side` field for most T0 family names it shares, with one documented, known exception', () => {
  // The "color of the last ply" heuristic matches openings.js's own side
  // for every T0-overlapping family EXCEPT King's Indian Defense: the CC0
  // dataset's own canonical root row for that family (E61, "1. d4 Nf6 2.
  // c4 g6 3. Nc3") ends on White's consolidating move, one ply past the
  // Black g6 that traditionally defines the opening -- a real, dataset-
  // driven edge case, not a bug in this heuristic. src/buildEcoPages.js's
  // findT0CrossLink() resolves this by preferring openings.js's own `side`
  // whenever a T0 cross-link exists (see test/buildEcoPages.test.js) --
  // this test documents the raw heuristic's own known limitation instead
  // of silently asserting something false.
  const KNOWN_HEURISTIC_EXCEPTIONS = new Set(['King\'s Indian Defense']);
  const { lines } = buildEcoDataset();
  const byFamily = new Map();
  for (const l of lines) {
    if (!byFamily.has(l.family)) byFamily.set(l.family, []);
    byFamily.get(l.family).push(l);
  }
  let checked = 0;
  for (const o of OPENINGS) {
    const familyLines = byFamily.get(o.name);
    if (!familyLines || KNOWN_HEURISTIC_EXCEPTIONS.has(o.name)) continue;
    const main = pickMainLine(familyLines);
    assert.equal(sideForLine(main), o.side, `${o.name}'s derived side should match openings.js`);
    checked += 1;
  }
  assert.ok(checked >= 5, 'expected at least 5 non-exception T0 openings to share a family name with the real dataset');
});

// ---------------------------------------------------------------------------
// buildFamilyIndex / t1Families -- against the REAL vendored dataset, so a
// change to the pinned CC0 data or the grouping logic is caught immediately
// (same "one end-to-end test against real data" pattern as ecoData.test.js).
// ---------------------------------------------------------------------------

test('buildFamilyIndex + t1Families: exactly 64 families have >= MIN_T1_LINES lines, covering ~94% of the dataset', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  assert.equal(familyIndex.length, 149);
  const t1 = t1Families(familyIndex);
  assert.equal(t1.length, 64);
  assert.equal(MIN_T1_LINES, 8);
  const t1LineCount = t1.reduce((sum, f) => sum + f.lineCount, 0);
  assert.equal(t1LineCount, 3607);
  assert.ok(t1LineCount / lines.length > 0.94);
});

test('buildFamilyIndex: every family has a unique slug, a main line, and a non-empty sorted ecoCodes list', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  const slugs = new Set();
  for (const f of familyIndex) {
    assert.ok(f.mainLine, `${f.family} should have a main line`);
    assert.ok(f.ecoCodes.length > 0);
    assert.deepEqual(f.ecoCodes, [...f.ecoCodes].sort());
    assert.ok(!slugs.has(f.slug), `${f.slug} should be unique across all 149 families`);
    slugs.add(f.slug);
  }
});

test('t1Families: none of the 64 T1 family hub filenames collide with an existing T0 opening filename', () => {
  const { lines } = buildEcoDataset();
  const t1 = t1Families(buildFamilyIndex(lines));
  const t0Filenames = new Set(OPENINGS.map((o) => `${o.slug}.html`));
  for (const f of t1) {
    assert.ok(!t0Filenames.has(familyHubFilename(f.slug)), `${f.slug}'s hub filename must not collide with a T0 page`);
  }
});

// ---------------------------------------------------------------------------
// buildVariationTree
// ---------------------------------------------------------------------------

test('buildVariationTree: a family-root line attaches directly to the tree root', () => {
  const root = line({ eco: 'C50', name: 'Italian Game', variation: null, segments: [] });
  const tree = buildVariationTree([root]);
  assert.deepEqual(tree.lines, [root]);
  assert.equal(tree.children.size, 0);
});

test('buildVariationTree: more than one family-root line (real transposition rows) both attach to the root, neither overwriting the other', () => {
  const a = line({ eco: 'B20', name: 'Sicilian Defense', variation: null, segments: [], sourceRow: 2 });
  const b = line({ eco: 'B27', name: 'Sicilian Defense', variation: null, segments: [], sourceRow: 3 });
  const tree = buildVariationTree([a, b]);
  assert.deepEqual(tree.lines, [a, b]);
});

test('buildVariationTree: nests lines by their segments path, sharing intermediate grouping nodes', () => {
  const najdorf = line({ eco: 'B90', name: 'Sicilian Defense: Najdorf Variation', variation: 'Najdorf Variation', segments: ['Najdorf Variation'] });
  const najdorfEnglish = line({ eco: 'B90', name: 'Sicilian Defense: Najdorf Variation, English Attack', variation: 'Najdorf Variation', subvariation: 'English Attack', segments: ['Najdorf Variation', 'English Attack'] });
  const dragon = line({ eco: 'B70', name: 'Sicilian Defense: Dragon Variation', variation: 'Dragon Variation', segments: ['Dragon Variation'] });
  const tree = buildVariationTree([najdorf, najdorfEnglish, dragon]);
  assert.deepEqual(tree.lines, []); // no family-root line in this fixture
  assert.equal(tree.children.size, 2); // "Najdorf Variation" and "Dragon Variation"
  const najdorfNode = tree.children.get('Najdorf Variation');
  assert.deepEqual(najdorfNode.lines, [najdorf]); // the grouping node IS itself a real line
  assert.equal(najdorfNode.children.size, 1);
  assert.deepEqual(najdorfNode.children.get('English Attack').lines, [najdorfEnglish]);
  assert.deepEqual(tree.children.get('Dragon Variation').lines, [dragon]);
});

test('buildVariationTree: two lines sharing the exact same segments path (a real transposition pair) both survive, not last-write-wins', () => {
  const orderA = line({ eco: 'B21', name: 'Sicilian Defense: Smith-Morra Gambit', variation: 'Smith-Morra Gambit', segments: ['Smith-Morra Gambit'], sourceRow: 10 });
  const orderB = line({ eco: 'B21', name: 'Sicilian Defense: Smith-Morra Gambit', variation: 'Smith-Morra Gambit', segments: ['Smith-Morra Gambit'], sourceRow: 11 });
  const tree = buildVariationTree([orderA, orderB]);
  const node = tree.children.get('Smith-Morra Gambit');
  assert.deepEqual(node.lines, [orderA, orderB]);
});

test('buildVariationTree: against the real Sicilian Defense data, produces a tree covering all 391 lines with no orphans and none dropped to a last-write-wins collision', () => {
  const { lines } = buildEcoDataset();
  const sicilianLines = lines.filter((l) => l.family === 'Sicilian Defense');
  assert.equal(sicilianLines.length, 391);
  const tree = buildVariationTree(sicilianLines);

  function countLines(node) {
    let count = node.lines.length;
    for (const child of node.children.values()) count += countLines(child);
    return count;
  }
  assert.equal(countLines(tree), 391);
});
