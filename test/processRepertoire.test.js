'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { RATING_BANDS, DEFAULT_SPEEDS, moveStatsFromExplorerResponse } = require('../src/processRepertoire');

const FIXTURES = path.join(__dirname, 'fixtures');
const explorerResponseFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));

test('RATING_BANDS maps every advertised band to valid Lichess rating buckets', () => {
  assert.deepEqual(RATING_BANDS['1400-1600'], [1400]);
  assert.deepEqual(RATING_BANDS['1600-1800'], [1600]);
  assert.deepEqual(RATING_BANDS['1800-2000'], [1800]);
  assert.deepEqual(RATING_BANDS['2000+'], [2000, 2200, 2500]);
});

test('DEFAULT_SPEEDS is a non-empty array of speed names', () => {
  assert.ok(Array.isArray(DEFAULT_SPEEDS) && DEFAULT_SPEEDS.length > 0);
});

test('moveStatsFromExplorerResponse computes per-move stats for white and sorts by games desc', () => {
  const rows = moveStatsFromExplorerResponse(explorerResponseFixture, 'white');
  assert.equal(rows.length, 3);
  // e4: 28000+8000+19000 = 55000 games -- most played, should be first.
  assert.equal(rows[0].san, 'e4');
  assert.equal(rows[0].games, 55000);
  assert.equal(rows[0].winPct, Number(((28000 / 55000) * 100).toFixed(1)));
  assert.equal(rows[0].drawPct, Number(((8000 / 55000) * 100).toFixed(1)));
  assert.equal(rows[0].lossPct, Number(((19000 / 55000) * 100).toFixed(1)));
  assert.equal(rows[0].playedPct, Number(((55000 / 100000) * 100).toFixed(1)));
  assert.equal(rows[0].averageRating, 1700);

  // d4: 15000+5000+10500 = 30500 games -- second most played.
  assert.equal(rows[1].san, 'd4');
  assert.equal(rows[1].games, 30500);

  // Nf3: 7000+2000+5500 = 14500 games -- least played of the three.
  assert.equal(rows[2].san, 'Nf3');
  assert.equal(rows[2].games, 14500);
});

test('moveStatsFromExplorerResponse flips win/loss framing for black', () => {
  const rows = moveStatsFromExplorerResponse(explorerResponseFixture, 'black');
  const e4 = rows.find((r) => r.san === 'e4');
  // For black, "winPct" should reflect black's win rate (the `black` count),
  // and "lossPct" should reflect white's win rate.
  assert.equal(e4.winPct, Number(((19000 / 55000) * 100).toFixed(1)));
  assert.equal(e4.lossPct, Number(((28000 / 55000) * 100).toFixed(1)));
  assert.equal(e4.drawPct, Number(((8000 / 55000) * 100).toFixed(1)));
});

test('moveStatsFromExplorerResponse handles an empty/missing moves array gracefully', () => {
  assert.deepEqual(moveStatsFromExplorerResponse({ white: 0, draws: 0, black: 0, moves: [] }, 'white'), []);
  assert.deepEqual(moveStatsFromExplorerResponse({}, 'white'), []);
});

test('moveStatsFromExplorerResponse rejects an invalid moverColor', () => {
  assert.throws(() => moveStatsFromExplorerResponse(explorerResponseFixture, 'red'), /moverColor/);
});
