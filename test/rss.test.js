'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderRssXml, rfc822 } = require('../src/rss');

test('rfc822 converts an ISO date to a well-formed RFC 822 date string at noon UTC', () => {
  const out = rfc822('2026-08-14');
  assert.match(out, /^\w{3}, 14 Aug 2026 12:00:00 GMT$/);
});

test('renderRssXml produces a well-formed RSS 2.0 document with one <item> per entry', () => {
  const xml = renderRssXml([
    { file: 'london-system.html', title: 'The London System', description: 'A d4 opening.' },
    { file: 'openings.html', title: 'All Openings', description: 'Hub page.', date: '2026-08-01' },
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2\.0">/);
  assert.match(xml, /<channel>/);
  const itemMatches = xml.match(/<item>/g) || [];
  assert.equal(itemMatches.length, 2);
  assert.match(xml, /<title>The London System<\/title>/);
  assert.match(xml, /<link>https:\/\/repertoire-builder\.com\/london-system\.html<\/link>/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/repertoire-builder\.com\/london-system\.html<\/guid>/);
  assert.match(xml, /<description>A d4 opening\.<\/description>/);
});

test('renderRssXml escapes special characters so the output stays well-formed XML', () => {
  const xml = renderRssXml([{ file: 'x.html', title: 'A & B < C', description: 'Quote " test' }]);
  assert.match(xml, /<title>A &amp; B &lt; C<\/title>/);
  assert.match(xml, /Quote &quot; test/);
});

test('renderRssXml uses a per-item date when supplied, falling back to BUILD_DATE otherwise', () => {
  const xml = renderRssXml([{ file: 'x.html', title: 'X', description: 'd', date: '2026-01-01' }]);
  assert.match(xml, /<pubDate>Thu, 01 Jan 2026 12:00:00 GMT<\/pubDate>/);
});
