'use strict';

/**
 * Manual verification script for src/boardWidget.js (Phase 7c) -- same
 * category as scripts/visual-qa.js: a real-browser check too heavy for the
 * fast `npm test` suite (see test/visualQa.test.js's own header comment for
 * why cm-chessboard's own extensive vendor DOM logic isn't a fit for
 * node:test either -- it needs a real document, not a stub). Run by hand:
 *
 *   node scripts/boardWidgetCheck.js
 *
 * Builds test/fixtures/boardWidgetDemo.client.js with esbuild (same
 * bundleBrowserEntry() src/buildStatic.js uses for the real site), embeds
 * it plus src/boardSvg.js's spriteDefsHtml() and src/render.js's SITE_CSS
 * into one self-contained HTML string (no server needed -- Playwright's
 * page.setContent() is enough since there are no external asset URLs to
 * resolve), then drives it: steps the replay board through its FEN array,
 * plays one legal free-mode move and confirms it lands, attempts one
 * illegal free-mode move and confirms it's rejected, and saves a
 * screenshot at each of the three required viewports
 * (design-standards.md) into visual-qa-output/ for manual review.
 *
 * Exits non-zero (with a printed reason) on any assertion failure.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bundleBrowserEntry } = require('../src/buildStatic');
const { spriteDefsHtml } = require('../src/boardSvg');
const { SITE_CSS } = require('../src/render');

const OUTPUT_DIR = path.join(__dirname, '..', 'visual-qa-output');
const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
];

function buildFixtureHtml() {
  const bundle = bundleBrowserEntry(
    path.join(__dirname, '..', 'test', 'fixtures', 'boardWidgetDemo.client.js'),
    '/* test-only bundle, see scripts/boardWidgetCheck.js */'
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>boardWidget demo (test fixture, not part of the site)</title>
<style>${SITE_CSS}</style>
</head>
<body>
  <main>
    <h1 class="page-title">boardWidget verification fixture</h1>
    ${spriteDefsHtml()}
    <section>
      <h2>Replay mode</h2>
      <div id="replay-board"></div>
    </section>
    <section>
      <h2>Free mode</h2>
      <div id="free-board"></div>
      <p id="free-status">last move: (none)</p>
    </section>
  </main>
  <script>${bundle}</script>
</body>
</html>`;
}

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures += 1;
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const html = buildFixtureHtml();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(200);

  check('no uncaught page errors on mount', pageErrors.length === 0 || (() => { console.error(pageErrors); return false; })());

  // --- replay mode ---
  const replayStatus = () => page.locator('#replay-board .sr-only[aria-live]').innerText();
  check('replay starts on step 1 ("Start")', (await replayStatus()) === 'Start');
  await page.locator('#replay-board .board-replay-controls button[aria-label="Next move"]').click();
  check('replay next -> "1. e4"', (await replayStatus()) === '1. e4');
  await page.locator('#replay-board .board-replay-controls button[aria-label="Next move"]').click();
  check('replay next -> "1. e4 e5"', (await replayStatus()) === '1. e4 e5');
  const nextBtnDisabled = await page.locator('#replay-board .board-replay-controls button[aria-label="Next move"]').isDisabled();
  check('"Next move" disables on the last step', nextBtnDisabled === true);
  await page.locator('#replay-board .board-replay-controls button[aria-label="First move"]').click();
  check('replay "First move" returns to step 1', (await replayStatus()) === 'Start');

  // --- free mode: legal move e2-e4 ---
  await page.locator('#free-board rect.square[data-square="e2"]').click();
  await page.locator('#free-board rect.square[data-square="e4"]').click();
  await page.waitForTimeout(200);
  const statusAfterLegal = await page.locator('#free-status').innerText();
  check('a legal move (e2-e4) is accepted and reported', statusAfterLegal.includes('e4') && statusAfterLegal.includes('last move'));

  // --- free mode: illegal move attempt, e.g. moving the same pawn two ranks backward ---
  await page.locator('#free-board rect.square[data-square="e4"]').click();
  await page.locator('#free-board rect.square[data-square="e2"]').click();
  await page.waitForTimeout(200);
  const statusAfterIllegal = await page.locator('#free-status').innerText();
  check('an illegal move (e4 back to e2) is rejected, not reported as a move', statusAfterIllegal === statusAfterLegal);

  // --- accessibility extension actually rendered ---
  const a11yTableCount = await page.locator('#free-board table').count();
  check('Accessibility extension renders a real <table> board view', a11yTableCount > 0);
  const liveRegionCount = await page.locator('#free-board [aria-live]').count();
  check('Accessibility extension provides at least one aria-live region', liveRegionCount > 0);

  // --- design tokens, not cm-chessboard's shipped default palette ---
  const squareFill = await page.locator('#free-board rect.square.white').first().evaluate((el) => getComputedStyle(el).fill);
  check('board square uses the site\'s own board-light token, not cm-chessboard\'s shipped #ecdab9 default', squareFill !== 'rgb(236, 218, 185)');

  // --- screenshots at all three required viewports ---
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(100);
    const outPath = path.join(OUTPUT_DIR, `boardWidget-demo-${vp.name}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`  saved ${path.relative(process.cwd(), outPath)}`);
  }

  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

main().catch((err) => {
  console.error('boardWidgetCheck crashed:', err);
  process.exitCode = 1;
});
