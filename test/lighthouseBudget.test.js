'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUDGET_MIN_SCORE, CATEGORIES, GATED_PAGES, MAX_ATTEMPTS, scoreOf, culpritAuditsFor, evaluate } = require('../scripts/lighthouseBudget');

// Only the pure, no-browser-required helpers are exercised here -- actually
// launching Chromium + Lighthouse is heavy and isn't a fit for this
// project's fast fixture-driven unit suite. Same rationale as
// test/visualQa.test.js's own header comment.

test('BUDGET_MIN_SCORE is this site\'s current binding floor (90), not a not-yet-reached aspirational number', () => {
  assert.equal(BUDGET_MIN_SCORE, 90);
});

test('CATEGORIES covers all four Lighthouse categories this budget gate requires', () => {
  assert.deepEqual(CATEGORIES.slice().sort(), ['accessibility', 'best-practices', 'performance', 'seo']);
});

// Entries are either a plain filename string, or {page, skipCategories} for
// a page with a known, documented, temporary per-category exception (see
// GATED_PAGES's own comment for why a whole-page exemption would be the
// wrong shape here -- it would block deploy-pages.yml's `deploy` job on an
// unrelated page's known, temporary gap).
function pageNameOf(entry) {
  return typeof entry === 'string' ? entry : entry.page;
}

test('GATED_PAGES includes the homepage, three representative inner pages, and both new Repertoire Pack page types (design-standards.md Distinctiveness Gate item 6)', () => {
  const names = GATED_PAGES.map(pageNameOf);
  assert.equal(GATED_PAGES.length, 6);
  assert.ok(names.includes('index.html'));
  assert.ok(names.includes('methodology.html'));
  assert.ok(names.includes('repertoire-packs.html'));
  assert.ok(names.includes('repertoire-packs/white-1400-1600.html'));
});

test('the two Repertoire Pack pages exempt only "seo" (their known noindex-caused gap), never performance/accessibility/best-practices', () => {
  const packEntries = GATED_PAGES.filter((e) => typeof e === 'object' && e.page.startsWith('repertoire-packs'));
  assert.equal(packEntries.length, 2);
  for (const entry of packEntries) {
    assert.deepEqual(entry.skipCategories, ['seo']);
  }
});

test('every non-pack GATED_PAGES entry is a plain string with no category exemption', () => {
  const nonPackEntries = GATED_PAGES.filter((e) => pageNameOf(e) !== 'repertoire-packs.html' && pageNameOf(e) !== 'repertoire-packs/white-1400-1600.html');
  for (const entry of nonPackEntries) {
    assert.equal(typeof entry, 'string');
  }
});

test('scoreOf converts a 0..1 Lighthouse score to a 0..100 integer', () => {
  assert.equal(scoreOf({ performance: { score: 0.93 } }, 'performance'), 93);
  assert.equal(scoreOf({ performance: { score: 1 } }, 'performance'), 100);
});

test('scoreOf returns null for a missing or null category (Lighthouse reports null when a category could not be computed)', () => {
  assert.equal(scoreOf({}, 'performance'), null);
  assert.equal(scoreOf({ performance: { score: null } }, 'performance'), null);
});

test('culpritAuditsFor names the specific failing audit(s) in a category, not just its bare score', () => {
  const lhr = {
    categories: {
      'best-practices': {
        score: 0.75,
        auditRefs: [{ id: 'errors-in-console' }, { id: 'doctype' }, { id: 'js-libraries' }],
      },
    },
    audits: {
      'errors-in-console': { id: 'errors-in-console', title: 'No errors logged to the console', score: 0, displayValue: '' },
      doctype: { id: 'doctype', title: 'Page has the HTML doctype', score: 1, displayValue: '' },
      'js-libraries': { id: 'js-libraries', title: 'Detect JS libraries', score: null, displayValue: '' },
    },
  };
  const culprits = culpritAuditsFor(lhr, 'best-practices');
  assert.equal(culprits.length, 1);
  assert.match(culprits[0], /errors-in-console/);
  assert.match(culprits[0], /No errors logged to the console/);
});

test('culpritAuditsFor returns an empty array for a missing category or a category with no auditRefs', () => {
  assert.deepEqual(culpritAuditsFor({ categories: {}, audits: {} }, 'best-practices'), []);
  assert.deepEqual(culpritAuditsFor({ categories: { 'best-practices': {} }, audits: {} }, 'best-practices'), []);
});

// MAX_ATTEMPTS>1 (retry-once-on-fail) exists specifically because a real,
// confirmed CI run (methodology.html, 2026-08-16) scored best-practices=75
// once and 100 on every other attempt with no code change in between --
// see MAX_ATTEMPTS's own comment in scripts/lighthouseBudget.js.
test('MAX_ATTEMPTS allows at least one retry, so a single flaky below-budget run does not fail the gate alone', () => {
  assert.ok(MAX_ATTEMPTS >= 2);
});

test('evaluate: a passing lhr with no skipped categories is ok with no failures', () => {
  const lhr = {
    categories: {
      performance: { score: 1 },
      accessibility: { score: 1 },
      'best-practices': { score: 1 },
      seo: { score: 1 },
    },
    audits: {},
  };
  const result = evaluate(lhr, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.failingAudits, {});
});

test('evaluate: a below-budget category not in skipCategories fails, and a skipped one does not', () => {
  const lhr = {
    categories: {
      performance: { score: 1 },
      accessibility: { score: 1 },
      'best-practices': { score: 1 },
      seo: { score: 0.63 },
    },
    audits: {},
  };
  const result = evaluate(lhr, ['seo']);
  assert.equal(result.ok, true);

  const resultUnskipped = evaluate(lhr, []);
  assert.equal(resultUnskipped.ok, false);
  assert.deepEqual(resultUnskipped.failures, ['seo: 63']);
});
