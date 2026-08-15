'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, utcDateHeaderToIso, openSource, run } = require('../scripts/ingestDump');
const { MAX_SHARD_BYTES } = require('../src/ingest/writeShards');
const { ROOT_MAX_PLY } = require('../src/ingest/aggregate');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ingest', 'sample.pgn');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-dump-'));
}

test('parseArgs: rejects an unrecognized flag rather than silently ignoring it', () => {
  assert.throws(() => parseArgs(['--bogus', 'x']), /unrecognized argument/);
});

test('parseArgs: applies defaults', () => {
  const args = parseArgs(['--source', 'foo.pgn']);
  assert.equal(args.maxPlies, 16);
  assert.equal(args.minGames, 50);
  assert.equal(args.games, Infinity);
});

test('utcDateHeaderToIso: converts the dump\'s dotted date format', () => {
  assert.equal(utcDateHeaderToIso('2026.07.04'), '2026-07-04');
  assert.equal(utcDateHeaderToIso('garbage'), null);
  assert.equal(utcDateHeaderToIso(undefined), null);
});

test('openSource: a local non-.zst path opens a plain fs.createReadStream (never spawns curl/zstd)', () => {
  const { stream, destroy } = openSource({ source: FIXTURE_PATH });
  assert.equal(typeof stream.pipe, 'function');
  destroy();
});

test('openSource: throws when neither --source nor --month is given', () => {
  assert.throws(() => openSource({}), /pass --source/);
});

test('run(): produces a valid manifest + root shard from a small inline fixture, entirely offline', async () => {
  const dir = tmpDir();
  const pgnPath = path.join(dir, 'mini.pgn');
  const pgn = [
    '[Event "Rated Blitz game"]',
    '[Result "1-0"]',
    '[UTCDate "2026.07.01"]',
    '[WhiteElo "1650"]',
    '[BlackElo "1670"]',
    '[ECO "C50"]',
    '[Opening "Italian Game"]',
    '[TimeControl "180+2"]',
    '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 1-0',
    '',
    '[Event "Rated Blitz game"]',
    '[Result "0-1"]',
    '[UTCDate "2026.07.02"]',
    '[WhiteElo "1600"]',
    '[BlackElo "1640"]',
    '[ECO "C50"]',
    '[Opening "Italian Game"]',
    '[TimeControl "180+2"]',
    '',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 0-1',
    '',
    // Excluded: correspondence.
    '[Event "Rated Correspondence game"]',
    '[Result "1-0"]',
    '[WhiteElo "1600"]',
    '[BlackElo "1600"]',
    '[TimeControl "-"]',
    '',
    '1. d4 d5 1-0',
    '',
  ].join('\n');
  fs.writeFileSync(pgnPath, pgn, 'utf8');

  const outDir = path.join(dir, 'out');
  const result = await run(['--source', pgnPath, '--out', outDir, '--min-games', '1']);

  assert.equal(result.gamesScanned, 3);
  assert.equal(result.gamesUsed, 2);
  assert.ok(fs.existsSync(path.join(outDir, 'root.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'manifest.json')));

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.gamesScanned, 3);
  assert.equal(manifest.gamesUsed, 2);
  assert.equal(manifest.gamesExcluded.correspondence, 1);
  assert.ok(Array.isArray(manifest.shards) && manifest.shards.length >= 1);
  assert.deepEqual(manifest.observedGameDateRange, ['2026-07-01', '2026-07-02']);

  const root = JSON.parse(fs.readFileSync(path.join(outDir, 'root.json'), 'utf8'));
  const rec = root.positions['1600-1800'].blitz;
  assert.ok(Object.keys(rec).length > 0);
});

test('run(): the --games budget stops scanning early', async () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  const result = await run(['--source', FIXTURE_PATH, '--out', outDir, '--min-games', '1', '--games', '10']);
  assert.equal(result.gamesScanned, 10);
});

test('run(): the full committed synthetic fixture produces valid shards + manifest end to end', async () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  // --min-games 1 here (not the production default of 50) is a deliberate
  // test-scale override -- see TESTING.md: a 200-500 game fixture spread
  // across 6 bands x 3 pools never reaches 50 games in any one (band,
  // pool, position) bucket, so MIN_GAMES=50 would correctly filter the
  // fixture down to nothing. The production default stays 50 (asserted
  // separately below).
  const result = await run(['--source', FIXTURE_PATH, '--out', outDir, '--min-games', '1']);

  assert.ok(result.gamesScanned >= 300);
  assert.ok(result.gamesUsed > 0);
  assert.ok(result.gamesUsed < result.gamesScanned); // the fixture deliberately includes excludable games

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.shards.length >= 1);
  for (const shard of manifest.shards) {
    assert.ok(fs.existsSync(path.join(outDir, shard.file)));
    const bytes = fs.statSync(path.join(outDir, shard.file)).size;
    assert.equal(bytes, shard.bytes);
  }

  // Data-sanity spot check (a lightweight version of what a dedicated
  // verification script will do exhaustively): every stored w+d+l for a
  // position is internally consistent with its balanced subset.
  const root = JSON.parse(fs.readFileSync(path.join(outDir, 'root.json'), 'utf8'));
  for (const byPool of Object.values(root.positions)) {
    for (const byPosKey of Object.values(byPool)) {
      for (const record of Object.values(byPosKey)) {
        const [w, d, l, bw, bd, bl] = record;
        assert.ok(w >= 0 && d >= 0 && l >= 0);
        assert.ok(bw <= w && bd <= d && bl <= l); // balanced subset never exceeds the full count
      }
    }
  }
});

test('run(): defaults to MIN_GAMES=50 in production (unset --min-games), which filters this small fixture down to zero positions', async () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  const result = await run(['--source', FIXTURE_PATH, '--out', outDir]);
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.minGames, 50);
  assert.ok(result.gamesUsed > 0); // games were still read/classified correctly
});

// Regression coverage for the 2026-08-15 root.json-over-budget fix: a real
// smoke-scale run (500000 games) at the previous ROOT_MAX_PLY (6) produced a
// root.json of 10,999,304 bytes against writeShards.js's 5 MB
// MAX_SHARD_BYTES budget. This fixture is far too small to reproduce that
// absolute number (see the "defaults to MIN_GAMES=50" test above -- at the
// production MIN_GAMES=50 this fixture yields zero positions), but
// `--min-games 1` (the worst case: no filtering at all) is the closest this
// fixture gets to stress-testing root.json's size, and it must stay well
// under budget at the current ROOT_MAX_PLY -- if this ever fails, either
// ROOT_MAX_PLY crept back up without re-checking the real-scale budget, or
// the shard format grew heavier per position and the same reconsideration
// applies.
test('run(): root.json stays comfortably under MAX_SHARD_BYTES at fixture scale, unfiltered', async () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  await run(['--source', FIXTURE_PATH, '--out', outDir, '--min-games', '1']);

  const rootBytes = fs.statSync(path.join(outDir, 'root.json')).size;
  assert.ok(
    rootBytes < MAX_SHARD_BYTES * 0.5,
    `root.json is ${rootBytes} bytes at fixture scale (${ROOT_MAX_PLY}-ply root) -- ` +
    `expected well under half of MAX_SHARD_BYTES (${MAX_SHARD_BYTES}) here, since this ` +
    'is only a ~300-game fixture, not the 500k-game scale the real budget is sized for',
  );
});

test('aggregate: ROOT_MAX_PLY stays at or below the value verified safe for the 500k-game smoke scale (see src/ingest/aggregate.js header comment) -- a regression guard against silently raising root.json tree depth back toward the over-budget value (6) without re-checking against a fresh smoke-test run', () => {
  assert.ok(
    ROOT_MAX_PLY <= 3,
    `ROOT_MAX_PLY is ${ROOT_MAX_PLY} -- raising it above 3 needs a fresh smoke-test run ` +
    'confirming root.json stays under MAX_SHARD_BYTES at real (500k+ game) scale first',
  );
});
