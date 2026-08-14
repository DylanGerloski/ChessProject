'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  speedFromEventHeader,
  speedFromTimeControl,
  bandForRating,
  classifyGame,
  resultLetter,
} = require('../src/ingest/gameFilter');

test('speedFromEventHeader: recognizes each published speed, longest-needle-first', () => {
  assert.equal(speedFromEventHeader('Rated Blitz game'), 'blitz');
  assert.equal(speedFromEventHeader('Rated UltraBullet game'), 'ultraBullet');
  assert.equal(speedFromEventHeader('Rated Bullet tournament'), 'bullet');
  assert.equal(speedFromEventHeader('Rated Correspondence game'), 'correspondence');
  assert.equal(speedFromEventHeader('Rated Rapid swiss'), 'rapid');
  assert.equal(speedFromEventHeader(undefined), null);
  assert.equal(speedFromEventHeader('Something unrecognized'), null);
});

test('speedFromTimeControl: buckets by Lichess\'s published duration thresholds', () => {
  assert.equal(speedFromTimeControl('15+0'), 'ultraBullet');
  assert.equal(speedFromTimeControl('60+0'), 'bullet');
  assert.equal(speedFromTimeControl('180+2'), 'blitz');
  assert.equal(speedFromTimeControl('600+5'), 'rapid');
  assert.equal(speedFromTimeControl('1800+30'), 'classical');
  assert.equal(speedFromTimeControl('-'), 'correspondence');
  assert.equal(speedFromTimeControl('garbage'), null);
});

test('bandForRating: bucket boundaries are inclusive on the low end', () => {
  assert.equal(bandForRating(1199), 'u1200');
  assert.equal(bandForRating(1200), '1200-1400');
  assert.equal(bandForRating(1399), '1200-1400');
  assert.equal(bandForRating(2000), '2000+');
  assert.equal(bandForRating(2900), '2000+');
});

test('resultLetter: maps the three legal PGN results', () => {
  assert.equal(resultLetter('1-0'), 'w');
  assert.equal(resultLetter('1/2-1/2'), 'd');
  assert.equal(resultLetter('0-1'), 'l');
  assert.equal(resultLetter('*'), null);
});

test('classifyGame: excludes an unterminated game (Result "*")', () => {
  const result = classifyGame({ Result: '*', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated Blitz game' });
  assert.deepEqual(result, { include: false, reason: 'result' });
});

test('classifyGame: excludes a game missing either Elo', () => {
  const result = classifyGame({ Result: '1-0', WhiteElo: '?', BlackElo: '1500', Event: 'Rated Blitz game' });
  assert.equal(result.include, false);
  assert.equal(result.reason, 'missing-elo');
});

test('classifyGame: excludes correspondence outright', () => {
  const result = classifyGame({ Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated Correspondence game', TimeControl: '-' });
  assert.deepEqual(result, { include: false, reason: 'correspondence' });
});

test('classifyGame: includes a normal blitz game with the correct band/pool/balanced', () => {
  const result = classifyGame({
    Result: '1-0', WhiteElo: '1620', BlackElo: '1660', Event: 'Rated Blitz game', TimeControl: '180+2',
  });
  assert.equal(result.include, true);
  assert.equal(result.band, '1600-1800');
  assert.equal(result.pool, 'blitz');
  assert.equal(result.speed, 'blitz');
  assert.equal(result.balanced, true);
  assert.equal(result.avgElo, 1640);
  assert.equal(result.speedDisagreement, false);
});

test('classifyGame: an unbalanced pair (gap > 50) is not balanced', () => {
  const result = classifyGame({
    Result: '1-0', WhiteElo: '1400', BlackElo: '1600', Event: 'Rated Blitz game', TimeControl: '180+2',
  });
  assert.equal(result.balanced, false);
});

test('classifyGame: flags a speed disagreement between Event and TimeControl without excluding the game', () => {
  const result = classifyGame({
    Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated Blitz game', TimeControl: '600+5',
  });
  assert.equal(result.include, true);
  assert.equal(result.speed, 'blitz'); // Event is primary
  assert.equal(result.speedDisagreement, true);
});

test('classifyGame: falls back to TimeControl when Event is unrecognized', () => {
  const result = classifyGame({
    Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Some tournament', TimeControl: '180+2',
  });
  assert.equal(result.include, true);
  assert.equal(result.speed, 'blitz');
});

test('classifyGame: bullet and ultraBullet both map to the bullet pool', () => {
  const bullet = classifyGame({ Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated Bullet game' });
  const ultra = classifyGame({ Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated UltraBullet game' });
  assert.equal(bullet.pool, 'bullet');
  assert.equal(ultra.pool, 'bullet');
});

test('classifyGame: rapid and classical both map to the rapid_classical pool', () => {
  const rapid = classifyGame({ Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated Rapid game' });
  const classical = classifyGame({ Result: '1-0', WhiteElo: '1500', BlackElo: '1500', Event: 'Rated Classical game' });
  assert.equal(rapid.pool, 'rapid_classical');
  assert.equal(classical.pool, 'rapid_classical');
});
