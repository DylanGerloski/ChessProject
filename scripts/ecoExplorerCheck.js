'use strict';

/**
 * Manual verification script for T3, the interactive ECO explorer (Phase
 * 7e) -- same category as scripts/boardWidgetCheck.js/scripts/visual-qa.js:
 * a real-browser check too heavy (or, here, deliberately file://-specific)
 * for the fast `npm test` suite. Run by hand, AFTER a real
 * `node src/buildStatic.js`:
 *
 *   node scripts/ecoExplorerCheck.js
 *
 * Drives the REAL built dist/eco-explorer.html directly over a file:// URL
 * (not a served http:// copy -- that is the whole point of this script:
 * npm run visual-qa's throwaway http server would make the reverse-lookup
 * fetch() succeed, silently hiding whether the file://-opened-from-disk
 * degradation path actually works). Verifies:
 *   - the page loads with no uncaught JS errors under file://
 *   - search/filter finds real results by name, ECO code, and move text
 *   - selecting a result mounts a real replay board
 *   - free-play (clicking two squares) is accepted
 *   - FEN paste identifies (or honestly reports it cannot, offline) a position
 *   - PGN paste mounts the game
 *   - a PGN tag value containing HTML never becomes a DOM element (textContent
 *     rule, security-standards.md) -- checked by asserting zero <img> elements
 *     exist after submitting one
 *   - an oversized PGN and a maliciously deep-nested PGN are BOTH rejected
 *     quickly (no tab freeze) with a plain-text error message
 *   - the file://-declared exception itself: identification honestly
 *     reports "needs a network connection" rather than hanging or crashing
 *
 * Exits non-zero (with a printed reason) on any assertion failure.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const EXPLORER_PATH = path.join(DIST_DIR, 'eco-explorer.html');

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
  if (!fs.existsSync(EXPLORER_PATH)) {
    console.error(`${EXPLORER_PATH} does not exist -- run "node src/buildStatic.js" first.`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`file://${EXPLORER_PATH.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  check('no uncaught page errors on load (file:// URL)', pageErrors.length === 0 || (() => { console.error(pageErrors); return false; })());

  // --- initial state: free board mounted from the starting position -------
  const initialSquares = await page.locator('#explorer-board-mount .square').count();
  check('a board is mounted on initial load (free-play from start)', initialSquares === 64);

  // --- search by name -------------------------------------------------------
  await page.locator('#explorer-search-input').fill('najdorf');
  await page.waitForTimeout(200);
  const najdorfRows = await page.locator('#explorer-results tbody tr').count();
  check('searching "najdorf" returns at least one result', najdorfRows > 0);
  const najdorfText = await page.locator('#explorer-results').innerText();
  check('a najdorf result mentions "Najdorf"', /najdorf/i.test(najdorfText));

  // --- search by ECO code ---------------------------------------------------
  await page.locator('#explorer-search-input').fill('B90');
  await page.waitForTimeout(200);
  const b90Text = await page.locator('#explorer-results').innerText();
  check('searching "B90" returns a result carrying the B90 chip', /B90/.test(b90Text));

  // --- search by move sequence ----------------------------------------------
  await page.locator('#explorer-search-input').fill('Nf3 d6');
  await page.waitForTimeout(200);
  const moveRows = await page.locator('#explorer-results tbody tr').count();
  check('searching by a move sequence ("Nf3 d6") returns at least one result', moveRows > 0);

  // --- selecting a result mounts a replay board -----------------------------
  await page.locator('#explorer-search-input').fill('Italian Game');
  await page.waitForTimeout(200);
  await page.locator('#explorer-results tbody tr button.explorer-result-name').first().click();
  await page.waitForTimeout(200);
  const currentLineAfterSelect = await page.locator('#explorer-current-line').innerText();
  check('selecting a result updates the current-line status text', currentLineAfterSelect.length > 0);
  const replayControlsCount = await page.locator('#explorer-board-mount .board-replay-controls').count();
  check('selecting a result mounts a replay board (with replay controls)', replayControlsCount === 1);

  // --- free play: a legal move is accepted ----------------------------------
  await page.locator('#explorer-search-input').fill('');
  await page.waitForTimeout(100);
  // Reload to get back to a clean free-play board (search selection above swapped to replay mode).
  await page.goto(`file://${EXPLORER_PATH.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.locator('#explorer-board-mount rect.square[data-square="e2"]').click();
  await page.locator('#explorer-board-mount rect.square[data-square="e4"]').click();
  await page.waitForTimeout(200);
  const afterMove = await page.locator('#explorer-current-line').innerText();
  check('a legal free-play move (e2-e4) is accepted and reported', afterMove.includes('e4'));

  // --- identify degrades honestly under file:// (the declared exception) ---
  await page.waitForTimeout(500); // give the lazy fetch() attempt time to fail
  const identifyText = await page.locator('#explorer-identify-status').innerText();
  check('identify status is non-empty and does not silently hang', identifyText.length > 0);
  check('identify status honestly reports the offline/file:// limitation rather than crashing', /network connection|Not a named position|Identified/i.test(identifyText));

  // --- FEN paste --------------------------------------------------------------
  // The FEN/PGN inputs live inside a <details> (design-standards.md:
  // collapsed by default, "Identify a position from a FEN or PGN"), so it
  // must be opened first -- Playwright's actionability checks correctly
  // refuse to fill/click a hidden (collapsed-details) element.
  await page.locator('.explorer-paste summary').click();
  await page.waitForTimeout(100);
  await page.locator('#explorer-fen-input').fill('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  await page.locator('#explorer-fen-submit').click();
  await page.waitForTimeout(300);
  const squaresAfterFen = await page.locator('#explorer-board-mount .square').count();
  check('a valid pasted FEN mounts a board', squaresAfterFen === 64);

  // --- invalid FEN is rejected via a plain-text error, never HTML -----------
  await page.locator('#explorer-fen-input').fill('this is not a fen');
  await page.locator('#explorer-fen-submit').click();
  await page.waitForTimeout(100);
  const fenErrorText = await page.locator('#explorer-paste-error').innerText();
  check('an invalid FEN shows a plain-language error', fenErrorText.length > 0 && !/</.test(fenErrorText));
  const fenErrorChildren = await page.locator('#explorer-paste-error').evaluate((el) => el.children.length);
  check('the FEN error message has zero child elements (textContent-only rendering)', fenErrorChildren === 0);

  // --- valid PGN paste mounts the game ---------------------------------------
  await page.locator('#explorer-pgn-input').fill('[Event "Test Game"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
  await page.locator('#explorer-pgn-submit').click();
  await page.waitForTimeout(300);
  const currentLineAfterPgn = await page.locator('#explorer-current-line').innerText();
  check('a valid pasted PGN updates the current-line status with the players\' names', currentLineAfterPgn.includes('Alice') && currentLineAfterPgn.includes('Bob'));

  // --- a PGN tag value containing HTML is rendered as text, never executed --
  await page.locator('#explorer-pgn-input').fill('[Event "<img src=x onerror=alert(1)>"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 *');
  await page.locator('#explorer-pgn-submit').click();
  await page.waitForTimeout(300);
  const imgCountAfterMaliciousPgn = await page.locator('img').count();
  check('an <img onerror> PGN tag value never becomes a real DOM <img> element', imgCountAfterMaliciousPgn === 0);
  const currentLineAfterMaliciousPgn = await page.locator('#explorer-current-line').innerText();
  check('the malicious tag value appears as literal, inert text', currentLineAfterMaliciousPgn.includes('<img src=x onerror=alert(1)>'));

  // --- oversized PGN is rejected quickly, no tab freeze -----------------------
  const oversized = `1. e4 e5 ${'x'.repeat(300 * 1024)}`;
  await page.locator('#explorer-pgn-input').fill(oversized);
  const startOversized = Date.now();
  await page.locator('#explorer-pgn-submit').click();
  await page.waitForFunction(
    () => document.getElementById('explorer-paste-error').textContent.length > 0,
    { timeout: 5000 }
  );
  const oversizedElapsedMs = Date.now() - startOversized;
  const oversizedErrorText = await page.locator('#explorer-paste-error').innerText();
  check('an oversized PGN is rejected within 5s (no freeze)', oversizedElapsedMs < 5000);
  check('an oversized PGN shows a plain "too large" message', /too large/i.test(oversizedErrorText));

  // --- maliciously deep-nested PGN is rejected quickly, no tab freeze --------
  const deepNested = `1. e4 ${'('.repeat(5000)}${')'.repeat(5000)}`;
  await page.locator('#explorer-pgn-input').fill(deepNested);
  const startNested = Date.now();
  await page.locator('#explorer-pgn-submit').click();
  await page.waitForFunction(
    () => document.getElementById('explorer-paste-error').textContent.length > 0,
    { timeout: 5000 }
  );
  const nestedElapsedMs = Date.now() - startNested;
  const nestedErrorText = await page.locator('#explorer-paste-error').innerText();
  check('a deeply-nested malicious PGN is rejected within 5s (no freeze/stack overflow)', nestedElapsedMs < 5000);
  check('a deeply-nested malicious PGN shows a plain nesting-related message', /nest/i.test(nestedErrorText));

  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

main().catch((err) => {
  console.error('ecoExplorerCheck crashed:', err);
  process.exitCode = 1;
});
