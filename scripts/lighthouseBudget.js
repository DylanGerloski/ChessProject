'use strict';

/**
 * CI quality gate: Lighthouse budget enforcement.
 *
 * Reuses scripts/lighthouseRunner.js (extracted from scripts/visual-qa.js,
 * which already had this server+Chromium+Lighthouse machinery) rather than
 * duplicating it. Zero new dependencies.
 *
 * Gates Performance / Accessibility / Best Practices / SEO all >= 90 on the
 * homepage and three representative inner pages: one main opening page, one
 * family/variations hub, and the methodology page once it ships.
 *
 * Set at 90, not a higher aspirational number: 90 is this site's binding
 * accessibility/performance floor today. Gating at a number the site does
 * not yet reach would make the pipeline permanently red and get ignored,
 * which is worse than no gate. Raise BUDGET_MIN_SCORE only once the site
 * actually clears a higher bar across the board, not before.
 *
 * Usage: node scripts/lighthouseBudget.js [distDir]   (default: dist)
 */

const fs = require('fs');
const path = require('path');
const { resolveTarget, launchBrowser, runLighthouse } = require('./lighthouseRunner');

const BUDGET_MIN_SCORE = 90; // see header comment -- raise only once the site clears a higher bar for real
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
// On every AdSense-bearing page, Google's own adsbygoogle.js Auto Ads
// script sets a real third-party cookie (evidence: a
// googleads.g.doubleclick.net request in the Lighthouse trace), which caps
// the Best Practices score at 77 regardless of this site's own markup or
// config -- a true positive about live third-party ad behavior, not a
// template bug this project can fix. These two audits are skipped for that
// reason (reviewed and approved as an accepted residual risk, the same
// treatment already applied to AdSense's script-src CSP limitation)
// rather than left permanently red or gamed. Ad-loading timing/behavior is
// deliberately left unchanged by this exception.
const SKIP_AUDITS = ['third-party-cookies', 'inspector-issues'];
// Distinct from scripts/visual-qa.js's 9522 so both can run in the same CI
// job without a CDP port clash.
const CDP_PORT = 9523;

// Each entry is either a plain filename, or {page, skipCategories} when a
// category is a KNOWN, documented, temporary exception for that one page --
// distinct from SKIP_AUDITS below, which is a permanent, sitewide, specific-
// audit exemption. skipCategories exists because this gate's pass/fail
// result directly controls whether deploy-pages.yml's `deploy` job runs
// (`needs: quality`) -- adding a page that's KNOWN to fail an entire
// category outright, with no per-category escape hatch, would block every
// future deploy of the WHOLE SITE on one unrelated page's known gap, not
// just fail a check for that page.
const GATED_PAGES = [
  'index.html', // homepage
  'italian-game.html', // representative main opening page
  'italian-game-variations.html', // representative family/variations hub
  'methodology.html', // methodology page -- not yet built; expected to fail this gate until it ships
  // Repertoire Pack sales pages (design-standards.md Distinctiveness Gate
  // item 6: "both new page types"). Both currently carry noindex (STORE in
  // src/render.js still ships sentinel, not-yet-real, merchant urls -- see
  // isPlaceholderStoreUrl()) until a human picks a merchant and real STORE
  // urls land, so `seo` is skipped here specifically (Lighthouse's
  // "is-crawlable" audit -- everything else on these two pages already
  // scores >=90) rather than exempting the whole page from this gate.
  // Remove this skipCategories override once STORE carries real urls --
  // at that point noindex clears and seo should score >=90 like every
  // other page, so a real regression would show up again immediately.
  { page: 'repertoire-packs.html', skipCategories: ['seo'] },
  { page: 'repertoire-packs/white-1400-1600.html', skipCategories: ['seo'] }, // a representative pack detail page (the second new page type)
];

function scoreOf(categories, key) {
  const cat = categories[key];
  if (!cat || cat.score === null || cat.score === undefined) return null;
  return Math.round(cat.score * 100);
}

// Names the specific audit(s) dragging a failing category below budget --
// a bare category score (e.g. "best-practices: 75") gives no signal for
// root-causing a regression; this is what a human/agent actually needs to
// read next, per this gate's whole purpose. Pure (no browser/Lighthouse
// call) so it's directly unit-testable against a fixture lhr shape.
function culpritAuditsFor(lhr, categoryKey) {
  const cat = lhr.categories && lhr.categories[categoryKey];
  if (!cat || !Array.isArray(cat.auditRefs)) return [];
  return cat.auditRefs
    .map((ref) => lhr.audits[ref.id])
    .filter((audit) => audit && audit.score !== null && audit.score < 1)
    .map((audit) => `${audit.id} (${audit.title}): score ${audit.score}${audit.displayValue ? `, ${audit.displayValue}` : ''}`);
}

async function auditPage(distDir, page, skipCategories = []) {
  const filePath = path.join(distDir, page);
  if (!fs.existsSync(filePath)) {
    return { page, ok: false, missing: true };
  }
  const { pageUrl, cleanup } = await resolveTarget(filePath);
  const browser = await launchBrowser(CDP_PORT);
  try {
    const lhr = await runLighthouse(pageUrl, { categories: CATEGORIES, cdpPort: CDP_PORT, skipAudits: SKIP_AUDITS });
    const scores = {};
    const failures = [];
    const failingAudits = {};
    for (const key of CATEGORIES) {
      const score = scoreOf(lhr.categories, key);
      scores[key] = score;
      if (skipCategories.includes(key)) continue;
      if (score === null || score < BUDGET_MIN_SCORE) {
        failures.push(`${key}: ${score === null ? 'n/a' : score}`);
        const culprits = culpritAuditsFor(lhr, key);
        if (culprits.length > 0) failingAudits[key] = culprits;
      }
    }
    return { page, ok: failures.length === 0, scores, failures, skipCategories, failingAudits };
  } finally {
    await browser.close();
    await cleanup();
  }
}

async function runAll(distDir) {
  const results = [];
  for (const entry of GATED_PAGES) {
    const page = typeof entry === 'string' ? entry : entry.page;
    const skipCategories = typeof entry === 'string' ? [] : (entry.skipCategories || []);
    results.push(await auditPage(distDir, page, skipCategories));
  }
  return results;
}

async function main() {
  const distDir = path.resolve(process.argv[2] || 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`lighthouseBudget: dist directory not found at ${distDir}. Run npm run build:static first.`);
    process.exitCode = 1;
    return;
  }

  const results = await runAll(distDir);
  let anyFail = false;
  for (const result of results) {
    if (result.missing) {
      anyFail = true;
      console.error(`FAIL  ${result.page}: not found in ${distDir} (not yet built)`);
    } else if (!result.ok) {
      anyFail = true;
      console.error(`FAIL  ${result.page}: ${result.failures.join(', ')} (budget: >= ${BUDGET_MIN_SCORE})`);
      if (result.failingAudits) {
        for (const [category, culprits] of Object.entries(result.failingAudits)) {
          for (const culprit of culprits) {
            console.error(`        ${category} audit failing: ${culprit}`);
          }
        }
      }
    } else {
      const skipNote = result.skipCategories && result.skipCategories.length > 0
        ? ` (${result.skipCategories.join(', ')} exempted -- see GATED_PAGES comment)`
        : '';
      console.log(`PASS  ${result.page}: ${CATEGORIES.map((k) => `${k}=${result.scores[k]}`).join(' ')}${skipNote}`);
    }
  }

  process.exitCode = anyFail ? 1 : 0;
  console.log(anyFail ? '\nlighthouseBudget: one or more pages failed the budget.' : '\nlighthouseBudget: all gated pages passed.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('lighthouseBudget failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { BUDGET_MIN_SCORE, CATEGORIES, GATED_PAGES, CDP_PORT, scoreOf, culpritAuditsFor, auditPage, runAll };
