#!/usr/bin/env node
'use strict';

/**
 * CLI entry point for the bounded-prefix streaming ingest pipeline that
 * turns a Lichess database dump prefix into this site's own position/move
 * aggregate dataset.
 *
 *   node scripts/ingestDump.js --source test/fixtures/ingest/sample.pgn
 *   node scripts/ingestDump.js --month 2026-07 --games 2000000
 *
 * MEMORY MODEL, DISCLOSED (2026-08-15 OOM incident): this script's PGN
 * reading (src/ingest/pgnStream.js) and per-game position walk
 * (src/ingest/positionWalk.js) are genuinely bounded -- one game at a time,
 * discarded immediately. What is NOT bounded is src/ingest/aggregate.js's
 * AggregateBuilder: it holds every distinct position/move it has ever seen
 * in memory for the entire run (by design -- family-shard assignment is a
 * plurality vote over the whole run, so it can't be decided early and
 * flushed). A real 2026-07 full-scale run (games=8000000) hit Node's
 * default ~4GB old-space ceiling and crashed with a FATAL ERROR OOM after
 * ~19 minutes of scanning, well short of 8,000,000 games, while a same-month
 * 500,000-game smoke test had completed cleanly. Two changes landed together
 * to address this, neither of which is a claim that memory use is now
 * bounded -- it still is not, it is just no longer silently uninstrumented:
 *   1. AggregateBuilder no longer retains a dead, unused EPD string per
 *      distinct position (see src/ingest/aggregate.js's header comment).
 *   2. This script now logs gamesScanned + process.memoryUsage() every
 *      DEFAULT_PROGRESS_EVERY games (see below), and .github/workflows/
 *      ingest-dump.yml now sets NODE_OPTIONS=--max-old-space-size dynamically
 *      from the runner's own actual free memory instead of relying on
 *      Node's conservative default. A genuine incremental-flush redesign of
 *      AggregateBuilder (so memory stays roughly constant regardless of
 *      games scanned) is the real fix if a future run still OOMs even with
 *      more heap -- deliberately out of scope here: a heap-ceiling increase
 *      plus a reduced, empirically-justified games budget is a smaller,
 *      lower-risk change to verify before trusting another multi-hour run,
 *      and buys time to design the incremental-flush version properly
 *      rather than rushing it.
 *
 * IMPORTANT -- this script CAN reach the network (a `--source` that is an
 * http(s) URL, or a bare `--month` which builds the real
 * database.lichess.org dump URL) -- that code path is implemented here so
 * the design is complete and ready, not because it has been exercised.
 * Pulling several GB from a third-party donation-funded server and
 * publishing the result is a deliberate, separately-approved step, not
 * something to run casually. Every test and every manual run performed
 * while building this module used `--source <local file path>` only --
 * never a URL, never `--month` alone. If you are about to run this against
 * a URL, stop and get that separate approval first.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { iterateGames } = require('../src/ingest/pgnStream');
const { classifyGame, resultLetter } = require('../src/ingest/gameFilter');
const { walkPositions } = require('../src/ingest/positionWalk');
const { AggregateBuilder } = require('../src/ingest/aggregate');
const { writeShards } = require('../src/ingest/writeShards');
const { buildEcoCodeToFamilySlug, familySlugForGame } = require('../src/ingest/familyLookup');
const { buildEcoDataset } = require('../src/ecoData');
const { buildFamilyIndex } = require('../src/ecoFamilies');

const DEFAULT_OUT_DIR = path.join(__dirname, '..', 'data', 'aggregates');
const DEFAULT_MAX_PLIES = 16;
const DEFAULT_MIN_GAMES = 50;
const USER_AGENT = 'repertoire-builder-ingest/1 (+https://repertoire-builder.com/contact.html)';
const RETRY_DELAY_MS = 60_000;
const MAX_RETRIES = 2;
// Added 2026-08-15 with the OOM fix (see this file's header comment and
// src/ingest/aggregate.js's header comment): the run that OOM'd printed
// nothing between "observed header set" and the fatal crash, so there was
// no way to tell how many games -- or how much heap -- had been consumed
// before it died. Every DEFAULT_PROGRESS_EVERY games, run() now logs
// gamesScanned/gamesUsed plus process.memoryUsage(), so a future run (OOM
// or not) leaves a real trail instead of a silent jump from "started" to
// "crashed".
const DEFAULT_PROGRESS_EVERY = 250_000;

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT_DIR, maxPlies: DEFAULT_MAX_PLIES, minGames: DEFAULT_MIN_GAMES, games: Infinity,
    progressEvery: DEFAULT_PROGRESS_EVERY,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i += 1];
    switch (arg) {
      case '--source': args.source = next(); break;
      case '--month': args.month = next(); break;
      case '--games': args.games = Number(next()); break;
      case '--out': args.out = path.resolve(next()); break;
      case '--max-plies': args.maxPlies = Number(next()); break;
      case '--min-games': args.minGames = Number(next()); break;
      case '--progress-every': args.progressEvery = Number(next()); break;
      default:
        throw new Error(`ingestDump: unrecognized argument "${arg}"`);
    }
  }
  return args;
}

function formatMemoryUsage() {
  const m = process.memoryUsage();
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(0)}MB`;
  return `rss=${mb(m.rss)} heapUsed=${mb(m.heapUsed)} heapTotal=${mb(m.heapTotal)} external=${mb(m.external)}`;
}

function dumpUrlForMonth(month) {
  return `https://database.lichess.org/standard/lichess_db_standard_rated_${month}.pgn.zst`;
}

/**
 * Fails loudly (before any download starts) if the tooling a compressed/
 * network source needs isn't on PATH -- a fast, clear failure here instead
 * of assuming a CI runner image always has both `curl` and `zstd`, and
 * finding out only after a long download has already started.
 */
function preflightDecompressionTooling() {
  for (const bin of ['zstd', 'curl']) {
    const result = spawnSync(bin, ['--version']);
    if (result.error || result.status !== 0) {
      throw new Error(`ingestDump: preflight failed -- "${bin}" is not available on PATH. A compressed or remote --source needs both curl and zstd.`);
    }
  }
}

/**
 * Resolves `--source`/`--month` into a readable stream of raw PGN bytes,
 * plus a `destroy()` callback that genuinely stops the transfer (not just
 * reading) -- required so a game-budget cutoff actually stops bytes moving
 * off a third party's server, not just stops this process consuming them.
 *
 * Three cases:
 *  - a local path not ending ".zst": plain fs.createReadStream (this is the
 *    ONLY path any test or fixture-driven run has ever taken).
 *  - a local path ending ".zst": spawn `zstd -dc -c <path>`, stream stdout.
 *  - an http(s) URL, or bare --month (dump URL derived): preflight, then
 *    spawn `curl` piped into `zstd -dc`, one sequential GET, descriptive
 *    User-Agent, max 2 retries 60s apart. NEVER exercised so far -- see
 *    this file's header comment.
 */
function openSource({ source, month }) {
  if (!source && !month) {
    throw new Error('ingestDump: pass --source <path|url> or --month <YYYY-MM>');
  }
  const resolvedSource = source || dumpUrlForMonth(month);

  if (/^https?:\/\//i.test(resolvedSource)) {
    preflightDecompressionTooling();
    return openNetworkSource(resolvedSource);
  }
  if (resolvedSource.endsWith('.zst')) {
    preflightDecompressionTooling();
    const child = spawn('zstd', ['-dc', '-c', resolvedSource]);
    return { stream: child.stdout, destroy: () => child.kill() };
  }
  const stream = fs.createReadStream(resolvedSource);
  return { stream, destroy: () => stream.destroy() };
}

/**
 * NOT exercised so far -- see this file's header comment. Kept fully
 * implemented, not stubbed, so the future live-ingest workflow has a
 * working transport to call.
 */
function openNetworkSource(url) {
  let attempt = 0;
  const trySpawn = () => spawn('sh', ['-c', `curl -s -A "${USER_AGENT}" --retry ${MAX_RETRIES} --retry-delay ${RETRY_DELAY_MS / 1000} "${url}" | zstd -dc`]);
  const child = trySpawn();
  attempt += 1;
  return { stream: child.stdout, destroy: () => child.kill(), attempt };
}

function utcDateHeaderToIso(value) {
  // "2026.07.04" -> "2026-07-04". Tolerant of a missing/malformed value
  // (the real dump's header format has not been verified against a live
  // download -- see this file's header comment) -- returns null rather
  // than throwing, since a game we can't date should not crash the whole
  // ingest.
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function run(argv) {
  const args = parseArgs(argv);

  const { stream: source, destroy } = openSource(args);

  const ecoDataset = buildEcoDataset();
  const ecoCodeToFamilySlug = buildEcoCodeToFamilySlug({ dataDir: undefined, readFileImpl: undefined });
  const familyDisplayNames = new Map(buildFamilyIndex(ecoDataset.lines).map((f) => [f.slug, f.family]));

  const builder = new AggregateBuilder();

  let gamesScanned = 0;
  let gamesUsed = 0;
  const gamesExcluded = Object.create(null);
  let speedClassificationDisagreements = 0;
  let observedHeaderKeys = null;
  let minDate = null;
  let maxDate = null;
  let peakHeapUsedBytes = 0;

  for await (const game of iterateGames(source, { maxPlies: args.maxPlies })) {
    if (gamesScanned === 0) {
      observedHeaderKeys = Object.keys(game.headers);
      // Print the observed header set the FIRST time this ever runs
      // against a new source, so a header-set mismatch against what
      // src/ingest/gameFilter.js assumes is visible immediately rather
      // than silently mis-parsed.
      // eslint-disable-next-line no-console
      console.log(`ingestDump: observed header set (first game): ${observedHeaderKeys.join(', ')}`);
    }
    gamesScanned += 1;

    const classification = classifyGame(game.headers);
    if (!classification.include) {
      gamesExcluded[classification.reason] = (gamesExcluded[classification.reason] || 0) + 1;
    } else {
      gamesUsed += 1;
      if (classification.speedDisagreement) speedClassificationDisagreements += 1;

      const iso = utcDateHeaderToIso(game.headers.UTCDate);
      if (iso) {
        if (!minDate || iso < minDate) minDate = iso;
        if (!maxDate || iso > maxDate) maxDate = iso;
      }

      const familySlug = familySlugForGame({
        ecoCodeToFamilySlug,
        ecoHeader: game.headers.ECO,
        openingHeader: game.headers.Opening,
      });
      const nodes = walkPositions(game.movetextPrefix, { maxPlies: args.maxPlies });
      builder.addGame({
        band: classification.band,
        pool: classification.pool,
        balanced: classification.balanced,
        avgElo: classification.avgElo,
        resultLetter: resultLetter(game.headers.Result),
        nodes,
        familySlug,
      });
    }

    if (args.progressEvery > 0 && gamesScanned % args.progressEvery === 0) {
      const heapUsed = process.memoryUsage().heapUsed;
      if (heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = heapUsed;
      // eslint-disable-next-line no-console
      console.log(`ingestDump: progress gamesScanned=${gamesScanned} gamesUsed=${gamesUsed} ${formatMemoryUsage()}`);
    }

    if (gamesScanned >= args.games) {
      destroy();
      break;
    }
  }
  {
    const heapUsed = process.memoryUsage().heapUsed;
    if (heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = heapUsed;
  }

  const finalized = builder.finalize({ minGames: args.minGames });

  const manifestFields = {
    pipelineVersion: 1,
    dumpMonths: args.month ? [args.month] : [],
    retrievedAt: new Date().toISOString(),
    observedGameDateRange: [minDate, maxDate],
    gamesScanned,
    gamesUsed,
    gamesExcluded,
    speedClassificationDisagreements,
    maxPlies: args.maxPlies,
    minGames: args.minGames,
    bands: ['u1200', '1200-1400', '1400-1600', '1600-1800', '1800-2000', '2000+'],
    pools: ['bullet', 'blitz', 'rapid_classical'],
    balancedEloWindow: 50,
    // Added with the 2026-08-15 OOM fix -- the highest process.memoryUsage()
    // .heapUsed observed at any progress checkpoint (see DEFAULT_PROGRESS_EVERY
    // above) during this run, in MB. Informational only (nothing downstream
    // reads it), kept on the manifest so a run's actual peak memory is on
    // permanent record next to its gamesScanned/games budget, not just in a
    // GitHub Actions log that eventually ages out.
    peakHeapUsedMB: Math.round(peakHeapUsedBytes / (1024 * 1024)),
  };

  const { manifest, shardFiles } = writeShards({
    outDir: args.out,
    finalized,
    familyDisplayNames,
    manifestFields,
  });

  // eslint-disable-next-line no-console
  console.log(`ingestDump: gamesScanned=${gamesScanned} gamesUsed=${gamesUsed} positions=${finalized.positionCount} filteredBelowMinGames=${finalized.filteredCount}`);
  // eslint-disable-next-line no-console
  console.log(`ingestDump: peak heapUsed during scan = ${manifestFields.peakHeapUsedMB}MB (final: ${formatMemoryUsage()})`);
  for (const shard of shardFiles) {
    // eslint-disable-next-line no-console
    console.log(`ingestDump: shard ${shard.file} -- ${shard.bytes} bytes, ${shard.positions} positions`);
  }
  if (minDate && maxDate) {
    // eslint-disable-next-line no-console
    console.log(`ingestDump: observed game date range ${minDate} .. ${maxDate}`);
  }

  return { manifest, shardFiles, gamesScanned, gamesUsed };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`ingestDump: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, dumpUrlForMonth, utcDateHeaderToIso, openSource, run };
