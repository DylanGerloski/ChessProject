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

// Regression coverage for the broken-nav-link incident: a genuinely relative
// (no leading '/') target must resolve against the REFERRING PAGE's own
// directory, the same way a real browser does -- not always against distDir
// root, which is what let a real production bug (every relative href on the
// nested Repertoire Pack detail pages) pass this checker undetected. See
// scripts/checkLinks.js's resolveInternalTarget() header comment.
test('resolveInternalTarget resolves a relative target against the referring file\'s own directory, not always distDir root', () => {
  const referring = path.join('/dist', 'repertoire-packs', 'white-1400-1600.html');
  assert.equal(
    resolveInternalTarget('/dist', 'eco-openings.html', referring),
    path.join('/dist', 'repertoire-packs', 'eco-openings.html'),
    'a bare relative filename found on a nested page must resolve relative to that page\'s own directory'
  );
});

test('resolveInternalTarget resolves a site-absolute (leading "/") target against distDir regardless of the referring page\'s own depth', () => {
  const referring = path.join('/dist', 'repertoire-packs', 'white-1400-1600.html');
  assert.equal(
    resolveInternalTarget('/dist', '/eco-openings.html', referring),
    path.join('/dist', 'eco-openings.html')
  );
});

test('resolveInternalTarget falls back to resolving a relative target against distDir when no referringFile is given (backward-compatible default)', () => {
  assert.equal(resolveInternalTarget('/dist', 'about.html'), path.join('/dist', 'about.html'));
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

test('checkFile: a nested page (repertoire-packs/<id>.html) with a bare relative nav link is now correctly flagged as broken, even though the target filename exists at dist root (the exact production incident this guards against)', () => {
  const dir = mkTmpDir('checklinks-nested-relative-');
  writeFile(dir, 'eco-openings.html', '<p>the real root-level page</p>');
  const file = writeFile(dir, path.join('repertoire-packs', 'white-1400-1600.html'), '<a href="eco-openings.html">ECO openings</a>');
  const { offenses } = checkFile(dir, file);
  assert.equal(offenses.length, 1, 'a bare relative href on a nested page must resolve relative to that page, not silently pass because the filename happens to exist at dist root');
  assert.match(offenses[0], /broken internal link/);
});

test('checkFile: the same nested page passes once the link is root-relative (leading slash) -- the actual fix', () => {
  const dir = mkTmpDir('checklinks-nested-absolute-');
  writeFile(dir, 'eco-openings.html', '<p>the real root-level page</p>');
  const file = writeFile(dir, path.join('repertoire-packs', 'white-1400-1600.html'), '<a href="/eco-openings.html">ECO openings</a>');
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
