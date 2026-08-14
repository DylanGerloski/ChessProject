'use strict';

/**
 * Standalone runner for the ECO data pipeline (src/ecoData.js). Not wired into
 * src/buildStatic.js -- integrating this dataset into actual page output is a later
 * task's job (family hub / ECO explorer pages), which also has to decide payload shaping
 * (index vs. per-family chunks) that is out of this pipeline's scope.
 *
 * This script exists so the pipeline (and its "fail loudly on a malformed row" behavior)
 * can be run and inspected on its own: `node scripts/buildEcoData.js`. It prints summary
 * stats and timing, and writes a full JSON snapshot to .cache/eco-dataset.json (gitignored
 * -- fully reproducible from the vendored TSV/JSON in data/eco/ in a few seconds, so there
 * is no reason to commit it) for manual inspection.
 */

const fs = require('fs');
const path = require('path');
const { buildEcoDataset } = require('../src/ecoData');

function main() {
  const start = Date.now();
  const { lines, stats, quarantinedFromB, onlyInA } = buildEcoDataset();
  const elapsedMs = Date.now() - start;

  console.log('ECO data pipeline: OK');
  console.log(`  ${stats.totalLines} lines parsed and legality-validated in ${elapsedMs}ms`);
  console.log(`  ${stats.distinctEcoCodesA} distinct ECO codes (Source A)`);
  console.log(`  ${stats.distinctFamilies} distinct opening families`);
  console.log(`  Source B: ${stats.sourceBTotalEntries} entries, ${stats.distinctEcoCodesB} distinct ECO codes`);
  console.log(`  ${stats.linesCoveredBySourceB}/${stats.totalLines} lines have a Source B reverse-lookup match`);
  const quarantineDesc = quarantinedFromB
    .map((q) => `${q.code}${q.trimmedMatchesA ? ' (whitespace dupe of ' + q.code.trim() + ')' : ' (UNEXPLAINED)'}`)
    .join(', ');
  console.log(`  quarantined from B (in B, not in A): ${quarantineDesc || '(none)'}`);
  console.log(`  only in A (no Source B coverage): ${onlyInA.length}`);

  const outDir = path.join(__dirname, '..', '.cache');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'eco-dataset.json');
  fs.writeFileSync(outPath, JSON.stringify({ stats, quarantinedFromB, onlyInA, lines }, null, 2));
  const bytes = fs.statSync(outPath).size;
  console.log(`  wrote ${outPath} (${(bytes / 1024).toFixed(1)} KB)`);
}

main();
