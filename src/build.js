'use strict';

/**
 * Static-site entry point: fetch -> process -> render -> write to disk.
 * Usage: node src/build.js <lichess-username>
 */

const fs = require('fs');
const path = require('path');
const { fetchRatingHistory, fetchRecentGames, LichessNotFoundError, LichessRateLimitError } = require('./fetchLichess');
const { summarizeRatingHistory, summarizeGames } = require('./process');
const { renderPlayerPage } = require('./render');

async function buildPlayerPage(username) {
  const [history, games] = await Promise.all([
    fetchRatingHistory(username),
    fetchRecentGames(username, { max: 15 }),
  ]);

  const ratingRows = summarizeRatingHistory(history);
  const gameSummary = summarizeGames(games, username);

  return renderPlayerPage({ username, ratingRows, gameSummary });
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node src/build.js <lichess-username>');
    process.exitCode = 1;
    return;
  }

  try {
    const html = await buildPlayerPage(username);
    const outDir = path.join(__dirname, '..', 'dist');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'index.html');
    fs.writeFileSync(outFile, html, 'utf8');
    console.log(`Wrote ${outFile}`);
    console.log('Open it in a browser, e.g.:');
    console.log(`  start "" "${outFile}"`);
  } catch (err) {
    if (err instanceof LichessNotFoundError) {
      console.error(`No such Lichess user: ${username}`);
    } else if (err instanceof LichessRateLimitError) {
      console.error('Lichess API rate limit hit, try again shortly.');
    } else {
      console.error('Build failed:', err.message);
    }
    // Set the exit code but let Node drain its event loop naturally instead
    // of forcing process.exit() here -- calling it immediately after a
    // Promise.all() where one fetch rejected while a sibling fetch is still
    // in flight can abort that request's handle mid-transition and crash
    // the process with a native libuv assertion on some Node builds.
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildPlayerPage };
