'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const vm = require('vm');
const {
  buildStatic,
  buildPlayerLookupBundle,
  buildDrillBundle,
  bundleBrowserEntry,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  assertNoTokenLeak,
  assertFilenamesUnique,
} = require('../src/buildStatic');
const { RATING_BANDS } = require('../src/processRepertoire');
const { getOpening } = require('../src/openings');
const { makeSmartExplorerFetch, fakeResponse } = require('./helpers/fakeExplorer');

const FIXTURES = path.join(__dirname, 'fixtures');
const rootFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));

const ITALIAN_PREFIX_PLAY = getOpening('italian-game').line.map((p) => p.uci).join(',');

/**
 * Executes an esbuild-bundled browser script in a fresh vm context whose
 * global scope deliberately has NO `require`, `module`, or `exports`
 * binding (unlike Node's own global scope) -- a real file:// page has none
 * of those either. If the bundle referenced any of them outside a properly
 * scoped closure, this throws a ReferenceError. This is the functional
 * replacement for the old regex-based "no leftover require()/module.exports"
 * checks: esbuild's own CommonJS-emulation wrapper (__commonJS) legitimately
 * contains the literal text "module.exports" and "require" inside closures
 * that never leak to global scope, so a textual ban on those substrings no
 * longer indicates anything broken -- actually executing the bundle with no
 * such globals available does.
 */
function runBundleInSandbox(bundleText) {
  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    window: {
      history: { replaceState: () => {} },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    URL,
    URLSearchParams,
  };
  sandbox.window.location = { href: 'file:///dist/test.html', search: '' };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  new vm.Script(bundleText, { filename: 'bundle-under-test.js' }).runInContext(sandbox);
  return sandbox;
}

// buildStatic() now also drives buildContentPages() (the 10 opening pages +
// hub), which needs move-order validation to succeed for every configured
// opening line -- a fetch that blindly returns the same fixture for every
// `play` param (as the old repertoire-only fake did) would fail that
// validation. makeSmartExplorerFetch() handles opening-line requests
// correctly and falls back to the original root fixture for everything
// else (the repertoire explorer's own open-ended tree walk), so both
// pipelines get a coherent fake. No live network calls are made anywhere in
// this file.
//
// The drill build (src/buildDrill.js) additionally walks past the end of
// the italian-game line into positions makeSmartExplorerFetch has no
// knowledge of, and unlike the repertoire/content pipelines its data does
// get replayed onto a real board (src/renderDrill.js's server-rendered
// board -- see src/chessPosition.js). The generic rootFixture's moves
// (e2e4/d2d4/g1f3) are not legal replies to "1.e4 e5 2.Nf3 Nc6 3.Bc4" (that
// square is already vacated), so this wrapper serves one extra, real,
// legal pair of black replies (3...Bc5, 3...Nf6) for exactly that one
// position -- the only drill position this test file's board-rendering
// path actually replays -- before falling through to the shared smart fetch
// for everything else (which is never board-simulated).
function fakeExplorerFetch() {
  const smart = makeSmartExplorerFetch({ fallbackJson: rootFixture });
  const fetchImpl = async (url) => {
    const playParam = new URL(url).searchParams.get('play') || '';
    if (playParam === ITALIAN_PREFIX_PLAY) {
      return fakeResponse({
        white: 20000,
        draws: 6000,
        black: 24000,
        moves: [
          { uci: 'f8c5', san: 'Bc5', averageRating: 1700, white: 11000, draws: 3500, black: 13000 },
          { uci: 'g8f6', san: 'Nf6', averageRating: 1705, white: 9000, draws: 2500, black: 11000 },
        ],
        opening: null,
      });
    }
    return smart.fetchImpl(url);
  };
  return { fetchImpl, getCallCount: smart.getCallCount };
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

test('every repertoire page and player.html carry a canonical link, a title ending in the site suffix, and a full OpenGraph block (og:title/description/image), even though they used to ship with none', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const repertoireHtml = fs.readFileSync(path.join(outDir, 'repertoire-1600-1800-white.html'), 'utf8');
    assert.match(repertoireHtml, /<title>[^<]+ \| Repertoire Builder<\/title>/);
    assert.match(repertoireHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/repertoire-1600-1800-white\.html">/);
    assert.match(repertoireHtml, /<meta name="description" content="[^"]+">/);
    assert.match(repertoireHtml, /<meta property="og:title" content="[^"]+">/);
    assert.match(repertoireHtml, /<meta property="og:description" content="[^"]+">/);
    assert.match(repertoireHtml, /<meta property="og:image" content="https:\/\/repertoire-builder\.com\/og-default\.png">/);
    assert.match(repertoireHtml, /<meta name="twitter:card" content="summary_large_image">/);

    const playerHtml = fs.readFileSync(path.join(outDir, 'player.html'), 'utf8');
    assert.match(playerHtml, /<title>Player lookup \| Repertoire Builder<\/title>/);
    assert.match(playerHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/player\.html">/);
    assert.match(playerHtml, /<meta property="og:image" content="https:\/\/repertoire-builder\.com\/og-default\.png">/);
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

test('buildStatic also writes feed.xml (one <item> per content page) and links it from the home page head', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, contentWritten } = await buildStatic({ fetchImpl, useCache: false });

    const feedPath = path.join(outDir, 'feed.xml');
    assert.ok(fs.existsSync(feedPath), 'expected feed.xml to exist on disk');
    const feedXml = fs.readFileSync(feedPath, 'utf8');
    assert.match(feedXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(feedXml, /<rss version="2\.0">/);
    const itemMatches = feedXml.match(/<item>/g) || [];
    assert.equal(itemMatches.length, contentWritten.length);
    assert.match(feedXml, /<link>https:\/\/repertoire-builder\.com\/openings\.html<\/link>/);

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="https:\/\/repertoire-builder\.com\/feed\.xml">/);
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

test('indexPage footer never mentions TESTING.md or other internal build artifacts', () => {
  const html = indexPage([]);
  assert.doesNotMatch(html, /TESTING\.md/);
});

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

test('buildPlayerLookupBundle esbuild-bundles fetchLichess.js, process.js, render.js, and the browser controller into one self-contained IIFE that runs with no global require/module/exports (file:// invariant)', () => {
  const bundle = buildPlayerLookupBundle();
  assert.match(bundle, /function fetchRatingHistory/);
  assert.match(bundle, /function summarizeRatingHistory/);
  assert.match(bundle, /function renderRatingTable/);
  // \s* rather than a literal space: bundleBrowserEntry() now runs esbuild
  // with minifyWhitespace (Phase 7e, added when eco-explorer.js became this
  // site's heaviest bundle), which legitimately collapses "= class" to
  // "=class" -- still the exact same class expression, not a renamed or
  // dropped one, so the check stays meaningful without depending on
  // insignificant whitespace esbuild is now allowed to strip.
  assert.match(bundle, /LichessNotFoundError\s*=\s*class/);
  // Real proof, not a text ban: run it in a vm context with no require/
  // module/exports globals (same as an actual file:// page) and confirm it
  // doesn't throw. esbuild's own __commonJS wrapper legitimately contains
  // the literal text "module.exports" inside a properly scoped closure, so
  // banning that substring textually no longer indicates anything broken.
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

test('buildDrillBundle esbuild-bundles chessPosition.js, drillLogic.js, and the drill browser controller into one self-contained IIFE that runs with no global require/module/exports (file:// invariant)', () => {
  const bundle = buildDrillBundle();
  assert.match(bundle, /function applyUciMove/);
  assert.match(bundle, /function gradeMove/);
  assert.match(bundle, /function pickReply/);
  assert.match(bundle, /function applyRoundResult/);
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

test('bundleBrowserEntry throws loudly on a syntax error in the entry point, same failure-loudly guarantee the old string-splice bundler had', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-bundle-test-'));
  try {
    const tmpFile = path.join(tmpDir, 'broken.js');
    fs.writeFileSync(tmpFile, 'function broken( { return 1; }\n', 'utf8');
    assert.throws(() => bundleBrowserEntry(tmpFile, '/* header */'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

test('indexPage carries the meta-framing repositioning: new h1/description/canonical and one card per rating band', () => {
  const links = [
    { band: '1400-1600', color: 'white', file: 'repertoire-1400-1600-white.html' },
    { band: '1400-1600', color: 'black', file: 'repertoire-1400-1600-black.html' },
    { band: '1600-1800', color: 'white', file: 'repertoire-1600-1800-white.html' },
    { band: '1600-1800', color: 'black', file: 'repertoire-1600-1800-black.html' },
    { band: '1800-2000', color: 'white', file: 'repertoire-1800-2000-white.html' },
    { band: '1800-2000', color: 'black', file: 'repertoire-1800-2000-black.html' },
    { band: '2000+', color: 'white', file: 'repertoire-2000-white.html' },
    { band: '2000+', color: 'black', file: 'repertoire-2000-black.html' },
  ];
  const html = indexPage(links);
  assert.match(html, /<h1 class="page-title">The chess opening meta, by rating band<\/h1>/);
  assert.match(html, /<title>The Chess Opening Meta by Rating Band \| Repertoire Builder<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{1,160}">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/">/);
  // G1: one role=group pill picker, one pill per band+color combo (4 bands x 2 colors).
  assert.match(html, /<div class="band-picker" role="group" aria-label="Pick your rating band and color">/);
  for (const band of ['1400-1600', '1600-1800', '1800-2000', '2000+']) {
    assert.match(html, new RegExp(`class="band-pill" href="[^"]+">${band.replace('+', '\\+')} `));
  }
  assert.match(html, /as White/);
  assert.match(html, /as Black/);
});

test('playerLookupPage references the bundled script and has no server-only routes', () => {
  const html = playerLookupPage();
  assert.match(html, /<script src="player-lookup\.js"><\/script>/);
  assert.match(html, /id="lookup-form"/);
  assert.match(html, /id="username"/);
  assert.match(html, /id="result"/);
  assert.doesNotMatch(html, /action="\/player"/);
});

test('playerLookupPage opts into the wide layout container (B3: player lookup is a data-dense page type)', () => {
  const html = playerLookupPage();
  assert.match(html, /<body class="layout--wide">/);
});

test('indexPage does NOT opt into the wide layout container (B3: only the three data-dense page types do)', () => {
  const html = indexPage([]);
  assert.match(html, /<body>/);
  assert.doesNotMatch(html, /<body class="layout--wide">/);
});

test('indexPage (G1, R7): the rating-band picker is a single role=group pill control (the primary action); the drill card and opening cards are demoted outline cards, with no link targets added/removed/reordered', () => {
  const links = [{ band: '1400-1600', color: 'white', file: 'repertoire-1400-1600-white.html' }];
  // No `bands` field -- exercises renderOpeningStatCard's fallback-to-plain-card path (G2).
  const contentEntries = [{ openingConfig: { slug: 'italian-game' }, model: { name: 'Italian Game', eco: 'C50', side: 'white' } }];
  const html = indexPage(links, contentEntries, 'italian-game-drill.html');

  // Band picker: role=group pill control, not a card.
  assert.match(html, /<div class="band-picker" role="group" aria-label="Pick your rating band and color">/);
  assert.match(html, /<a class="band-pill" href="repertoire-1400-1600-white\.html">1400-1600 <span class="band-pill-color">as White<\/span><\/a>/);
  // Drill card: card--outline card--nav (pure navigation, no stat data).
  assert.match(html, /<div class="card card--outline card--nav"><h3><a href="italian-game-drill\.html">Italian Game drill<\/a><\/h3>/);
  // Opening card: card--nav card--outline too, since this fixture's model has no `bands` (G2 fallback).
  assert.match(html, /<div class="card card--nav card--outline"><h3><a href="italian-game\.html">Italian Game<\/a><\/h3>/);
  // Same link targets as before -- nothing added, removed, or reordered.
  assert.match(html, /href="repertoire-1400-1600-white\.html"/);
  assert.match(html, /href="italian-game-drill\.html"/);
  assert.match(html, /href="italian-game\.html"/);
});

test('indexPage (G2): an opening card with real band data shows the WDL bar + score for 1600-1800 inline, never an approximated number', () => {
  const links = [];
  const contentEntries = [{
    openingConfig: { slug: 'italian-game' },
    model: {
      name: 'Italian Game',
      eco: 'C50',
      side: 'white',
      bands: [
        { band: '1600-1800', enoughData: true, games: 12345, whitePct: 40, drawPct: 20, blackPct: 40, scoreForSide: 50 },
      ],
    },
  }];
  const html = indexPage(links, contentEntries, null);
  assert.match(html, /<div class="card card--stat card--outline">/);
  assert.match(html, /class="wdl-bar"/);
  assert.match(html, /Scores 50\.0% for white at 1600-1800 \(12,345 games\)/);
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
    const { outDir, repertoireLinks, contentWritten, ecoWritten, ecoExplorerResult, pageFilenames } = await buildStatic({ fetchImpl, useCache: false });

    assert.ok(fs.existsSync(path.join(outDir, 'sitemap.xml')));
    assert.ok(fs.existsSync(path.join(outDir, 'robots.txt')));
    assert.ok(fs.existsSync(path.join(outDir, 'eco-explorer.html')), 'Phase 7e: eco-explorer.html must be written');
    assert.ok(fs.existsSync(path.join(outDir, 'eco-explorer.js')), 'Phase 7e: eco-explorer.js bundle must be written');
    assert.ok(fs.existsSync(path.join(outDir, 'eco-reverse-lookup.json')), 'Phase 7e: the FEN reverse-lookup asset must be written');
    assert.ok(ecoExplorerResult.reverseLookupCount > 0);

    // index + player + drill + 404 + 8 repertoire + 10 openings + hub + 6 guides + hub + FAQ + privacy/about/contact
    // + (Phase 7d) 64 T1 family hubs + 5 T2 volume pages + 2 T2 browse-index pages
    // + (Phase 7e) 1 ECO explorer page.
    // pageFilenames includes 404.html (for the filename-uniqueness check),
    // but the sitemap itself must exclude it -- see the separate assertion
    // below, and src/sitemap.js's buildSitemapEntries.
    const expectedPageCount = 4 + repertoireLinks.length + contentWritten.length + ecoWritten.length + 3 + 1;
    assert.equal(pageFilenames.length, expectedPageCount);
    assert.ok(pageFilenames.includes('404.html'));
    assert.ok(pageFilenames.includes('eco-explorer.html'));

    const sitemapXml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    assert.match(sitemapXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const locMatches = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locMatches.length, expectedPageCount - 1, '404.html must be excluded from the sitemap');
    assert.ok(locMatches.includes('https://repertoire-builder.com/'), 'home should canonicalize to the directory form');
    assert.ok(locMatches.includes('https://repertoire-builder.com/italian-game.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/chess-opening-faq.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/privacy.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/italian-game-drill.html'));
    assert.equal(ecoWritten.length, 64 + 5 + 2, 'Phase 7d: 64 T1 hubs + 5 T2 volume pages + 2 T2 browse-index pages');
    assert.ok(locMatches.includes('https://repertoire-builder.com/sicilian-defense-variations.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/eco-volume-b.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/eco-openings.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/eco-explorer.html'));
    // player-lookup.js/drill.js/eco-explorer.js/eco-reverse-lookup.json/ads.txt/CNAME are not pages and must not appear.
    assert.ok(!sitemapXml.includes('player-lookup.js'));
    assert.ok(!sitemapXml.includes('drill.js'));
    assert.ok(!sitemapXml.includes('eco-explorer.js'));
    assert.ok(!sitemapXml.includes('eco-reverse-lookup.json'));
    assert.ok(!sitemapXml.includes('ads.txt'));
    assert.ok(!sitemapXml.includes('404.html'), '404.html must never appear in sitemap.xml');

    const robotsTxt = fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
    assert.match(robotsTxt, /^User-agent: \*/);
    assert.match(robotsTxt, /Sitemap: https:\/\/repertoire-builder\.com\/sitemap\.xml/);
  })
);

test('buildStatic writes dist/404.html with the shared shell, noindex, and copies the identity assets into dist/', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const notFoundHtml = fs.readFileSync(path.join(outDir, '404.html'), 'utf8');
    assert.match(notFoundHtml, /<meta name="robots" content="noindex">/);
    assert.match(notFoundHtml, /class="site-header"/);
    assert.match(notFoundHtml, /class="site-nav"/);
    assert.match(notFoundHtml, /class="site-footer"/);

    for (const file of ['og-default.png', 'apple-touch-icon.png', 'favicon.svg']) {
      const outPath = path.join(outDir, file);
      assert.ok(fs.existsSync(outPath), `expected ${file} to be copied into dist/`);
      assert.ok(fs.statSync(outPath).size > 0, `${file} should not be empty`);
    }

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /<meta property="og:image" content="https:\/\/repertoire-builder\.com\/og-default\.png">/);
    assert.match(homeHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
    assert.match(homeHtml, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  })
);

test('buildStatic never emits an internal href="index.html" link -- the repertoire/home nav target is "/"', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    for (const file of ['index.html', 'italian-game.html', 'repertoire-1600-1800-white.html', '404.html']) {
      const html = fs.readFileSync(path.join(outDir, file), 'utf8');
      assert.doesNotMatch(html, /href="index\.html"/, `${file} should not link to href="index.html"`);
    }
  })
);

test('buildStatic writes italian-game-drill.html and drill.js, with the drill data baked in and drill.js a self-contained esbuild bundle (file:// invariant)', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, pageFilenames } = await buildStatic({ fetchImpl, useCache: false });

    assert.ok(fs.existsSync(path.join(outDir, 'italian-game-drill.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'drill.js')));
    assert.ok(pageFilenames.includes('italian-game-drill.html'));
    assert.ok(!pageFilenames.includes('drill.js'), 'drill.js is a script, not a page');

    const drillHtml = fs.readFileSync(path.join(outDir, 'italian-game-drill.html'), 'utf8');
    assert.match(drillHtml, /<h1 class="page-title">Italian Game drill/);
    assert.match(drillHtml, /play the Italian Game from move 1/);
    assert.match(drillHtml, /id="drill-data"/);
    assert.match(drillHtml, /<script src="drill\.js" defer><\/script>/);
    const boardSquareCount = (drillHtml.match(/class="board-sq /g) || []).length;
    assert.equal(boardSquareCount, 64);

    // See buildDrillBundle's own test above for why this is a sandboxed
    // execution check rather than a textual require()/module.exports ban.
    const drillJs = fs.readFileSync(path.join(outDir, 'drill.js'), 'utf8');
    assert.doesNotThrow(() => runBundleInSandbox(drillJs));
  })
);

test('assertFilenamesUnique still passes with italian-game-drill.html and drill.js in the full static build filename list', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    // buildStatic() already runs assertFilenamesUnique() internally and
    // would have thrown during the build above if the new drill filenames
    // collided with anything -- a successful build IS the assertion here.
    await assert.doesNotReject(() => buildStatic({ fetchImpl, useCache: false }));
  })
);

test('the home page links to the drill, and player lookup is still linked too', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="italian-game-drill\.html"/);
    assert.match(homeHtml, /Drill it: play the move your rating band plays/);
    assert.match(homeHtml, /href="player\.html"/);
  })
);

test('the nav on an existing static page now includes the drill link', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const openingsHtml = fs.readFileSync(path.join(outDir, 'openings.html'), 'utf8');
    assert.match(openingsHtml, /href="italian-game-drill\.html"/);
  })
);
