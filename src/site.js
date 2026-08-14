'use strict';

/**
 * Site-wide constants: one place to change origin/base-path/branding so a
 * future custom-domain move or rename is a one-line edit plus a
 * rebuild, not a grep-and-replace across every page template. Pure data, no
 * I/O -- safe to require from anywhere, including renderContent.js.
 */

const SITE_ORIGIN = 'https://repertoire-builder.com';
const BASE_PATH = '/';
const SITE_NAME = 'Repertoire Builder';
const SITE_TAGLINE = 'The chess opening meta, by rating band: what players at your level actually play, and what actually wins.';
// No individually-attributed human byline has been supplied for this build --
// do not invent a person.
// Article/Organization structured data (phase 3) should use SITE_AUTHOR as an
// Organization, not a fabricated person, unless the human supplies a real name.
const SITE_AUTHOR = SITE_NAME;
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/**
 * @param {string} file a flat filename as written to dist/, e.g. 'italian-game.html'.
 *   Pass '' (or omit) for the site root. A leading '/' is stripped first (some
 *   callers, e.g. nav.repertoire, use '/' as the root's own href) so it never
 *   doubles up with BASE_PATH's own trailing slash -- see the regression test
 *   in test/site.test.js for the double-slash bug this guards against.
 * @returns {string} an absolute URL under SITE_ORIGIN + BASE_PATH.
 */
function absoluteUrl(file = '') {
  const cleanFile = file.startsWith('/') ? file.slice(1) : file;
  return `${SITE_ORIGIN}${BASE_PATH}${cleanFile}`;
}

/**
 * @param {string} base a page-specific title, without any site-name suffix.
 * @returns {string} `${base} | ${SITE_NAME}` -- always. The suffix used to
 *   be silently dropped when the combined title exceeded the SEO cap (spec
 *   2.2), which is why some titles shipped with no site name at all. The cap
 *   is enforced instead at buildContent.js's assertPageMetadata, which now
 *   fails the build loudly on an over-length title so the base title gets
 *   shortened at the source instead of the suffix quietly disappearing.
 */
function pageTitle(base) {
  return `${base} | ${SITE_NAME}`;
}

module.exports = {
  SITE_ORIGIN,
  BASE_PATH,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_AUTHOR,
  BUILD_DATE,
  absoluteUrl,
  pageTitle,
};
