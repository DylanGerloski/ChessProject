'use strict';

// REWRITE, stated for anyone comparing this to the pre-WS-1 version: this
// file used to test buildDrillTree/buildDrillData (the old single-opening,
// live-Explorer tree builder). Those functions no longer exist -- see
// src/buildDrill.js's own header comment for the full explanation of the
// WS-1 rewrite (this module now walks the COMMITTED band shards at build
// time to produce drill-reference.html's content, never a live network
// call). This file tests the new shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MIN_REFERENCE_GAMES,
  readShardSync,
  readManifest,
  lookupSync,
  buildReferenceLines,
  buildDrillReferenceData,
} = require('../src/buildDrill');
const { getOpening } = require('../src/openings');

const REAL_REP_DATA_DIR = path.join(__dirname, '..', 'data', 'rep');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-reference-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------
// readShardSync / readManifest
// -----------------------------------------------------------------------

test('readShardSync: a missing shard file returns null, never throws', () => {
  withTempDir((dir) => {
    assert.equal(readShardSync(dir, '1600-1800', 'root'), null);
  });
});

test('readShardSync: unparseable JSON returns null, never throws', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '1600-1800'));
    fs.writeFileSync(path.join(dir, '1600-1800', 'root.json'), 'not json{{{');
    assert.equal(readShardSync(dir, '1600-1800', 'root'), null);
  });
});

test('readShardSync: a shape-invalid shard (wrong schema version) returns null', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '1600-1800'));
    fs.writeFileSync(path.join(dir, '1600-1800', 'root.json'), JSON.stringify({ v: 99, band: '1600-1800', pool: 'blitz', positions: {} }));
    assert.equal(readShardSync(dir, '1600-1800', 'root'), null);
  });
});

test('readShardSync: reads a real, valid shard from the committed data/rep/ directory', () => {
  const shard = readShardSync(REAL_REP_DATA_DIR, '1600-1800', 'root');
  assert.ok(shard, 'expected the real committed 1600-1800/root.json shard to exist and parse');
  assert.equal(shard.v, 1);
  assert.equal(shard.band, '1600-1800');
  assert.ok(Object.keys(shard.positions).length > 0);
});

test('readManifest: missing manifest returns null, never throws', () => {
  withTempDir((dir) => {
    assert.equal(readManifest(dir), null);
  });
});

test('readManifest: reads the real committed manifest', () => {
  const manifest = readManifest(REAL_REP_DATA_DIR);
  assert.ok(manifest);
  assert.equal(typeof manifest.retrieved, 'string');
  assert.equal(manifest.pool, 'blitz');
});

// -----------------------------------------------------------------------
// lookupSync
// -----------------------------------------------------------------------

test('lookupSync: real committed data at the start position (1600-1800) is "in" coverage with real, sane numbers', () => {
  const result = lookupSync(REAL_REP_DATA_DIR, '1600-1800', []);
  assert.equal(result.coverage, 'in');
  assert.ok(result.games > 0);
  assert.ok(result.moves.length > 0);
  for (const m of result.moves) {
    assert.equal(typeof m.san, 'string');
    assert.ok(m.san.length > 0);
    assert.ok(m.score >= 0 && m.score <= 1);
    assert.ok(m.scoreLo <= m.score && m.score <= m.scoreHi);
  }
  // e4 and d4 are real, dominant replies in this band -- sanity, not a
  // guess: both must appear somewhere in the candidate list.
  const sans = result.moves.map((m) => m.san);
  assert.ok(sans.includes('e4'));
  assert.ok(sans.includes('d4'));
});

test('lookupSync: a position with no crawled coverage returns "out-of-book", never throws', () => {
  // A long, specific, extremely unlikely-to-be-crawled line.
  const result = lookupSync(REAL_REP_DATA_DIR, '1600-1800', ['a2a3', 'h7h6', 'a3a4', 'h6h5', 'a4a5', 'h5h4']);
  assert.equal(result.coverage, 'out-of-book');
  assert.deepEqual(result.moves, []);
});

test('lookupSync: an unknown band (no shard directory at all) returns "out-of-book" rather than throwing', () => {
  const result = lookupSync(REAL_REP_DATA_DIR, 'not-a-real-band', []);
  assert.equal(result.coverage, 'out-of-book');
});

// -----------------------------------------------------------------------
// buildReferenceLines / buildDrillReferenceData
// -----------------------------------------------------------------------

test('buildReferenceLines: the Italian Game at 1600-1800 produces real, multi-ply lines from the committed shards', () => {
  const opening = getOpening('italian-game');
  const lines = buildReferenceLines({ band: '1600-1800', opening, repDataDir: REAL_REP_DATA_DIR, maxPlies: 4, breadth: 2 });
  assert.ok(lines.length > 0, 'expected at least one real reference line for a well-covered opening/band');
  for (const line of lines) {
    assert.ok(line.plies.length > 0);
    for (const ply of line.plies) {
      assert.equal(typeof ply.san, 'string');
      assert.ok(ply.games >= MIN_REFERENCE_GAMES, `every printed ply must clear the ${MIN_REFERENCE_GAMES}-game floor`);
    }
  }
});

test('buildReferenceLines: an opening/band pair with no coverage returns an empty array, not a throw', () => {
  const opening = getOpening('kings-indian-defense');
  // 2000+ band's data/rep coverage for KID may or may not exist; the
  // structural guarantee under test is "never throws, always an array."
  const lines = buildReferenceLines({ band: 'not-a-real-band', opening, repDataDir: REAL_REP_DATA_DIR });
  assert.deepEqual(lines, []);
});

test('buildDrillReferenceData: real bands x real openings, only entries with actual coverage are included (Non-Negotiable 4: no locked/empty content)', () => {
  const data = buildDrillReferenceData({ repDataDir: REAL_REP_DATA_DIR });
  assert.equal(data.length, 4, 'the four real crawled bands');
  let sawAtLeastOneOpening = false;
  for (const bandEntry of data) {
    assert.ok(['1400-1600', '1600-1800', '1800-2000', '2000+'].includes(bandEntry.band));
    for (const openingEntry of bandEntry.openings) {
      sawAtLeastOneOpening = true;
      assert.ok(openingEntry.lines.length > 0, `${bandEntry.band}/${openingEntry.slug} was included but has no lines`);
    }
  }
  assert.ok(sawAtLeastOneOpening, 'expected at least one real opening/band pair to have coverage in the committed data');
});

test('buildDrillReferenceData: an empty repDataDir produces bands with zero openings, never throws', () => {
  withTempDir((dir) => {
    const data = buildDrillReferenceData({ repDataDir: dir });
    assert.equal(data.length, 4);
    for (const bandEntry of data) {
      assert.deepEqual(bandEntry.openings, []);
    }
  });
});
