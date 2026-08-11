'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  fetchExplorerMoves,
  ExplorerRateLimitError,
  ExplorerApiError,
  START_FEN,
} = require('../src/fetchOpeningExplorer');

const FIXTURES = path.join(__dirname, 'fixtures');
const explorerResponseFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));

// All tests below use a hand-built fake fetch -- no live network calls are
// made anywhere in this file.
function fakeResponse({ status = 200, statusText = 'OK', json = null, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => json,
  };
}

test('fetchExplorerMoves resolves with parsed JSON on success', async () => {
  const fetchImpl = async () => fakeResponse({ status: 200, json: explorerResponseFixture });
  const data = await fetchExplorerMoves({ ratings: [1600], fetchImpl });
  assert.equal(data.moves.length, 3);
  assert.equal(data.moves[0].san, 'e4');
});

test('fetchExplorerMoves throws when ratings is missing or empty', async () => {
  await assert.rejects(() => fetchExplorerMoves({ fetchImpl: async () => fakeResponse({ json: {} }) }), /ratings/);
  await assert.rejects(() => fetchExplorerMoves({ ratings: [], fetchImpl: async () => fakeResponse({ json: {} }) }), /ratings/);
});

test('fetchExplorerMoves throws ExplorerRateLimitError on 429', async () => {
  const fetchImpl = async () => fakeResponse({ status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '20' } });
  await assert.rejects(async () => {
    try {
      await fetchExplorerMoves({ ratings: [1600], fetchImpl });
    } catch (err) {
      assert.ok(err instanceof ExplorerRateLimitError);
      assert.equal(err.retryAfter, '20');
      throw err;
    }
  }, ExplorerRateLimitError);
});

test('fetchExplorerMoves throws ExplorerApiError on other non-ok statuses', async () => {
  const fetchImpl = async () => fakeResponse({ status: 500, statusText: 'Internal Server Error' });
  await assert.rejects(() => fetchExplorerMoves({ ratings: [1600], fetchImpl }), ExplorerApiError);
});

test('fetchExplorerMoves builds the URL with fen, play, ratings, speeds, and moves', async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return fakeResponse({ status: 200, json: explorerResponseFixture });
  };
  await fetchExplorerMoves({
    play: ['e2e4', 'c7c5'],
    ratings: [1600, 1800],
    speeds: ['blitz', 'rapid'],
    moves: 5,
    fetchImpl,
  });

  assert.match(capturedUrl, /^https:\/\/explorer\.lichess\.org\/lichess\?/);
  const parsed = new URL(capturedUrl);
  assert.equal(parsed.searchParams.get('fen'), START_FEN);
  assert.equal(parsed.searchParams.get('play'), 'e2e4,c7c5');
  assert.equal(parsed.searchParams.get('ratings'), '1600,1800');
  assert.equal(parsed.searchParams.get('speeds'), 'blitz,rapid');
  assert.equal(parsed.searchParams.get('moves'), '5');
});

test('fetchExplorerMoves omits the play param when no moves have been played', async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return fakeResponse({ status: 200, json: explorerResponseFixture });
  };
  await fetchExplorerMoves({ ratings: [1600], fetchImpl });
  const parsed = new URL(capturedUrl);
  assert.equal(parsed.searchParams.has('play'), false);
});
