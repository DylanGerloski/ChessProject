'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SITE_CSS, DESIGN_TOKENS, renderDocumentHead, renderNewsletterSignup, renderFooter } = require('../src/render');

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

// Security-standards.md "Headers" section: the CSP and referrer meta tags
// must appear exactly as specified, and GoatCounter must load over an
// explicit https scheme rather than protocol-relative.

test('renderDocumentHead ships the CSP meta tag exactly as the security standard specifies', () => {
  const head = renderDocumentHead('Test Page');
  assert.match(
    head,
    /<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'">/
  );
});

test('renderDocumentHead ships the strict-origin-when-cross-origin referrer meta tag', () => {
  const head = renderDocumentHead('Test Page');
  assert.match(head, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
});

test('renderDocumentHead loads the GoatCounter script over an explicit https scheme, not protocol-relative', () => {
  const head = renderDocumentHead('Test Page');
  assert.match(head, /src="https:\/\/gc\.zgo\.at\/count\.js"/);
  assert.doesNotMatch(head, /src="\/\/gc\.zgo\.at\/count\.js"/);
});

// Newsletter signup: wired to the real builtittheycome.substack.com
// publication (same publication as filetools and lol-practice-system).
// Regression coverage for the real-embed wiring -- easy to silently regress
// back to a broken <form action> pointed at Substack's /embed URL (which
// does not actually subscribe anyone) or to lose the lazy-load/escaping
// behavior in a large template-literal rewrite.

test('renderNewsletterSignup points the real embed slot at the exact builtittheycome.substack.com publication', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /data-newsletter-src="https:\/\/builtittheycome\.substack\.com\/embed"/);
  assert.doesNotMatch(html, /<form[^>]*action="https:\/\/builtittheycome\.substack\.com/, 'must not POST to the Substack embed URL as a form action -- Substack has no such endpoint');
});

test('renderNewsletterSignup does not eagerly emit a live <iframe> -- the embed is created client-side only near the viewport', () => {
  const html = renderNewsletterSignup();
  assert.doesNotMatch(html, /<iframe/, 'an eagerly-rendered iframe on a sitewide footer would cost the Lighthouse Performance budget');
  assert.match(html, /data-newsletter-slot/);
});

test('renderNewsletterSignup provides a noscript fallback link to the real publication', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /<noscript><p class="newsletter-description"><a href="https:\/\/builtittheycome\.substack\.com" target="_blank" rel="noopener noreferrer">Subscribe on Substack<\/a><\/p><\/noscript>/);
});

test('renderNewsletterSignup only assigns the iframe src client-side when it starts with https:// (no javascript:/data: scheme)', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /if\(!src\|\|!\/\^https:\\\/\\\/\/\.test\(src\)\)return;/, 'the client-side loader must scheme-check data-newsletter-src before assigning it to iframe.src');
});

// Donation identity consolidation: the footer used to link two donation
// platforms under two different handles (Ko-fi "flavaa", Buy Me a Coffee
// "dylanger254") -- a trust seam. Ko-fi is now the only linked donation
// platform on the live site.

test('renderFooter links only Ko-fi in the support-links block, never Buy Me a Coffee', () => {
  const html = renderFooter('footer copy');
  assert.match(html, /href="https:\/\/ko-fi\.com\/flavaa"[^>]*>&#9749; Support on Ko-fi<\/a>/);
  assert.doesNotMatch(html, /buymeacoffee\.com/);
  assert.doesNotMatch(html, /Buy Me a Coffee/);
});

// Regression: a legalLinks object missing `methodology` (some callers --
// src/renderEcoPages.js's ECO_LEGAL_LINKS, src/renderEcoExplorerPage.js's
// ECO_EXPLORER_LEGAL_LINKS -- carry privacy/about/contact but not
// methodology) used to leave a whitespace-only text node inside the
// <nav class="legal-links"> block, which html-validate's no-trailing-
// whitespace rule flags. Caught by running html-validate across the FULL
// dist/**/*.html output, not just the pages a task directly touches.
test('renderFooter: a legalLinks object missing methodology renders no blank line (no-trailing-whitespace safe)', () => {
  const html = renderFooter('footer copy', { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html' });
  const navMatch = html.match(/<nav class="legal-links"[^>]*>([\s\S]*?)<\/nav>/);
  const inner = navMatch[1];
  assert.doesNotMatch(inner, /^[\t ]+\r?\n[\t ]*$/m, 'no line inside the nav should contain only whitespace');
  assert.match(inner, /Privacy policy/);
  assert.match(inner, /About/);
  assert.match(inner, /Contact/);
  assert.doesNotMatch(inner, /Methodology/);
});

test('renderFooter: a legalLinks object WITH methodology renders the fourth link, still with no blank lines', () => {
  const html = renderFooter('footer copy', { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html' });
  const navMatch = html.match(/<nav class="legal-links"[^>]*>([\s\S]*?)<\/nav>/);
  const inner = navMatch[1];
  assert.doesNotMatch(inner, /^[\t ]+\r?\n[\t ]*$/m, 'no line inside the nav should contain only whitespace');
  assert.match(inner, /href="methodology\.html">Methodology<\/a>/);
});
