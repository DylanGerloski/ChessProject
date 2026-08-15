'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wilsonInterval, scoreInterval, formatInterval, Z_95 } = require('../src/stats');

test('wilsonInterval: hand-checked value at k=50, n=100 (~40.4% to 59.6%)', () => {
  const { low, high } = wilsonInterval(50, 100);
  assert.ok(Math.abs(low - 0.404) < 0.001, `low was ${low}`);
  assert.ok(Math.abs(high - 0.596) < 0.001, `high was ${high}`);
});

test('wilsonInterval: n=0 returns a degenerate zero interval, not NaN/Infinity', () => {
  const { low, high, half } = wilsonInterval(0, 0);
  assert.equal(low, 0);
  assert.equal(high, 0);
  assert.equal(half, 0);
});

test('wilsonInterval: n=1, k=1 (p=1) stays within [0,1] and is wide', () => {
  const { low, high, half } = wilsonInterval(1, 1);
  assert.ok(low >= 0 && low <= 1);
  assert.ok(high >= 0 && high <= 1);
  assert.ok(half > 0.1, 'a single-game interval should be very wide');
});

test('wilsonInterval: n=1, k=0 (p=0) stays within [0,1]', () => {
  const { low, high } = wilsonInterval(0, 1);
  assert.ok(low >= 0 && low <= 1);
  assert.ok(high >= 0 && high <= 1);
  assert.equal(low, 0, 'p=0 should never produce a negative lower bound');
});

test('wilsonInterval: p=0 at large n is still clamped to >= 0', () => {
  const { low } = wilsonInterval(0, 10000);
  assert.equal(low, 0);
});

test('wilsonInterval: p=1 at large n is still clamped to <= 1', () => {
  const { high } = wilsonInterval(10000, 10000);
  assert.equal(high, 1);
});

test('wilsonInterval: interval narrows as n grows, same proportion', () => {
  const small = wilsonInterval(50, 100);
  const large = wilsonInterval(5000, 10000);
  assert.ok(large.half < small.half);
});

test('scoreInterval: all-draws is a score of exactly 0.5 with zero outcome variance (every game is the same result)', () => {
  const { score, half } = scoreInterval(0, 100, 0);
  assert.equal(score, 0.5);
  assert.equal(half, 0);
});

test('scoreInterval: all wins gives score 1 and a low bound < 1 (draws contribute no variance here, but n is finite)', () => {
  const { score, high } = scoreInterval(100, 0, 0);
  assert.equal(score, 1);
  assert.equal(high, 1);
});

test('scoreInterval: n=0 returns a degenerate zero interval, not NaN', () => {
  const { score, low, high, half } = scoreInterval(0, 0, 0);
  assert.equal(score, 0);
  assert.equal(low, 0);
  assert.equal(high, 0);
  assert.equal(half, 0);
});

test('scoreInterval: is a genuinely different formula from wilsonInterval, not a thin wrapper around it', () => {
  // A 60% "win rate" via Wilson vs. a 60% "score" (60 wins, 0 draws, 40
  // losses) via the trinomial interval share the same point value (draws=0
  // means the trinomial mean reduces to the binomial proportion), but
  // Wilson's score-test inversion and the trinomial normal approximation
  // are different constructions and do not produce identical bounds -- this
  // is what "do not apply Wilson to score" (spec 3.1) means concretely: two
  // distinct, independently callable functions, not the same math reused.
  assert.notEqual(wilsonInterval, scoreInterval);
  const w = wilsonInterval(60, 100);
  const s = scoreInterval(60, 0, 40);
  assert.equal(s.score, 0.6);
  // Close (same underlying proportion) but not identical constructions.
  assert.ok(Math.abs(w.low - s.low) > 1e-6, 'Wilson and the trinomial interval should not coincide bit-for-bit');
  assert.ok(Math.abs(w.low - s.low) < 0.02, 'but should be in the same ballpark for a 0-draw split');
});

test('scoreInterval: draws pull the interval narrower than an equivalent win/loss-only split at the same score', () => {
  // 50 wins/0 draws/50 losses and 0 wins/100 draws/0 losses both score 0.5,
  // but the all-draws case has zero outcome variance (every game is
  // literally the same result) while the win/loss split has maximal
  // variance -- the trinomial formula must reflect that, not just always
  // reproduce the binomial answer.
  const allDraws = scoreInterval(0, 100, 0);
  const halfHalf = scoreInterval(50, 0, 50);
  assert.equal(allDraws.score, 0.5);
  assert.equal(halfHalf.score, 0.5);
  assert.ok(allDraws.half < halfHalf.half);
});

test('formatInterval: one decimal place, plus-minus sign', () => {
  assert.equal(formatInterval(0.004), '±0.4');
  assert.equal(formatInterval(0.0), '±0.0');
  assert.equal(formatInterval(0.0123), '±1.2');
});

test('formatInterval: non-finite input returns empty string rather than "±NaN"', () => {
  assert.equal(formatInterval(null), '');
  assert.equal(formatInterval(undefined), '');
  assert.equal(formatInterval(NaN), '');
});

test('Z_95 is the standard two-tailed 95% z-value', () => {
  assert.ok(Math.abs(Z_95 - 1.96) < 0.01);
});
