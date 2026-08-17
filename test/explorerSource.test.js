'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { fetchMoves, aggregatesAvailable, DEFAULT_POOL } = require('../src/explorerSource');
const { walkPositions } = require('../src/ingest/positionWalk');

function tmpAggregatesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-source-'));
}

function writeFixtureAggregates(dir) {
  const startNodes = walkPositions(['e4']);
  const startKey = startNodes[0].posKey;
  const root = {
    positions: {
      '1600-1800': {
        blitz: {
          [startKey]: [10, 2, 8, 4, 1, 3, {
            e2e4: [7, 1, 2, 3, 0, 1, 16400, 10],
            d2d4: [3, 1, 6, 1, 1, 2, 4800, 3],
            g1f3: [0, 0, 0, 0, 0, 0, 0, 0],
          }],
        },
      },
    },
    pathIndex: {},
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify(root), 'utf8');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString() }), 'utf8');
}

test('aggregatesAvailable: false when the directory has no manifest.json/root.json', () => {
  const dir = tmpAggregatesDir();
  assert.equal(aggregatesAvailable(dir), false);
});

test('aggregatesAvailable: true once both manifest.json and root.json exist', () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  assert.equal(aggregatesAvailable(dir), true);
});

test('fetchMoves: with no aggregate data present, falls back to the live-API fetchImpl unchanged (today\'s production behavior)', async () => {
  const dir = tmpAggregatesDir(); // empty -- no manifest.json
  let capturedUrl = null;
  const fakeFetchImpl = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ white: 5, draws: 1, black: 4, moves: [], opening: null }),
    };
  };
  const response = await fetchMoves({
    play: [], band: '1600-1800', ratings: [1600], speeds: ['blitz', 'rapid'], moves: 8, fetchImpl: fakeFetchImpl, dir,
  });
  assert.equal(response.white, 5);
  assert.ok(capturedUrl, 'expected the live-API fetchImpl to have been called');
  assert.match(capturedUrl, /ratings=1600/);
  assert.match(capturedUrl, /speeds=blitz%2Crapid/);
});

test('fetchMoves: once aggregate data is present, issues zero live-API calls and returns the aggregate-shaped response', async () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  const fakeFetchImpl = async () => {
    throw new Error('fetchMoves should never call the live API when aggregate data is present');
  };
  const response = await fetchMoves({ play: [], band: '1600-1800', fetchImpl: fakeFetchImpl, dir });
  assert.equal(response.white, 10);
  assert.equal(response.draws, 2);
  assert.equal(response.black, 8);
  assert.deepEqual(response.balanced, { white: 4, draws: 1, black: 3 });
  assert.equal(response.moves.length, 3);
});

test('fetchMoves: defaults to the blitz pool when none is given (spec section 1.3\'s default-pool decision)', async () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  assert.equal(DEFAULT_POOL, 'blitz');
  const response = await fetchMoves({ play: [], band: '1600-1800', dir });
  assert.equal(response.white, 10); // only resolves if it actually looked up the 'blitz' pool
});

test('fetchMoves: `moves` truncates the aggregate-sourced move list to the top N by total games, matching the live API\'s own `moves` param', async () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  const response = await fetchMoves({ play: [], band: '1600-1800', moves: 2, dir });
  assert.equal(response.moves.length, 2);
  // Sorted descending by total games -- e2e4 (10 games) then d2d4 (5 games), never the 0-game g1f3 entry.
  assert.deepEqual(response.moves.map((m) => m.uci), ['e2e4', 'd2d4']);
});

test('fetchMoves: an unfound position on the aggregate path returns a well-shaped empty response, not a throw', async () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  const response = await fetchMoves({ play: ['e2e4', 'e7e5', 'g1f3'], band: '1600-1800', dir });
  assert.equal(response.white, 0);
  assert.deepEqual(response.moves, []);
});

test('fetchMoves: on the aggregate path, each move carries resultingBalanced -- null when the resulting position has no record (WS-3.3 condition 4 data)', async () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  const response = await fetchMoves({ play: [], band: '1600-1800', dir });
  const e4 = response.moves.find((m) => m.uci === 'e2e4');
  // The fixture never stores a record for the position after 1.e4, so this
  // must be null (no data), never 0 (a real, tiny sample) -- see
  // resultingPositionBalanced's own doc comment for why that distinction matters.
  assert.equal(e4.resultingBalanced, null);
});

test('fetchMoves: on the aggregate path, resultingBalanced resolves a real value once the resulting position IS in the dataset', async () => {
  const dir = tmpAggregatesDir();
  writeFixtureAggregates(dir);
  const rootPath = path.join(dir, 'root.json');
  const root = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  const afterE4Key = walkPositions(['e4'])[1].posKey;
  root.positions['1600-1800'].blitz[afterE4Key] = [7, 1, 2, 3, 0, 1, {}];
  fs.writeFileSync(rootPath, JSON.stringify(root), 'utf8');

  const response = await fetchMoves({ play: [], band: '1600-1800', dir });
  const e4 = response.moves.find((m) => m.uci === 'e2e4');
  assert.deepEqual(e4.resultingBalanced, { white: 3, draws: 0, black: 1 });
});

test('fetchMoves: on the live-API fallback path, moves carry no resultingBalanced field at all', async () => {
  const dir = tmpAggregatesDir(); // empty -- no manifest.json, forces live-API fallback
  const fakeFetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ white: 5, draws: 1, black: 4, moves: [{ uci: 'e2e4', san: 'e4', white: 3, draws: 1, black: 1, averageRating: 1500 }], opening: null }),
  });
  const response = await fetchMoves({ play: [], band: '1600-1800', ratings: [1600], speeds: ['blitz'], fetchImpl: fakeFetchImpl, dir });
  assert.equal(response.moves[0].resultingBalanced, undefined);
});

test('actualPoolSpeeds: reports the real live-API-fallback speeds when no aggregate data is present, and single-pool blitz once it is -- the single source of truth every "which pool did this build use" disclosure (pack.json/README/repertoire-packs pages, and renderContent.js\'s renderOpeningPage manifest branch) now reads instead of a hardcoded literal', () => {
  const { actualPoolSpeeds, DEFAULT_POOL } = require('../src/explorerSource');
  const emptyDir = tmpAggregatesDir();
  assert.deepEqual(actualPoolSpeeds(emptyDir), ['blitz', 'rapid']);

  const realDir = tmpAggregatesDir();
  writeFixtureAggregates(realDir);
  assert.deepEqual(actualPoolSpeeds(realDir), [DEFAULT_POOL]);
  assert.deepEqual(actualPoolSpeeds(realDir), ['blitz']);
});
