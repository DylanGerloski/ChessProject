'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUDGET_MIN_SCORE, CATEGORIES, GATED_PAGES, scoreOf } = require('../scripts/lighthouseBudget');

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
