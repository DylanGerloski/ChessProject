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
 *   (player-lookup.js) assembled by concatenating the existing
 *   fetchLichess.js, process.js, and render.js source (their pure functions
 *   are reused as-is; only the trailing `module.exports` line is stripped
 *   since the browser has no CommonJS module object) with a small DOM
 *   controller (src/browser/playerLookup.client.js). That bundle calls
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
const { buildRepertoireTree } = require('./buildRepertoire');
const { RATING_BANDS } = require('./processRepertoire');
const { renderRepertoirePage, escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { getApiToken } = require('./fetchOpeningExplorer');
const { buildContentPages } = require('./buildContent');
const { withExplorerCache } = require('./explorerCache');
const { renderPrivacyPage, renderAboutPage, renderContactPage, adsTxtContent } = require('./renderCompliance');
const { renderSitemapXml, robotsTxtContent } = require('./sitemap');
const { homeJsonLd } = require('./structuredData');
const { SITE_TAGLINE, absoluteUrl } = require('./site');

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

// Nav link targets for the static build -- flat filenames, no server routes.
// Shared with renderRepertoirePage() (see repertoire page rendering below)
// so every static page's header links are identical. 'guides'/'faq' added
// added once guides.html/chess-opening-faq.html actually existed.
const STATIC_NAV = { player: 'player.html', repertoire: 'index.html', openings: 'openings.html', guides: 'guides.html', faq: 'chess-opening-faq.html' };

// Compliance pages: privacy policy, about, and
// contact, linked from every page's footer via renderFooter()'s optional
// `legalLinks` param (see src/render.js). Kept as flat filenames matching
// every other static page, and shared with src/renderContent.js's own
// CONTENT_LEGAL_LINKS constant (kept in sync by comment there, since that
// module can't require() this one without a circular dependency).
const LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html' };

const BROWSER_BUNDLE_SOURCES = [
  path.join(__dirname, 'fetchLichess.js'),
  path.join(__dirname, 'process.js'),
  path.join(__dirname, 'render.js'),
];
const BROWSER_CONTROLLER = path.join(__dirname, 'browser', 'playerLookup.client.js');

function repertoireFileName(band, color) {
  const safeBand = band.replace(/[^\w-]/g, '');
  return `repertoire-${safeBand}-${color}.html`;
}

/**
 * Strips the trailing `module.exports = {...};` block from a CommonJS
 * source file so it can be concatenated into a plain <script> for the
 * browser (which has no `module` global). Throws if no such block is found,
 * so a future edit to one of these source files that changes the
 * module.exports shape fails the build loudly instead of silently shipping
 * a stale or broken bundle.
 */
function bundleBrowserModule(srcPath) {
  const src = fs.readFileSync(srcPath, 'utf8');
  const stripped = src.replace(/\n*module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/, '\n');
  if (stripped === src) {
    throw new Error(`bundleBrowserModule: no trailing module.exports block found in ${srcPath}`);
  }
  return stripped;
}

function buildPlayerLookupBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js from src/fetchLichess.js, src/process.js,',
    ' * src/render.js, and src/browser/playerLookup.client.js. Do not edit this file',
    ' * directly -- edit the source files above and re-run `node src/buildStatic.js`.',
    ' *',
    ' * This calls only Lichess\'s keyless public API (https://lichess.org/api)',
    ' * directly from your browser. No Lichess API token is used, read, or present',
    ' * anywhere in this file. */',
    '',
  ].join('\n');

  const modules = BROWSER_BUNDLE_SOURCES.map(bundleBrowserModule);
  const controller = fs.readFileSync(BROWSER_CONTROLLER, 'utf8');
  return [header, ...modules, controller].join('\n\n');
}

function indexPage(repertoireLinks, contentEntries = []) {
  const items = repertoireLinks
    .map(({ band, color, file }) => `<li><a href="${escapeHtml(file)}">${escapeHtml(band)}, ${escapeHtml(color)}</a></li>`)
    .join('\n        ');

  const openingsSection = contentEntries.length > 0
    ? `<h2>Openings by real win rate</h2>
    <p class="repertoire-intro">${contentEntries.length} opening pages, each backed by real Lichess data across four
       rating bands -- see <a href="openings.html">all openings &rarr;</a></p>
    <div class="card-grid">
      ${contentEntries
        .slice(0, 6)
        .map(
          (e) => `<div class="card"><h3><a href="${escapeHtml(e.openingConfig.slug)}.html">${escapeHtml(e.model.name)}</a></h3><p>${escapeHtml(e.model.eco)}, playing as ${escapeHtml(e.model.side)}</p></div>`
        )
        .join('\n      ')}
    </div>`
    : '';

  const homeJsonLdBlock = homeJsonLd({ url: absoluteUrl(''), description: SITE_TAGLINE });

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title: 'Lichess stats (static build)', jsonLd: homeJsonLdBlock })}
<body>
  ${renderHeader(STATIC_NAV, 'repertoire')}
  <main>
    <h1 class="page-title">Lichess stats</h1>
    <p class="subtitle">This is a fully static version of the app: every page here is a plain file, no
       server required.</p>

    <h2>Player lookup</h2>
    <p><a href="player.html">Look up any Lichess username &rarr;</a> (fetches live data
       directly in your browser when you open this page; nothing is pre-baked).</p>

    ${openingsSection}

    <h2>Rating-band opening-repertoire explorer</h2>
    <p class="repertoire-intro">Pre-rendered at build time for these 8 rating-band / color combinations:</p>
    <ul>
        ${items}
    </ul>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>. See TESTING.md in the project source for how this site is built.', LEGAL_LINKS)}
</body>
</html>
`;
}

function playerLookupPage() {
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead('Player lookup - Lichess stats')}
<body>
  ${renderHeader(STATIC_NAV, 'player')}
  <main>
    <h1 class="page-title">Player lookup</h1>
    <p class="subtitle">Enter a Lichess username to view rating history and recent games. This runs
       entirely in your browser, calling Lichess's public API directly -- no token
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
      const html = renderRepertoirePage({
        ...data,
        nav: STATIC_NAV,
        legalLinks: LEGAL_LINKS,
      });
      const file = repertoireFileName(band, color);
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
  const { written: contentWritten, entries: contentEntries } = await buildContentPages({
    fetchImpl: cachedFetchImpl,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
  });

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), indexPage(repertoireLinks, contentEntries), 'utf8');
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
    ...repertoireLinks.map((r) => r.file),
    ...contentWritten.map((c) => c.file),
  ];

  assertFilenamesUnique([
    ...pageFilenames,
    'player-lookup.js',
    'CNAME',
    'ads.txt',
  ]);
  assertNoTokenLeak(OUT_DIR, getApiToken());

  // sitemap.xml / robots.txt (phase 3): generated from the actual list of
  // .html pages just written above, so they can't drift from what's really
  // on disk -- written last, after the uniqueness/token checks, so a
  // failed build never leaves a stale sitemap pointing at pages that
  // didn't actually get (re)written this run.
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), renderSitemapXml(pageFilenames), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), robotsTxtContent(), 'utf8');

  return { outDir: OUT_DIR, repertoireLinks, contentWritten, pageFilenames };
}

async function main() {
  const useCache = !process.argv.includes('--no-cache');
  try {
    const { outDir, repertoireLinks, contentWritten } = await buildStatic({ useCache });
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
    console.log('  - privacy.html, about.html, contact.html, ads.txt (compliance pages)');
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
  bundleBrowserModule,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  assertNoTokenLeak,
  assertFilenamesUnique,
  STATIC_NAV,
  LEGAL_LINKS,
};
