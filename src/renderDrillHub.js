'use strict';

/**
 * /drill.html (the hub) and /drill-reference.html -- PLACEHOLDER renderers
 * (the WS-1 spec section 6.2's binding shared-file
 * mitigation). Same "this file's contents get replaced entirely,
 * buildStatic.js/render.js never change again" pattern as
 * src/renderRepertoireBuilder.js -- see that file's own header comment for
 * the full reasoning; the follow-on task here is Drill Engine v2 (spec
 * section 3.3), which owns rewriting src/renderDrill.js, src/buildDrill.js,
 * and src/browser/drill.client.js into the real multi-opening hub -- none
 * of that is attempted here.
 *
 * /italian-game-drill.html (the existing single-opening drill pilot)
 * becomes a redirect stub to /drill.html (spec 3.3). That page's real,
 * working content is NOT deleted -- src/renderDrill.js/src/buildDrill.js/
 * src/browser/drill.client.js are untouched on disk and still exported
 * from their own modules, simply no longer called from
 * src/buildStatic.js's main build sequence, ready for the follow-on task
 * to rewrite into the new hub.
 */

const { renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { absoluteUrl, pageTitle } = require('./site');

const IS_PLACEHOLDER = true;

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} a full, minimal, honest standalone HTML document.
 */
function renderDrillHubPage({ nav, legalLinks }) {
  const title = pageTitle('Opening drill');
  const description = 'Train the openings your rating band actually plays, spaced-repetition style, seeded from any opening or from your own opening report. In progress.';
  const canonical = absoluteUrl('drill.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, noindex: true })}
<body>
<div class="page">
  ${renderHeader(nav, 'drill')}
  <main class="prose">
    <h1 class="page-title">Opening drill</h1>
    <p class="subtitle">This page is being built: a drill hub covering any opening in the band data,
      not just one &mdash; seeded from an opening report, a saved repertoire, or the band data itself,
      with spaced repetition so due cards come back when you actually need them.</p>
    <p>The full-line reference for a given opening will live at
      <a href="drill-reference.html">drill reference</a> once this ships.</p>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>.', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} a full, minimal, honest standalone HTML document.
 */
function renderDrillReferencePage({ nav, legalLinks }) {
  const title = pageTitle('Drill reference');
  const description = 'Full opening lines for the drill hub, listed in one place rather than during a drill attempt. In progress.';
  const canonical = absoluteUrl('drill-reference.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, noindex: true })}
<body>
<div class="page">
  ${renderHeader(nav, 'drill')}
  <main class="prose">
    <h1 class="page-title">Drill reference</h1>
    <p class="subtitle">This page is being built: full opening lines for the
      <a href="drill.html">opening drill</a>, listed here rather than on the drill page itself, so a
      drill attempt is never answered by the reference sitting right below it.</p>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>.', legalLinks)}
</div>
</body>
</html>
`;
}

module.exports = { renderDrillHubPage, renderDrillReferencePage, IS_PLACEHOLDER };
