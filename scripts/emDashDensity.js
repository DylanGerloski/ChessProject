'use strict';

/**
 * Measures em-dash density in rendered PROSE only (p/li/h1/h2/h3/summary
 * text, not tables/code/data): em dash characters divided by word count,
 * times 150 -- i.e. em dashes per 150 words, a proxy for "reads like it
 * was written by an AI." A plain phrase grep over source misses this
 * pattern entirely (an em dash isn't a fixed tell phrase), and counting
 * against source misses text assembled from shared fragments (a
 * description string reused across several pages) -- both are why this
 * measures the actual BUILT dist/ output instead.
 *
 * Shares its approach with a sibling tool in this author's other projects --
 * kept generic on purpose so it can be dropped into another workspace with
 * only the DIST path needing to match.
 *
 * Usage: node scripts/emDashDensity.js [--fail-over <rate>]
 *   Prints every page's rate and sentence-level 2+-em-dash hits. Exits
 *   non-zero only if --fail-over is passed and any page exceeds it -- so
 *   this can be run informationally (the default) or wired into a hard
 *   gate once the whole site is under threshold.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const THRESHOLD_PER_150_WORDS = 1;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Extracts inner text of every <p>, <li>, <h1-3>, <summary> tag, stripping nested markup. */
function extractProse(html) {
  // Strip <style>/<script> content FIRST -- this site inlines CSS/JS into
  // every page's <head> and <body>, and that content's own comments can
  // contain literal tag-shaped text that would otherwise open a false match
  // spanning from the CSS/JS all the way to the real element deep in <body>.
  const withoutNonProse = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  const chunks = [];
  const re = /<(p|li|h1|h2|h3|summary)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(withoutNonProse))) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—').replace(/&[a-z]+;/gi, ' ');
    chunks.push(text);
  }
  return chunks;
}

function countEmDashes(text) {
  return (text.match(/—/g) || []).length;
}

function wordCount(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

/** Splits on sentence-ending punctuation for the "2+ in one sentence" check. */
function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ does not exist -- run `npm run build:static` first.');
    process.exitCode = 1;
    return;
  }
  const failOverIdx = process.argv.indexOf('--fail-over');
  const failOver = failOverIdx !== -1 ? Number(process.argv[failOverIdx + 1]) : null;

  const files = walk(DIST).sort();
  let anyOver = false;
  const rows = [];

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const prose = extractProse(html);
    const fullText = prose.join(' ');
    const words = wordCount(fullText);
    const dashes = countEmDashes(fullText);
    const rate = words ? (dashes / words) * 150 : 0;

    let worstSentenceCount = 0;
    for (const chunk of prose) {
      for (const s of sentences(chunk)) {
        const c = countEmDashes(s);
        if (c > worstSentenceCount) worstSentenceCount = c;
      }
    }

    const rel = path.relative(DIST, file);
    const over = rate > THRESHOLD_PER_150_WORDS || worstSentenceCount >= 2;
    if (over) anyOver = true;
    rows.push({ rel, words, dashes, rate, worstSentenceCount, over });
  }

  for (const r of rows) {
    const flag = r.over ? 'OVER' : 'ok';
    console.log(`${flag.padEnd(4)} ${r.rate.toFixed(2)}/150w  (max ${r.worstSentenceCount} em-dash/sentence, ${r.words}w)  ${r.rel}`);
  }

  const overCount = rows.filter((r) => r.over).length;
  console.log(`\n${overCount}/${rows.length} pages over threshold (${THRESHOLD_PER_150_WORDS}/150 words or 2+ in one sentence).`);

  if (failOver !== null && anyOver) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { extractProse, countEmDashes, wordCount, sentences };
