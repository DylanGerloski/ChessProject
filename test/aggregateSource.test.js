'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadAggregates, resolvePosition, explorerShapedResponse, resultingPositionBalanced } = require('../src/aggregateSource');
const { walkPositions } = require('../src/ingest/positionWalk');
const { moveStatsFromExplorerResponse } = require('../src/processRepertoire');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-source-'));
}

function writeFixtureAggregates(dir) {
  const startNodes = walkPositions(['e4']);
  const startKey = startNodes[0].posKey;
  const afterE4Key = startNodes[1].posKey;

  const root = {
    positions: {
      '1600-1800': {
        blitz: {
          [startKey]: [10, 2, 8, 4, 1, 3, {
            e2e4: [7, 1, 2, 3, 0, 1, 16400, 10],
            d2d4: [3, 1, 6, 1, 1, 2, 4800, 3],
          }],
        },
      },
    },
    pathIndex: { e2e4: afterE4Key },
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify(root), 'utf8');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString() }), 'utf8');
  return { startKey, afterE4Key };
}

test('resolvePosition: replays a UCI play list to the correct posKey', () => {
  const { posKey } = resolvePosition(['e2e4']);
  const expected = walkPositions(['e4'])[1].posKey;
  assert.equal(posKey, expected);
});

test('resolvePosition: empty play list resolves to the starting position', () => {
  const { posKey } = resolvePosition([]);
  const expected = walkPositions([])[0].posKey;
  assert.equal(posKey, expected);
});

test('resolvePosition: throws on an illegal move rather than silently producing a wrong FEN', () => {
  assert.throws(() => resolvePosition(['a1a8']), /illegal move/);
});

test('loadAggregates: throws a clear error when manifest.json is missing', () => {
  const dir = tmpDir();
  assert.throws(() => loadAggregates({ dir }), /no manifest\.json/);
});

test('explorerShapedResponse: matches the shape moveStatsFromExplorerResponse() already consumes', () => {
  const dir = tmpDir();
  writeFixtureAggregates(dir);
  const aggregates = loadAggregates({ dir });

  const response = explorerShapedResponse({ aggregates, play: [], band: '1600-1800', pool: 'blitz' });
  assert.equal(response.white, 10);
  assert.equal(response.draws, 2);
  assert.equal(response.black, 8);
  assert.deepEqual(response.balanced, { white: 4, draws: 1, black: 3 });
  assert.equal(response.moves.length, 2);

  // Drop-in compatible with the existing consumer.
  const stats = moveStatsFromExplorerResponse(response, 'white');
  assert.equal(stats.length, 2);
  const e4 = stats.find((m) => m.uci === 'e2e4');
  assert.equal(e4.san, 'e4');
  assert.equal(e4.games, 10);
  assert.equal(e4.averageRating, 1640);
});

test('explorerShapedResponse: an unfound position returns a well-shaped empty response, not a throw', () => {
  const dir = tmpDir();
  writeFixtureAggregates(dir);
  const aggregates = loadAggregates({ dir });
  const response = explorerShapedResponse({ aggregates, play: ['e2e4', 'e7e5', 'g1f3'], band: '1600-1800', pool: 'blitz' });
  assert.equal(response.white, 0);
  assert.deepEqual(response.moves, []);
});

test('explorerShapedResponse: falls back to a family shard for a position not in root', () => {
  const dir = tmpDir();
  writeFixtureAggregates(dir);
  const deepNodes = walkPositions(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
  const deepKey = deepNodes[8].posKey;
  const familyDir = path.join(dir, 'f');
  fs.mkdirSync(familyDir, { recursive: true });
  fs.writeFileSync(
    path.join(familyDir, 'ruy-lopez.json'),
    JSON.stringify({ family: 'Ruy Lopez', slug: 'ruy-lopez', positions: { b: { blitz: { [deepKey]: [5, 0, 1, 2, 0, 0, {}] } } } }),
    'utf8',
  );
  const aggregates = loadAggregates({ dir });
  const response = explorerShapedResponse({
    aggregates,
    play: deepNodes.slice(1).map((n) => n.move.uci),
    band: 'b',
    pool: 'blitz',
    familySlug: 'ruy-lopez',
  });
  assert.equal(response.white, 5);
  assert.equal(response.black, 1);
});

test('explorerShapedResponse: each move carries its own balanced (rating gap <= 50) counts, additive to the all-games ones', () => {
  const dir = tmpDir();
  writeFixtureAggregates(dir);
  const aggregates = loadAggregates({ dir });
  const response = explorerShapedResponse({ aggregates, play: [], band: '1600-1800', pool: 'blitz' });
  const e4 = response.moves.find((m) => m.uci === 'e2e4');
  const d4 = response.moves.find((m) => m.uci === 'd2d4');
  assert.deepEqual(e4.balanced, { white: 3, draws: 0, black: 1 });
  assert.deepEqual(d4.balanced, { white: 1, draws: 1, black: 2 });
});

test('resultingPositionBalanced: returns the RESULTING position\'s balanced totals, merged across every path that reaches it', () => {
  const dir = tmpDir();
  const { afterE4Key } = writeFixtureAggregates(dir);
  // Add a second position record for "after 1.e4" so resultingPositionBalanced
  // has something real to find (writeFixtureAggregates only stores the
  // starting position's record).
  const rootPath = path.join(dir, 'root.json');
  const root = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  root.positions['1600-1800'].blitz[afterE4Key] = [7, 1, 2, 3, 0, 1, {}];
  fs.writeFileSync(rootPath, JSON.stringify(root), 'utf8');

  const aggregates = loadAggregates({ dir });
  const result = resultingPositionBalanced({ aggregates, play: [], uci: 'e2e4', band: '1600-1800', pool: 'blitz' });
  assert.deepEqual(result, { white: 3, draws: 0, black: 1 });
});

test('resultingPositionBalanced: returns null (not zero) when the resulting position is not in this dataset', () => {
  const dir = tmpDir();
  writeFixtureAggregates(dir);
  const aggregates = loadAggregates({ dir });
  const result = resultingPositionBalanced({ aggregates, play: [], uci: 'g1f3', band: '1600-1800', pool: 'blitz' });
  assert.equal(result, null);
});
