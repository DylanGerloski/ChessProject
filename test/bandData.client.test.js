'use strict';

// src/browser/bandData.client.js is a real CommonJS module required()d by
// other client entry points (src/browser/repertoireBuilder.client.js etc.),
// not an esbuild entry point itself -- same shape as
// src/browser/bandState.client.js, tested the same way: required directly
// in Node with a fake fetchImpl, no bundling/vm sandbox needed (see that
// test file's own header comment).

const test = require('node:test');
const assert = require('node:assert/strict');

const { lookup, shardUrl, clearCache } = require('../src/browser/bandData.client');
const { shardKeyFor, positionRecordFrom, buildShard } = require('../src/bandShards');

function fakeFetchServing(shardsByUrl) {
  return async (url) => {
    if (!(url in shardsByUrl)) {
      return { ok: false, status: 404 };
    }
    const body = shardsByUrl[url];
    return { ok: true, status: 200, json: async () => body };
  };
}

function shardWithStartPosition() {
  // Real starting-position posKey (matches test/bandShards.test.js's own
  // assertion for [] -- kept independent here rather than importing
  // posKeyFor, so this fixture is legible on its own).
  const posKey = require('../src/bandShards').posKeyFor([]).posKey;
  const positions = {
    [posKey]: positionRecordFrom({
      white: 6000,
      draws: 2000,
      black: 4000,
      moves: [
        { uci: 'e2e4', white: 3500, draws: 1200, black: 1300, averageRating: 1650 },
        { uci: 'd2d4', white: 2500, draws: 800, black: 2700, averageRating: 1640 },
      ],
    }),
  };
  return buildShard({ band: '1600-1800', pool: 'blitz', retrieved: '2026-08-15', minGames: 300, positions });
}

test.beforeEach(() => clearCache());

test('lookup: coverage "in" for a position present in the shard, with SAN derived and score computed from the side to move', async () => {
  const shard = shardWithStartPosition();
  const url = shardUrl('1600-1800', shardKeyFor([]));
  const fetchImpl = fakeFetchServing({ [url]: shard });

  const result = await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl });
  assert.equal(result.coverage, 'in');
  assert.equal(result.games, 12000);
  assert.equal(result.total.w, 6000);
  assert.equal(result.retrieved, '2026-08-15');
  assert.equal(result.moves.length, 2);

  const e4 = result.moves.find((m) => m.uci === 'e2e4');
  assert.equal(e4.san, 'e4');
  assert.equal(e4.games, 6000);
  assert.equal(e4.playedPct, 0.5);
  // White to move at the start position: score uses (white wins, draws, black wins).
  // (3500 + 1200/2) / 6000 = 0.68333...
  assert.ok(Math.abs(e4.score - 0.68333) < 0.001);
});

test('lookup: coverage "out-of-book" when the shard loads but has no record for this exact position', async () => {
  const shard = shardWithStartPosition();
  const url = shardUrl('1600-1800', shardKeyFor(['g1f3']));
  // Serve the SAME shard content at a shard URL that would never actually
  // contain the ply-1 position (root shard only stores the start position
  // in this fixture) -- simulates a real "no record for this posKey" case.
  const fetchImpl = fakeFetchServing({ [url]: { ...shard, positions: {} } });

  const result = await lookup({ play: ['g1f3'], band: '1600-1800', pool: 'blitz', fetchImpl });
  assert.equal(result.coverage, 'out-of-book');
  assert.equal(result.games, 0);
  assert.deepEqual(result.moves, []);
});

test('lookup: coverage "unavailable" on a fetch failure (404, offline, or a genuinely missing shard)', async () => {
  const fetchImpl = fakeFetchServing({});
  const result = await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl });
  assert.equal(result.coverage, 'unavailable');
  assert.deepEqual(result.moves, []);
});

test('lookup: coverage "unavailable" on unparseable JSON, degrading gracefully rather than throwing', async () => {
  const url = shardUrl('1600-1800', shardKeyFor([]));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  const result = await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl });
  assert.equal(result.coverage, 'unavailable');
});

test('lookup: coverage "unavailable" for a shard failing the v===1 shape check (a stale cached schema)', async () => {
  const shard = shardWithStartPosition();
  const url = shardUrl('1600-1800', shardKeyFor([]));
  const fetchImpl = fakeFetchServing({ [url]: { ...shard, v: 0 } });
  const result = await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl });
  assert.equal(result.coverage, 'unavailable');
});

test('lookup: one fetch() per shard per session -- a second lookup for the same shard does not re-request it', async () => {
  const shard = shardWithStartPosition();
  const url = shardUrl('1600-1800', shardKeyFor([]));
  let callCount = 0;
  const fetchImpl = async (u) => {
    callCount += 1;
    return u === url ? { ok: true, status: 200, json: async () => shard } : { ok: false, status: 404 };
  };

  await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl });
  await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl });
  assert.equal(callCount, 1);
});

test('lookup: with no fetchImpl available at all (no global fetch), resolves to "unavailable" rather than throwing', async () => {
  const result = await lookup({ play: [], band: '1600-1800', pool: 'blitz', fetchImpl: null });
  assert.equal(result.coverage, 'unavailable');
});
