'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isHttpUrl, resolveTarget, CONTENT_TYPES } = require('../scripts/lighthouseRunner');

// Only the pure/no-browser-required surface is exercised here -- see
// test/visualQa.test.js's header comment for why launching a real browser
// isn't a fit for the fast unit suite. scripts/visual-qa.js and
// scripts/lighthouseBudget.js both exercise the browser-launching path by
// hand instead, by actually running them against a built site.

test('isHttpUrl distinguishes URLs from local paths', () => {
  assert.equal(isHttpUrl('http://localhost:8787/'), true);
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('dist/index.html'), false);
});

test('CONTENT_TYPES covers the extensions this site actually ships', () => {
  for (const ext of ['.html', '.js', '.css', '.json', '.png', '.svg', '.xml', '.woff2']) {
    assert.ok(CONTENT_TYPES[ext], `missing content type for ${ext}`);
  }
});

test('resolveTarget passes an http(s) URL through unchanged with a no-op cleanup', async () => {
  const { pageUrl, cleanup } = await resolveTarget('https://example.com/page');
  assert.equal(pageUrl, 'https://example.com/page');
  await assert.doesNotReject(cleanup());
});

test('resolveTarget rejects a local path that does not exist', async () => {
  await assert.rejects(() => resolveTarget('definitely-not-a-real-file-xyz.html'), /File not found/);
});
