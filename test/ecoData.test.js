'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EcoDataError,
  DEFAULT_DATA_DIR,
  SOURCE_A_FILES,
  SOURCE_B_FILES,
  parseSourceATsv,
  tokenizeSan,
  deriveLine,
  parseFamilyVariation,
  reconcileEcoCodes,
  loadSourceB,
  buildEcoDataset,
} = require('../src/ecoData');

// ---------------------------------------------------------------------------
// parseSourceATsv
// ---------------------------------------------------------------------------

test('parseSourceATsv: parses a well-formed TSV into eco/name/pgn rows, skipping the header', () => {
  const tsv = 'eco\tname\tpgn\nA00\tAmar Opening\t1. Nh3\nA01\tNimzo-Larsen Attack\t1. b3\n';
  const rows = parseSourceATsv(tsv, 'a.tsv');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { eco: 'A00', name: 'Amar Opening', pgn: '1. Nh3', file: 'a.tsv', row: 2 });
  assert.equal(rows[1].eco, 'A01');
});

test('parseSourceATsv: throws EcoDataError on an unexpected header', () => {
  const tsv = 'code\tname\tmoves\nA00\tAmar Opening\t1. Nh3\n';
  assert.throws(() => parseSourceATsv(tsv, 'a.tsv'), EcoDataError);
});

test('parseSourceATsv: throws EcoDataError on a row with the wrong column count', () => {
  const tsv = 'eco\tname\tpgn\nA00\tAmar Opening\n'; // missing the pgn column
  assert.throws(() => parseSourceATsv(tsv, 'a.tsv'), /malformed TSV row/);
});

// ---------------------------------------------------------------------------
// tokenizeSan
// ---------------------------------------------------------------------------

test('tokenizeSan: strips move-number markers and returns ordered SAN tokens', () => {
  const tokens = tokenizeSan('1. Nh3 d5 2. g3 e5 3. f4', {});
  assert.deepEqual(tokens, ['Nh3', 'd5', 'g3', 'e5', 'f4']);
});

test('tokenizeSan: a single-move line tokenizes to one token', () => {
  assert.deepEqual(tokenizeSan('1. Nh3', {}), ['Nh3']);
});

test('tokenizeSan: throws EcoDataError on ellipsis notation (unexpected upstream format)', () => {
  assert.throws(() => tokenizeSan('1. e4 e5 2... Nf3', {}), EcoDataError);
});

test('tokenizeSan: throws EcoDataError on a move number glued to the next token with no space', () => {
  assert.throws(() => tokenizeSan('1.e4 e5', {}), EcoDataError);
});

// ---------------------------------------------------------------------------
// deriveLine
// ---------------------------------------------------------------------------

test('deriveLine: derives UCI and FEN per ply for a normal opening line', () => {
  const { plies, finalFen } = deriveLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], {});
  assert.equal(plies.length, 5);
  assert.deepEqual(
    plies.map((p) => p.uci),
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'],
  );
  assert.equal(plies[0].color, 'white');
  assert.equal(plies[1].color, 'black');
  assert.equal(plies[0].fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.equal(finalFen, plies[4].fen);
});

test('deriveLine: handles castling and produces the correct UCI for the king move', () => {
  const { plies } = deriveLine(
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'],
    {},
  );
  const castle = plies[plies.length - 1];
  assert.equal(castle.san, 'O-O');
  assert.equal(castle.uci, 'e1g1');
});

test('deriveLine: throws EcoDataError with context on an illegal move', () => {
  assert.throws(
    () => deriveLine(['e4', 'e5', 'Qh5xh8'], { eco: 'X99', name: 'Fake Line', file: 'x.tsv', row: 3 }),
    (err) => {
      assert.ok(err instanceof EcoDataError);
      assert.match(err.message, /illegal or malformed SAN move at ply 3/);
      assert.equal(err.context.eco, 'X99');
      assert.equal(err.context.ply, 3);
      assert.equal(err.context.san, 'Qh5xh8');
      return true;
    },
  );
});

test('deriveLine: throws EcoDataError on a move that is not legal from move 1 (transposition-broken row)', () => {
  // "e5" cannot be white's first move -- this is exactly the class of "transposition-
  // broken row" the pipeline must catch rather than silently rendering.
  assert.throws(() => deriveLine(['e5'], { eco: 'X00', name: 'Bogus' }), EcoDataError);
});

test('deriveLine: an empty SAN list returns the start position as finalFen', () => {
  const { plies, finalFen } = deriveLine([], {});
  assert.equal(plies.length, 0);
  assert.equal(finalFen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
});

// ---------------------------------------------------------------------------
// parseFamilyVariation
// ---------------------------------------------------------------------------

test('parseFamilyVariation: a name with no colon is a family-root row', () => {
  assert.deepEqual(parseFamilyVariation('Amar Opening'), {
    family: 'Amar Opening',
    variation: null,
    subvariation: null,
    segments: [],
  });
});

test('parseFamilyVariation: family + single variation, no subvariation', () => {
  const result = parseFamilyVariation('Amar Opening: Paris Gambit');
  assert.equal(result.family, 'Amar Opening');
  assert.equal(result.variation, 'Paris Gambit');
  assert.equal(result.subvariation, null);
  assert.deepEqual(result.segments, ['Paris Gambit']);
});

test('parseFamilyVariation: family + variation + subvariation', () => {
  const result = parseFamilyVariation('Sicilian Defense: Najdorf Variation, English Attack');
  assert.equal(result.family, 'Sicilian Defense');
  assert.equal(result.variation, 'Najdorf Variation');
  assert.equal(result.subvariation, 'English Attack');
  assert.deepEqual(result.segments, ['Najdorf Variation', 'English Attack']);
});

test('parseFamilyVariation: deep hierarchy (4+ comma segments) is preserved in order', () => {
  const name =
    "English Opening: King's English Variation, Four Knights Variation, Fianchetto Line, with .. d6, Be7";
  const result = parseFamilyVariation(name);
  assert.equal(result.family, 'English Opening');
  assert.equal(result.segments.length, 5);
  assert.equal(result.segments[0], "King's English Variation");
  assert.equal(result.segments[4], 'Be7');
});

// ---------------------------------------------------------------------------
// reconcileEcoCodes
// ---------------------------------------------------------------------------

test('reconcileEcoCodes: finds codes only in B and flags whitespace-explained ones', () => {
  const codesA = ['A00', 'B01', 'C89'];
  const codesB = ['A00', 'B01', 'C89', 'C89 ', 'Z99'];
  const { quarantinedFromB, onlyInA } = reconcileEcoCodes(codesA, codesB);
  assert.equal(quarantinedFromB.length, 2);
  const byCode = Object.fromEntries(quarantinedFromB.map((q) => [q.code, q.trimmedMatchesA]));
  assert.equal(byCode['C89 '], true, 'trailing-space dupe of a real A code should be explained');
  assert.equal(byCode['Z99'], false, 'a genuinely unknown code should not be marked explained');
  assert.deepEqual(onlyInA, []);
});

test('reconcileEcoCodes: reports codes present in A but absent from B', () => {
  const { onlyInA } = reconcileEcoCodes(['A00', 'A01'], ['A00']);
  assert.deepEqual(onlyInA, ['A01']);
});

// ---------------------------------------------------------------------------
// loadSourceB
// ---------------------------------------------------------------------------

test('loadSourceB: reads all 5 files and indexes entries by FEN', () => {
  const fakeFiles = {
    'ecoA.json': JSON.stringify({ FEN1: { eco: 'A00', name: 'Foo', moves: 'x', src: 'eco_tsv' } }),
    'ecoB.json': JSON.stringify({ FEN2: { eco: 'B00', name: 'Bar', moves: 'y', src: 'eco_tsv' } }),
    'ecoC.json': JSON.stringify({}),
    'ecoD.json': JSON.stringify({}),
    'ecoE.json': JSON.stringify({}),
  };
  const readFileImpl = (p) => fakeFiles[path.basename(p)];
  const { byFen, ecoCodes, totalEntries } = loadSourceB(readFileImpl, '/fake/data/eco');
  assert.equal(totalEntries, 2);
  assert.equal(byFen.get('FEN1').eco, 'A00');
  assert.deepEqual(ecoCodes.sort(), ['A00', 'B00']);
});

// ---------------------------------------------------------------------------
// buildEcoDataset -- fixture-driven (no disk I/O)
// ---------------------------------------------------------------------------

function fakeReadFileImpl(files) {
  return (p) => {
    const key = path.basename(path.dirname(p)) + '/' + path.basename(p);
    if (!(key in files)) throw new Error(`fakeReadFileImpl: no fixture for ${key}`);
    return files[key];
  };
}

test('buildEcoDataset: end-to-end over a small fixture, including stats and reconciliation', () => {
  const tsvHeader = 'eco\tname\tpgn\n';
  const files = {
    'lichess-chess-openings/a.tsv': tsvHeader + 'A00\tAmar Opening\t1. Nh3\nA00\tAmar Opening: Paris Gambit\t1. Nh3 d5 2. g3\n',
    'lichess-chess-openings/b.tsv': tsvHeader,
    'lichess-chess-openings/c.tsv': tsvHeader + 'C50\tItalian Game\t1. e4 e5 2. Nf3 Nc6 3. Bc4\n',
    'lichess-chess-openings/d.tsv': tsvHeader,
    'lichess-chess-openings/e.tsv': tsvHeader,
    'eco-json/ecoA.json': JSON.stringify({
      'rnbqkbnr/pppppppp/8/8/8/7N/PPPPPPPP/RNBQKB1R b KQkq - 1 1': { eco: 'A00', name: 'Amar Opening', moves: '1. Nh3', src: 'eco_tsv' },
      'somefen/for/unrelated': { eco: 'A00 ', name: 'typo dupe', moves: '', src: 'eco_tsv' },
    }),
    'eco-json/ecoB.json': JSON.stringify({}),
    'eco-json/ecoC.json': JSON.stringify({
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3': { eco: 'C50', name: 'Italian Game', moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4', src: 'eco_tsv' },
    }),
    'eco-json/ecoD.json': JSON.stringify({}),
    'eco-json/ecoE.json': JSON.stringify({}),
  };

  const result = buildEcoDataset({ dataDir: '/fake/data/eco', readFileImpl: fakeReadFileImpl(files) });

  assert.equal(result.lines.length, 3);
  assert.equal(result.stats.totalLines, 3);
  assert.equal(result.stats.distinctEcoCodesA, 2); // A00, C50
  assert.equal(result.stats.distinctFamilies, 2); // "Amar Opening", "Italian Game"

  const paris = result.lines.find((l) => l.name === 'Amar Opening: Paris Gambit');
  assert.equal(paris.family, 'Amar Opening');
  assert.equal(paris.variation, 'Paris Gambit');
  assert.equal(paris.plies.length, 3);

  const amarRoot = result.lines.find((l) => l.name === 'Amar Opening');
  assert.equal(amarRoot.inSourceB, true, 'the exact final FEN for 1. Nh3 is vendored in the fixture');

  const italian = result.lines.find((l) => l.eco === 'C50');
  assert.equal(italian.inSourceB, true);

  assert.equal(result.quarantinedFromB.length, 1);
  assert.equal(result.quarantinedFromB[0].code, 'A00 ');
  assert.equal(result.quarantinedFromB[0].trimmedMatchesA, true);
});

test('buildEcoDataset: a malformed row anywhere in the vendored data fails the whole build loudly', () => {
  const tsvHeader = 'eco\tname\tpgn\n';
  const files = {
    'lichess-chess-openings/a.tsv': tsvHeader + 'A00\tBroken Row\t1. e4 e5 2. Qh5xh8\n', // illegal move
    'lichess-chess-openings/b.tsv': tsvHeader,
    'lichess-chess-openings/c.tsv': tsvHeader,
    'lichess-chess-openings/d.tsv': tsvHeader,
    'lichess-chess-openings/e.tsv': tsvHeader,
    'eco-json/ecoA.json': JSON.stringify({}),
    'eco-json/ecoB.json': JSON.stringify({}),
    'eco-json/ecoC.json': JSON.stringify({}),
    'eco-json/ecoD.json': JSON.stringify({}),
    'eco-json/ecoE.json': JSON.stringify({}),
  };
  assert.throws(
    () => buildEcoDataset({ dataDir: '/fake/data/eco', readFileImpl: fakeReadFileImpl(files) }),
    (err) => {
      assert.ok(err instanceof EcoDataError);
      assert.equal(err.context.eco, 'A00');
      assert.equal(err.context.name, 'Broken Row');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Real vendored data -- the actual validation pass this task exists to run.
// Skipped automatically if the vendored files aren't present (shouldn't happen
// in this repo, but keeps this test file from being a hard disk-layout coupling).
// ---------------------------------------------------------------------------

const vendoredDataExists = SOURCE_A_FILES.every((f) =>
  fs.existsSync(path.join(DEFAULT_DATA_DIR, 'lichess-chess-openings', f)),
) && SOURCE_B_FILES.every((f) => fs.existsSync(path.join(DEFAULT_DATA_DIR, 'eco-json', f)));

test(
  'buildEcoDataset: real vendored data -- all 3,810 rows parse and validate, matching the spec\'s measured numbers',
  { skip: !vendoredDataExists && 'vendored ECO data not present in this checkout' },
  () => {
    const { lines, stats, quarantinedFromB, onlyInA } = buildEcoDataset();

    assert.equal(stats.totalLines, 3810);
    assert.equal(stats.distinctEcoCodesA, 500);
    assert.equal(stats.distinctFamilies, 149);
    assert.equal(stats.sourceBTotalEntries, 12379);
    assert.equal(stats.distinctEcoCodesB, 506);

    // Per-volume row counts from the spec (measured against the pinned commit).
    const byFile = {};
    for (const l of lines) byFile[l.sourceFile] = (byFile[l.sourceFile] || 0) + 1;
    assert.equal(byFile['a.tsv'], 817);
    assert.equal(byFile['b.tsv'], 772);
    assert.equal(byFile['c.tsv'], 1250);
    assert.equal(byFile['d.tsv'], 614);
    assert.equal(byFile['e.tsv'], 357);

    // Every line has at least one validated ply and a well-formed final FEN.
    for (const line of lines) {
      assert.ok(line.plies.length >= 1, `${line.eco} ${line.name} has no plies`);
      assert.match(line.finalFen, /^[1-8pnbrqkPNBRQK/]+ [wb] [KQkq-]+ (-|[a-h][36]) \d+ \d+$/);
    }

    // The known 506-vs-500 discrepancy is fully explained by whitespace typos in Source B.
    assert.equal(quarantinedFromB.length, 6);
    assert.ok(quarantinedFromB.every((q) => q.trimmedMatchesA === true));
    assert.equal(onlyInA.length, 0);
  },
);
