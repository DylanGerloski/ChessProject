'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const zlib = require('zlib');
const {
  truncateFenForLookup,
  buildExplorerLineIndex,
  buildT0CrossLinkMap,
  buildReverseLookupIndex,
} = require('../src/ecoExplorerData');
const { buildEcoDataset, loadSourceB, DEFAULT_DATA_DIR } = require('../src/ecoData');
const { buildFamilyIndex } = require('../src/ecoFamilies');
const { OPENINGS } = require('../src/openings');

// --- truncateFenForLookup ------------------------------------------------

test('truncateFenForLookup drops the halfmove clock and fullmove number', () => {
  assert.equal(
    truncateFenForLookup('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3'
  );
});

test('truncateFenForLookup is idempotent (already-truncated input passes through)', () => {
  const t = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  assert.equal(truncateFenForLookup(t), t);
});

// --- buildExplorerLineIndex (pure fixture) -------------------------------

const fixtureLines = [
  { eco: 'A00', name: 'Uncommon Openings', family: 'Uncommon Openings', variation: null, plies: [{ san: 'a3' }] },
  { eco: 'C50', name: 'Italian Game', family: 'Italian Game', variation: null, plies: [{ san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }, { san: 'Nc6' }, { san: 'Bc4' }] },
];
const fixtureFamilyIndex = [
  { family: 'Uncommon Openings', slug: 'uncommon-openings', lineCount: 1 },
  { family: 'Italian Game', slug: 'italian-game', lineCount: 20 }, // pretend T1-eligible
];

test('buildExplorerLineIndex produces a compact array (not object) per line', () => {
  const index = buildExplorerLineIndex(fixtureLines, fixtureFamilyIndex);
  assert.equal(index.length, 2);
  assert.ok(Array.isArray(index[0]));
  assert.equal(index[0].length, 5);
});

test('buildExplorerLineIndex joins SAN plies space-separated, in order', () => {
  const index = buildExplorerLineIndex(fixtureLines, fixtureFamilyIndex);
  const italian = index.find((row) => row[1] === 'Italian Game');
  assert.equal(italian[3], 'e4 e5 Nf3 Nc6 Bc4');
});

test('buildExplorerLineIndex sets hubFile only for a family with >= MIN_T1_LINES lines, never a fabricated link', () => {
  const index = buildExplorerLineIndex(fixtureLines, fixtureFamilyIndex);
  const uncommon = index.find((row) => row[1] === 'Uncommon Openings');
  const italian = index.find((row) => row[1] === 'Italian Game');
  assert.equal(uncommon[4], null); // lineCount 1 -- no hub
  assert.equal(italian[4], 'italian-game-variations.html'); // lineCount 20 -- has a hub
});

// --- buildT0CrossLinkMap --------------------------------------------------

test('buildT0CrossLinkMap maps every real OPENINGS entry to its own T0 filename', () => {
  const map = buildT0CrossLinkMap(OPENINGS);
  assert.equal(Object.keys(map).length, OPENINGS.length);
  for (const o of OPENINGS) {
    assert.equal(map[o.name], `${o.slug}.html`);
  }
});

test('buildT0CrossLinkMap never invents an entry for a name not in OPENINGS', () => {
  const map = buildT0CrossLinkMap(OPENINGS);
  assert.equal(map['Not A Real Opening'], undefined);
});

// --- buildReverseLookupIndex -----------------------------------------------

test('buildReverseLookupIndex sorts ascending by the truncated FEN key', () => {
  const byFen = new Map([
    ['b w - - 0 1', { eco: 'B00', name: 'B' }],
    ['a w - - 0 1', { eco: 'A00', name: 'A' }],
  ]);
  const index = buildReverseLookupIndex(byFen);
  assert.deepEqual(index.map((row) => row[0]), ['a w - -', 'b w - -']);
});

test('buildReverseLookupIndex collapses two entries that truncate to the same key into one row', () => {
  const byFen = new Map([
    ['x w KQkq - 0 1', { eco: 'A00', name: 'First' }],
    ['x w KQkq - 3 12', { eco: 'A00', name: 'First' }], // same position, different move counters
  ]);
  const index = buildReverseLookupIndex(byFen);
  assert.equal(index.length, 1);
  assert.equal(index[0][0], 'x w KQkq -');
});

test('buildReverseLookupIndex output rows have exactly [fen, eco, name]', () => {
  const byFen = new Map([['x w - - 0 1', { eco: 'A00', name: 'First', src: 'eco_tsv', extra: 'dropped' }]]);
  const index = buildReverseLookupIndex(byFen);
  assert.deepEqual(index[0], ['x w - -', 'A00', 'First']);
});

// --- end-to-end against the REAL vendored data (same discipline as ecoData.test.js/ecoFamilies.test.js) ----

test('end-to-end: real dataset produces the exact measured explorer-index and reverse-lookup sizes', () => {
  const dataset = buildEcoDataset();
  const familyIndex = buildFamilyIndex(dataset.lines);
  const lineIndex = buildExplorerLineIndex(dataset.lines, familyIndex);
  assert.equal(lineIndex.length, 3810);

  const json = JSON.stringify(lineIndex);
  const gzipBytes = zlib.gzipSync(json).length;
  // Measured this session: ~52.5 KB gzip. Assert a generous ceiling (80 KB)
  // rather than the exact figure, so a small, legitimate future data change
  // doesn't fail this test outright -- but a regression that bloats this
  // payload by, say, 5x (e.g. accidentally inlining per-ply FEN again) must
  // fail loudly here rather than silently shipping a much heavier page.
  assert.ok(gzipBytes < 80 * 1024, `explorer line index is ${gzipBytes} bytes gzip -- expected well under 80 KB`);

  const sourceB = loadSourceB((p) => fs.readFileSync(p, 'utf8'), DEFAULT_DATA_DIR);
  const reverseIndex = buildReverseLookupIndex(sourceB.byFen);
  assert.equal(reverseIndex.length, 12106); // measured this session against the real pinned data
  // Sorted check: every consecutive pair is non-decreasing.
  for (let i = 1; i < reverseIndex.length; i += 1) {
    assert.ok(reverseIndex[i - 1][0] <= reverseIndex[i][0], `reverse lookup index not sorted at index ${i}`);
  }
});

test('end-to-end: every T1 family (>= MIN_T1_LINES) is reachable via at least one explorer-index hubFile entry', () => {
  const dataset = buildEcoDataset();
  const familyIndex = buildFamilyIndex(dataset.lines);
  const lineIndex = buildExplorerLineIndex(dataset.lines, familyIndex);
  const t1Families = familyIndex.filter((f) => f.lineCount >= 8);
  for (const f of t1Families) {
    const hasHubLink = lineIndex.some((row) => row[2] === f.family && row[4] !== null);
    assert.ok(hasHubLink, `T1 family "${f.family}" has no explorer-index row with a hubFile link`);
  }
});
