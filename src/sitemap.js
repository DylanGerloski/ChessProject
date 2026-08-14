'use strict';

/**
 * sitemap.xml / robots.txt generation. Generated from the actual list of
 * .html filenames a build wrote, never hand-maintained, so it cannot drift
 * from what's really on disk. Pure functions, no I/O -- the caller
 * (src/buildStatic.js) is responsible for actually writing the returned
 * strings to disk.
 */

const { absoluteUrl, BUILD_DATE } = require('./site');
const { escapeHtml } = require('./render');
const { RATING_BANDS } = require('./processRepertoire');

/**
 * Home page canonicalizes to the site root (https://.../) rather than
 * /index.html, matching the canonical URL every other page already
 * declares for itself -- this is the one place that distinction is
 * applied for the sitemap.
 */
function sitemapUrlFor(file) {
  return file === 'index.html' ? absoluteUrl('') : absoluteUrl(file);
}

/**
 * The 8 old repertoire-<band>-<color>.html filenames, now redirect stubs
 * pointing at the collapsed repertoire.html (spec WS-3.2 section 2.2). A
 * redirect source must never appear in a sitemap -- mirrors how 404.html is
 * already filtered out below, rather than inventing a second mechanism.
 *
 * Computed here from RATING_BANDS x ['white','black'] using the SAME
 * filename rule src/buildStatic.js's repertoireFileName() applies (strip
 * anything but word chars/hyphens from the band, "repertoire-<band>-<color>.html"),
 * rather than importing it from buildStatic.js -- that module already
 * requires this one (renderSitemapXml/robotsTxtContent), so importing back
 * would be circular. This is the same "small, duplicated helper" convention
 * src/buildContent.js's own repertoireFileName() copy already established.
 */
function redirectStubFileName(band, color) {
  const safeBand = band.replace(/[^\w-]/g, '');
  return `repertoire-${safeBand}-${color}.html`;
}

const REDIRECT_STUBS = new Set(
  Object.keys(RATING_BANDS).flatMap((band) => ['white', 'black'].map((color) => redirectStubFileName(band, color)))
);

/**
 * @param {string[]} files flat filenames as written to dist/ (any
 *   non-`.html` entries -- player-lookup.js, ads.txt, CNAME -- are filtered
 *   out; they aren't pages). 404.html is also filtered out here -- it is the
 *   static-hosting error page (noindex, see src/renderCompliance.js), never
 *   a real destination, so it must never appear in the sitemap. Likewise
 *   every filename in REDIRECT_STUBS (the 8 old repertoire-<band>-<color>.html
 *   redirect stubs) -- a redirect source must never appear in a sitemap.
 * @returns {Array<{file:string, loc:string, lastmod:string}>} sorted by
 *   filename, for deterministic output.
 */
function buildSitemapEntries(files) {
  return files
    .filter((f) => f.endsWith('.html') && f !== '404.html' && !REDIRECT_STUBS.has(f))
    .slice()
    .sort()
    .map((f) => ({ file: f, loc: sitemapUrlFor(f), lastmod: BUILD_DATE }));
}

/**
 * @param {string[]} files see buildSitemapEntries
 * @returns {string} a complete sitemap.xml document (sitemaps.org 0.9
 *   schema). No priority/changefreq -- Google ignores both, so omitting
 *   them avoids shipping meaningless noise.
 */
function renderSitemapXml(files) {
  const entries = buildSitemapEntries(files);
  const urls = entries
    .map((e) => `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * @returns {string} robots.txt content: allow-all, pointing at the
 *   generated sitemap.xml. NOTE: on a github.io subdomain this file is NOT
 *   host-authoritative -- GitHub controls the domain-root robots.txt. It
 *   becomes authoritative the moment a custom domain is attached (see the
 *   CNAME file src/buildStatic.js already writes).
 */
function robotsTxtContent() {
  return `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl('sitemap.xml')}\n`;
}

module.exports = {
  sitemapUrlFor,
  buildSitemapEntries,
  renderSitemapXml,
  robotsTxtContent,
  REDIRECT_STUBS,
};
