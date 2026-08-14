'use strict';

/**
 * RSS 2.0 feed generation for the content pages that actually get
 * added/updated over time -- the opening
 * guides and editorial articles buildContent.js writes, not the repertoire
 * explorer pages (those are a fixed set of band/color combinations, not
 * "content" in the publishing sense). Pure function, no I/O --
 * src/buildStatic.js is responsible for writing the returned string to
 * dist/feed.xml.
 *
 * HONEST LIMITATION: every item's <pubDate> currently falls back to the
 * same site-wide BUILD_DATE unless an explicit `date` is supplied per item,
 * because buildContent.js's entries don't track individual page
 * authorship/first-publish dates today. That means a feed reader cannot
 * yet distinguish "written today" from "written months ago, rebuilt
 * today" -- acceptable for now (subscribers still see every current page
 * once), but worth fixing if per-page authored dates are ever added to the
 * content data model.
 */

const { absoluteUrl, SITE_TAGLINE, BUILD_DATE } = require('./site');
const { escapeHtml } = require('./render');

const SITE_NAME_FOR_FEED = 'Repertoire Builder';

/**
 * @param {string} dateStr an ISO date (YYYY-MM-DD).
 * @returns {string} an RFC 822 date string, the format RSS <pubDate>
 *   requires. Uses noon UTC so a date-only input never rolls to the
 *   adjacent calendar day depending on the reader's timezone.
 */
function rfc822(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toUTCString();
}

/**
 * @param {Array<{file: string, title: string, description?: string, date?: string}>} items
 *   flat dist/ filenames plus the metadata already extracted for each
 *   (buildContent.js's `written` entries already carry title/description).
 * @returns {string} a complete RSS 2.0 document.
 */
function renderRssXml(items) {
  const lastBuildDate = rfc822(BUILD_DATE);
  const itemsXml = items
    .map((item) => {
      const link = absoluteUrl(item.file);
      return `  <item>
    <title>${escapeHtml(item.title)}</title>
    <link>${escapeHtml(link)}</link>
    <guid isPermaLink="true">${escapeHtml(link)}</guid>
    <description>${escapeHtml(item.description || '')}</description>
    <pubDate>${rfc822(item.date || BUILD_DATE)}</pubDate>
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeHtml(SITE_NAME_FOR_FEED)}</title>
  <link>${escapeHtml(absoluteUrl(''))}</link>
  <description>${escapeHtml(SITE_TAGLINE)}</description>
  <language>en-us</language>
  <lastBuildDate>${lastBuildDate}</lastBuildDate>
${itemsXml}
</channel>
</rss>
`;
}

module.exports = { renderRssXml, rfc822 };
