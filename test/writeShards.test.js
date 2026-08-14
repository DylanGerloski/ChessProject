'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeShards, ShardTooLargeError, MAX_SHARD_BYTES, countPositions } = require('../src/ingest/writeShards');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-shards-'));
}

test('countPositions: counts across bands and pools', () => {
  const positions = {
    b1: { blitz: { p1: [], p2: [] }, bullet: { p3: [] } },
    b2: { blitz: { p4: [] } },
  };
  assert.equal(countPositions(positions), 4);
});

test('writeShards: writes root.json, family shards, and manifest.json with a computed shards list', () => {
  const dir = tmpDir();
  const finalized = {
    root: { positions: { b1: { blitz: { pos1: [1, 0, 0, 0, 0, 0, {}] } } }, pathIndex: {} },
    families: new Map([['italian-game', { positions: { b1: { blitz: { pos2: [2, 0, 1, 0, 0, 0, {}] } } } }]]),
  };
  const familyDisplayNames = new Map([['italian-game', 'Italian Game']]);

  const { manifest, shardFiles } = writeShards({
    outDir: dir,
    finalized,
    familyDisplayNames,
    manifestFields: { pipelineVersion: 1, gamesScanned: 10 },
  });

  assert.ok(fs.existsSync(path.join(dir, 'root.json')));
  assert.ok(fs.existsSync(path.join(dir, 'f', 'italian-game.json')));
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));

  const familyOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'f', 'italian-game.json'), 'utf8'));
  assert.equal(familyOnDisk.family, 'Italian Game');
  assert.equal(familyOnDisk.slug, 'italian-game');

  assert.equal(manifest.pipelineVersion, 1);
  assert.equal(manifest.gamesScanned, 10);
  assert.equal(manifest.shards.length, 2);
  assert.equal(shardFiles.find((s) => s.file === 'root.json').positions, 1);
  assert.equal(shardFiles.find((s) => s.file === 'f/italian-game.json').positions, 1);

  const manifestOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifestOnDisk.shards, manifest.shards);
});

test('writeShards: throws ShardTooLargeError rather than silently writing an oversized shard', () => {
  const dir = tmpDir();
  // Build a family shard whose JSON serialization is deliberately over the
  // 5 MB budget.
  const bigMoves = {};
  for (let i = 0; i < 260000; i += 1) {
    bigMoves[`m${i}`] = [1, 1, 1, 1, 1, 1, 1500, 1];
  }
  const bigPositionRecord = [1, 0, 0, 0, 0, 0, bigMoves];
  const familyPositions = { b1: { blitz: { pos1: bigPositionRecord } } };
  const finalized = {
    root: { positions: {}, pathIndex: {} },
    families: new Map([['huge-family', { positions: familyPositions }]]),
  };
  assert.throws(
    () => writeShards({ outDir: dir, finalized, manifestFields: {} }),
    (err) => err instanceof ShardTooLargeError && err.bytes > MAX_SHARD_BYTES,
  );
});
