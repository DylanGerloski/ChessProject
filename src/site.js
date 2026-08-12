'use strict';

/**
 * Site-wide constants: one place to change origin/base-path/branding so a
 * future custom-domain move or rename is a one-line edit plus a
 * rebuild, not a grep-and-replace across every page template. Pure data, no
 * I/O -- safe to require from anywhere, including renderContent.js.
 */

const SITE_ORIGIN = 'https://repertoire-builder.com';
const BASE_PATH = '/';
const SITE_NAME = 'Lichess Stats';
const SITE_TAGLINE = 'Chess opening stats by rating band, from real Lichess games.';
// No individually-attributed human byline has been supplied for this build --
// do not invent a person.
// Article/Organization structured data (phase 3) should use SITE_AUTHOR as an
// Organization, not a fabricated person, unless the human supplies a real name.
const SITE_AUTHOR = SITE_NAME;
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/**
 * @param {string} file a flat filename as written to dist/, e.g. 'italian-game.html'.
 *   Pass '' (or omit) for the site root.
 * @returns {string} an absolute URL under SITE_ORIGIN + BASE_PATH.
 */
function absoluteUrl(file = '') {
  return `${SITE_ORIGIN}${BASE_PATH}${file}`;
}

module.exports = {
  SITE_ORIGIN,
  BASE_PATH,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_AUTHOR,
  BUILD_DATE,
  absoluteUrl,
};
