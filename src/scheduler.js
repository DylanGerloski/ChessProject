'use strict';

/**
 * SM-2-class spaced-repetition scheduling primitives (WS-1 spec section 2.3 -- "Contract C: the scheduler"). Pure:
 * no DOM, no clock read internally -- `now` is always injected, so callers
 * (and this module's own tests) get deterministic results. The whole
 * algorithm sits behind ONE exported function, schedule(), so a future FSRS
 * upgrade (spec 4.4: deliberately deferred out of WS-1) is a swap of this
 * one module, never a change scattered across the drill engine.
 *
 * SM-2 as published (super-memory.com/english/ol/sm2.htm):
 *   I(1) = 1, I(2) = 6, I(n) = ceil(I(n-1) * EF)
 *   EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)), floored at 1.3
 *   q < 3 restarts repetitions from the beginning.
 *
 * TWO DELIBERATE, DOCUMENTED DEVIATIONS from the letter of that spec (spec
 * 4.4 explains why each is the right call for a web product):
 *
 *  (i) SuperMemo's "repeat items scoring under 4 the same day until they
 *      score 4 or more" within-session loop is NOT implemented here -- that
 *      is session-UI behavior (the drill engine's job, not this pure
 *      module's), and a five-minute web session that refuses to end is a
 *      worse product than a slightly less optimal schedule. Instead: a
 *      grade below 3 restarts repetitions AND does not change EF (a
 *      simplification of the canonical formula, which does recompute EF on
 *      every grade -- this module's own binding choice, made deliberately
 *      so a single bad review doesn't compound with a lapse-count penalty
 *      in the same event), and schedules the card at I(1) = 1 day. The
 *      drill engine (W3) is expected to re-queue a card graded under 3 once
 *      more before the session ends, using its own session-level queue --
 *      that re-queue does not call schedule() a second time for the same
 *      attempt.
 *
 *  (ii) Ease-hell mitigation. SM-2's well-documented failure mode is a card
 *      whose EF collapses to the 1.3 floor and then returns at the shortest
 *      possible interval forever (the reason Chessbook -- the closest
 *      direct competitor for chess repertoire spaced repetition -- publicly
 *      migrated to FSRS-4.5). Our mitigation converts the failure into a
 *      product signal instead of a punishment: a card with `lapses >= 8`
 *      AND `ef` at the floor gets a minimum interval of 3 days and is
 *      tagged `stuck: true`. The drill UI (W3) is expected to surface a
 *      stuck card as "This line keeps beating you," linking back to the
 *      Repertoire Builder at that exact position -- fixing the repertoire
 *      is the real answer to a line the visitor cannot memorise.
 */

const EF_FLOOR = 1.3;
const DEFAULT_EF = 2.5;
const STUCK_LAPSES_THRESHOLD = 8;
const STUCK_MIN_INTERVAL_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @returns {{rep:number, ef:number, intervalDays:number, dueAt:string|null,
 *   lapses:number, stuck:boolean}} the state of a card that has never been
 *   reviewed.
 */
function newCardState() {
  return { rep: 0, ef: DEFAULT_EF, intervalDays: 0, dueAt: null, lapses: 0, stuck: false };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {{rep?:number, ef?:number, intervalDays?:number, lapses?:number}} [card]
 *   the card's current scheduling state -- pass `null`/`undefined`, or omit,
 *   for a brand-new card (equivalent to newCardState()). Any missing/
 *   non-finite field falls back to its newCardState() default rather than
 *   throwing, so a caller can pass a partial/legacy record and still get a
 *   sane result.
 * @param {number} grade an integer 0-5 (SuperMemo's "quality of response,"
 *   q) -- see gradeFromAttempt() below for the drill-specific mapping from
 *   a real attempt to this scale.
 * @param {Date} now injected so results are deterministic in tests; must be
 *   a real Date instance.
 * @returns {{rep:number, ef:number, intervalDays:number, dueAt:string,
 *   lapses:number, stuck:boolean}}
 */
function schedule(card, grade, now) {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new Error(`schedule: grade must be an integer 0-5, got ${grade}`);
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('schedule: now must be a valid Date');
  }

  const c = card || newCardState();
  const prevRep = Number.isInteger(c.rep) ? c.rep : 0;
  const prevEf = isFiniteNumber(c.ef) ? c.ef : DEFAULT_EF;
  const prevInterval = isFiniteNumber(c.intervalDays) ? c.intervalDays : 0;
  const prevLapses = Number.isInteger(c.lapses) ? c.lapses : 0;

  let rep;
  let ef;
  let intervalDays;
  let lapses;

  if (grade < 3) {
    // Deviation (i): restart repetitions, leave EF untouched, schedule at
    // I(1) = 1 day.
    rep = 0;
    ef = prevEf;
    intervalDays = 1;
    lapses = prevLapses + 1;
  } else {
    if (prevRep === 0) intervalDays = 1;
    else if (prevRep === 1) intervalDays = 6;
    else intervalDays = Math.ceil(prevInterval * prevEf);
    rep = prevRep + 1;
    ef = Math.max(EF_FLOOR, prevEf + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    lapses = prevLapses;
  }

  // Deviation (ii): ease-hell mitigation.
  const stuck = lapses >= STUCK_LAPSES_THRESHOLD && ef <= EF_FLOOR;
  if (stuck) {
    intervalDays = Math.max(intervalDays, STUCK_MIN_INTERVAL_DAYS);
  }

  const dueAt = new Date(now.getTime() + intervalDays * MS_PER_DAY).toISOString();

  return { rep, ef, intervalDays, dueAt, lapses, stuck };
}

/**
 * Maps one real drill attempt to SuperMemo's q scale -- "the design
 * judgment SM-2 does not supply" (spec 2.3). Kept here (not duplicated in
 * the drill engine) so the mapping is defined exactly once, same reasoning
 * as the rest of this module.
 *
 *   q=5 correct first attempt, no reveal, answered under 5s
 *   q=4 correct first attempt, 5s or slower
 *   q=3 correct after one off-meta or unrecognised attempt
 *   q=2 incorrect, then revealed
 *   q=0 "Show me the answer" pressed with no attempt made
 *
 * @param {{noAttemptMade?: boolean, usedReveal?: boolean,
 *   correctOnFirstAttempt?: boolean, responseMs?: number}} attempt
 * @returns {number} an integer 0-5.
 */
function gradeFromAttempt({ noAttemptMade = false, usedReveal = false, correctOnFirstAttempt = false, responseMs = null } = {}) {
  if (noAttemptMade) return 0;
  if (usedReveal || !correctOnFirstAttempt) {
    // "correct after one off-meta or unrecognised attempt" (q=3) vs.
    // "incorrect, then revealed" (q=2): the drill engine is the only caller
    // that knows whether the visitor's own attempt was ever correct before
    // a reveal was used -- `usedReveal: true` with `correctOnFirstAttempt:
    // false` (the visitor never got it right) is q=2; any other non-first-
    // attempt-correct path is q=3.
    return usedReveal && !correctOnFirstAttempt ? 2 : 3;
  }
  return isFiniteNumber(responseMs) && responseMs < 5000 ? 5 : 4;
}

module.exports = {
  EF_FLOOR,
  DEFAULT_EF,
  STUCK_LAPSES_THRESHOLD,
  STUCK_MIN_INTERVAL_DAYS,
  newCardState,
  schedule,
  gradeFromAttempt,
};
