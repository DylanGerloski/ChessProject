'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMethodologyPage } = require('../src/renderContent');
const { MISTAKE_THRESHOLDS } = require('../src/processOpenings');

const NAV = { home: '/', repertoire: 'repertoire.html', openings: 'openings.html', guides: 'guides.html', faq: 'chess-opening-faq.html', player: 'player.html' };

test('renderMethodologyPage: exactly one h1, and all 7 required sections as h2 headings inside the article', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  const h1s = html.match(/<h1[^>]*>/g) || [];
  assert.equal(h1s.length, 1);
  const articleHtml = html.match(/<article[^>]*>([\s\S]*?)<\/article>/)[1];
  // The shared footer's newsletter signup also carries an h2 ("Get new
  // openings and guides by email") on every page site-wide -- scoped to
  // <article> here so this test counts only THIS page's own 7 required
  // sections, not that shared component.
  const h2s = (articleHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/g) || []).map((h) => h.replace(/<[^>]+>/g, ''));
  assert.equal(h2s.length, 7);
  assert.deepEqual(h2s, [
    'Where the numbers come from',
    'How games are bucketed',
    'How rates are computed',
    'What we do not control for',
    'How &ldquo;common mistake&rdquo; is defined',
    'What would change a number',
    'Corrections policy',
  ]);
});

test('renderMethodologyPage: uses real <section> elements (semantic structure, spec 3.5)', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  const sectionCount = (html.match(/<section>/g) || []).length;
  assert.equal(sectionCount, 7);
});

test('renderMethodologyPage: emits Article and Dataset JSON-LD, never FAQPage', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = blocks.map((b) => b['@type']).sort();
  assert.deepEqual(types, ['Article', 'BreadcrumbList', 'Dataset']);
  assert.ok(!types.includes('FAQPage'));
});

test('renderMethodologyPage: Dataset JSON-LD carries a real CC0 license URL', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const dataset = blocks.find((b) => b['@type'] === 'Dataset');
  assert.equal(dataset.license, 'http://creativecommons.org/publicdomain/zero/1.0/');
});

test('renderMethodologyPage: title, canonical, and meta description are all present and within SEO caps', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
  assert.match(title, /Methodology/);
  assert.match(title, /Repertoire Builder/);
  assert.ok(title.length <= 70, `title too long: ${title.length}`);
  const canonical = html.match(/<link rel="canonical" href="([^"]*)">/)[1];
  assert.equal(canonical, 'https://repertoire-builder.com/methodology.html');
  const description = html.match(/<meta name="description" content="([^"]*)">/)[1];
  assert.ok(description.length <= 160, `description too long: ${description.length}`);
});

test('renderMethodologyPage: without a manifest (today\'s live-Explorer-API fallback), honestly describes the live API as the source, not a dump it never ran', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  assert.match(html, /live.*Lichess Opening Explorer API/i);
  assert.doesNotMatch(html, /This build used/); // that sentence only appears in the manifest-present branch
});

test('renderMethodologyPage: with a manifest, names the actual dump month(s) and observed date range rather than a generic claim', () => {
  const manifest = {
    dumpMonths: ['2026-07'],
    retrievedAt: '2026-08-01T00:00:00.000Z',
    observedGameDateRange: ['2026-07-01', '2026-07-04'],
    gamesScanned: 500000,
    gamesUsed: 480000,
  };
  const html = renderMethodologyPage({ nav: NAV, manifest, thresholds: MISTAKE_THRESHOLDS });
  assert.match(html, /2026-07/);
  assert.match(html, /2026-07-01/);
  assert.match(html, /2026-07-04/);
  assert.match(html, /480,000/);
});

test('renderMethodologyPage: renders the LIVE threshold values, not a hardcoded paraphrase', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: { minPlayedPct: 5, minBalancedN: 999, limit: 2 } });
  assert.match(html, /5%/);
  assert.match(html, /999 games/);
});

test('renderMethodologyPage: footer links to privacy/about/contact/methodology, none broken by omission', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  assert.match(html, /href="privacy\.html"/);
  assert.match(html, /href="about\.html"/);
  assert.match(html, /href="contact\.html"/);
});

test('renderMethodologyPage: carries the shared security/referrer meta tags like every other page', () => {
  const html = renderMethodologyPage({ nav: NAV, manifest: null, thresholds: MISTAKE_THRESHOLDS });
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /name="referrer"/);
});
