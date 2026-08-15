'use strict';

/**
 * /opening-report.html -- PLACEHOLDER renderer (WS-1 spec section 6.2's binding shared-file mitigation).
 * Same "this file's contents get replaced entirely, buildStatic.js/
 * render.js never change again" pattern as src/renderRepertoireBuilder.js
 * -- see that file's own header comment for the full reasoning; the
 * follow-on task here is the Personal Opening Report (spec section 3.2).
 *
 * player.html (the existing rating-history/recent-games lookup) becomes a
 * redirect stub to this page (spec 3.2: "The existing /player.html becomes
 * a redirect stub to it"). That real content is NOT deleted -- spec 3.2:
 * "Rating history and recent games survive as a secondary section of the
 * new page" -- the follow-on task is expected to fold
 * src/browser/playerLookup.client.js's existing, working functionality
 * into this page's real implementation, not reinvent it.
 */

const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME, absoluteUrl, pageTitle } = require('./site');

const IS_PLACEHOLDER = true;

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} a full, minimal, honest standalone HTML document.
 */
function renderOpeningReportPage({ nav, legalLinks }) {
  const title = pageTitle('Opening report');
  const description = `Find the biggest gaps between what you play and what your rating band actually plays, from your Lichess username. In progress.`;
  const canonical = absoluteUrl('opening-report.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, noindex: true })}
<body>
<div class="page">
  ${renderHeader(nav, 'player')}
  <main class="prose">
    <h1 class="page-title">Opening report</h1>
    <p class="subtitle">This page is being built: enter a Lichess username and see the five biggest
      differences between what you play and what wins more often at your rating band.</p>
    <p>Rating history and recent games &mdash; the previous player-lookup page&rsquo;s own content &mdash; will move
      here as a secondary section once this ships; nothing about that feature is going away.</p>
  </main>
  ${renderFooter(`Data source: <a href="https://lichess.org/api">lichess.org/api</a>, called directly from your browser &mdash; ${escapeHtml(SITE_NAME)} never sees your games.`, legalLinks)}
</div>
</body>
</html>
`;
}

module.exports = { renderOpeningReportPage, IS_PLACEHOLDER };
