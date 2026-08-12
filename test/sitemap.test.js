'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSitemapEntries, renderSitemapXml, robotsTxtContent, sitemapUrlFor } = require('../src/sitemap');

test('sitemapUrlFor canonicalizes index.html to the directory form, and passes other files through absoluteUrl', () => {
  assert.equal(sitemapUrlFor('index.html'), 'https://repertoire-builder.com/');
  assert.equal(sitemapUrlFor('italian-game.html'), 'https://repertoire-builder.com/italian-game.html');
});

test('buildSitemapEntries filters out non-.html files and sorts the rest', () => {
  const entries = buildSitemapEntries(['b.html', 'a.html', 'player-lookup.js', 'ads.txt', 'CNAME']);
  assert.deepEqual(entries.map((e) => e.file), ['a.html', 'b.html']);
  for (const e of entries) {
    assert.match(e.loc, /^https:\/\/repertoire-builder\.com\//);
    assert.match(e.lastmod, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('buildSitemapEntries excludes 404.html even though it ends in .html', () => {
  const entries = buildSitemapEntries(['a.html', '404.html', 'b.html']);
  assert.deepEqual(entries.map((e) => e.file), ['a.html', 'b.html']);
});

test('renderSitemapXml produces well-formed, minimal sitemaps.org XML with one <url> per .html page, no priority/changefreq', () => {
  const xml = renderSitemapXml(['index.html', 'italian-game.html', 'player-lookup.js', 'ads.txt']);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urlMatches = xml.match(/<url>/g) || [];
  assert.equal(urlMatches.length, 2); // index.html + italian-game.html only
  assert.match(xml, /<loc>https:\/\/repertoire-builder\.com\/<\/loc>/); // home, directory form
  assert.match(xml, /<loc>https:\/\/repertoire-builder\.com\/italian-game\.html<\/loc>/);
  assert.doesNotMatch(xml, /priority/);
  assert.doesNotMatch(xml, /changefreq/);
  assert.doesNotMatch(xml, /player-lookup\.js/);
  assert.doesNotMatch(xml, /ads\.txt/);
});

test('renderSitemapXml excludes 404.html from the generated sitemap', () => {
  const xml = renderSitemapXml(['index.html', '404.html', 'italian-game.html']);
  const urlMatches = xml.match(/<url>/g) || [];
  assert.equal(urlMatches.length, 2);
  assert.doesNotMatch(xml, /404/);
});

test('renderSitemapXml escapes a literal "&" in the URL so the output stays well-formed XML', () => {
  const xml = renderSitemapXml(['a&b.html']);
  assert.match(xml, /<loc>https:\/\/repertoire-builder\.com\/a&amp;b\.html<\/loc>/);
});

test('robotsTxtContent is a standard allow-all robots.txt pointing at the generated sitemap.xml', () => {
  const txt = robotsTxtContent();
  assert.match(txt, /^User-agent: \*\n/);
  assert.match(txt, /\nAllow: \/\n/);
  assert.match(txt, /\nSitemap: https:\/\/repertoire-builder\.com\/sitemap\.xml\n$/);
});
