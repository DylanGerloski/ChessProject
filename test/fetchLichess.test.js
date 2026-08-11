'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  fetchUserProfile,
  fetchRatingHistory,
  fetchRecentGames,
  LichessNotFoundError,
  LichessRateLimitError,
  LichessApiError,
} = require('../src/fetchLichess');

const FIXTURES = path.join(__dirname, 'fixtures');
const userProfileFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'user-profile.json'), 'utf8'));
const ratingHistoryFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'rating-history.json'), 'utf8'));
const gamesNdjsonFixture = fs.readFileSync(path.join(FIXTURES, 'games.ndjson'), 'utf8');

// All tests below use a hand-built fake fetch -- no live network calls are
// made anywhere in this file.
function fakeResponse({ status = 200, statusText = 'OK', json = null, text = null, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => json,
    text: async () => text,
  };
}

test('fetchUserProfile resolves with parsed JSON on success', async () => {
  const fetchImpl = async () => fakeResponse({ status: 200, json: userProfileFixture });
  const profile = await fetchUserProfile('TestUser', { fetchImpl });
  assert.equal(profile.username, 'TestUser');
  assert.equal(profile.perfs.blitz.rating, 1650);
});

test('fetchUserProfile throws LichessNotFoundError on 404', async () => {
  const fetchImpl = async () => fakeResponse({ status: 404, statusText: 'Not Found' });
  await assert.rejects(() => fetchUserProfile('nobody', { fetchImpl }), LichessNotFoundError);
});

test('fetchUserProfile throws LichessRateLimitError on 429', async () => {
  const fetchImpl = async () => fakeResponse({ status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '30' } });
  await assert.rejects(async () => {
    try {
      await fetchUserProfile('anyone', { fetchImpl });
    } catch (err) {
      assert.ok(err instanceof LichessRateLimitError);
      assert.equal(err.retryAfter, '30');
      throw err;
    }
  }, LichessRateLimitError);
});

test('fetchUserProfile throws LichessApiError on other non-ok statuses', async () => {
  const fetchImpl = async () => fakeResponse({ status: 500, statusText: 'Internal Server Error' });
  await assert.rejects(() => fetchUserProfile('anyone', { fetchImpl }), LichessApiError);
});

test('fetchRatingHistory resolves with parsed JSON array on success', async () => {
  const fetchImpl = async () => fakeResponse({ status: 200, json: ratingHistoryFixture });
  const history = await fetchRatingHistory('TestUser', { fetchImpl });
  assert.equal(history.length, 3);
  assert.equal(history[0].name, 'Blitz');
});

test('fetchRatingHistory throws LichessNotFoundError on 404', async () => {
  const fetchImpl = async () => fakeResponse({ status: 404 });
  await assert.rejects(() => fetchRatingHistory('nobody', { fetchImpl }), LichessNotFoundError);
});

test('fetchRecentGames parses ndjson body into an array of game objects', async () => {
  const fetchImpl = async () => fakeResponse({ status: 200, text: gamesNdjsonFixture });
  const games = await fetchRecentGames('TestUser', { max: 15, fetchImpl });
  assert.equal(games.length, 3);
  assert.deepEqual(games.map((g) => g.id), ['game1', 'game2', 'game3']);
});

test('fetchRecentGames throws LichessRateLimitError on 429', async () => {
  const fetchImpl = async () => fakeResponse({ status: 429, headers: { 'retry-after': '5' } });
  await assert.rejects(() => fetchRecentGames('TestUser', { fetchImpl }), LichessRateLimitError);
});

test('fetchRecentGames requests the ndjson accept header and includes max in the URL', async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  const fetchImpl = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return fakeResponse({ status: 200, text: '' });
  };
  await fetchRecentGames('TestUser', { max: 7, fetchImpl });
  assert.match(capturedUrl, /\/api\/games\/user\/TestUser\?max=7/);
  assert.equal(capturedHeaders.Accept, 'application/x-ndjson');
});
