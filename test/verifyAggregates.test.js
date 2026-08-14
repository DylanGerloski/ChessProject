'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateCounts,
  checkShardRecordIntegrity,
  checkRenderedWdlSums,
  checkSampleSizeMonotonicity,
  checkNoEmptyTables,
  loadManifest,
  checkRateHasSampleSize,
  checkShardSizeLimits,
  checkDistDataSize,
  hygieneOffenses,
  checkPublicHygiene,
  loadAggregateShards,
  MAX_SHARD_BYTES,
} = require('../scripts/verifyAggregates');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// --- validateCounts / checkShardRecordIntegrity ---------------------------------

test('validateCounts accepts a well-formed [w,d,l,bw,bd,bl] tuple', () => {
  assert.deepEqual(validateCounts('x', [10, 5, 3, 4, 2, 1]), []);
});

test('validateCounts rejects a non-integer or negative count', () => {
  const problems = validateCounts('x', [10.5, 5, -3, 4, 2, 1]);
  assert.ok(problems.some((p) => p.includes('w=10.5')));
  assert.ok(problems.some((p) => p.includes('l=-3')));
});

test('validateCounts rejects a balanced-subset count exceeding its full-count sibling', () => {
  const problems = validateCounts('x', [10, 5, 3, 11, 2, 1]);
  assert.ok(problems.some((p) => p.includes('balanced wins (11) exceed total wins (10)')));
});

test('validateCounts rejects a malformed (wrong length) tuple without throwing', () => {
  const problems = validateCounts('x', [1, 2, 3]);
  assert.equal(problems.length, 1);
});

test('checkShardRecordIntegrity walks positions and their move edges', () => {
  const positions = [
    { posKey: 'p1', total: [10, 5, 3, 4, 2, 1], moves: { e4: [6, 2, 1, 3, 1, 0] } },
    { posKey: 'p2', total: [10, 5, 3, 4, 2, 100], moves: {} }, // bl=100 > l=3
  ];
  const problems = checkShardRecordIntegrity(positions);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /position p2/);
});

// --- checkRenderedWdlSums ---------------------------------------------------------

test('checkRenderedWdlSums passes when the triplet sums to ~100', () => {
  const dir = mkTmpDir('wdl-ok-');
  writeFile(dir, 'a.html', '<span class="wdl-label">50.6% / 4.0% / 45.4%</span>');
  assert.deepEqual(checkRenderedWdlSums(dir), []);
});

test('checkRenderedWdlSums flags a triplet outside the 0.2-point tolerance', () => {
  const dir = mkTmpDir('wdl-bad-');
  writeFile(dir, 'a.html', '<span class="wdl-label">50.0% / 4.0% / 44.0%</span>'); // sums to 98.0
  const problems = checkRenderedWdlSums(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sums to 98\.00/);
});

// --- checkSampleSizeMonotonicity: the transposition-aware check -----------------

test('checkSampleSizeMonotonicity does NOT false-positive on legitimate transposition merging', () => {
  // Two different opening move orders (1.e4 e5 2.Nf3 vs 1.Nf3 e5 2.e4)
  // transpose into the same position C. Each parent edge contributes 40k
  // games; C's own total (80k) legitimately exceeds EITHER single parent
  // (which a naive "child <= single parent" check would wrongly flag) but
  // matches the SUM of both recorded parent edges exactly.
  const positionTotalGames = new Map([
    ['parentA', 45000],
    ['parentB', 42000],
    ['childC', 80000],
  ]);
  const parentEdgeGames = new Map([
    ['childC', [40000, 40000]], // edge from parentA and edge from parentB
  ]);
  const problems = checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames);
  assert.deepEqual(problems, [], 'transposition merging must not be flagged');
});

test('checkSampleSizeMonotonicity still catches a genuine over-count against the summed parents', () => {
  const positionTotalGames = new Map([
    ['parentA', 45000],
    ['parentB', 42000],
    ['childC', 999999], // far more games than either parent, or their sum, could supply
  ]);
  const parentEdgeGames = new Map([
    ['childC', [40000, 40000]],
  ]);
  const problems = checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /childC/);
  assert.match(problems[0], /999999/);
  assert.match(problems[0], /80000/); // the summed parent bound
});

test('checkSampleSizeMonotonicity skips a position with zero recorded parent edges (root, or all parents pruned)', () => {
  const positionTotalGames = new Map([['orphan', 500]]);
  const parentEdgeGames = new Map(); // no recorded parent at all
  assert.deepEqual(checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames), []);
});

test('checkSampleSizeMonotonicity skips a child not present in this shard set rather than crashing', () => {
  const positionTotalGames = new Map(); // child pruned/not loaded
  const parentEdgeGames = new Map([['missingChild', [100]]]);
  assert.deepEqual(checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames), []);
});

// --- checkNoEmptyTables -----------------------------------------------------------

test('checkNoEmptyTables passes a table with at least one row', () => {
  const dir = mkTmpDir('table-ok-');
  writeFile(dir, 'a.html', '<table><thead><tr><th>x</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
  assert.deepEqual(checkNoEmptyTables(dir), []);
});

test('checkNoEmptyTables flags a table with an empty tbody', () => {
  const dir = mkTmpDir('table-bad-');
  writeFile(dir, 'a.html', '<table><thead><tr><th>x</th></tr></thead><tbody></tbody></table>');
  const problems = checkNoEmptyTables(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /table #1 has no <tr> rows/);
});

test('checkNoEmptyTables does not flag a deliberate empty state using .empty-note (no <table> at all)', () => {
  const dir = mkTmpDir('table-empty-note-');
  writeFile(dir, 'a.html', '<p class="empty-note">No qualifying mistakes were found.</p>');
  assert.deepEqual(checkNoEmptyTables(dir), []);
});

// --- loadManifest ------------------------------------------------------------------

test('loadManifest reports a clear problem when manifest.json is missing', () => {
  const dir = mkTmpDir('manifest-missing-');
  const { manifest, problems } = loadManifest(dir);
  assert.equal(manifest, null);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not found/);
});

test('loadManifest accepts a fresh, internally-consistent manifest', () => {
  const dir = mkTmpDir('manifest-ok-');
  const shardPath = writeFile(dir, 'f/italian-game.json', '{}');
  const bytes = fs.statSync(shardPath).size;
  writeFile(
    dir,
    'manifest.json',
    JSON.stringify({
      retrievedAt: new Date().toISOString(),
      shards: [{ file: 'f/italian-game.json', bytes }],
    })
  );
  const { manifest, problems } = loadManifest(dir);
  assert.ok(manifest);
  assert.deepEqual(problems, []);
});

test('loadManifest flags a retrievedAt older than the freshness limit', () => {
  const dir = mkTmpDir('manifest-stale-');
  const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: old, shards: [] }));
  const { problems } = loadManifest(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /days old/);
});

test('loadManifest flags a shard listed in the manifest but missing on disk', () => {
  const dir = mkTmpDir('manifest-missing-shard-');
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'f/ghost.json', bytes: 10 }] }));
  const { problems } = loadManifest(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /missing on disk/);
});

test('loadManifest flags a shard whose on-disk size disagrees with the manifest', () => {
  const dir = mkTmpDir('manifest-size-mismatch-');
  writeFile(dir, 'f/x.json', '{"a":1}');
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'f/x.json', bytes: 999999 }] }));
  const { problems } = loadManifest(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /manifest says 999999/);
});

// --- checkRateHasSampleSize -------------------------------------------------------

test('checkRateHasSampleSize passes a row carrying both a rate cell and a games count', () => {
  const dir = mkTmpDir('rate-ok-');
  writeFile(dir, 'a.html', '<tr><td class="rate">51.2%</td><td>142,318 games</td></tr>');
  assert.deepEqual(checkRateHasSampleSize(dir), []);
});

test('checkRateHasSampleSize flags a rate cell with no games count in its row', () => {
  const dir = mkTmpDir('rate-bad-');
  writeFile(dir, 'a.html', '<tr><td class="rate">51.2%</td><td>no count here</td></tr>');
  const problems = checkRateHasSampleSize(dir);
  assert.equal(problems.length, 1);
});

// --- checkShardSizeLimits / checkDistDataSize -------------------------------------

test('checkShardSizeLimits flags a shard over the 5 MB limit', () => {
  const dir = mkTmpDir('shard-size-');
  const big = Buffer.alloc(MAX_SHARD_BYTES + 1, 'a');
  fs.writeFileSync(path.join(dir, 'big.json'), big);
  const manifest = { shards: [{ file: 'big.json', bytes: big.length }] };
  const problems = checkShardSizeLimits(dir, manifest);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /5 MB/);
});

test('checkDistDataSize passes when dist/data is small or absent', () => {
  const dir = mkTmpDir('dist-data-');
  assert.deepEqual(checkDistDataSize(dir), []); // no dist/data dir at all
  writeFile(dir, 'data/small.json', '{}');
  assert.deepEqual(checkDistDataSize(dir), []);
});

// --- hygieneOffenses / checkPublicHygiene -----------------------------------------

test('hygieneOffenses catches a leaked internal task-id-shaped string', () => {
  const offenses = hygieneOffenses('see task-ab12cd34-56ef78 for details');
  assert.ok(offenses.some((o) => /task-ab12cd34-56ef78/.test(o)));
});

test('hygieneOffenses does NOT flag this asset\'s own brand name "Repertoire Builder"', () => {
  assert.deepEqual(hygieneOffenses('Repertoire Builder shows chess opening statistics.'), []);
  assert.deepEqual(hygieneOffenses('https://repertoire-builder.com/og-default.png'), []);
});

test('hygieneOffenses flags the internal-process phrase "the builder" (agent-role usage)', () => {
  const offenses = hygieneOffenses('this was implemented by the builder role.');
  assert.ok(offenses.length > 0);
});

test('hygieneOffenses does not flag "architecture"/"architectural" but does flag the bare role name', () => {
  assert.deepEqual(hygieneOffenses('a solid architecture and architectural choices.'), []);
  assert.ok(hygieneOffenses('reviewed by the architect role.').length > 0);
});

test('checkPublicHygiene scans dist files and reports the offending file', () => {
  const dir = mkTmpDir('hygiene-');
  writeFile(dir, 'leak.html', '<p>Filed as decision-ab12cd34-56ef78.</p>');
  writeFile(dir, 'clean.html', '<p>Repertoire Builder: real chess statistics.</p>');
  const problems = checkPublicHygiene(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /leak\.html/);
});

// --- loadAggregateShards -----------------------------------------------------------

test('loadAggregateShards parses the assumed shard shape and builds the parent-edge index for monotonicity', () => {
  const dir = mkTmpDir('shards-');
  // parentA --e4--> childC ; parentB --Nf3--> childC (a transposition), each
  // move edge carries an optional 7th "childKey" element per this loader's
  // documented convention.
  const shard = {
    u1200: {
      blitz: {
        parentA: [45000, 0, 0, 0, 0, 0, { e4: [40000, 0, 0, 0, 0, 0, 'childC'] }],
        parentB: [42000, 0, 0, 0, 0, 0, { Nf3: [40000, 0, 0, 0, 0, 0, 'childC'] }],
        childC: [80000, 0, 0, 0, 0, 0, {}],
      },
    },
  };
  writeFile(dir, 'root.json', JSON.stringify(shard));
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [] }));
  const manifest = { shards: [] };
  const { positionTotalGames, parentEdgeGames } = loadAggregateShards(dir, manifest);
  assert.equal(positionTotalGames.get('u1200/blitz/childC'), 80000);
  assert.deepEqual(parentEdgeGames.get('u1200/blitz/childC').sort(), [40000, 40000]);
  // and feeding this straight into the monotonicity check must not flag it
  assert.deepEqual(checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames), []);
});
