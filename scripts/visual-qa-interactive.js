'use strict';

/**
 * Interactive-state screenshot helper: both drill.html's session board and
 * repertoire-builder.html's #rb-workspace board are hidden behind a click
 * before they exist in the DOM, so the ordinary scripts/visual-qa.js (which
 * screenshots a URL as-loaded, no interaction) cannot see them. Not a
 * permanent addition to package.json; run directly with
 * `node scripts/visual-qa-interactive.js`.
 */

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(__dirname, '..', 'visual-qa-output');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
];

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(DIST, decodeURIComponent(urlPath));
    if (!filePath.startsWith(DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function shootDrillSession(browser, port) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(`http://127.0.0.1:${port}/drill.html`);
    // Seed a real, fresh (never-attempted) card so "Start session" is enabled.
    await page.evaluate(() => {
      window.localStorage.setItem('rb.drill.v2', JSON.stringify({
        v: 2,
        migratedV1: true,
        cards: [{
          id: 'qa-1', play: [], fen: null, answerUci: 'e2e4', answerSan: 'e4',
          side: 'white', band: '1600-1800', pool: 'blitz', openingSlug: 'qa',
          openingName: 'QA', eco: 'C50', source: 'band-meta',
          sm2: { rep: 0, ef: 2.5, intervalDays: 0, dueAt: null, lapses: 0, stuck: false },
        }],
      }));
    });
    await page.reload();
    await page.locator('#drill-start-session').click();
    await page.locator('#drill-session').waitFor({ state: 'visible' });
    await page.locator('#drill-board svg.cm-chessboard').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `drill-session-${vp.name}.png`) });
    await page.close();
    console.log(`saved drill-session-${vp.name}.png`);
  }
}

async function shootRepertoireBuilderWorkspace(browser, port) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(`http://127.0.0.1:${port}/repertoire-builder.html`);
    // src/renderRepertoireBuilder.js: #rb-create-form's submit button
    // ("Create repertoire") needs no filled name -- handleCreateSubmit
    // (repertoireBuilder.client.js) falls back to the pressed band choice /
    // checked side radio and an empty name, then calls openRepertoire()
    // which reveals #rb-workspace.
    await page.locator('#rb-create-form button[type="submit"]').click();
    await page.locator('#rb-workspace').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#rb-board svg.cm-chessboard').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `repertoire-builder-workspace-${vp.name}.png`) });
    await page.close();
    console.log(`saved repertoire-builder-workspace-${vp.name}.png`);
  }
}

async function main() {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    await shootDrillSession(browser, port);
    await shootRepertoireBuilderWorkspace(browser, port);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
