'use strict';

/**
 * Local, one-off generator for the site's identity artwork: the default
 * social-share image (og-default.png, 1200x630), the Apple home-screen icon
 * (apple-touch-icon.png, 180x180), and a standalone favicon.svg -- all
 * derived from the same design tokens and the same mark already used for
 * the inline favicon (FAVICON_DATA_URI in src/render.js), so nothing here
 * introduces a new color or a second brand mark.
 *
 * Uses Playwright (already a devDependency -- see package.json) to render a
 * small self-contained HTML template and screenshot it. This script is NOT
 * part of `npm run build:static` and never runs automatically -- the main
 * static build must not depend on a browser being available. Run it by hand
 * whenever the artwork needs to change, then commit the three files it
 * writes under assets/:
 *
 *   node scripts/build-og-image.js
 *
 * buildStatic.js copies assets/og-default.png, assets/apple-touch-icon.png,
 * and assets/favicon.svg into dist/ on every build -- this script only has
 * to be re-run when the artwork itself changes, not on every build.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { DESIGN_TOKENS, THEME_ROLES, FAVICON_DATA_URI, designTokensCss } = require('../src/render');
const { SITE_NAME, SITE_TAGLINE } = require('../src/site');
const { renderBoardDiagram, spriteDefsHtml } = require('../src/boardSvg');
const { boardFromFen, packOgImageFilename } = require('../src/renderPackPages');
const { fenAfter, buildPackTree, packJsonFromResult } = require('../src/buildPack');
const { PACK_CATALOGUE } = require('../src/buildPackPages');
const { withExplorerCache } = require('../src/explorerCache');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// FIX (found while extending this script for per-pack OG images, M2):
// this file used to interpolate DESIGN_TOKENS values directly as resolved
// JS strings (`background: ${T['--color-bg']}`), which silently broke the
// moment a referenced key moved to the semantic role layer (THEME_ROLES.light
// -- see render.js's own DESIGN_TOKENS doc comment for the two-layer split).
// A role value like `--color-bg` is ITSELF a `var(--color-ink-0)` reference,
// not a literal -- interpolating that string into a CSS property with no
// `--color-ink-0` custom property defined anywhere on the page resolves to
// nothing, not the intended color (confirmed by re-rendering the existing
// ogImageHtml() output fresh: plain white background, black text, not the
// themed parchment/green image actually committed under assets/og-default.png,
// which therefore predated whichever refactor introduced the split and was
// stale). Fixed the same way scripts/buildPacks.js's own pdfStylesheet()
// already does it for the exact same two-layer token set: emit BOTH layers
// as real CSS custom properties in one shared `:root { ... }` block
// (ROOT_CSS below), then reference them as literal `var(--name)` in every
// template's CSS -- never a JS-resolved string. assets/og-default.png and
// assets/apple-touch-icon.png are regenerated in the same pass as the new
// pack images below, since they shared the same bug.
const ROOT_CSS = `:root { ${designTokensCss(DESIGN_TOKENS)}\n${designTokensCss(THEME_ROLES.light)} }`;

/**
 * FAVICON_DATA_URI is a `data:image/svg+xml,<url-encoded markup>` string.
 * Decoding it recovers the exact same mark used for the inline favicon, so
 * favicon.svg and the icon shown inside the og-image / apple-touch-icon
 * never drift from the one already live on every page.
 */
function decodeFaviconSvg() {
  const prefix = 'data:image/svg+xml,';
  if (!FAVICON_DATA_URI.startsWith(prefix)) {
    throw new Error('build-og-image: FAVICON_DATA_URI is not the expected data:image/svg+xml, format');
  }
  return decodeURIComponent(FAVICON_DATA_URI.slice(prefix.length));
}

/**
 * A small decorative checkerboard corner, alternating --color-board-light /
 * --color-board-dark squares, anchored to the bottom-right of the canvas
 * and bled slightly past the edge -- a nod to the site's subject matter
 * without competing with the wordmark/tagline for attention.
 */
function boardCornerHtml(squareSize, cols, rows) {
  let squares = '';
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isLight = (row + col) % 2 === 0;
      const color = isLight ? 'var(--color-board-light)' : 'var(--color-board-dark)';
      squares += `<div style="position:absolute; left:${col * squareSize}px; top:${row * squareSize}px; width:${squareSize}px; height:${squareSize}px; background:${color};"></div>`;
    }
  }
  return `<div style="position:absolute; right:-${squareSize}px; bottom:-${squareSize}px; width:${cols * squareSize}px; height:${rows * squareSize}px; overflow:hidden; opacity:0.9;">${squares}</div>`;
}

function ogImageHtml() {
  const faviconSvg = decodeFaviconSvg();
  const board = boardCornerHtml(60, 6, 6);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${ROOT_CSS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; }
  body {
    position: relative;
    overflow: hidden;
    background: var(--color-bg);
    font-family: var(--font-sans);
  }
  .frame {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 96px;
  }
  .mark {
    width: 72px;
    height: 72px;
    margin-bottom: 28px;
  }
  .wordmark {
    font-family: var(--font-serif);
    font-weight: var(--weight-bold);
    color: var(--color-accent-dark);
    font-size: 84px;
    line-height: var(--leading-tight);
    letter-spacing: -0.01em;
  }
  .tagline {
    font-family: var(--font-sans);
    color: var(--color-muted);
    font-size: 30px;
    line-height: var(--leading-normal);
    max-width: 780px;
    margin-top: 24px;
  }
</style></head>
<body>
  ${board}
  <div class="frame">
    <div class="mark">${faviconSvg}</div>
    <div class="wordmark">${SITE_NAME}</div>
    <div class="tagline">${SITE_TAGLINE}</div>
  </div>
</body></html>`;
}

function appleTouchIconHtml() {
  const faviconSvg = decodeFaviconSvg();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${ROOT_CSS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 180px; height: 180px; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-accent-dark);
  }
  .mark { width: 180px; height: 180px; }
  .mark svg { display: block; width: 100%; height: 100%; }
</style></head>
<body><div class="mark">${faviconSvg}</div></body></html>`;
}

/**
 * Per-pack OG image (monetization-layer spec 1.9/1.8 craft-detail item 4):
 * "the real board at the pack root plus the line count" -- never stock
 * imagery, the same craft-floor rule every other on-page image already
 * follows (design-standards.md's Imagery section). Board position is AFTER
 * the pack's own stated first move (fenAfter([firstMoveUci])) -- see
 * src/buildPackPages.js's own comment for why root.fen itself is the bare
 * starting position, not this pack's own identity position.
 */
function packOgImageHtml({ title, lineCount, fen, flip }) {
  const board = boardFromFen(fen);
  const boardHtml = `${spriteDefsHtml()}${renderBoardDiagram(board, { flip, label: `${title} position` })}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${ROOT_CSS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 72px;
    background: var(--color-bg);
    font-family: var(--font-sans);
    padding: 0 88px;
  }
  .sprite-defs-hidden { position: absolute; width: 0; height: 0; overflow: hidden; }
  .board { display: grid; grid-template-columns: repeat(8, 48px); grid-template-rows: repeat(8, 48px); width: 384px; height: 384px; border: 2px solid var(--color-accent-dark); border-radius: 8px; overflow: hidden; flex-shrink: 0; }
  .board-sq { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; }
  .board-sq--light { background: var(--color-board-light); }
  .board-sq--dark { background: var(--color-board-dark); }
  .board-piece { width: 38px; height: 38px; }
  .text { max-width: 560px; }
  .kicker { font-family: var(--font-sans); color: var(--color-muted); font-size: 22px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 14px; }
  .title { font-family: var(--font-serif); font-weight: var(--weight-bold); color: var(--color-accent-dark); font-size: 46px; line-height: 1.15; }
  .lines { font-family: var(--font-sans); color: var(--color-text); font-size: 26px; margin-top: 22px; line-height: 1.4; }
</style></head>
<body>
  ${boardHtml}
  <div class="text">
    <div class="kicker">Repertoire pack</div>
    <div class="title">${title}</div>
    <div class="lines">${lineCount.toLocaleString()} lines, picked by one published rule</div>
  </div>
</body></html>`;
}

async function screenshotHtml(browser, html, width, height, outFile) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outFile, clip: { x: 0, y: 0, width, height } });
  } finally {
    await page.close();
  }
}

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // favicon.svg: no Playwright needed -- it's the exact same vector markup
  // already inline in FAVICON_DATA_URI, just written out as a standalone
  // file instead of a data URI.
  const faviconSvgPath = path.join(ASSETS_DIR, 'favicon.svg');
  fs.writeFileSync(faviconSvgPath, decodeFaviconSvg(), 'utf8');
  console.log(`Wrote ${faviconSvgPath}`);

  const browser = await chromium.launch();
  try {
    const ogPath = path.join(ASSETS_DIR, 'og-default.png');
    await screenshotHtml(browser, ogImageHtml(), 1200, 630, ogPath);
    console.log(`Wrote ${ogPath} (1200x630)`);

    const iconPath = path.join(ASSETS_DIR, 'apple-touch-icon.png');
    await screenshotHtml(browser, appleTouchIconHtml(), 180, 180, iconPath);
    console.log(`Wrote ${iconPath} (180x180)`);

    // Repertoire Pack OG images (monetization-layer spec 1.8/1.9): one per
    // catalogue entry, real board + real line count, never stock imagery.
    // Uses the SAME cached/live Explorer fetch chain as scripts/
    // buildPacks.js and src/buildPackPages.js -- see those files' own
    // header comments for why re-running buildPackTree() here reproduces
    // byte-identical results rather than depending on packs/<id>/pack.json
    // having been generated first.
    const fetchImpl = withExplorerCache(fetch);
    const retrieved = new Date().toISOString().slice(0, 10);
    for (const def of PACK_CATALOGUE) {
      // eslint-disable-next-line no-await-in-loop -- one-off local script, serial by design (same reasoning as every other Explorer-backed builder)
      const result = await buildPackTree({ ratingBand: def.band, color: def.color, firstMoveUci: def.firstMoveUci, speeds: ['blitz', 'rapid'], fetchImpl });
      const packJson = packJsonFromResult(result, { id: def.id, title: def.title, speeds: ['blitz', 'rapid'], retrieved });
      const fen = fenAfter([def.firstMoveUci]);
      const html = packOgImageHtml({ title: def.title, lineCount: packJson.line_count, fen, flip: def.color === 'black' });
      const outPath = path.join(ASSETS_DIR, packOgImageFilename(def.id));
      // eslint-disable-next-line no-await-in-loop -- see above
      await screenshotHtml(browser, html, 1200, 630, outPath);
      console.log(`Wrote ${outPath} (1200x630, ${packJson.line_count} lines)`);
    }
  } finally {
    await browser.close();
  }

  console.log('Done. Commit the files under assets/ -- buildStatic.js copies them into dist/ on every build.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('build-og-image failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  decodeFaviconSvg,
  ogImageHtml,
  appleTouchIconHtml,
  packOgImageHtml,
};
