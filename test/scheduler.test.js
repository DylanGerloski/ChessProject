'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EF_FLOOR,
  DEFAULT_EF,
  STUCK_LAPSES_THRESHOLD,
  newCardState,
  schedule,
  gradeFromAttempt,
} = require('../src/scheduler');

const NOW = new Date('2026-08-15T12:00:00.000Z');

test('newCardState: a brand-new card starts at rep 0, default EF, no due date', () => {
  const card = newCardState();
  assert.equal(card.rep, 0);
  assert.equal(card.ef, DEFAULT_EF);
  assert.equal(card.dueAt, null);
  assert.equal(card.lapses, 0);
  assert.equal(card.stuck, false);
});

test('schedule: first-ever review at q=5 -- I(1)=1 day, rep advances to 1, EF increases', () => {
  const result = schedule(newCardState(), 5, NOW);
  assert.equal(result.rep, 1);
  assert.equal(result.intervalDays, 1);
  assert.ok(result.ef > DEFAULT_EF);
  assert.equal(result.dueAt, new Date(NOW.getTime() + 1 * 86400000).toISOString());
});

test('schedule: SM-2\'s I(1)=1, I(2)=6, I(n)=ceil(I(n-1)*EF) sequence at a constant high grade', () => {
  let card = newCardState();
  card = schedule(card, 5, NOW); // rep 0 -> 1, interval 1
  assert.equal(card.intervalDays, 1);
  card = schedule(card, 5, NOW); // rep 1 -> 2, interval 6
  assert.equal(card.intervalDays, 6);
  const efAfterTwo = card.ef;
  card = schedule(card, 5, NOW); // rep 2 -> 3, interval ceil(6 * ef)
  assert.equal(card.intervalDays, Math.ceil(6 * efAfterTwo));
});

test('schedule: q < 3 restarts repetitions, leaves EF untouched, schedules at 1 day, and increments lapses (deviation i)', () => {
  let card = newCardState();
  card = schedule(card, 5, NOW);
  card = schedule(card, 5, NOW); // rep=2, some EF != DEFAULT_EF
  const efBeforeLapse = card.ef;

  const lapsed = schedule(card, 1, NOW);
  assert.equal(lapsed.rep, 0);
  assert.equal(lapsed.ef, efBeforeLapse, 'EF must not change on a grade < 3 review');
  assert.equal(lapsed.intervalDays, 1);
  assert.equal(lapsed.lapses, 1);
});

test('schedule: a grade of exactly 3 counts as a pass (not a lapse) -- rep advances, lapses untouched', () => {
  const result = schedule(newCardState(), 3, NOW);
  assert.equal(result.rep, 1);
  assert.equal(result.lapses, 0);
});

test('schedule: EF never drops below the 1.3 floor even under repeated low-but-passing grades', () => {
  let card = newCardState();
  for (let i = 0; i < 20; i += 1) {
    card = schedule(card, 3, NOW);
  }
  assert.ok(card.ef >= EF_FLOOR);
  assert.equal(card.ef, EF_FLOOR);
});

test('schedule: ease-hell mitigation (deviation ii) -- 8+ lapses at the EF floor gets stuck:true and a minimum 3-day interval', () => {
  let card = newCardState();
  // Drive EF to the floor, then rack up lapses. Each passing grade=3 review
  // subtracts 0.14 from EF (2.5 -> 1.3 takes 9 such reviews); Math.max
  // clamps it at the floor from then on, so a few extra iterations of
  // headroom keeps this independent of the exact arithmetic.
  for (let i = 0; i < 12; i += 1) card = schedule(card, 3, NOW);
  assert.equal(card.ef, EF_FLOOR);

  for (let i = 0; i < STUCK_LAPSES_THRESHOLD - 1; i += 1) {
    card = schedule(card, 1, NOW);
    assert.equal(card.stuck, false, `should not be stuck before ${STUCK_LAPSES_THRESHOLD} lapses (at lapse ${i + 1})`);
  }
  card = schedule(card, 1, NOW); // lapse number STUCK_LAPSES_THRESHOLD
  assert.equal(card.lapses, STUCK_LAPSES_THRESHOLD);
  assert.equal(card.stuck, true);
  assert.equal(card.intervalDays, 3);
});

test('schedule: a card NOT at the EF floor is never marked stuck, however many lapses it has', () => {
  let card = newCardState();
  card.ef = 2.0; // above the floor
  card.lapses = STUCK_LAPSES_THRESHOLD + 2;
  const result = schedule(card, 1, NOW);
  assert.equal(result.stuck, false);
});

test('schedule: throws on an invalid grade or a non-Date now', () => {
  assert.throws(() => schedule(newCardState(), 6, NOW));
  assert.throws(() => schedule(newCardState(), -1, NOW));
  assert.throws(() => schedule(newCardState(), 2.5, NOW));
  assert.throws(() => schedule(newCardState(), 3, 'not a date'));
  assert.throws(() => schedule(newCardState(), 3, new Date('not a date')));
});

test('schedule: a null/undefined card is treated as brand new', () => {
  const a = schedule(null, 5, NOW);
  const b = schedule(newCardState(), 5, NOW);
  assert.deepEqual(a, b);
});

test('gradeFromAttempt: the spec\'s grade-mapping table', () => {
  assert.equal(gradeFromAttempt({ noAttemptMade: true }), 0);
  assert.equal(gradeFromAttempt({ usedReveal: true, correctOnFirstAttempt: false }), 2);
  assert.equal(gradeFromAttempt({ usedReveal: false, correctOnFirstAttempt: false }), 3);
  assert.equal(gradeFromAttempt({ correctOnFirstAttempt: true, responseMs: 4000 }), 5);
  assert.equal(gradeFromAttempt({ correctOnFirstAttempt: true, responseMs: 7000 }), 4);
});
