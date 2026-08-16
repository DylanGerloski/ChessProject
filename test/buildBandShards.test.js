'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fetchMoves } = require('../src/explorerSource');
const { walkPositions } = require('../src/ingest/positionWalk');
const {
  requireAggregates,
  crawlBand,
} = require('../scripts/buildBandShards');

// 2026-08-16 incident regression coverage: repertoire.html and
// repertoire-builder.html showed a ~6,900x-different games-count for the
// identical band+move because scripts/buildBandShards.js silently fell back
// to the live, all-time-cumulative Opening Explorer API instead of the same
// dump-derived data/aggregates/ dataset repertoire.html is built from. These
// tests assert (a) that fallback is now refused rather than silent, and
// (b) the crawler and explorerSource.fetchMoves() (repertoire.html's own
// read path) agree exactly on games-count for the same band+move when both
// read the same fixture aggregate data.

function tmpAggregatesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'build-band-shards-'));
}

const TEST_BAND = '1600-1800';

/**
 * Same fixture shape test/aggregateSource.test.js and test/explorerSource.test.js
 * already use: a root.json position record [w, d, b, [w,d,l], bw, bd, bl,
 * moves] -- deliberately well ABOVE buildBandShards.js's own MIN_GAMES (300)
 * so the crawler actually stores this position, and deliberately a small,
 * plausible one-band/one-pool total -- the opposite shape of the incident's
 * hundreds-of-millions all-time cumulative numbers.
 */
function writeFixtureAggregates(dir) {
  const startKey = walkPositions([])[0].posKey;
  const root = {
    positions: {
      [TEST_BAND]: {
        blitz: {
          [startKey]: [200, 50, 150, 80, 20, 60, {
            e2e4: [120, 30, 90, 48, 12, 36, 249600, 240],
            d2d4: [50, 15, 40, 20, 6, 16, 106400, 105],
          }],
        },
      },
    },
    pathIndex: {},
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify(root), 'utf8');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString() }), 'utf8');
  return { startKey };
}

function checkpointPath(band) {
  return path.join(__dirname, '..', '.cache', 'band-shards', `${band}.checkpoint.json`);
}

/** crawlBand() persists a real on-disk checkpoint keyed only by band name --
 * clear it before and after so this test never resumes stale state from a
 * previous run, and never leaves state behind for the next one. */
function clearCheckpoint() {
  fs.rmSync(checkpointPath(TEST_BAND), { force: true });
}

test('requireAggregates: throws a clear, non-silent error when no aggregate data is present', () => {
  const dir = tmpAggregatesDir(); // empty
  assert.throws(
    () => requireAggregates(dir),
    /Refusing to crawl the live Opening Explorer API as a substitute/
  );
});

test('requireAggregates: does not throw once real aggregate data exists', () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  assert.doesNotThrow(() => requireAggregates(dir));
});

test('requireAggregates: does not throw with no aggregates when allowLive is explicitly set', () => {
  const dir = tmpAggregatesDir(); // empty
  assert.doesNotThrow(() => requireAggregates(dir, { allowLive: true }));
});

test('crawlBand: with aggregate data present, issues zero live-API calls (the incident\'s exact failure mode)', async (t) => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  clearCheckpoint();
  t.after(clearCheckpoint);

  const fetchImpl = async () => {
    throw new Error('crawlBand should never call the live API when aggregate data is present');
  };

  const { state } = await crawlBand(TEST_BAND, { budget: 1, fetchImpl, aggregatesDir: dir });
  assert.equal(state.entries.length, 1);
});

test('crawlBand and explorerSource.fetchMoves (repertoire.html\'s own read path) agree exactly on games-count for the same band+move', async (t) => {
  const dir = tmpAggregatesDir();
  const { startKey } = writeFixtureAggregates(dir);
  clearCheckpoint();
  t.after(clearCheckpoint);

  const fetchImpl = async () => {
    throw new Error('should not be called: aggregate data is present');
  };

  // The crawler's own write path (what ends up in data/rep/).
  const { state } = await crawlBand(TEST_BAND, { budget: 1, fetchImpl, aggregatesDir: dir });
  assert.equal(state.entries.length, 1);
  const [entry] = state.entries;
  assert.equal(entry.posKey, startKey);
  const [w, d, b] = entry.record;
  const crawledTotal = w + d + b;

  // The SAME position, read the way src/buildRepertoire.js (repertoire.html)
  // reads it, via src/explorerSource.js's fetchMoves() directly.
  const response = await fetchMoves({ play: [], band: TEST_BAND, pool: 'blitz', dir });
  const readPathTotal = (response.white || 0) + (response.draws || 0) + (response.black || 0);

  assert.equal(crawledTotal, readPathTotal, 'the crawler and the repertoire.html read path must agree on games-count for the same band+move');
  assert.equal(crawledTotal, 400); // 200 + 50 + 150 -- sanity: a small, plausible fixture total, not an inflated one
});
