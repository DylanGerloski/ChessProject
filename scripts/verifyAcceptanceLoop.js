'use strict';
/**
 * End-to-end acceptance-loop check: drives a real browser (playwright)
 * against a built dist/ output the same way a visitor would, covering the
 * full chain a single individual feature's own tests can't see end to end:
 *   1. Opening report: enter a Lichess username, fetch, view leaks, and
 *      confirm the leak report is saved for the drill page to pick up.
 *   2. Drill: seed cards from the saved leak report, start a session,
 *      verify no spoiler pre-attempt (no candidate table, no data-uci
 *      anywhere in the DOM), answer/reveal, verify the candidate table
 *      DOES appear after that.
 *   3. Repertoire builder: create a repertoire and export a real PGN file.
 *   4. Band persistence: change the band on one page, confirm it carries
 *      over on navigation to the other band-aware pages.
 *
 * Usage: node scripts/verifyAcceptanceLoop.js [distDir] [lichessUsername]
 *   distDir defaults to ./dist (must already be built: npm run build:static)
 *   lichessUsername defaults to a placeholder; if the live Lichess fetch
 *   for that username doesn't produce a usable report (rate limit,
 *   concurrency contention, or an account with too few games at a covered
 *   position), this script automatically falls back to a route-intercepted
 *   synthetic games response so the run still exercises the REAL
 *   client-side leak-analysis/rendering code deterministically, and says
 *   so plainly in its output rather than silently passing on live data.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const DIST_DIR = process.argv[2] || path.join(__dirname, '..', 'dist');
const USERNAME = process.argv[3] || 'DrNykterstein';

function serveDist(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(dir, urlPath);
      if (!filePath.startsWith(dir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found: ' + urlPath);
          return;
        }
        const ext = path.extname(filePath);
        const type = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      });
    });
    server.listen(0, 'localhost', () => resolve(server));
  });
}

/**
 * Builds a realistic /api/games/user NDJSON body matching the exact shape
 * src/leakAnalysis.js's parseGameLine() requires (id, moves as a SAN
 * string, players.white/black.user.name, winner) -- used only as a
 * fallback when the real Lichess API is unavailable (rate limit /
 * concurrency contention), so the REAL client-side leak-analysis code
 * still runs end to end against realistic data instead of the flow being
 * left unverified.
 */
function buildSyntheticGamesNdjson(username, count) {
  const lines = [];
  // Two real opening lines this codebase treats as flagship-covered
  // (Italian Game, used throughout render.js/renderDrill.js's own
  // fixtures/comments) so band-coverage lookups have real data to match
  // against. The user loses the majority of the Sicilian-flavoured games
  // on purpose, to exercise real leak detection (a below-band win rate at
  // a covered position), not just the "no leaks" empty state.
  const goodLine = 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 d6 c3 O-O';
  const leakyLine = 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2 e5';
  for (let i = 0; i < count; i += 1) {
    const userIsWhite = i % 2 === 0;
    const isGoodLine = i % 3 !== 0; // 2/3 Italian (mostly wins), 1/3 Sicilian (mostly losses)
    const moves = isGoodLine ? goodLine : leakyLine;
    // User wins most Italian games, loses most Sicilian-side games -- a
    // realistic, deliberately leaky sample.
    const userWins = isGoodLine ? i % 5 !== 0 : i % 4 === 0;
    const winnerColor = userWins ? (userIsWhite ? 'white' : 'black') : (userIsWhite ? 'black' : 'white');
    lines.push(JSON.stringify({
      id: `synth${String(i).padStart(4, '0')}`,
      rated: true,
      variant: 'standard',
      speed: 'blitz',
      createdAt: 1717000000000 + i * 100000,
      moves,
      winner: winnerColor,
      players: {
        white: { user: { name: userIsWhite ? username : 'Opponent' + i, id: (userIsWhite ? username : 'opponent' + i).toLowerCase() }, rating: 1550 + (i % 50) },
        black: { user: { name: userIsWhite ? 'Opponent' + i : username, id: (userIsWhite ? 'opponent' + i : username).toLowerCase() }, rating: 1550 + (i % 50) },
      },
    }));
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const results = { pass: [], fail: [] };
  function check(label, ok, detail) {
    if (ok) {
      results.pass.push(label);
      console.log('PASS:', label, detail || '');
    } else {
      results.fail.push(label + (detail ? ' -- ' + detail : ''));
      console.log('FAIL:', label, detail || '');
    }
  }

  const server = await serveDist(DIST_DIR);
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [browser console error]', msg.text());
  });
  page.on('pageerror', (err) => console.log('  [browser pageerror]', err.message));

  // ---------------------------------------------------------------------
  // 1. Opening report: real Lichess username -> leak report
  // ---------------------------------------------------------------------
  await page.goto(`${base}/opening-report.html`, { waitUntil: 'networkidle' });
  await page.fill('#report-username', USERNAME);
  await page.click('#report-form button[type="submit"]');
  // Wait for either a result render or an explicit error state, up to 30s
  // (real network call to lichess.org).
  await page.waitForFunction(
    () => {
      const el = document.getElementById('report-result');
      return el && el.textContent && el.textContent.trim().length > 0;
    },
    { timeout: 30000 }
  ).catch(() => {});
  let reportText = await page.$eval('#report-result', (el) => el.textContent).catch(() => '');
  check('opening report: real Lichess fetch attempt produced a non-empty result panel', reportText.trim().length > 0, `len=${reportText.trim().length}`);

  const liveErrorState = /status-message--error/.test(await page.$eval('#report-result', (el) => el.innerHTML).catch(() => ''));
  if (liveErrorState) {
    console.log('  live Lichess fetch did not produce usable data (rate limit / concurrency contention on this shared machine, or account data shape) -- falling back to a route-intercepted synthetic games response to still exercise the REAL client-side leak-analysis + rendering pipeline end to end, deterministically. Live attempt text:', reportText.trim());
    const syntheticGames = buildSyntheticGamesNdjson(USERNAME, 40);
    await page.route('**/api/games/user/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: syntheticGames });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('#report-username', USERNAME);
    await page.click('#report-form button[type="submit"]');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('report-result');
        return el && el.textContent && el.textContent.trim().length > 0;
      },
      { timeout: 15000 }
    ).catch(() => {});
    reportText = await page.$eval('#report-result', (el) => el.textContent).catch(() => '');
    const stillError = /status-message--error/.test(await page.$eval('#report-result', (el) => el.innerHTML).catch(() => ''));
    check('opening report: route-intercepted synthetic-data fallback produced a real (non-error) rendered report', !stillError, `text: ${reportText.trim().slice(0, 200)}`);
  }

  const leakReportRaw = await page.evaluate(() => {
    try { return window.localStorage.getItem('rb.leakReport.v1'); } catch (e) { return null; }
  });
  check('opening report: saved leak report to localStorage (rb.leakReport.v1)', !!leakReportRaw, leakReportRaw ? `${leakReportRaw.length} bytes` : 'null');
  let leakCount = null;
  if (leakReportRaw) {
    try {
      const parsed = JSON.parse(leakReportRaw);
      leakCount = (parsed.leaks || []).length;
    } catch (e) { /* ignore */ }
  }
  console.log('  leak count in saved report:', leakCount, '(0 is a valid outcome for a strong/low-game-count account)');

  // ---------------------------------------------------------------------
  // 2. Drill: seed from the saved report, verify spoiler-safety, answer
  // ---------------------------------------------------------------------
  await page.goto(`${base}/drill.html`, { waitUntil: 'networkidle' });
  const seedBtn = await page.$('#drill-seed-report-btn');
  check('drill hub: "add leak cards to deck" button appears after a saved report', !!seedBtn);
  if (seedBtn) {
    await seedBtn.click();
    await page.waitForTimeout(300);
  }
  // Also seed from band metadata directly (works even if the leak report
  // seeding produced zero cards, e.g. a strong player / small sample).
  const seedFormPresent = await page.$('#drill-seed-form');
  if (seedFormPresent) {
    const optionCount = await page.$$eval('#drill-seed-opening option', (opts) => opts.length);
    if (optionCount > 1) {
      await page.selectOption('#drill-seed-opening', { index: 1 });
      await page.click('#drill-seed-form button[type="submit"]');
      await page.waitForTimeout(1500);
    }
  }
  const dueCount = await page.$eval('#drill-due-count', (el) => el.textContent).catch(() => null);
  console.log('  due count after seeding:', dueCount);

  const startBtn = await page.$('#drill-start-session');
  const startBtnEnabled = startBtn ? await startBtn.isEnabled() : false;
  check('drill hub: start-session button present and enabled after seeding', startBtnEnabled);

  if (startBtnEnabled) {
    await page.click('#drill-start-session');
    await page.waitForTimeout(500);

    // SPOILER CHECK: before any attempt, the candidate table must contain
    // no real move data -- only the placeholder empty-note, no <table>.
    const candidateHtmlPre = await page.$eval('#drill-candidate-table', (el) => el.innerHTML).catch(() => '');
    const hasTablePre = /<table/i.test(candidateHtmlPre);
    check('drill session: candidate table has NO <table> markup before any attempt (spoiler rule)', !hasTablePre, hasTablePre ? 'FOUND A TABLE PRE-ATTEMPT' : 'placeholder only');

    // Also check the full page HTML (view-source equivalent) for a leaked
    // answer: no data-uci attribute values should be present pre-attempt
    // anywhere in the DOM (candidate rows carry data-uci).
    const fullHtmlPre = await page.content();
    const hasDataUciPre = /data-uci="[^"]+"/.test(fullHtmlPre);
    check('drill session: no data-uci (answer) attributes anywhere in the DOM before an attempt', !hasDataUciPre, hasDataUciPre ? 'data-uci found pre-attempt' : 'none found');

    // Make an attempt: type a plausible move and submit. Any move is fine
    // for this check -- we're verifying reveal-after-attempt, not correctness.
    const moveInput = await page.$('#drill-move-text');
    if (moveInput) {
      await moveInput.fill('e4');
      const moveForm = await page.$('#drill-move-form');
      if (moveForm) {
        await page.click('#drill-move-form button[type="submit"]').catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    // If the move field didn't exist or grading didn't fire, force a reveal
    // via the explicit "show answer" affordance -- both are legitimate
    // reveal triggers per the spoiler rule.
    const showAnswerBtn = await page.$('#drill-show-answer');
    if (showAnswerBtn) {
      const disabled = await showAnswerBtn.isDisabled().catch(() => false);
      if (!disabled) {
        await showAnswerBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    const candidateHtmlPost = await page.$eval('#drill-candidate-table', (el) => el.innerHTML).catch(() => '');
    const hasTablePost = /<table/i.test(candidateHtmlPost);
    check('drill session: candidate table DOES reveal (has <table>) after an attempt/explicit reveal', hasTablePost, hasTablePost ? 'table present' : 'still no table -- check selectors');
  }

  // ---------------------------------------------------------------------
  // 3. Repertoire builder: create, add a move, export PGN
  // ---------------------------------------------------------------------
  await page.goto(`${base}/repertoire-builder.html`, { waitUntil: 'networkidle' });
  await page.fill('#rb-name-input', 'Acceptance Test Repertoire');
  const whiteChoice = await page.$('.rb-band-choice[data-band]');
  await page.click('#rb-create-form button[type="submit"]');
  await page.waitForTimeout(500);
  const workspaceVisible = await page.$eval('#rb-workspace', (el) => !el.hidden).catch(() => false);
  check('repertoire builder: creating a repertoire opens the workspace (board + tree)', workspaceVisible);

  // Try to add one real move via a candidate-move button in the band panel.
  const moveBtn = await page.$('#rb-band-table-wrapper button[data-uci], #rb-band-table-wrapper table tbody tr');
  if (moveBtn) {
    // Prefer an explicit clickable row/button if present.
    const clickable = await page.$('#rb-band-panel button');
    if (clickable) await clickable.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  let downloadedPgn = null;
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.click('#rb-export-btn'),
    ]);
    const streamPath = await download.path();
    downloadedPgn = fs.readFileSync(streamPath, 'utf8');
  } catch (err) {
    console.log('  export download capture failed:', err.message);
  }
  check('repertoire builder: export produces a downloadable PGN file with content', !!downloadedPgn && downloadedPgn.length > 0, downloadedPgn ? `${downloadedPgn.length} bytes, starts: ${JSON.stringify(downloadedPgn.slice(0, 60))}` : 'no download captured');

  // ---------------------------------------------------------------------
  // 4. Band persistence: set a band on the builder page, confirm it
  //    carries over to repertoire.html after navigation.
  // ---------------------------------------------------------------------
  const bandSelect = await page.$('[data-band-header-control]');
  let setBand = null;
  if (bandSelect) {
    const options = await page.$$eval('[data-band-header-control] option', (opts) => opts.map((o) => o.value));
    const currentVal = await page.$eval('[data-band-header-control]', (el) => el.value);
    setBand = options.find((v) => v !== currentVal) || currentVal;
    await page.selectOption('[data-band-header-control]', setBand);
    await page.waitForTimeout(300);
  }
  check('band header control: present on repertoire-builder.html', !!bandSelect);

  await page.goto(`${base}/repertoire.html`, { waitUntil: 'networkidle' });
  const bandOnRepertoirePage = await page.$eval('[data-band-header-control]', (el) => el.value).catch(() => null);
  check('band persistence: band chosen on builder page carries over to repertoire.html', bandOnRepertoirePage === setBand, `set=${setBand}, read-back=${bandOnRepertoirePage}`);

  await page.goto(`${base}/opening-report.html`, { waitUntil: 'networkidle' });
  const bandOnReportPage = await page.$eval('[data-band-header-control]', (el) => el.value).catch(() => null);
  check('band persistence: band also carries over to opening-report.html', bandOnReportPage === setBand, `set=${setBand}, read-back=${bandOnReportPage}`);

  await page.goto(`${base}/drill.html`, { waitUntil: 'networkidle' });
  const bandOnDrillPage = await page.$eval('[data-band-header-control]', (el) => el.value).catch(() => null);
  check('band persistence: band also carries over to drill.html', bandOnDrillPage === setBand, `set=${setBand}, read-back=${bandOnDrillPage}`);

  await browser.close();
  server.close();

  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${results.pass.length}  FAIL: ${results.fail.length}`);
  if (results.fail.length) {
    console.log('Failures:');
    results.fail.forEach((f) => console.log('  -', f));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('SCRIPT ERROR:', err);
  process.exitCode = 1;
});
