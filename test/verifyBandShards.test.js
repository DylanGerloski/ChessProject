'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAll, summarize } = require('../scripts/verifyBandShards');
const { buildShard } = require('../src/bandShards');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'band-shards');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-band-shards-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('runAll: the hand-checked fixture directory passes all three checks', () => {
  const { results } = runAll(FIXTURE_DIR);
  const { anyFail } = summarize(results);
  assert.equal(anyFail, false);
  for (const { problems } of results) assert.deepEqual(problems, []);
});

test('runAll: a genuinely missing manifest is a WARN (non-gating), not a FAIL', () =>
  withTempDir((dir) => {
    const { results } = runAll(dir);
    const { anyFail } = summarize(results);
    assert.equal(anyFail, false);
    assert.ok(results[0].problems[0].startsWith('missing-manifest:'));
  })
);

test('runAll: an empty positions map fails the gate', () =>
  withTempDir((dir) => {
    const shard = buildShard({ band: '1600-1800', pool: 'blitz', retrieved: '2026-08-15', minGames: 300, positions: {} });
    fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify(shard), 'utf8');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      bands: [{ band: '1600-1800', shards: [{ file: 'root.json' }] }],
    }), 'utf8');

    const { results } = runAll(dir);
    const { anyFail } = summarize(results);
    assert.equal(anyFail, true);
    const emptyCheck = results.find((r) => r.name.includes('empty positions map'));
    assert.match(emptyCheck.problems[0], /empty positions map/);
  })
);

test('runAll: an internally inconsistent W/D/L record fails the gate', () =>
  withTempDir((dir) => {
    const shard = buildShard({
      band: '1600-1800',
      pool: 'blitz',
      retrieved: '2026-08-15',
      minGames: 300,
      positions: {
        aaaaaaaaaaaaaaaaaaaaaaaa: [10, 5, 5, [['e2e4', 999, 0, 0, 1600]]], // move white-wins > position white-wins
      },
    });
    fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify(shard), 'utf8');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      bands: [{ band: '1600-1800', shards: [{ file: 'root.json' }] }],
    }), 'utf8');

    const { results } = runAll(dir);
    const { anyFail } = summarize(results);
    assert.equal(anyFail, true);
    const consistencyCheck = results.find((r) => r.name.includes('W+D+L'));
    assert.match(consistencyCheck.problems[0], /exceeds position white-wins/);
  })
);

test('runAll: a shard file listed in the manifest but missing on disk fails the gate', () =>
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      bands: [{ band: '1600-1800', shards: [{ file: 'nonexistent.json' }] }],
    }), 'utf8');
    const { results } = runAll(dir);
    const { anyFail } = summarize(results);
    assert.equal(anyFail, true);
  })
);
