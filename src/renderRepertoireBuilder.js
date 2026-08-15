'use strict';

/**
 * /repertoire-builder.html -- PLACEHOLDER renderer (WS-1 spec section 6.2's binding shared-file mitigation).
 *
 * This file's whole reason to exist as its own module: src/buildStatic.js
 * requires and calls `renderRepertoireBuilderPage` and reads
 * `IS_PLACEHOLDER` from HERE, not from anything inline in buildStatic.js
 * itself. The follow-on task that builds the real Repertoire Builder v1
 * (spec section 3.1, task ID "W1a") replaces THIS FILE'S CONTENTS ENTIRELY
 * -- same exported function name and shape, `IS_PLACEHOLDER` flipped to
 * `false` -- and never needs to touch src/buildStatic.js or src/render.js
 * at all. That is what keeps W1a genuinely file-disjoint from W2/W3/W4;
 * see the spec section named above for the full reasoning.
 *
 * `IS_PLACEHOLDER` also drives src/buildStatic.js's sitemap/noindex
 * treatment (same "noindex until real" pattern already used for a Pack
 * page still carrying a STORE PLACEHOLDER url, src/render.js's
 * isPlaceholderStoreUrl()) -- a page that isn't built yet must not be
 * indexed or offered to search engines as if it were.
 */

const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME, absoluteUrl, pageTitle } = require('./site');

const IS_PLACEHOLDER = true;

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} a full, minimal, honest standalone HTML document --
 *   real content (not a blank shell), noindexed until the real page ships.
 */
function renderRepertoireBuilderPage({ nav, legalLinks }) {
  const title = pageTitle('Repertoire builder');
  const description = `Build and export a chess opening repertoire against real ${SITE_NAME} rating-band data. In progress.`;
  const canonical = absoluteUrl('repertoire-builder.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, noindex: true })}
<body>
<div class="page">
  ${renderHeader(nav, 'builder')}
  <main class="prose">
    <h1 class="page-title">Repertoire builder</h1>
    <p class="subtitle">This page is being built: an interactive board where every move is checked
      against what your rating band actually plays, so you can construct and export a real opening
      repertoire.</p>
    <p>In the meantime, the <a href="${escapeHtml(nav.repertoire || 'repertoire.html')}">repertoire explorer</a>
      already shows the band data itself, and the <a href="${escapeHtml(nav.packs || 'repertoire-packs.html')}">repertoire packs</a>
      are a ready-made PGN built from the same data.</p>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>.', legalLinks)}
</div>
</body>
</html>
`;
}

module.exports = { renderRepertoireBuilderPage, IS_PLACEHOLDER };
