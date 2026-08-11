'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { summarizeRatingHistory, summarizeGames } = require('../src/process');

const FIXTURES = path.join(__dirname, 'fixtures');
const ratingHistoryFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'rating-history.json'), 'utf8'));
const gamesFixture = fs
  .readFileSync(path.join(FIXTURES, 'games.ndjson'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

test('summarizeRatingHistory computes current/peak/low/change per variant', () => {
  const rows = summarizeRatingHistory(ratingHistoryFixture);

  const blitz = rows.find((r) => r.variant === 'Blitz');
  assert.ok(blitz, 'Blitz row should exist');
  assert.equal(blitz.current, 1650);
  assert.equal(blitz.peak, 1650);
  assert.equal(blitz.low, 1500);
  assert.equal(blitz.change, 150);
  assert.equal(blitz.gamesRecorded, 4);
  assert.equal(blitz.firstDate, '2026-01-05');
  assert.equal(blitz.lastDate, '2026-04-01');

  const bullet = rows.find((r) => r.variant === 'Bullet');
  assert.ok(bullet, 'Bullet row should exist');
  assert.equal(bullet.current, 1580);
  assert.equal(bullet.change, -20);
});

test('summarizeRatingHistory drops variants with zero recorded points', () => {
  const rows = summarizeRatingHistory(ratingHistoryFixture);
  assert.equal(rows.find((r) => r.variant === 'Correspondence'), undefined);
});

test('summarizeRatingHistory returns [] for non-array input', () => {
  assert.deepEqual(summarizeRatingHistory(null), []);
  assert.deepEqual(summarizeRatingHistory(undefined), []);
});

test('summarizeGames counts wins/losses/draws correctly regardless of color', () => {
  const summary = summarizeGames(gamesFixture, 'TestUser');
  assert.equal(summary.totalGames, 3);
  // game1: TestUser is white, winner white -> win
  // game2: TestUser is black, winner black -> win
  // game3: no winner -> draw
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 0);
  assert.equal(summary.draws, 1);
  assert.equal(summary.winRate, 66.7);
  assert.equal(summary.avgOpponentRating, 1630);
});

test('summarizeGames matches username case-insensitively and lists opponents/results', () => {
  const summary = summarizeGames(gamesFixture, 'testuser');
  assert.equal(summary.results.length, 3);
  assert.equal(summary.results[0].opponent, 'OpponentA');
  assert.equal(summary.results[0].color, 'white');
  assert.equal(summary.results[0].result, 'win');
  assert.equal(summary.results[1].opponent, 'OpponentB');
  assert.equal(summary.results[1].color, 'black');
  assert.equal(summary.results[1].result, 'win');
  assert.equal(summary.results[2].result, 'draw');
  assert.match(summary.results[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test('summarizeGames handles empty input gracefully', () => {
  const summary = summarizeGames([], 'TestUser');
  assert.equal(summary.totalGames, 0);
  assert.equal(summary.winRate, null);
  assert.equal(summary.avgOpponentRating, null);
  assert.deepEqual(summary.results, []);
});
