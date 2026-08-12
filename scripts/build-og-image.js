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
const { DESIGN_TOKENS, FAVICON_DATA_URI } = require('../src/render');
const { SITE_NAME, SITE_TAGLINE } = require('../src/site');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const T = DESIGN_TOKENS;

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
      const color = isLight ? T['--color-board-light'] : T['--color-board-dark'];
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
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; }
  body {
    position: relative;
    overflow: hidden;
    background: ${T['--color-bg']};
    font-family: ${T['--font-sans']};
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
    font-family: ${T['--font-serif']};
    font-weight: ${T['--weight-bold']};
    color: ${T['--color-accent-dark']};
    font-size: 84px;
    line-height: ${T['--leading-tight']};
    letter-spacing: -0.01em;
  }
  .tagline {
    font-family: ${T['--font-sans']};
    color: ${T['--color-muted']};
    font-size: 30px;
    line-height: ${T['--leading-normal']};
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
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 180px; height: 180px; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${T['--color-accent-dark']};
  }
  .mark { width: 180px; height: 180px; }
  .mark svg { display: block; width: 100%; height: 100%; }
</style></head>
<body><div class="mark">${faviconSvg}</div></body></html>`;
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
  } finally {
    await browser.close();
  }

  console.log('Done. Commit the three files under assets/ -- buildStatic.js copies them into dist/ on every build.');
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
};
