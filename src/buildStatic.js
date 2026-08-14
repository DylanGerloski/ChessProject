'use strict';

/**
 * Full static-site build for GitHub Pages staging (local-only: this script
 * does not touch git, GitHub, or any account -- it only writes files under
 * dist/). Produces a self-contained dist/ directory that works when opened
 * directly in a browser via a file:// URL, no server required, since
 * GitHub Pages itself just serves static files.
 *
 * Two features, two different strategies:
 *
 * - Rating-band repertoire explorer: pre-rendered at build time into 8
 *   static HTML files (one per RATING_BANDS key x color), reusing
 *   buildRepertoireTree() + renderRepertoirePage() unchanged. This is the
 *   ONLY place the Lichess API token (LICHESS_API_TOKEN / .lichess-token,
 *   read by fetchOpeningExplorer.js) is used -- it is read locally during
 *   this build step to call the Explorer API, and the resulting HTML files
 *   contain only the aggregated stats the API returned, never the token
 *   itself. assertNoTokenLeak() below checks every file written to dist/
 *   for the literal token string as a build-time safety net, and
 *   test/buildStatic.test.js exercises the same check against a fake token.
 *
 * - Player lookup: a static HTML shell (player.html) plus a plain-JS bundle
 *   (player-lookup.js) built with esbuild (a real CommonJS bundle, entry
 *   point src/browser/playerLookup.client.js, which require()s
 *   fetchLichess.js/process.js/render.js directly like any other module in
 *   this project) into a single self-contained IIFE with no runtime
 *   require() -- see bundleBrowserEntry() below. That bundle calls
 *   Lichess's already-public, keyless general API directly from the
 *   visitor's browser -- no token is read, embedded, or needed for this
 *   page at all.
 *
 * - Content pages (phases 1-2 of the content-depth
 *   build): 10 opening pages + the openings hub (phase 1), plus an FAQ page
 *   and 6 editorial guide articles + a guides hub (phase 2), all
 *   pre-rendered the same way via buildContentPages() (src/buildContent.js).
 *   Also token-gated the same way -- see that module's own header comment.
 *
 * - sitemap.xml / robots.txt / structured data (phase 3): sitemap.xml and
 *   robots.txt (src/sitemap.js) are generated from the actual list of
 *   .html filenames this build writes, so they can't drift from what's
 *   really on disk. JSON-LD (src/structuredData.js) is emitted per-page by
 *   src/renderContent.js/src/buildStatic.js's indexPage(), not here.
 *
 * Usage: node src/buildStatic.js [--no-cache]
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { buildRepertoireTree } = require('./buildRepertoire');
const { RATING_BANDS } = require('./processRepertoire');
const { renderRepertoirePage, escapeHtml, renderDocumentHead, renderHeader, renderFooter, renderPageHead } = require('./render');
const { renderOpeningStatCard } = require('./renderContent');
const { getApiToken } = require('./fetchOpeningExplorer');
const { buildContentPages } = require('./buildContent');
const { buildEcoPages } = require('./buildEcoPages');
const { buildEcoDataset } = require('./ecoData');
const { buildFamilyIndex, t1Families } = require('./ecoFamilies');
const { ECO_INDEX_FILE } = require('./renderEcoPages');
const { buildEcoExplorerPage, ECO_EXPLORER_FILE, REVERSE_LOOKUP_FILE } = require('./buildEcoExplorer');
const { withExplorerCache } = require('./explorerCache');
const { renderPrivacyPage, renderAboutPage, renderContactPage, render404Page, adsTxtContent } = require('./renderCompliance');
const { renderSitemapXml, robotsTxtContent } = require('./sitemap');
const { renderRssXml } = require('./rss');
const { homeJsonLd } = require('./structuredData');
const { SITE_NAME, SITE_TAGLINE, absoluteUrl, pageTitle } = require('./site');
const { buildDrillData } = require('./buildDrill');
const { renderDrillPage } = require('./renderDrill');

// Pre-rendering all 8 band/color combinations issues many sequential
// Explorer API requests (each combination expands several plies), which can
// trip Lichess's rate limiter well before the whole batch finishes. This
// wrapper is ONLY used as the default (real) fetch implementation -- any
// caller that passes its own `fetchImpl` (as every test in
// test/buildStatic.test.js does) bypasses it entirely, so it never adds
// delays or retries to the test suite.
async function politeFetch(url, options) {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === MAX_ATTEMPTS) {
      return response;
    }
    const retryAfterHeader = response.headers && typeof response.headers.get === 'function'
      ? Number(response.headers.get('retry-after'))
      : NaN;
    const waitMs = (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  // Unreachable, but keeps control flow explicit.
  return fetch(url, options);
}

const OUT_DIR = path.join(__dirname, '..', 'dist');
const COLORS = ['white', 'black'];

// Identity artwork committed under assets/ by scripts/build-og-image.js (run
// by hand, not part of this build -- see that script's own header comment).
// Copied verbatim into dist/ on every build so a normal `npm run
// build:static` never needs Playwright itself.
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const IDENTITY_ASSET_FILES = ['og-default.png', 'apple-touch-icon.png', 'favicon.svg'];

// Self-hosted heading webfont. assets/fonts/fraunces-variable.woff2 was extracted once from the
// @fontsource-variable/fraunces devDependency (an OFL-licensed npm package
// that bundles the actual Google Fonts binary, so the build never fetches
// anything from Google at runtime or build time); copied verbatim into
// dist/fonts/ here, same pattern as IDENTITY_ASSET_FILES above. render.js's
// @font-face/preload reference this exact dist/-relative path.
const FONT_ASSET_FILES = ['fraunces-variable.woff2'];

// Nav link targets for the static build -- flat filenames, no server routes.
// Shared with renderRepertoirePage() (see repertoire page rendering below)
// so every static page's header links are identical. 'guides'/'faq' added
// added once guides.html/chess-opening-faq.html actually existed; 'drill'
// added once italian-game-drill.html existed (single-opening drill pilot).
const STATIC_NAV = { player: 'player.html', repertoire: '/', openings: 'openings.html', eco: ECO_INDEX_FILE, drill: 'italian-game-drill.html', guides: 'guides.html', faq: 'chess-opening-faq.html' };

// The one opening this drill pilot covers, and the rating band its
// server-rendered starting position and candidate table default to. Kept
// here (not hardcoded inside renderDrill.js) so a future second-opening
// pilot only has to change this one call site.
const DRILL_OPENING_SLUG = 'italian-game';
const DRILL_DEFAULT_BAND = '1600-1800';

// Maps an opening slug to its drill page filename, so buildContentPages()
// can thread a "Drill this opening" CTA into that opening's page without
// buildContent.js needing to know the drill pilot is single-opening -- a
// future second-opening pilot only needs another entry here.
const DRILL_PAGES = { [DRILL_OPENING_SLUG]: 'italian-game-drill.html' };

// Compliance pages: privacy policy, about, and
// contact, linked from every page's footer via renderFooter()'s optional
// `legalLinks` param (see src/render.js). Kept as flat filenames matching
// every other static page, and shared with src/renderContent.js's own
// CONTENT_LEGAL_LINKS constant (kept in sync by comment there, since that
// module can't require() this one without a circular dependency).
const LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html' };

const BROWSER_ENTRY = path.join(__dirname, 'browser', 'playerLookup.client.js');
const DRILL_ENTRY = path.join(__dirname, 'browser', 'drill.client.js');
const ECO_EXPLORER_ENTRY = path.join(__dirname, 'browser', 'ecoExplorer.client.js');

function repertoireFileName(band, color) {
  const safeBand = band.replace(/[^\w-]/g, '');
  return `repertoire-${safeBand}-${color}.html`;
}

/**
 * Bundles a single CommonJS entry point (and everything it require()s,
 * transitively) into one self-contained IIFE with esbuild, for direct use
 * as a <script src="..."> in the static build. No runtime require(), no
 * module resolution at load time -- esbuild resolves and inlines the whole
 * graph at build time, which is what keeps the output working from a
 * file:// URL (native ESM `import` is blocked by CORS over file://; a
 * pre-bundled IIFE has no such restriction). `bundle: true` + `write:
 * false` returns the built text directly with no temp files on disk.
 * `esbuild.buildSync` throws (loudly, synchronously) on any resolution or
 * syntax error in the entry point or anything it require()s, so a broken
 * source edit fails the build instead of silently shipping a stale bundle
 * -- the same failure-loudly guarantee the old string-splice approach had.
 */
function bundleBrowserEntry(entryPath, headerComment) {
  const result = esbuild.buildSync({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    banner: { js: headerComment },
    logLevel: 'silent',
    // Whitespace/dead-code minification only -- NOT minifyIdentifiers.
    // test/buildStatic.test.js's own bundle tests (and any future ones)
    // assert on real function names being present in the output (e.g.
    // `/function fetchRatingHistory/`) as proof the right modules got
    // bundled; renaming identifiers would make that check meaningless
    // without a source map, for a source-size win this project doesn't
    // need (nothing here is minimizing against a CDN egress cost). Added
    // for Phase 7e (src/browser/ecoExplorer.client.js, the heaviest bundle
    // on this site at ~230 KB raw / ~43 KB gzip unminified) but applies to
    // every bundle equally -- real bytes shipped to every visitor, not a
    // T3-specific hack.
    minifyWhitespace: true,
    minifySyntax: true,
  });
  return result.outputFiles[0].text;
}

function buildPlayerLookupBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/playerLookup.client.js and its module dependencies',
    ' * (src/fetchLichess.js, src/process.js, src/render.js). Do not edit',
    ' * this file directly -- edit the source files above and re-run `node',
    ' * src/buildStatic.js`.',
    ' *',
    ' * This calls only Lichess\'s keyless public API (https://lichess.org/api)',
    ' * directly from your browser. No Lichess API token is used, read, or present',
    ' * anywhere in this file. */',
  ].join('\n');

  return bundleBrowserEntry(BROWSER_ENTRY, header);
}

/**
 * Same esbuild strategy as buildPlayerLookupBundle(), for the opening
 * drill's client bundle: entry point src/browser/drill.client.js, which
 * require()s src/chessPosition.js and src/drillLogic.js (both pure). All
 * drill data is baked into the page at build time (see the #drill-data
 * JSON block src/renderDrill.js emits) -- this bundle never makes a
 * network request itself.
 */
function buildDrillBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/drill.client.js and its module dependencies',
    ' * (src/chessPosition.js, src/drillLogic.js). Do not edit this file',
    ' * directly -- edit the source files above and re-run `node',
    ' * src/buildStatic.js`.',
    ' *',
    ' * This makes no network requests -- every position/percentage it uses',
    ' * comes from the #drill-data JSON block already on the page. */',
  ].join('\n');

  return bundleBrowserEntry(DRILL_ENTRY, header);
}

/**
 * Same esbuild strategy again, for T3's client bundle (Phase 7e): entry
 * point src/browser/ecoExplorer.client.js, which require()s
 * src/boardWidget.js, src/pgnWrapper.js, and chess.js -- the only bundle on
 * this site that ships chess.js to the browser (see src/pgnWrapper.js's own
 * header comment for why this page, and only this page, needs it: it is
 * the sole place visitor-supplied PGN/FEN input reaches a chess engine).
 * This bundle also issues the one runtime fetch() this static site makes
 * for same-origin data -- see src/ecoExplorerData.js's header comment.
 */
function buildEcoExplorerBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/ecoExplorer.client.js and its module dependencies',
    ' * (src/boardWidget.js, src/pgnWrapper.js, chess.js, cm-chessboard).',
    ' * Do not edit this file directly -- edit the source files above and',
    ' * re-run `node src/buildStatic.js`.',
    ' *',
    ' * This is the only page on this site that parses visitor-supplied PGN/',
    ' * FEN text (always through src/pgnWrapper.js\'s size-capped, depth-',
    ' * guarded wrapper -- never chess.js directly) and the only page that',
    ' * issues a runtime fetch() for same-origin data (eco-reverse-lookup.json,',
    ' * lazy-loaded on first use). No Lichess API token is used, read, or',
    ' * present anywhere in this file. */',
  ].join('\n');

  return bundleBrowserEntry(ECO_EXPLORER_ENTRY, header);
}

// Drill CTA card for the home page. Kept as its own additive block (a new
// section, appended without touching any of indexPage()'s existing copy)
// since a separate, later pass is expected to rework the rest of this
// page's headline/subtitle/section order -- keeping this isolated avoids
// that future edit and this one stepping on each other.
function drillCtaSection(drillFile) {
  if (!drillFile) return '';
  return `<h2>Drill it: play the move your rating band plays</h2>
    <div class="card-grid">
      <div class="card card--outline card--nav"><h3><a href="${escapeHtml(drillFile)}">Italian Game drill</a></h3><p>Pick the move, see instantly whether it is the move players at your rating actually make, and what that move scores.</p></div>
    </div>`;
}

// The four rating-band pickers as one role=group control with 44px pill
// links (render.js's .band-picker/.band-pill), replacing four floating
// .card elements that carried the same visual weight as unrelated nav
// cards on the same page. Link targets/labels unchanged from the old cards
// (band + color, e.g. "as White").
function bandPickerHtml(repertoireLinks) {
  const pills = Object.keys(RATING_BANDS)
    .flatMap((band) => repertoireLinks
      .filter((r) => r.band === band)
      .map(({ color, file }) => `<a class="band-pill" href="${escapeHtml(file)}">${escapeHtml(band)} <span class="band-pill-color">as ${escapeHtml(color === 'white' ? 'White' : 'Black')}</span></a>`))
    .join('\n      ');
  return `<div class="band-picker" role="group" aria-label="Pick your rating band and color">
      ${pills}
    </div>`;
}

// Product decision: the rating-band picker below is the homepage's single
// primary action -- repertoire lookup is the site's core value prop and
// existing traffic driver (now a single role=group pill control, not four
// accent-filled cards competing with
// unrelated nav cards on the same page -- see bandPickerHtml above). The
// drill card and openings cards (below) stay demoted to outline cards
// (card--outline) -- same link targets, lower visual weight; see
// design-standards.md 4.5's "one primary action per view". Openings cards
// additionally carry inline WDL data via renderOpeningStatCard.
function indexPage(repertoireLinks, contentEntries = [], drillFile = null) {
  const openingsSection = contentEntries.length > 0
    ? `<h2>Openings by real win rate</h2>
    <p class="repertoire-intro">${contentEntries.length} openings, ranked by what they actually score in real games
       at each rating band &mdash; see <a href="openings.html">all openings &rarr;</a></p>
    <div class="card-grid">
      ${contentEntries
        .slice(0, 6)
        .map((e) => renderOpeningStatCard(e.openingConfig, e.model, 'card--outline'))
        .join('\n      ')}
    </div>`
    : '';

  const homeDescription = 'Which chess openings players at your rating actually play, and which of those picks actually win. Real win rates from millions of Lichess games.';
  const homeJsonLdBlock = homeJsonLd({ url: absoluteUrl(''), description: homeDescription });

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({
    title: `The Chess Opening Meta by Rating Band | ${SITE_NAME}`,
    description: homeDescription,
    canonical: absoluteUrl(''),
    jsonLd: homeJsonLdBlock,
    feedUrl: absoluteUrl('feed.xml'),
  })}
<body>
  ${renderHeader(STATIC_NAV, 'repertoire')}
  <main>
    ${renderPageHead({
      title: 'The chess opening meta, by rating band',
      subtitle: 'Which openings players at your rating actually play, and how often those picks actually win. Every number on this site comes from real Lichess games &mdash; no theory, no opinions, no engine lines.',
    })}

    <h2>Start with your rating band</h2>
    <p class="repertoire-intro">Openings behave differently at every rating. Pick your band &mdash; everything below is
       filtered to real games at that level.</p>
    ${bandPickerHtml(repertoireLinks)}

    ${drillCtaSection(drillFile)}

    ${openingsSection}

    <h2>Player lookup</h2>
    <p><a href="player.html">Look up any Lichess username &rarr;</a> (fetches live data
       directly in your browser when you open this page; nothing is pre-baked).</p>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>.', LEGAL_LINKS)}
</body>
</html>
`;
}

function playerLookupPage() {
  const title = pageTitle('Player lookup');
  const description = 'Look up any Lichess username to see rating history and recent games, fetched live and rendered directly in your browser — no account or token needed.';
  const canonical = absoluteUrl('player.html');
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body class="layout--wide">
  ${renderHeader(STATIC_NAV, 'player')}
  <main>
    <h1 class="page-title">Player lookup</h1>
    <p class="subtitle">Enter a Lichess username to view rating history and recent games. This runs
       entirely in your browser, calling Lichess&rsquo;s public API directly &mdash; no token
       needed and none is used.</p>
    <form id="lookup-form" class="lookup-form">
      <input id="username" name="username" placeholder="e.g. DrNykterstein" required>
      <button type="submit">View</button>
    </form>
    <div id="result"></div>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>, called directly from this page in your browser.', LEGAL_LINKS)}
  <script src="player-lookup.js"></script>
</body>
</html>
`;
}

async function buildRepertoirePages({ fetchImpl = politeFetch } = {}) {
  const written = [];
  for (const band of Object.keys(RATING_BANDS)) {
    for (const color of COLORS) {
      const data = await buildRepertoireTree({ ratingBand: band, color, fetchImpl });
      const file = repertoireFileName(band, color);
      const colorLabel = color === 'white' ? 'White' : 'Black';
      const html = renderRepertoirePage({
        ...data,
        nav: STATIC_NAV,
        legalLinks: LEGAL_LINKS,
        canonical: absoluteUrl(file),
        description: `Repertoire explorer, ${band}, playing as ${colorLabel}: the moves players actually play at each ply, and how each one scores, from real Lichess games.`,
      });
      fs.writeFileSync(path.join(OUT_DIR, file), html, 'utf8');
      written.push({ band, color, file });
    }
  }
  return written;
}

/**
 * Reads back every file just written to outDir (recursively, including any
 * subdirectory -- e.g. a future nested output) and fails loudly if the
 * literal token string appears anywhere in it. This is the explicit,
 * automated check the task calls for, run both here (real build) and by
 * test/buildStatic.test.js (fake token, fake fetch, no live calls).
 */
function assertNoTokenLeak(outDir, token) {
  if (!token) return;
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(token)) {
        offenders.push(path.relative(outDir, full));
      }
    }
  }
  walk(outDir);
  if (offenders.length > 0) {
    throw new Error(`Lichess API token leaked into generated static output: ${offenders.join(', ')}`);
  }
}

/**
 * Fails loudly on any filename collision across every page this build
 * writes -- a content page slug colliding with a repertoire filename or
 * another content page would silently overwrite one of them otherwise.
 */
function assertFilenamesUnique(filenames) {
  const seen = new Map();
  for (const name of filenames) {
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (dupes.length > 0) {
    throw new Error(`Duplicate output filename(s) across the static build: ${dupes.join(', ')}`);
  }
}

async function buildStatic({ fetchImpl = politeFetch, useCache = true } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const repertoireLinks = await buildRepertoirePages({ fetchImpl });

  // Content pages (opening pages + hub) share the same rate-limited Explorer
  // endpoint, so they get the same politeFetch treatment, plus an on-disk
  // cache -- authoring this content means rebuilding many times, and each
  // rebuild would otherwise re-issue ~90 requests. `useCache: false` (wired
  // to --no-cache below) bypasses it for a forced refresh.
  const cachedFetchImpl = withExplorerCache(fetchImpl, { enabled: useCache });

  // Cheap (~2s, no network -- see src/ecoData.js) dataset parse, just to
  // size the "browse the full ECO index" link the openings hub links out
  // to below. buildEcoPages() (called later, after content pages) parses
  // the same vendored dataset again itself rather than taking this one as
  // a parameter -- keeps it usable/testable standalone -- the double parse
  // costs a couple of extra seconds, not a couple of extra Explorer requests.
  const ecoDatasetForLink = buildEcoDataset();
  const ecoFamilyIndexForLink = buildFamilyIndex(ecoDatasetForLink.lines);
  const ecoIndexLink = {
    href: ECO_INDEX_FILE,
    familyCount: ecoFamilyIndexForLink.length,
    lineCount: ecoDatasetForLink.stats.totalLines,
  };

  const { written: contentWritten, entries: contentEntries } = await buildContentPages({
    fetchImpl: cachedFetchImpl,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
    drillPages: DRILL_PAGES,
    ecoIndexLink,
  });

  // Single-opening drill pilot (beta): baked at build time from the same
  // rate-limited, cached Explorer endpoint as the content pages above --
  // see src/buildDrill.js for the request-count budget (25 per band, 100
  // total). Reuses repertoireFileName() (already defined above) so the
  // drill's "keep exploring" link points at the real generated filename
  // rather than a hand-typed one that could drift.
  const drillData = await buildDrillData({ openingSlug: DRILL_OPENING_SLUG, fetchImpl: cachedFetchImpl });
  const drillFile = 'italian-game-drill.html';
  const drillHtml = renderDrillPage({
    drillData,
    nav: STATIC_NAV,
    legalLinks: LEGAL_LINKS,
    openingLink: `${DRILL_OPENING_SLUG}.html`,
    repertoireLink: repertoireFileName(DRILL_DEFAULT_BAND, 'white'),
  });
  fs.writeFileSync(path.join(OUT_DIR, drillFile), drillHtml, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'drill.js'), buildDrillBundle(), 'utf8');

  // T1 family hub pages + T2 ECO volume/browse index pages (Phase 7d):
  // same rate-limited, cached Explorer endpoint, one request at a time,
  // ~256 requests total (see src/buildEcoPages.js's own header comment for
  // the exact budget). No dependency on contentWritten/drillFile -- reads
  // openings.js only to find a T0 cross-link by name, never their files.
  const { written: ecoWritten } = await buildEcoPages({
    fetchImpl: cachedFetchImpl,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
  });

  // T3: the interactive ECO explorer (Phase 7e) -- zero Explorer API
  // requests (see src/buildEcoExplorer.js's own header comment), reuses the
  // dataset/family index already parsed above for the openings-hub link.
  // Also writes dist/eco-reverse-lookup.json, the one asset this static
  // build produces that a page fetch()es at runtime rather than inlining
  // (see src/ecoExplorerData.js's header comment).
  const ecoExplorerResult = buildEcoExplorerPage({
    dataset: ecoDatasetForLink,
    familyIndex: ecoFamilyIndexForLink,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
  });
  fs.writeFileSync(path.join(OUT_DIR, 'eco-explorer.js'), buildEcoExplorerBundle(), 'utf8');

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), indexPage(repertoireLinks, contentEntries, drillFile), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'player.html'), playerLookupPage(), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'player-lookup.js'), buildPlayerLookupBundle(), 'utf8');

  // Compliance pages: privacy policy, about, contact,
  // and an ads.txt stub. See src/renderCompliance.js for what each contains
  // and why (AdSense review requirements). nav omits these three from the top nav bar
  // deliberately -- they're reachable from every page's footer instead (via
  // LEGAL_LINKS above), matching how most sites treat legal/about pages.
  fs.writeFileSync(path.join(OUT_DIR, 'privacy.html'), renderPrivacyPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'about.html'), renderAboutPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'contact.html'), renderContactPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'ads.txt'), adsTxtContent(), 'utf8');

  // 404 page: same header/nav/footer shell as every other page, noindex,
  // excluded from sitemap.xml (src/sitemap.js filters it out). GitHub Pages
  // serves this automatically for a custom domain (dist/CNAME above).
  fs.writeFileSync(
    path.join(OUT_DIR, '404.html'),
    render404Page({
      nav: STATIC_NAV,
      legalLinks: LEGAL_LINKS,
      homeLink: STATIC_NAV.repertoire,
      openingsLink: STATIC_NAV.openings,
      repertoireLink: repertoireFileName(DRILL_DEFAULT_BAND, 'white'),
    }),
    'utf8'
  );

  // Identity artwork (og-default.png, apple-touch-icon.png, favicon.svg):
  // committed under assets/ by scripts/build-og-image.js, copied verbatim
  // here on every build. Fails loudly if a file is missing rather than
  // silently shipping a site with no og:image -- run
  // `node scripts/build-og-image.js` once if this throws.
  for (const assetFile of IDENTITY_ASSET_FILES) {
    const src = path.join(ASSETS_DIR, assetFile);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing identity asset ${src} -- run "node scripts/build-og-image.js" first.`);
    }
    fs.copyFileSync(src, path.join(OUT_DIR, assetFile));
  }

  // Self-hosted heading webfont (see FONT_ASSET_FILES above) -- copied into
  // dist/fonts/ verbatim, matching the /fonts/fraunces-variable.woff2 path
  // render.js's @font-face and preload <link> both reference.
  const FONT_OUT_DIR = path.join(OUT_DIR, 'fonts');
  fs.mkdirSync(FONT_OUT_DIR, { recursive: true });
  for (const fontFile of FONT_ASSET_FILES) {
    const src = path.join(ASSETS_DIR, 'fonts', fontFile);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing font asset ${src} -- see assets/fonts/ and src/render.js's --font-serif comment.`);
    }
    fs.copyFileSync(src, path.join(FONT_OUT_DIR, fontFile));
  }
  // Custom domain for GitHub Pages. dist/ is gitignored and
  // regenerated fresh on every `npm run build:static` run, and its contents
  // are what actually gets pushed to the gh-pages branch GitHub Pages
  // serves from (confirmed by diffing dist/ against `git ls-tree gh-pages`
  // -- same flat file set at the branch root), so CNAME has to be written
  // here on every build rather than added once by hand, or it would be
  // silently wiped the next time this script runs. No trailing slash, no
  // scheme, no www -- GitHub Pages requires the bare domain string.
  fs.writeFileSync(path.join(OUT_DIR, 'CNAME'), 'Repertoire-Builder.com', 'utf8');

  const pageFilenames = [
    'index.html',
    'player.html',
    'privacy.html',
    'about.html',
    'contact.html',
    '404.html',
    drillFile,
    ...repertoireLinks.map((r) => r.file),
    ...contentWritten.map((c) => c.file),
    ...ecoWritten.map((e) => e.file),
    ecoExplorerResult.file,
  ];

  assertFilenamesUnique([
    ...pageFilenames,
    'player-lookup.js',
    'drill.js',
    'eco-explorer.js',
    REVERSE_LOOKUP_FILE,
    'CNAME',
    'ads.txt',
    'feed.xml',
    ...IDENTITY_ASSET_FILES,
  ]);
  assertNoTokenLeak(OUT_DIR, getApiToken());

  // sitemap.xml / robots.txt (phase 3): generated from the actual list of
  // .html pages just written above, so they can't drift from what's really
  // on disk -- written last, after the uniqueness/token checks, so a
  // failed build never leaves a stale sitemap pointing at pages that
  // didn't actually get (re)written this run.
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), renderSitemapXml(pageFilenames), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), robotsTxtContent(), 'utf8');

  // feed.xml: RSS for the content pages that actually get added/updated
  // over time (opening guides +
  // editorial articles from buildContentPages() above) -- NOT the
  // repertoire explorer pages (a fixed band/color grid, not "content" in
  // the publishing sense) and NOT the drill pilot (a single static page).
  // Built from the same `contentWritten` entries already used for the
  // sitemap, so it can't drift from what's really on disk either.
  fs.writeFileSync(path.join(OUT_DIR, 'feed.xml'), renderRssXml(contentWritten), 'utf8');

  return { outDir: OUT_DIR, repertoireLinks, contentWritten, ecoWritten, ecoExplorerResult, pageFilenames };
}

async function main() {
  const useCache = !process.argv.includes('--no-cache');
  try {
    const { outDir, repertoireLinks, contentWritten, ecoWritten, ecoExplorerResult } = await buildStatic({ useCache });
    console.log(`Wrote static site to ${outDir}`);
    console.log(`  - index.html (links to player lookup + ${repertoireLinks.length} repertoire pages + openings)`);
    console.log('  - player.html + player-lookup.js (client-side player lookup, no token used)');
    for (const { file } of repertoireLinks) {
      console.log(`  - ${file}`);
    }
    console.log(`  - ${contentWritten.length} content pages (10 opening pages + openings hub)`);
    for (const { file } of contentWritten) {
      console.log(`  - ${file}`);
    }
    console.log(`  - ${ecoWritten.length} ECO pages (T1 family hubs + T2 volume/browse indexes, Phase 7d)`);
    console.log(`  - ${ecoExplorerResult.file} + eco-explorer.js + ${ecoExplorerResult.reverseLookupFile} (interactive ECO explorer, Phase 7e, ${ecoExplorerResult.reverseLookupCount.toLocaleString()} reverse-lookup positions)`);
    console.log('  - privacy.html, about.html, contact.html, ads.txt (compliance pages)');
    console.log('  - italian-game-drill.html + drill.js (single-opening drill pilot, beta)');
    console.log('  - sitemap.xml, robots.txt (generated from the pages actually written above)');
    console.log('Verified: no Lichess API token string appears in any generated file.');
    console.log('Verified: no filename collisions across the static build.');
    console.log('Open dist/index.html directly in a browser (file:// URL) -- no server needed.');
  } catch (err) {
    console.error('Static build failed:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStatic,
  buildRepertoirePages,
  buildPlayerLookupBundle,
  buildDrillBundle,
  bundleBrowserEntry,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  assertNoTokenLeak,
  assertFilenamesUnique,
  STATIC_NAV,
  LEGAL_LINKS,
};
