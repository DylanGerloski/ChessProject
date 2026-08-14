'use strict';

/**
 * CI quality gate: data-sanity suite.
 *
 * Runs 7 checks against BOTH the raw aggregate shards (data/aggregates/,
 * produced by a database-dump ingestion pipeline that does not exist in
 * this repo yet) and the built dist/ output. Hand-rolled, no dependency,
 * same pattern as scripts/checkLinks.js.
 *
 * IMPORTANT, read before assuming a red run is a bug in this script:
 * the ingestion pipeline that writes data/aggregates/ (would live under
 * src/ingest/) has not been built yet at the time this gate was written.
 * Checks 1a/2/4/6a (below) require data/aggregates/manifest.json to exist
 * and WILL fail until that pipeline ships real output -- that is the
 * correct, intended behavior of a gate that blocks deploy on missing/bad
 * data, not a defect in this script.
 *
 * Usage: node scripts/verifyAggregates.js [distDir] [--aggregates <dir>]
 *   distDir      default "dist"
 *   --aggregates default "data/aggregates"
 */

const fs = require('fs');
const path = require('path');

const MAX_SHARD_BYTES = 5 * 1024 * 1024; // 5 MB per aggregate shard file
const MAX_DIST_DATA_BYTES = 100 * 1024 * 1024; // 100 MB total for dist/data (stays well under the GitHub Pages 1 GB limit)
const MANIFEST_MAX_AGE_DAYS = 100; // a stale data manifest should block deploy, not silently keep serving old numbers
const RENDERED_WDL_TOLERANCE = 0.2; // two 1-decimal roundings' worth of slack

// Public-content hygiene patterns: this repo's remote is public, so a
// filename/path/id that only makes sense to internal tooling must never
// show up in what actually gets published. Kept as a small local list
// rather than depending on anything outside this repo, since this script
// has to run standalone in CI.
const HYGIENE_PATTERNS = [
  /\btask-[a-z0-9]{8}-[a-f0-9]{6}\b/i,
  /\bdecision-[a-z0-9]{8}-[a-f0-9]{6}\b/i,
  /\bchief-of-staff\b/i,
  /\barchitect\b(?!ure)/i, // "architecture"/"architectural" are ordinary English; the bare role name isn't
  // "builder" is excluded: this asset's own product name is "Repertoire
  // Builder" (repertoire-builder.com) -- the role name would otherwise
  // false-positive on every single page and make this check useless. Only
  // the internal-process phrase "the builder" (agent-role usage, not the
  // brand) is still caught.
  /\bthe builder\b/i,
  /\bscout\b/i,
  /\breviewer\b/i,
  /\borchestrator\//i,
  /\.claude\//i,
  /\bdecision brief\b/i,
  /\bqueue task\b/i,
  /\bALWAYS ESCALATE\b/,
];

// --- generic filesystem helpers -------------------------------------------------

function listFiles(dir, predicate) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, predicate));
    } else if (entry.isFile() && (!predicate || predicate(full))) {
      out.push(full);
    }
  }
  return out;
}

function dirTotalBytes(dir) {
  return listFiles(dir).reduce((sum, f) => sum + fs.statSync(f).size, 0);
}

// --- check 1a: shard record integrity (exact integer sanity) --------------------

/**
 * Validates one [w, d, l, bw, bd, bl] counts tuple (section 1.4's per-move /
 * per-position record shape). Exact integer checks only -- no rounding is
 * involved at this layer, unlike the rendered-percentage check below.
 * Returns an array of problem strings (empty = valid).
 */
function validateCounts(label, counts) {
  const problems = [];
  if (!Array.isArray(counts) || counts.length !== 6) {
    return [`${label}: expected a 6-element [w,d,l,bw,bd,bl] array, got ${JSON.stringify(counts)}`];
  }
  const [w, d, l, bw, bd, bl] = counts;
  for (const [name, v] of [['w', w], ['d', d], ['l', l], ['bw', bw], ['bd', bd], ['bl', bl]]) {
    if (!Number.isInteger(v) || v < 0) {
      problems.push(`${label}: ${name}=${v} is not a non-negative integer`);
    }
  }
  if (problems.length) return problems; // don't compound with NaN comparisons below
  // The balanced subset (rating gap <= 50) is a SUBSET of all games by
  // definition, per component -- a balanced win is still counted in the
  // overall win count, so bw <= w, bd <= d, bl <= l always.
  if (bw > w) problems.push(`${label}: balanced wins (${bw}) exceed total wins (${w})`);
  if (bd > d) problems.push(`${label}: balanced draws (${bd}) exceed total draws (${d})`);
  if (bl > l) problems.push(`${label}: balanced losses (${bl}) exceed total losses (${l})`);
  return problems;
}

/**
 * positions: array of { posKey, total: [w,d,l,bw,bd,bl], moves: { uci: [w,d,l,bw,bd,bl] } }
 * -- the loader's normalized in-memory shape (see loadAggregateShards below).
 */
function checkShardRecordIntegrity(positions) {
  const problems = [];
  for (const pos of positions) {
    problems.push(...validateCounts(`position ${pos.posKey}`, pos.total));
    for (const [uci, counts] of Object.entries(pos.moves || {})) {
      problems.push(...validateCounts(`position ${pos.posKey} move ${uci}`, counts));
    }
  }
  return problems;
}

// --- check 1b: rendered W/D/L triplets sum to 100 --------------------------------

const WDL_LABEL_RE = /class="wdl-label">([\d.]+)%\s*\/\s*([\d.]+)%\s*\/\s*([\d.]+)%/g;

function checkRenderedWdlSums(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    let m;
    WDL_LABEL_RE.lastIndex = 0;
    while ((m = WDL_LABEL_RE.exec(html))) {
      const sum = Number(m[1]) + Number(m[2]) + Number(m[3]);
      if (Math.abs(sum - 100) > RENDERED_WDL_TOLERANCE) {
        problems.push(`${file}: rendered W/D/L "${m[1]}% / ${m[2]}% / ${m[3]}%" sums to ${sum.toFixed(2)}, not ~100`);
      }
    }
  }
  return problems;
}

// --- check 2: sample-size monotonicity, transposition-aware ---------------------

/**
 * The naive version of this check ("a child position's game count never
 * exceeds its single parent's") FALSE-POSITIVES on legitimate transposition
 * merging: because the pipeline keys aggregates by POSITION (section 1.4),
 * a child reached by several different move orders legitimately accumulates
 * more games than any ONE of its parents contributed. The correct check
 * bounds the child against the SUM of every recorded parent's contribution.
 *
 * @param {Map<string, number>} positionTotalGames posKey -> total games at that position (w+d+l)
 * @param {Map<string, number[]>} parentEdgeGames posKey (of the CHILD) -> array of games-counts,
 *   one entry per recorded parent edge (the w+d+l of the move at the parent
 *   position that leads to this child)
 * @returns {string[]} problems (empty = valid)
 *
 * Positions with zero recorded parent edges are skipped, not flagged --
 * with no recorded parent (root position, or every parent below MIN_GAMES
 * and pruned from the shard) there is nothing to check against, and
 * asserting "games <= 0" would itself be a false positive.
 */
function checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames) {
  const problems = [];
  for (const [childKey, edges] of parentEdgeGames.entries()) {
    if (!edges || edges.length === 0) continue;
    const childTotal = positionTotalGames.get(childKey);
    if (childTotal === undefined) continue; // child pruned/not in this shard set; nothing to compare
    const parentSum = edges.reduce((a, b) => a + b, 0);
    if (childTotal > parentSum) {
      problems.push(
        `position ${childKey}: game count ${childTotal} exceeds the sum of its ${edges.length} recorded parent edge(s) (${parentSum}) -- possible double-count or aggregation bug`
      );
    }
  }
  return problems;
}

// --- check 3: no page ships with an empty table -----------------------------------

const TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/g;
const TBODY_RE = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/;
const TR_RE = /<tr\b/;

function checkNoEmptyTables(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    let m;
    TABLE_RE.lastIndex = 0;
    let idx = 0;
    while ((m = TABLE_RE.exec(html))) {
      idx += 1;
      // Scope the row check to <tbody> specifically (this codebase's own
      // convention -- see src/renderContent.js) so a table with a populated
      // <thead> but a genuinely empty <tbody> is still caught. Tables with
      // no <tbody> tag at all fall back to checking the whole table.
      const tbodyMatch = TBODY_RE.exec(m[1]);
      const relevant = tbodyMatch ? tbodyMatch[1] : m[1];
      if (!TR_RE.test(relevant)) {
        problems.push(`${file}: table #${idx} has no <tr> rows in its body (deliberate empty states must use .empty-note and emit no <table> at all)`);
      }
    }
  }
  return problems;
}

// --- check 4: manifest present, parseable, fresh, shards accounted for -----------

function loadManifest(aggregatesDir) {
  const manifestPath = path.join(aggregatesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, problems: [`${manifestPath} not found (expected until the ingestion pipeline ships real data)`] };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { manifest: null, problems: [`${manifestPath} is not valid JSON: ${err.message}`] };
  }
  const problems = [];
  if (!manifest.retrievedAt) {
    problems.push(`${manifestPath}: missing retrievedAt`);
  } else {
    const ageMs = Date.now() - new Date(manifest.retrievedAt).getTime();
    if (Number.isNaN(ageMs)) {
      problems.push(`${manifestPath}: retrievedAt "${manifest.retrievedAt}" is not a parseable date`);
    } else if (ageMs > MANIFEST_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      problems.push(`${manifestPath}: retrievedAt is ${ageDays} days old, over the ${MANIFEST_MAX_AGE_DAYS}-day freshness limit`);
    }
  }
  for (const shard of manifest.shards || []) {
    const shardPath = path.join(aggregatesDir, shard.file);
    if (!fs.existsSync(shardPath)) {
      problems.push(`${manifestPath}: lists shard "${shard.file}" which is missing on disk at ${shardPath}`);
      continue;
    }
    const actualBytes = fs.statSync(shardPath).size;
    if (typeof shard.bytes === 'number' && actualBytes !== shard.bytes) {
      problems.push(`${manifestPath}: shard "${shard.file}" is ${actualBytes} bytes on disk, manifest says ${shard.bytes}`);
    }
  }
  return { manifest, problems };
}

// --- check 5: every rendered rate has a sample size alongside it -----------------

// Convention this gate enforces (no template renders a "rate" class yet,
// so this currently passes vacuously -- nothing to check): a cell carrying
// class="rate" must share a table row with a games-count. This codebase's
// existing sitewide pattern for a games count is the literal text
// "<number> games" (see src/render.js's "rep-games" span, src/
// renderContent.js's "N games" caption) -- reuse that pattern rather than
// requiring a brand-new class the moment interval rendering lands.
const GAMES_TEXT_RE = /[\d,]+\s+games/i;

function checkRateHasSampleSize(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = rowRe.exec(html))) {
      const row = m[1];
      if (/class="[^"]*\brate\b[^"]*"/.test(row) && !GAMES_TEXT_RE.test(row)) {
        problems.push(`${file}: a table row carries a "rate" cell with no games-count alongside it`);
      }
    }
  }
  return problems;
}

// --- check 6: shard/dist size budgets --------------------------------------------

function checkShardSizeLimits(aggregatesDir, manifest) {
  const problems = [];
  if (!manifest) return problems; // already reported by loadManifest
  for (const shard of manifest.shards || []) {
    const shardPath = path.join(aggregatesDir, shard.file);
    if (!fs.existsSync(shardPath)) continue; // already reported by loadManifest
    const bytes = fs.statSync(shardPath).size;
    if (bytes > MAX_SHARD_BYTES) {
      problems.push(`${shardPath}: ${bytes} bytes exceeds the ${MAX_SHARD_BYTES}-byte (5 MB) per-shard limit`);
    }
  }
  return problems;
}

function checkDistDataSize(distDir) {
  const dataDir = path.join(distDir, 'data');
  if (!fs.existsSync(dataDir)) return [];
  const total = dirTotalBytes(dataDir);
  if (total > MAX_DIST_DATA_BYTES) {
    return [`${dataDir}: ${total} bytes exceeds the ${MAX_DIST_DATA_BYTES}-byte (100 MB) dist/data budget`];
  }
  return [];
}

// --- check 7: public-content hygiene ----------------------------------------------

function hygieneOffenses(text) {
  const found = new Set();
  for (const re of HYGIENE_PATTERNS) {
    const m = text.match(re);
    if (m) found.add(m[0]);
  }
  return [...found];
}

function checkPublicHygiene(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html') || f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.xml'))) {
    const text = fs.readFileSync(file, 'utf8');
    const offenses = hygieneOffenses(text);
    if (offenses.length) {
      problems.push(`${file}: internal identifier(s) leaked into public output: ${offenses.join(', ')}`);
    }
  }
  return problems;
}

// --- shard loader (real-data wiring; ASSUMED shape, see header comment) ----------

/**
 * ASSUMED on-disk shard shape -- the per-position record shape (a
 * [w,d,l,bw,bd,bl] tuple plus a per-move breakdown) is settled, but the
 * top-level container isn't pinned down yet since nothing writes real
 * shards yet. Whatever module ends up writing data/aggregates/ (under
 * src/ingest/, not built yet) may need to adjust this loader to match once
 * it lands -- a one-file, low-risk follow-up, not a redesign of the checks
 * above:
 *
 *   { "<band>": { "<pool>": { "<posKey>": [w,d,l,bw,bd,bl,{uci:[w,d,l,bw,bd,bl]}] } } }
 *
 * Also builds the parent-edge index checkSampleSizeMonotonicity needs. This
 * loader cannot resolve a move's DESTINATION posKey from the compact record
 * shape alone (a per-move array carries no child-key field by default), so
 * it only builds edges for shards that also carry an optional "childKey"
 * 7th element per move -- if a shard omits it, that shard's positions are
 * skipped for check 2 with a stated reason rather than silently treated as
 * root positions. This is a known open gap for whoever builds the real
 * ingestion pipeline to close, not a bug in the check logic itself.
 */
function loadAggregateShards(aggregatesDir, manifest) {
  const positions = [];
  const positionTotalGames = new Map();
  const parentEdgeGames = new Map();
  const loadProblems = [];
  const skippedForMonotonicity = new Set();

  const shardFiles = (manifest && manifest.shards ? manifest.shards.map((s) => s.file) : []).map((f) => path.join(aggregatesDir, f));
  const rootPath = path.join(aggregatesDir, 'root.json');
  const files = fs.existsSync(rootPath) ? [rootPath, ...shardFiles] : shardFiles;

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      loadProblems.push(`${file}: not valid JSON (${err.message})`);
      continue;
    }
    for (const [band, byPool] of Object.entries(data || {})) {
      if (typeof byPool !== 'object' || byPool === null) continue;
      for (const [pool, byPosKey] of Object.entries(byPool)) {
        if (typeof byPosKey !== 'object' || byPosKey === null) continue;
        for (const [posKey, record] of Object.entries(byPosKey)) {
          if (!Array.isArray(record) || record.length < 7) {
            skippedForMonotonicity.add(posKey);
            continue;
          }
          const [w, d, l, bw, bd, bl, moves] = record;
          const total = [w, d, l, bw, bd, bl];
          const key = `${band}/${pool}/${posKey}`;
          positions.push({ posKey: key, total, moves: {} });
          positionTotalGames.set(key, w + d + l);

          for (const [uci, edge] of Object.entries(moves || {})) {
            if (!Array.isArray(edge) || edge.length < 6) continue;
            const edgeCounts = edge.slice(0, 6);
            positions[positions.length - 1].moves[uci] = edgeCounts;
            const childKey = edge[6]; // optional 7th element, see header comment
            if (!childKey) {
              skippedForMonotonicity.add(`${key} -> ${uci}`);
              continue;
            }
            const childFullKey = `${band}/${pool}/${childKey}`;
            const games = edgeCounts[0] + edgeCounts[1] + edgeCounts[2];
            if (!parentEdgeGames.has(childFullKey)) parentEdgeGames.set(childFullKey, []);
            parentEdgeGames.get(childFullKey).push(games);
          }
        }
      }
    }
  }

  return { positions, positionTotalGames, parentEdgeGames, loadProblems, skippedForMonotonicity };
}

// --- orchestration -----------------------------------------------------------------

function runAll({ distDir, aggregatesDir }) {
  const results = [];

  // Aggregate-shard-level checks (1a, 2, 4, 6a) -- depend on the ingestion pipeline's output.
  const { manifest, problems: manifestProblems } = loadManifest(aggregatesDir);
  results.push({ name: '4. manifest present/fresh/consistent', problems: manifestProblems });

  if (manifest) {
    const { positions, positionTotalGames, parentEdgeGames, loadProblems, skippedForMonotonicity } = loadAggregateShards(aggregatesDir, manifest);
    results.push({ name: '1a. shard record integrity (exact)', problems: [...loadProblems, ...checkShardRecordIntegrity(positions)] });
    const monoProblems = checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames);
    if (skippedForMonotonicity.size > 0) {
      monoProblems.push(
        `note: ${skippedForMonotonicity.size} position/move record(s) skipped for monotonicity (no destination posKey on the move edge -- see loadAggregateShards header comment)`
      );
    }
    results.push({ name: '2. sample-size monotonicity (transposition-aware)', problems: monoProblems });
    results.push({ name: '6a. shard file size limits', problems: checkShardSizeLimits(aggregatesDir, manifest) });
  } else {
    results.push({ name: '1a. shard record integrity (exact)', problems: ['skipped: no manifest'] });
    results.push({ name: '2. sample-size monotonicity (transposition-aware)', problems: ['skipped: no manifest'] });
    results.push({ name: '6a. shard file size limits', problems: ['skipped: no manifest'] });
  }

  // dist/-level checks (1b, 3, 5, 6b, 7) -- runnable today.
  if (fs.existsSync(distDir)) {
    results.push({ name: '1b. rendered W/D/L sums to 100', problems: checkRenderedWdlSums(distDir) });
    results.push({ name: '3. no page ships with an empty table', problems: checkNoEmptyTables(distDir) });
    results.push({ name: '5. every rendered rate has a sample size', problems: checkRateHasSampleSize(distDir) });
    results.push({ name: '6b. dist/data total size budget', problems: checkDistDataSize(distDir) });
    results.push({ name: '7. public-content hygiene', problems: checkPublicHygiene(distDir) });
  } else {
    for (const name of ['1b. rendered W/D/L sums to 100', '3. no page ships with an empty table', '5. every rendered rate has a sample size', '6b. dist/data total size budget', '7. public-content hygiene']) {
      results.push({ name, problems: [`skipped: ${distDir} not found -- run npm run build:static first`] });
    }
  }

  return results;
}

function main() {
  const args = process.argv.slice(2);
  let distDir = 'dist';
  let aggregatesDir = 'data/aggregates';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--aggregates') {
      aggregatesDir = args[++i];
    } else if (!args[i].startsWith('--')) {
      distDir = args[i];
    }
  }
  distDir = path.resolve(distDir);
  aggregatesDir = path.resolve(aggregatesDir);

  const results = runAll({ distDir, aggregatesDir });

  let anyFail = false;
  for (const { name, problems } of results) {
    const real = problems.filter((p) => !p.startsWith('skipped:'));
    const skipped = problems.filter((p) => p.startsWith('skipped:'));
    if (real.length > 0) {
      anyFail = true;
      console.error(`FAIL  ${name} (${real.length} problem(s))`);
      for (const p of real) console.error(`        ${p}`);
    } else if (skipped.length > 0) {
      anyFail = true; // a skip is still a red gate -- see header comment
      console.error(`FAIL  ${name}: ${skipped[0]}`);
    } else {
      console.log(`PASS  ${name}`);
    }
  }

  process.exitCode = anyFail ? 1 : 0;
  console.log(anyFail ? '\nverifyAggregates: one or more checks failed.' : '\nverifyAggregates: all checks passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  MAX_SHARD_BYTES,
  MAX_DIST_DATA_BYTES,
  MANIFEST_MAX_AGE_DAYS,
  RENDERED_WDL_TOLERANCE,
  HYGIENE_PATTERNS,
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
  runAll,
};
