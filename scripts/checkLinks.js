'use strict';

/**
 * CI quality gate: internal link checker. Hand-rolled, no dependency --
 * matches this repo's established pattern for scripts/*.js (see
 * scripts/boardWidgetCheck.js, scripts/ecoExplorerCheck.js) and avoids
 * adding a network-dependent Action to the deploy path.
 *
 * Walks dist/**\/*.html, extracts every href/src/srcset target, and for
 * each internal target resolves it against dist/ (handling a #fragment,
 * a ?query, and this site's flat-filename convention) and asserts the
 * resolved file exists. Also enforces this site's URL-hygiene convention:
 * no internal link may contain "index.html" (the canonical form always
 * omits it), and no link (internal or external) may use a bare "http://"
 * scheme.
 *
 * External links are collected and reported but never fail this gate -- a
 * third-party 503 must never block a deploy. There is no separate scheduled
 * workflow checking them yet (a known gap, not yet built -- only this
 * deploy workflow exists today).
 *
 * Usage: node scripts/checkLinks.js [distDir]   (default: dist)
 */

const fs = require('fs');
const path = require('path');

const TARGET_ATTR_RE = /\b(?:href|src)\s*=\s*"([^"]*)"/gi;
const SRCSET_ATTR_RE = /\bsrcset\s*=\s*"([^"]*)"/gi;

function listHtmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/** Splits a srcset attribute value into its individual URL candidates. */
function srcsetUrls(value) {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** True for a target this checker treats as "internal, should resolve to a dist/ file". */
function isInternal(target) {
  if (!target) return false;
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(target)) return false;
  if (/^https?:\/\//i.test(target)) return false; // handled separately (external, or scheme check)
  if (/^\/\//.test(target)) return false; // protocol-relative -- treated as external
  return true;
}

/** Extracts every href/src/srcset target from one HTML source string. */
function extractTargets(html) {
  const targets = [];
  let m;
  TARGET_ATTR_RE.lastIndex = 0;
  while ((m = TARGET_ATTR_RE.exec(html))) {
    targets.push(m[1]);
  }
  SRCSET_ATTR_RE.lastIndex = 0;
  while ((m = SRCSET_ATTR_RE.exec(html))) {
    targets.push(...srcsetUrls(m[1]));
  }
  return targets;
}

/**
 * Resolves an internal target (relative or site-absolute, may carry a
 * ?query and/or #fragment) against distDir under the flat-filename
 * convention. Returns the absolute filesystem path it should exist at, or
 * null for a target this checker doesn't apply to (a same-page fragment or
 * query with nothing else).
 */
function resolveInternalTarget(distDir, target) {
  const withoutFragment = target.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  if (!withoutQuery) return null;
  const relative = withoutQuery.replace(/^\//, '');
  return path.join(distDir, relative);
}

function checkFile(distDir, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const targets = extractTargets(html);
  const offenses = [];
  const external = [];

  for (const target of targets) {
    if (!target) continue;

    if (/^https?:\/\//i.test(target)) {
      if (!/^https:\/\//i.test(target)) {
        offenses.push(`${filePath}: insecure "http://" link: ${target}`);
      } else {
        external.push(target);
      }
      continue;
    }

    if (!isInternal(target)) continue; // mailto/tel/javascript/data/pure-fragment/protocol-relative

    if (/index\.html/i.test(target)) {
      offenses.push(`${filePath}: link contains "index.html" (this site's canonical URLs never include it): ${target}`);
    }

    const resolved = resolveInternalTarget(distDir, target);
    if (resolved === null) continue;
    if (!fs.existsSync(resolved)) {
      offenses.push(`${filePath}: broken internal link, target not found: "${target}" (resolved ${resolved})`);
    }
  }

  return { offenses, external };
}

function checkLinks(distDir) {
  const files = listHtmlFiles(distDir);
  const offenses = [];
  const externalLinks = new Set();
  for (const file of files) {
    const result = checkFile(distDir, file);
    offenses.push(...result.offenses);
    result.external.forEach((u) => externalLinks.add(u));
  }
  return { filesChecked: files.length, offenses, externalLinks: [...externalLinks].sort() };
}

function main() {
  const distDir = path.resolve(process.argv[2] || 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`checkLinks: dist directory not found at ${distDir}. Run npm run build:static first.`);
    process.exitCode = 1;
    return;
  }
  const { filesChecked, offenses, externalLinks } = checkLinks(distDir);
  console.log(
    `checkLinks: scanned ${filesChecked} HTML files, found ${externalLinks.length} distinct external link(s) (not verified reachable by this gate -- see this script's header comment).`
  );
  if (offenses.length > 0) {
    console.error(`\n${offenses.length} offense(s):`);
    for (const o of offenses) console.error(`  FAIL  ${o}`);
    process.exitCode = 1;
  } else {
    console.log('All internal links resolve. No "index.html" or insecure "http://" links found.');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listHtmlFiles,
  srcsetUrls,
  isInternal,
  extractTargets,
  resolveInternalTarget,
  checkFile,
  checkLinks,
};
