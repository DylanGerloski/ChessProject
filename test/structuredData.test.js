'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { jsonLdScript, stripHtmlToText, breadcrumbJsonLd, articleJsonLd, faqPageJsonLd, homeJsonLd, datasetJsonLd } = require('../src/structuredData');

/** Pulls the JSON payload back out of a `<script type="application/ld+json">...</script>` block. */
function parseJsonLdScript(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a JSON-LD <script> block');
  return JSON.parse(match[1]);
}

test('jsonLdScript emits valid JSON inside a script tag, and escapes "<" so a "</script" sequence in content cannot break out', () => {
  const html = jsonLdScript({ name: 'a </script> b' });
  assert.match(html, /^<script type="application\/ld\+json">.*<\/script>$/);
  const parsed = parseJsonLdScript(html);
  assert.equal(parsed.name, 'a </script> b'); // round-trips correctly despite the escaping
  const inner = html.slice('<script type="application/ld+json">'.length, -'</script>'.length);
  assert.doesNotMatch(inner, /<\/script/);
});

test('stripHtmlToText strips tags and decodes the small fixed set of entities this codebase emits', () => {
  assert.equal(stripHtmlToText('<p>Hello <a href="x.html">world</a> &rarr; done</p>'), 'Hello world -> done');
  assert.equal(stripHtmlToText('a &mdash; b &middot; c'), 'a - b - c');
});

test('breadcrumbJsonLd produces a well-formed BreadcrumbList with one ListItem per item, absolute URLs, in order', () => {
  const html = breadcrumbJsonLd([
    { label: 'Home', href: 'index.html' },
    { label: 'Openings', href: 'openings.html' },
    { label: 'Italian Game', href: 'italian-game.html' },
  ]);
  const ld = parseJsonLdScript(html);
  assert.equal(ld['@type'], 'BreadcrumbList');
  assert.equal(ld.itemListElement.length, 3);
  assert.equal(ld.itemListElement[0].position, 1);
  assert.equal(ld.itemListElement[0].name, 'Home');
  assert.equal(ld.itemListElement[0].item, 'https://repertoire-builder.com/index.html');
  assert.equal(ld.itemListElement[2].item, 'https://repertoire-builder.com/italian-game.html');
});

test('breadcrumbJsonLd omits the "item" URL for an entry with no href, without breaking the rest', () => {
  const html = breadcrumbJsonLd([{ label: 'Home', href: 'index.html' }, { label: 'Current page' }]);
  const ld = parseJsonLdScript(html);
  assert.equal(ld.itemListElement[1].item, undefined);
  assert.equal(ld.itemListElement[1].name, 'Current page');
});

test('breadcrumbJsonLd resolves a "/" home href (as used by nav.repertoire on every content page) to a single-slash root URL, not a double slash', () => {
  // Regression test for the site-health-audit-reported bug: the Home
  // breadcrumb item is built with `href: nav.repertoire`, and nav.repertoire
  // is the literal string '/' (also used, unchanged, as the visible
  // breadcrumb link's <a href>). That used to produce
  // "https://repertoire-builder.com//" here.
  const html = breadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: 'Guides', href: 'guides.html' },
    { label: 'Best Chess Openings for Beginners', href: 'best-chess-openings-for-beginners.html' },
  ]);
  const ld = parseJsonLdScript(html);
  assert.equal(ld.itemListElement[0].item, 'https://repertoire-builder.com/');
  assert.doesNotMatch(html, /repertoire-builder\.com\/\//);
});

test('articleJsonLd produces a valid Article block with an Organization author/publisher, never an invented person', () => {
  const html = articleJsonLd({
    headline: 'How to Beat the London System',
    description: 'A guide',
    datePublished: '2026-08-11',
    dateModified: '2026-08-11',
    url: 'https://repertoire-builder.com/how-to-beat-the-london-system.html',
  });
  const ld = parseJsonLdScript(html);
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.author['@type'], 'Organization');
  assert.equal(ld.author.name, 'Repertoire Builder');
  assert.equal(ld.publisher['@type'], 'Organization');
  assert.equal(ld.mainEntityOfPage['@id'], 'https://repertoire-builder.com/how-to-beat-the-london-system.html');
  assert.ok(ld.headline.length <= 110, 'headline should be <=110 chars per the binding spec');
});

test('faqPageJsonLd converts every faq answerHtml to plain text and preserves question order', () => {
  const html = faqPageJsonLd([
    { question: 'What is an opening?', answerHtml: '<p>See <a href="openings.html">openings</a> &rarr; for more.</p>' },
    { question: 'How often is data updated?', answerHtml: '<p>Whenever the site rebuilds.</p>' },
  ]);
  const ld = parseJsonLdScript(html);
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity.length, 2);
  assert.equal(ld.mainEntity[0].name, 'What is an opening?');
  assert.equal(ld.mainEntity[0]['@type'], 'Question');
  assert.equal(ld.mainEntity[0].acceptedAnswer['@type'], 'Answer');
  assert.doesNotMatch(ld.mainEntity[0].acceptedAnswer.text, /<[a-z]/i);
  assert.match(ld.mainEntity[0].acceptedAnswer.text, /openings -> for more/);
});

test('homeJsonLd emits both a WebSite and an Organization block, with no sitelinks searchbox action', () => {
  const combined = homeJsonLd({ url: 'https://repertoire-builder.com/', description: 'tagline' });
  const scripts = [...combined.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(scripts.length, 2);
  const types = scripts.map((s) => s['@type']).sort();
  assert.deepEqual(types, ['Organization', 'WebSite']);
  const website = scripts.find((s) => s['@type'] === 'WebSite');
  assert.equal(website.url, 'https://repertoire-builder.com/');
  assert.equal(website.description, 'tagline');
  assert.equal(website.potentialAction, undefined);
});

test('datasetJsonLd: emits a real Dataset block, license, creator, and a start/end temporalCoverage interval', () => {
  const html = datasetJsonLd({
    name: 'Repertoire Builder aggregate dataset',
    description: 'Position and move aggregates from Lichess database dumps.',
    url: 'https://repertoire-builder.com/methodology.html',
    license: 'http://creativecommons.org/publicdomain/zero/1.0/',
    temporalCoverage: ['2026-07-01', '2026-07-04'],
  });
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const ld = JSON.parse(match[1]);
  assert.equal(ld['@type'], 'Dataset');
  assert.equal(ld.name, 'Repertoire Builder aggregate dataset');
  assert.equal(ld.creator['@type'], 'Organization');
  assert.equal(ld.license, 'http://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(ld.temporalCoverage, '2026-07-01/2026-07-04');
});

test('datasetJsonLd: omits license/temporalCoverage entirely when not given, rather than emitting null/undefined', () => {
  const html = datasetJsonLd({ name: 'x', description: 'y', url: 'https://repertoire-builder.com/methodology.html' });
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const ld = JSON.parse(match[1]);
  assert.equal('license' in ld, false);
  assert.equal('temporalCoverage' in ld, false);
});
