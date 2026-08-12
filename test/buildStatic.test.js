'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  buildStatic,
  buildPlayerLookupBundle,
  bundleBrowserModule,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  assertNoTokenLeak,
  assertFilenamesUnique,
} = require('../src/buildStatic');
const { RATING_BANDS } = require('../src/processRepertoire');
const { makeSmartExplorerFetch } = require('./helpers/fakeExplorer');

const FIXTURES = path.join(__dirname, 'fixtures');
const rootFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));

// buildStatic() now also drives buildContentPages() (the 10 opening pages +
// hub), which needs move-order validation to succeed for every configured
// opening line -- a fetch that blindly returns the same fixture for every
// `play` param (as the old repertoire-only fake did) would fail that
// validation. makeSmartExplorerFetch() handles opening-line requests
// correctly and falls back to the original root fixture for everything
// else (the repertoire explorer's own open-ended tree walk), so both
// pipelines get a coherent fake. No live network calls are made anywhere in
// this file.
function fakeExplorerFetch() {
  return makeSmartExplorerFetch({ fallbackJson: rootFixture });
}

function withTempDist(fn) {
  // buildStatic() always writes to the real project dist/ dir (matching
  // build.js/buildRepertoire.js's existing convention of writing under
  // <project root>/dist), so tests run against that same directory. Capture
  // its prior contents and restore them afterwards so running the test
  // suite doesn't clobber a dist/ a human may have generated separately.
  const distDir = path.join(__dirname, '..', 'dist');
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-dist-backup-'));
  const hadDist = fs.existsSync(distDir);
  if (hadDist) {
    for (const entry of fs.readdirSync(distDir)) {
      fs.cpSync(path.join(distDir, entry), path.join(backupDir, entry), { recursive: true });
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      fs.rmSync(distDir, { recursive: true, force: true });
      if (hadDist) {
        fs.mkdirSync(distDir, { recursive: true });
        for (const entry of fs.readdirSync(backupDir)) {
          fs.cpSync(path.join(backupDir, entry), path.join(distDir, entry), { recursive: true });
        }
      }
      fs.rmSync(backupDir, { recursive: true, force: true });
    });
}

// useCache: false everywhere in this file, deliberately -- buildStatic()'s
// real (non-test) call path wraps fetchImpl in the on-disk Explorer cache
// (src/explorerCache.js), keyed only by request URL (fen/play/ratings/...),
// not by which fetchImpl produced the answer. Leaving caching on here would
// write this file's FAKE fixture responses into the project's real
// .cache/explorer/ directory, where a later real `npm run build:static`
// could silently read them back instead of hitting the live API.
test('buildStatic writes all 8 pre-rendered repertoire pages, an index, and the player-lookup page+bundle', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, repertoireLinks } = await buildStatic({ fetchImpl, useCache: false });

    assert.equal(repertoireLinks.length, 8);
    const expectedBands = Object.keys(RATING_BANDS);
    for (const band of expectedBands) {
      for (const color of ['white', 'black']) {
        const file = repertoireFileName(band, color);
        assert.ok(
          repertoireLinks.some((l) => l.file === file),
          `expected a repertoire link for ${file}`
        );
        assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
      }
    }

    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'player.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'player-lookup.js')));
  })
);

test('buildStatic also writes the 10 opening pages plus the openings hub, and the home page links to them', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, contentWritten } = await buildStatic({ fetchImpl, useCache: false });

    // 10 openings + openings hub + 6 guides + guides hub + FAQ (phase 2).
    assert.equal(contentWritten.length, 19);
    for (const { file } of contentWritten) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
    }
    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="openings\.html"/);
  })
);

test('buildStatic also writes the guides hub, all 6 guide articles, and the FAQ page, all reachable from nav', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    for (const file of [
      'guides.html',
      'chess-opening-faq.html',
      'how-to-beat-the-london-system.html',
      'best-chess-openings-for-beginners.html',
      'sicilian-vs-french-vs-caro-kann.html',
      'most-common-opening-mistakes-1600-1800.html',
      'should-you-study-openings-under-1500.html',
      'scandinavian-defense-at-club-level.html',
    ]) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
    }

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="guides\.html"/);
    assert.match(homeHtml, /href="chess-opening-faq\.html"/);

    const openingHtml = fs.readFileSync(path.join(outDir, 'italian-game.html'), 'utf8');
    assert.match(openingHtml, /href="guides\.html"/);
    assert.match(openingHtml, /href="chess-opening-faq\.html"/);
  })
);

test('buildStatic also writes privacy.html, about.html, contact.html, and ads.txt, and the footer links to them', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    for (const file of ['privacy.html', 'about.html', 'contact.html', 'ads.txt']) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
    }

    const adsTxt = fs.readFileSync(path.join(outDir, 'ads.txt'), 'utf8');
    assert.match(adsTxt, /^# ads\.txt for/);

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="privacy\.html">Privacy policy<\/a>/);
    assert.match(homeHtml, /href="about\.html">About<\/a>/);
    assert.match(homeHtml, /href="contact\.html">Contact<\/a>/);
    assert.match(homeHtml, /class="disclosure-note"/);

    const repertoireHtml = fs.readFileSync(path.join(outDir, 'repertoire-1600-1800-white.html'), 'utf8');
    assert.match(repertoireHtml, /href="privacy\.html">Privacy policy<\/a>/);

    const openingHtml = fs.readFileSync(path.join(outDir, 'italian-game.html'), 'utf8');
    assert.match(openingHtml, /href="privacy\.html">Privacy policy<\/a>/);
  })
);

test('assertFilenamesUnique throws on a duplicate filename and passes for a unique list', () => {
  assert.throws(() => assertFilenamesUnique(['a.html', 'b.html', 'a.html']), /Duplicate output filename/);
  assert.doesNotThrow(() => assertFilenamesUnique(['a.html', 'b.html', 'c.html']));
});

test('buildStatic never writes the Lichess API token into any generated file', () =>
  withTempDist(async () => {
    const previousToken = process.env.LICHESS_API_TOKEN;
    process.env.LICHESS_API_TOKEN = 'test-fixture-fake-token-do-not-leak-12345';
    try {
      const { fetchImpl } = fakeExplorerFetch();
      const { outDir } = await buildStatic({ fetchImpl, useCache: false });

      for (const file of fs.readdirSync(outDir)) {
        const full = path.join(outDir, file);
        if (fs.statSync(full).isDirectory()) continue;
        const content = fs.readFileSync(full, 'utf8');
        assert.equal(
          content.includes('test-fixture-fake-token-do-not-leak-12345'),
          false,
          `${file} must not contain the Lichess API token`
        );
      }
    } finally {
      if (previousToken === undefined) delete process.env.LICHESS_API_TOKEN;
      else process.env.LICHESS_API_TOKEN = previousToken;
    }
  })
);

test('assertNoTokenLeak throws if a written file contains the token string', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-token-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'oops.html'), '<p>secret-token-abc123</p>', 'utf8');
    assert.throws(() => assertNoTokenLeak(tmpDir, 'secret-token-abc123'), /token leaked/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('assertNoTokenLeak is a no-op when no token was available to leak', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-token-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'fine.html'), '<p>nothing secret here</p>', 'utf8');
    assert.doesNotThrow(() => assertNoTokenLeak(tmpDir, null));
    assert.doesNotThrow(() => assertNoTokenLeak(tmpDir, undefined));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildPlayerLookupBundle concatenates fetchLichess.js, process.js, render.js, and the browser controller with no leftover require()/module.exports', () => {
  const bundle = buildPlayerLookupBundle();
  assert.match(bundle, /function fetchRatingHistory/);
  assert.match(bundle, /function summarizeRatingHistory/);
  assert.match(bundle, /function renderRatingTable/);
  assert.match(bundle, /class LichessNotFoundError/);
  assert.doesNotMatch(bundle, /\brequire\(/);
  assert.doesNotMatch(bundle, /module\.exports/);
});

test('bundleBrowserModule throws loudly if a source file has no module.exports to strip', () => {
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-bundle-test-')), 'noexports.js');
  fs.writeFileSync(tmpFile, 'function foo() { return 1; }\n', 'utf8');
  assert.throws(() => bundleBrowserModule(tmpFile), /no trailing module\.exports block/);
});

test('indexPage links to player.html and every repertoire file, with no server-only routes', () => {
  const links = [
    { band: '1400-1600', color: 'white', file: 'repertoire-1400-1600-white.html' },
    { band: '1400-1600', color: 'black', file: 'repertoire-1400-1600-black.html' },
  ];
  const html = indexPage(links);
  assert.match(html, /href="player\.html"/);
  assert.match(html, /href="repertoire-1400-1600-white\.html"/);
  assert.match(html, /href="repertoire-1400-1600-black\.html"/);
  assert.doesNotMatch(html, /href="\/repertoire/);
});

test('playerLookupPage references the bundled script and has no server-only routes', () => {
  const html = playerLookupPage();
  assert.match(html, /<script src="player-lookup\.js"><\/script>/);
  assert.match(html, /id="lookup-form"/);
  assert.match(html, /id="username"/);
  assert.match(html, /id="result"/);
  assert.doesNotMatch(html, /action="\/player"/);
});

test('indexPage embeds WebSite + Organization JSON-LD', () => {
  const html = indexPage([]);
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = scripts.map((s) => s['@type']).sort();
  assert.deepEqual(types, ['Organization', 'WebSite']);
});

test('buildStatic also writes sitemap.xml (listing exactly the emitted .html pages) and robots.txt pointing at it', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, repertoireLinks, contentWritten, pageFilenames } = await buildStatic({ fetchImpl, useCache: false });

    assert.ok(fs.existsSync(path.join(outDir, 'sitemap.xml')));
    assert.ok(fs.existsSync(path.join(outDir, 'robots.txt')));

    // index + player + 8 repertoire + 10 openings + hub + 6 guides + hub + FAQ + privacy/about/contact.
    const expectedPageCount = 2 + repertoireLinks.length + contentWritten.length + 3;
    assert.equal(pageFilenames.length, expectedPageCount);

    const sitemapXml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    assert.match(sitemapXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const locMatches = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locMatches.length, expectedPageCount);
    assert.ok(locMatches.includes('https://repertoire-builder.com/'), 'home should canonicalize to the directory form');
    assert.ok(locMatches.includes('https://repertoire-builder.com/italian-game.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/chess-opening-faq.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/privacy.html'));
    // player-lookup.js/ads.txt/CNAME are not pages and must not appear.
    assert.ok(!sitemapXml.includes('player-lookup.js'));
    assert.ok(!sitemapXml.includes('ads.txt'));

    const robotsTxt = fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
    assert.match(robotsTxt, /^User-agent: \*/);
    assert.match(robotsTxt, /Sitemap: https:\/\/repertoire-builder\.com\/sitemap\.xml/);
  })
);
