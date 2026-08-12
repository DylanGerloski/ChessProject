'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pageTitle, SITE_NAME } = require('../src/site');

test('pageTitle always appends the site-name suffix, even for a base title long enough that the old 65-char fallback used to drop it silently', () => {
  // Regression coverage for the bug this fixes: a base title this long used
  // to push `${base} | ${SITE_NAME}` over the old 65-char cap, so pageTitle()
  // silently returned the bare base with no site name at all. It must now
  // always carry the suffix -- an over-length result is buildContent.js's
  // assertPageMetadata's job to catch loudly at build time, not pageTitle()'s
  // job to paper over quietly.
  const longBase = 'A Base Title Deliberately Long Enough To Exceed The Old Cap';
  const result = pageTitle(longBase);
  assert.equal(result, `${longBase} | ${SITE_NAME}`);
  assert.ok(result.endsWith(` | ${SITE_NAME}`));
});

test('pageTitle appends the suffix for an ordinary short title too', () => {
  assert.equal(pageTitle('Italian Game'), `Italian Game | ${SITE_NAME}`);
});
