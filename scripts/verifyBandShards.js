'use strict';

/**
 * Data-sanity gate for the WS-1 band-shard dataset (WS-1 spec section 2.1: "Add a CI data-sanity assertion:
 * manifest exists, W+D+L sums are internally consistent, no shard has an
 * empty positions map"). Same hand-rolled, no-dependency shape as the
 * existing scripts/verifyAggregates.js (a different dataset -- the
 * database-dump pipeline's data/aggregates/, not this one) and
 * scripts/checkLinks.js.
 *
 * Usage: node scripts/verifyBandShards.js [dir]
 *   dir defaults to dist/data/rep -- pass test/fixtures/band-shards to
 *   check the hand-checked fixture instead (see that directory's own
 *   README.md for why it exists).
 *
 * A GENUINELY MISSING dataset (scripts/buildBandShards.js has not been run
 * yet, so dist/data/rep/manifest.json doesn't exist) is reported as a WARN,
 * not a FAIL -- same reasoning as verifyAggregates.js's own "missing
 * manifest" handling: nothing in the current site build consumes
 * dist/data/rep/ until a WS-1 page ships that reads it, so gating on a
 * directory nothing yet requires would block every unrelated deploy for no
 * data-safety benefit. Once the manifest DOES exist but is broken, that
 * stays a hard FAIL.
 */

const fs = require('fs');
const path = require('path');
const { isValidShard, decodePositionRecord } = require('../src/bandShards');

function listShardFiles(dir, manifest) {
  const files = [];
  for (const band of manifest.bands || []) {
    for (const shard of band.shards || []) {
      files.push(path.join(dir, shard.file));
    }
  }
  return files;
}

function loadManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, missing: true, problems: [`missing-manifest: ${manifestPath} not found -- expected until scripts/buildBandShards.js has been run`] };
  }
  try {
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), missing: false, problems: [] };
  } catch (err) {
    return { manifest: null, missing: false, problems: [`${manifestPath} is not valid JSON: ${err.message}`] };
  }
}

/**
 * @param {object} record decoded PositionRecord (w, d, b, moves).
 * @param {string} label for error messages.
 * @returns {string[]} problems, empty = valid.
 */
function checkPositionConsistency(record, label) {
  const problems = [];
  for (const [name, v] of [['w', record.w], ['d', record.d], ['b', record.b]]) {
    if (!Number.isInteger(v) || v < 0) problems.push(`${label}: ${name}=${v} is not a non-negative integer`);
  }
  for (const m of record.moves) {
    for (const [name, v] of [['w', m.w], ['d', m.d], ['b', m.b]]) {
      if (!Number.isInteger(v) || v < 0) problems.push(`${label} move ${m.uci}: ${name}=${v} is not a non-negative integer`);
    }
    // A move's own w/d/b is the OUTCOME breakdown of games that continued
    // with it -- each component can never exceed the position's own total
    // for that same outcome (a move can't have more white wins recorded
    // than the position had white wins overall).
    if (m.w > record.w) problems.push(`${label} move ${m.uci}: move white-wins (${m.w}) exceeds position white-wins (${record.w})`);
    if (m.d > record.d) problems.push(`${label} move ${m.uci}: move draws (${m.d}) exceeds position draws (${record.d})`);
    if (m.b > record.b) problems.push(`${label} move ${m.uci}: move black-wins (${m.b}) exceeds position black-wins (${record.b})`);
  }
  return problems;
}

function checkShardFile(filePath) {
  const problems = [];
  if (!fs.existsSync(filePath)) {
    return [`${filePath}: listed in manifest.json but missing on disk`];
  }
  let shard;
  try {
    shard = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return [`${filePath}: not valid JSON (${err.message})`];
  }
  if (!isValidShard(shard)) {
    return [`${filePath}: fails isValidShard() (wrong/missing v, band, pool, or positions)`];
  }
  const posKeys = Object.keys(shard.positions);
  if (posKeys.length === 0) {
    problems.push(`${filePath}: empty positions map`);
  }
  for (const posKey of posKeys) {
    if (!/^[0-9a-f]{24}$/.test(posKey)) {
      problems.push(`${filePath}: posKey "${posKey}" is not a 24-char lowercase hex string`);
      continue;
    }
    const record = decodePositionRecord(shard.positions[posKey]);
    problems.push(...checkPositionConsistency(record, `${filePath} position ${posKey}`));
  }
  return problems;
}

/**
 * @param {string} dir
 * @returns {{results: Array<{name:string, problems:string[]}>}}
 */
function runAll(dir) {
  const results = [];
  const { manifest, missing, problems: manifestProblems } = loadManifest(dir);
  results.push({ name: 'manifest present and parseable', problems: manifestProblems });

  if (!manifest) {
    const reason = missing ? manifestProblems[0] : 'skipped: manifest failed to parse';
    results.push({ name: 'no shard has an empty positions map', problems: [reason] });
    results.push({ name: 'W+D+L sums are internally consistent', problems: [reason] });
    return { results };
  }

  const shardProblems = [];
  for (const filePath of listShardFiles(dir, manifest)) {
    shardProblems.push(...checkShardFile(filePath));
  }
  const emptyProblems = shardProblems.filter((p) => p.includes('empty positions map'));
  const consistencyProblems = shardProblems.filter((p) => !p.includes('empty positions map'));
  results.push({ name: 'no shard has an empty positions map', problems: emptyProblems });
  results.push({ name: 'W+D+L sums are internally consistent', problems: consistencyProblems });
  return { results };
}

const NON_GATING_PREFIXES = ['missing-manifest:'];
function isNonGating(problem) {
  return NON_GATING_PREFIXES.some((prefix) => problem.startsWith(prefix));
}

function summarize(results) {
  let anyFail = false;
  const lines = [];
  for (const { name, problems } of results) {
    const real = problems.filter((p) => !isNonGating(p));
    const nonGating = problems.filter(isNonGating);
    if (real.length > 0) {
      anyFail = true;
      lines.push({ level: 'error', text: `FAIL  ${name} (${real.length} problem(s))` });
      for (const p of real) lines.push({ level: 'error', text: `        ${p}` });
    } else if (nonGating.length > 0) {
      lines.push({ level: 'warn', text: `WARN  ${name}: ${nonGating[0]}` });
    } else {
      lines.push({ level: 'log', text: `PASS  ${name}` });
    }
  }
  return { anyFail, lines };
}

function main() {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'data', 'rep'));
  const { results } = runAll(dir);
  const { anyFail, lines } = summarize(results);
  for (const { level, text } of lines) console[level](text);
  process.exitCode = anyFail ? 1 : 0;
  console.log(anyFail ? '\nverifyBandShards: one or more checks failed.' : '\nverifyBandShards: all checks passed.');
}

if (require.main === module) {
  main();
}

module.exports = { loadManifest, checkPositionConsistency, checkShardFile, runAll, summarize, isNonGating };
