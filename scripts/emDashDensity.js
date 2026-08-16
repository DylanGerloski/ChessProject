'use strict';

/**
 * Flat em-dash ban over rendered BUILT dist/ output (design-standards.md's
 * zero-tolerance rule, superseding the old density-cap approach this file
 * used to implement -- see docs/CHANGELOG.md 2026-08-15). Any em dash
 * character reaching a visitor is a failure: no threshold, no "rare is
 * fine." Checks both the literal em dash character (—) and the &mdash;
 * HTML entity, since a browser renders both identically -- a plain
 * literal-character grep alone would have missed the entity form (this is
 * exactly how the Gumroad CTA button on the pack pages shipped with a
 * visible em dash despite this script running post-build: it only scanned
 * p/li/h1-3/summary text, and the CTA is a bare <a> tag outside that list).
 *
 * Scans ALL visible text in the built HTML (not just a fixed tag
 * allowlist), after stripping <style>/<script> contents and HTML comments
 * so inert code/markup never produces a false positive.
 *
 * Usage: node scripts/emDashDensity.js
 *   Prints every offending page and line-level context, then exits
 *   non-zero if any em dash (literal or entity) is found anywhere in
 *   dist/. Always a hard gate -- wired into `postbuild:static` so a
 *   regression fails the build automatically.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.html') || entry.name.endsWith('.xml')) out.push(p);
  }
  return out;
}

/** Strips inert (non-visible) content that could produce a false positive. */
function stripInert(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
}

/** Finds every literal em dash or &mdash; entity, with surrounding context. */
function findEmDashes(html) {
  const hits = [];
  const re = /.{0,30}(—|&mdash;).{0,30}/g;
  let m;
  while ((m = re.exec(html))) {
    hits.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return hits;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ does not exist -- run `npm run build:static` first.');
    process.exitCode = 1;
    return;
  }

  const files = walk(DIST).sort();
  let anyFound = false;
  const rows = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const visible = stripInert(raw);
    const hits = findEmDashes(visible);
    if (hits.length) {
      anyFound = true;
      rows.push({ rel: path.relative(DIST, file), hits });
    }
  }

  if (!anyFound) {
    console.log(`ok -- 0 em dashes (literal or &mdash;) found across ${files.length} built pages.`);
    return;
  }

  for (const r of rows) {
    console.log(`FAIL ${r.rel} (${r.hits.length} em dash${r.hits.length === 1 ? '' : 'es'})`);
    for (const h of r.hits) console.log(`     ...${h}...`);
  }
  console.log(`\n${rows.length}/${files.length} pages contain a banned em dash. design-standards.md: zero tolerance, no exceptions.`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { stripInert, findEmDashes };
