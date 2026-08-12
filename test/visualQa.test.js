'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  VIEWPORTS,
  OUTPUT_DIR,
  isHttpUrl,
  pageNameFor,
  formatScoreSummary,
} = require('../scripts/visual-qa');

// This file only exercises the pure, no-browser-required helpers exported by
// scripts/visual-qa.js. Actually launching Chromium + Lighthouse is heavy
// (a real download-once browser binary, a real headless render) and isn't a
// fit for this project's fast, fixture-driven unit suite -- the harness's
// full end-to-end behavior (screenshots + Lighthouse summary) is verified by
// hand per its own SUCCESS SIGNAL (`npm run visual-qa -- dist/index.html`
// after `npm run build:static`), not by `npm test`.

test('VIEWPORTS has exactly the three required breakpoints', () => {
  assert.equal(VIEWPORTS.length, 3);
  const names = VIEWPORTS.map((v) => v.name);
  assert.deepEqual(names, ['360x800', '768x1024', '1440x900']);
  for (const v of VIEWPORTS) {
    assert.ok(v.width > 0 && v.height > 0, `${v.name}: invalid dimensions`);
  }
});

test('OUTPUT_DIR is workspace-local, not inside orchestrator/', () => {
  assert.ok(OUTPUT_DIR.includes('visual-qa-output'));
  assert.ok(!OUTPUT_DIR.toLowerCase().includes('orchestrator'));
});

test('isHttpUrl distinguishes URLs from local paths', () => {
  assert.equal(isHttpUrl('http://localhost:8787/'), true);
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('dist/index.html'), false);
  assert.equal(isHttpUrl('C:\\Users\\dylan\\dist\\index.html'), false);
});

test('pageNameFor derives a filesystem-safe base name from a local path', () => {
  assert.equal(pageNameFor('dist/index.html'), 'index');
  assert.equal(pageNameFor(path.join('dist', 'player.html')), 'player');
});

test('pageNameFor derives a filesystem-safe base name from a URL path', () => {
  assert.equal(pageNameFor('http://localhost:8787/player/DrNykterstein'), 'player-DrNykterstein');
  assert.equal(pageNameFor('http://localhost:8787/'), 'index');
});

test('formatScoreSummary prints all three tracked categories with 0-100 scores', () => {
  const summary = formatScoreSummary({
    performance: { title: 'Performance', score: 1 },
    accessibility: { title: 'Accessibility', score: 0.79 },
    seo: { title: 'SEO', score: 0.82 },
  });
  assert.match(summary, /Performance: 100\/100/);
  assert.match(summary, /Accessibility: 79\/100/);
  assert.match(summary, /SEO: 82\/100/);
});

test('formatScoreSummary handles a missing category gracefully', () => {
  const summary = formatScoreSummary({ performance: { title: 'Performance', score: 1 } });
  assert.match(summary, /accessibility: n\/a/);
  assert.match(summary, /seo: n\/a/);
});
