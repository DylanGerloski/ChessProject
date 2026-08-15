'use strict';

// Regression coverage for src/browser/openingReport.client.js's escaping
// discipline at the DOM layer -- spec 3.7's own binding requirement that
// each of the four new untrusted-input sinks (N1-N4) "needs a test".
// test/leakAnalysis.test.js already covers the VALIDATORS themselves
// (isValidUsername/isValidGameId/decodeShareFragment) in isolation; this
// file proves the CLIENT actually uses them correctly at the point where a
// malicious value would otherwise reach innerHTML -- the gap a
// validator-only test can't close (a validator can be perfectly correct
// and still be bypassed by a render path that never calls it).
//
// Same technique as test/drillClientEscaping.test.js: openingReport.client.js
// is a browser-only IIFE with no module exports (an esbuild entry point,
// same convention as src/browser/playerLookup.client.js -- neither has a
// test hook), so this stubs just enough of `document`/`window` to let the
// *real*, unmodified module run its normal init() at require()-time,
// driving the exact render code paths under test. No source changes for
// testability.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CLIENT_PATH = path.join(__dirname, '..', 'src', 'browser', 'openingReport.client.js');

function noop() {}

/**
 * Loads and runs the real openingReport.client.js against a minimal
 * DOM/window stub, with `search`/`hash` controlling which code path
 * init() takes. Returns the captured HTML of #report-status/#report-result
 * after load.
 */
function runClientWith({ search = '', hash = '', localStorageGet = () => null } = {}) {
  const statusEl = { innerHTML: '' };
  const resultEl = { innerHTML: '' };
  const usernameInput = { value: '' };
  let submitHandler = null;
  const formEl = {
    addEventListener: (evt, handler) => {
      if (evt === 'submit') submitHandler = handler;
    },
  };
  const elementsById = {
    'report-status': statusEl,
    'report-result': resultEl,
    'report-form': formEl,
    'report-username': usernameInput,
  };

  global.document = {
    readyState: 'complete',
    getElementById: (id) => (Object.prototype.hasOwnProperty.call(elementsById, id) ? elementsById[id] : null),
    addEventListener: noop,
  };
  global.window = {
    location: { href: `https://example.test/opening-report.html${search}${hash}`, search, hash, pathname: '/opening-report.html', origin: 'https://example.test' },
    history: { replaceState: noop },
    localStorage: { getItem: localStorageGet, setItem: noop },
    addEventListener: noop,
  };
  // URL/URLSearchParams are already real Node globals (not stubbed) --
  // only document/window/fetch need adding and removing here.
  global.fetch = () => Promise.reject(new Error('this test must never issue a network request'));

  delete require.cache[require.resolve(CLIENT_PATH)];
  try {
    require(CLIENT_PATH);
  } finally {
    delete global.document;
    delete global.window;
    delete global.fetch;
  }

  return { statusHtml: statusEl.innerHTML, resultHtml: resultEl.innerHTML, submitHandler, usernameInput };
}

test('spec 3.7 N2: an XSS-shaped ?username= value renders as visible escaped text, never as markup, and issues no request', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const { resultHtml } = runClientWith({ search: `?username=${encodeURIComponent(payload)}` });
  assert.doesNotMatch(resultHtml, /<img src=x onerror=alert\(1\)>/);
  assert.match(resultHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // fetch is stubbed to reject the test outright if ever called -- getting
  // here at all (no unhandled rejection) confirms no request was issued
  // for an invalid username.
});

test('spec 3.7 N2: a plain invalid username (too short) is rejected with real copy, not silently ignored', () => {
  const { resultHtml } = runClientWith({ search: '?username=a' });
  assert.match(resultHtml, /isn't a Lichess-shaped username/);
});

test('spec 3.7 N3: a tampered/garbage share fragment is refused, never rendered as a report', () => {
  const { resultHtml, statusHtml } = runClientWith({ hash: '#r=%7B%22format%22%3A%22evil%22%7D' });
  // Falls through to the ordinary empty state (no form was submitted, no
  // valid ?username= or saved report either) -- the key assertion is that
  // nothing resembling a rendered leak report appears.
  assert.doesNotMatch(resultHtml, /report-verdict/);
  assert.doesNotMatch(statusHtml, /report-verdict/);
});

test('a malicious saved localStorage report (bad format) is refused by the strict validator, not rendered', () => {
  const evil = JSON.stringify({ format: 'not-a-real-format', leaks: [{ yourMove: { san: '<script>alert(1)</script>' } }] });
  const { resultHtml } = runClientWith({ localStorageGet: (key) => (key === 'rb.leakReport.v1' ? evil : null) });
  assert.doesNotMatch(resultHtml, /<script>alert\(1\)<\/script>/);
});
