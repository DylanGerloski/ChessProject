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
 * ?query and/or #fragment) the same way a real browser would: a
 * site-absolute target (leading '/') resolves against distDir (the site
 * root); a genuinely relative target (no leading '/') resolves against the
 * REFERRING PAGE's own directory, not always against distDir root.
 *
 * `referringFile` is optional and defaults to resolving relative targets
 * against distDir itself -- which is only correct for a page that actually
 * lives at the site root. Every real caller (checkFile() below) passes the
 * actual file being scanned, so relative targets are resolved correctly
 * regardless of that page's own depth. This distinction is what let a real
 * production bug through this gate undetected: every internal href on the
 * Repertoire Pack detail pages (src/renderPackPages.js, the first pages
 * nested one directory deep, /repertoire-packs/<id>.html) was a bare
 * page-relative filename with no leading slash -- correct only from a
 * root-level page. The OLD version of this function always resolved a
 * relative target against distDir root regardless of which file it was
 * found in, so a relative link like 'eco-openings.html' on the (nested)
 * pack detail page was checked against dist/eco-openings.html -- which
 * really does exist at the site root -- and passed, even though a browser
 * actually resolves that same href, found on a page at
 * /repertoire-packs/<id>.html, to the nonexistent
 * /repertoire-packs/eco-openings.html. See src/render.js's
 * siteRelativeHref() for the render-time fix that makes every internal href
 * this site emits root-relative going forward; this resolver is fixed
 * independently so it actually catches a regression of the same bug class
 * even if a future call site forgets to use that helper.
 *
 * @returns {string|null} the absolute filesystem path the target should
 *   exist at, or null for a target this checker doesn't apply to (a
 *   same-page fragment or query with nothing else).
 */
function resolveInternalTarget(distDir, target, referringFile = null) {
  const withoutFragment = target.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  if (!withoutQuery) return null;
  if (withoutQuery.startsWith('/')) {
    return path.join(distDir, withoutQuery.replace(/^\//, ''));
  }
  const baseDir = referringFile ? path.dirname(referringFile) : distDir;
  return path.join(baseDir, withoutQuery);
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

    const resolved = resolveInternalTarget(distDir, target, filePath);
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
