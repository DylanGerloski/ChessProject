'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { srcsetUrls, isInternal, extractTargets, resolveInternalTarget, checkFile, checkLinks } = require('../scripts/checkLinks');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

test('extractTargets pulls href, src and srcset values out of raw HTML', () => {
  const html = '<a href="/about.html">x</a><img src="a.png" srcset="a-1x.png 1x, a-2x.png 2x">';
  assert.deepEqual(extractTargets(html), ['/about.html', 'a.png', 'a-1x.png', 'a-2x.png']);
});

test('srcsetUrls drops the descriptor and keeps only the URL', () => {
  assert.deepEqual(srcsetUrls('a-1x.png 1x, a-2x.png 2x'), ['a-1x.png', 'a-2x.png']);
});

test('isInternal excludes mailto/tel/javascript/data/fragment/protocol-relative/absolute targets', () => {
  assert.equal(isInternal('mailto:a@b.com'), false);
  assert.equal(isInternal('tel:+1234567890'), false);
  assert.equal(isInternal('javascript:void(0)'), false);
  assert.equal(isInternal('data:image/png;base64,xyz'), false);
  assert.equal(isInternal('#section'), false);
  assert.equal(isInternal('//example.com/x'), false);
  assert.equal(isInternal('https://example.com/x'), false);
  assert.equal(isInternal('/about.html'), true);
  assert.equal(isInternal('about.html'), true);
});

test('resolveInternalTarget strips a fragment and query and resolves against distDir', () => {
  assert.equal(resolveInternalTarget('/dist', '/about.html#top'), path.join('/dist', 'about.html'));
  assert.equal(resolveInternalTarget('/dist', 'about.html?x=1'), path.join('/dist', 'about.html'));
  assert.equal(resolveInternalTarget('/dist', '#top'), null);
});

test('checkFile finds a broken internal link', () => {
  const dir = mkTmpDir('checklinks-broken-');
  const file = writeFile(dir, 'a.html', '<a href="/missing.html">gone</a>');
  const { offenses } = checkFile(dir, file);
  assert.equal(offenses.length, 1);
  assert.match(offenses[0], /broken internal link/);
});

test('checkFile passes a link whose target exists', () => {
  const dir = mkTmpDir('checklinks-ok-');
  writeFile(dir, 'b.html', '<p>target</p>');
  const file = writeFile(dir, 'a.html', '<a href="/b.html">b</a>');
  const { offenses } = checkFile(dir, file);
  assert.deepEqual(offenses, []);
});

test('checkFile flags a link containing "index.html"', () => {
  const dir = mkTmpDir('checklinks-index-');
  writeFile(dir, 'index.html', '<p>home</p>');
  const file = writeFile(dir, 'a.html', '<a href="/index.html">home</a>');
  const { offenses } = checkFile(dir, file);
  assert.equal(offenses.length, 1);
  assert.match(offenses[0], /index\.html/);
});

test('checkFile flags an insecure http:// link', () => {
  const dir = mkTmpDir('checklinks-http-');
  const file = writeFile(dir, 'a.html', '<a href="http://example.com">x</a>');
  const { offenses } = checkFile(dir, file);
  assert.equal(offenses.length, 1);
  assert.match(offenses[0], /insecure/);
});

test('checkFile collects an https:// link as external without failing on it', () => {
  const dir = mkTmpDir('checklinks-external-');
  const file = writeFile(dir, 'a.html', '<a href="https://lichess.org">lichess</a>');
  const { offenses, external } = checkFile(dir, file);
  assert.deepEqual(offenses, []);
  assert.deepEqual(external, ['https://lichess.org']);
});

test('checkLinks aggregates offenses and external links across the whole dist tree', () => {
  const dir = mkTmpDir('checklinks-tree-');
  writeFile(dir, 'index.html', '<a href="/missing.html">x</a><a href="https://example.com">ext</a>');
  writeFile(dir, 'about.html', '<a href="/index.html">home</a>');
  const { filesChecked, offenses, externalLinks } = checkLinks(dir);
  assert.equal(filesChecked, 2);
  // one broken-link offense (missing.html) plus one index.html-hygiene offense (about.html)
  assert.equal(offenses.length, 2);
  assert.deepEqual(externalLinks, ['https://example.com']);
});
