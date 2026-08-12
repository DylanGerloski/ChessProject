'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SITE_CSS, DESIGN_TOKENS, renderDocumentHead } = require('../src/render');

// Regression coverage: the self-hosted Fraunces
// heading webfont must stay scoped to headings only, self-hosted (never a
// Google Fonts link), and preloaded -- these are all easy to silently
// regress in a large inline-CSS template literal with no other test
// touching it.

test('--font-serif leads with the self-hosted Fraunces Variable face and still falls back to a real serif stack', () => {
  const value = DESIGN_TOKENS['--font-serif'];
  assert.ok(value.startsWith('"Fraunces Variable"'), 'Fraunces Variable must be the first choice in --font-serif');
  assert.match(value, /serif"?,?\s*$|serif$/i, '--font-serif must still end in a generic serif fallback');
  assert.doesNotMatch(value, /fonts\.googleapis\.com|fonts\.gstatic\.com/, '--font-serif must never reference Google Fonts directly');
});

test('SITE_CSS declares an @font-face for Fraunces Variable, self-hosted with font-display: swap', () => {
  assert.match(SITE_CSS, /@font-face\s*\{[^}]*font-family:\s*'Fraunces Variable'/);
  assert.match(SITE_CSS, /@font-face\s*\{[^}]*font-display:\s*swap/);
  assert.match(SITE_CSS, /src:\s*url\('\/fonts\/fraunces-variable\.woff2'\)/, 'the font must be served from this site, not a third party');
  assert.doesNotMatch(SITE_CSS, /fonts\.googleapis\.com|fonts\.gstatic\.com/, 'SITE_CSS must never link Google Fonts directly');
});

test('SITE_CSS keeps --font-serif on headings (h1/h2/h3) only, and off body/UI/data elements', () => {
  assert.match(SITE_CSS, /h1,\s*h2,\s*h3\s*\{[^}]*font-family:\s*var\(--font-serif\)/, 'headings must use the display face');

  // Non-heading elements that used to (or could accidentally) share
  // --font-serif: chess move chips (UI), stat numerals (data), and prose
  // blockquotes (body copy) must all stay on --font-sans so reading/data
  // legibility can't regress when the display face is swapped in.
  const moveChipRule = SITE_CSS.match(/\.move-chip\s*\{[^}]*\}/);
  const statValueRule = SITE_CSS.match(/\.stat-value\s*\{[^}]*\}/);
  const blockquoteRule = SITE_CSS.match(/\.prose blockquote\s*\{[^}]*\}/);
  assert.ok(moveChipRule && statValueRule && blockquoteRule, 'expected all three rules to still exist in SITE_CSS');
  assert.match(moveChipRule[0], /font-family:\s*var\(--font-sans\)/);
  assert.match(statValueRule[0], /font-family:\s*var\(--font-sans\)/);
  assert.match(blockquoteRule[0], /font-family:\s*var\(--font-sans\)/);
});

test('renderDocumentHead preloads the self-hosted woff2 with crossorigin, before the <style> block', () => {
  const head = renderDocumentHead('Test Page');
  const preloadMatch = head.match(/<link rel="preload" href="\/fonts\/fraunces-variable\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.ok(preloadMatch, 'expected a font preload link with as="font", type="font/woff2", and crossorigin');
  assert.ok(head.indexOf(preloadMatch[0]) < head.indexOf('<style>'), 'the font preload should come before the <style> block so the browser discovers it as early as possible');
});
