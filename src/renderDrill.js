'use strict';

/**
 * Page markup for the single-opening progressive recall drill (beta pilot).
 * Same division of labor as src/renderContent.js: this module is never
 * itself bundled into a browser bundle (see src/buildStatic.js's
 * bundleBrowserEntry() / buildDrillBundle() -- the drill's browser entry
 * point is src/browser/drill.client.js, not this file), so it may freely
 * require() render.js, chessPosition.js, renderContent.js, site.js, and
 * structuredData.js.
 *
 * The page is built to work with JavaScript disabled: the board is rendered
 * server-side at the drill's actual starting position (the opening line
 * plus the top-played opponent reply for the default rating band -- see
 * renderDrillPage below), and every drilled line across every rating band is
 * listed as plain text in a <details> block. src/browser/drill.client.js
 * only ever repaints/wires up nodes that are already present in this markup;
 * it never needs to inject structural HTML for the page to be readable.
 */

const { escapeHtml, formatPct, renderDocumentHead, renderHeader, renderFooter, renderPageHead } = require('./render');
const { renderBreadcrumb } = require('./renderContent');
const { FILES, RANKS, START_BOARD, applyUciMoves } = require('./chessPosition');
const { SITE_NAME, absoluteUrl } = require('./site');
const { breadcrumbJsonLd, jsonLdScript } = require('./structuredData');

const DEFAULT_BAND = '1600-1800';

const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/**
 * Reused, minimal design system (spec: no visual refresh here, only the
 * pieces this page actually needs). Emitted via renderDocumentHead's
 * `extraCss` param, so every other page's <head> is byte-for-byte unchanged.
 */
const DRILL_CSS = `
  /* Desktop two-column layout (design-standards.md 4.5): board + controls
     in a fixed-max-width left column, the candidates table filling the
     remainder, instead of one long stacked column leaving roughly half a
     1440px viewport empty. Single column below 1024px, unchanged — this
     only adds a min-width media query, nothing else about the markup
     changes for narrower viewports. */
  @media (min-width: 1024px) {
    .drill-layout {
      display: grid;
      grid-template-columns: minmax(0, 480px) 1fr;
      gap: var(--space-6);
      align-items: start;
    }
  }

  .drill-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin: var(--space-4) 0 var(--space-3);
  }
  .drill-controls legend { font-weight: 700; padding: 0 var(--space-2); }
  .drill-controls label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); color: var(--color-muted); }
  .drill-controls select { font: inherit; padding: var(--space-2) var(--space-3); border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }
  .drill-level-progress { font-size: var(--text-sm); color: var(--color-muted); margin: 0 0 var(--space-4); }

  .drill-move-input { display: flex; gap: var(--space-3); margin: var(--space-4) 0; }
  .drill-move-input input { flex: 1 1 200px; font: inherit; padding: var(--space-3) var(--space-4); border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); }
  .drill-move-input button { min-height: 44px; font: inherit; font-weight: 700; padding: var(--space-3) var(--space-5); border: none; border-radius: var(--radius-md); background: var(--color-accent-dark); color: var(--color-accent-contrast); cursor: pointer; }

  button.board-sq { border: none; padding: 0; margin: 0; cursor: pointer; }
  button.board-sq[aria-pressed="true"] { outline: 3px solid var(--color-focus); outline-offset: -3px; }
  button.board-sq:hover { filter: brightness(0.95); }

  .drill-feedback { border-radius: var(--radius-md); padding: var(--space-4); margin: var(--space-4) 0; font-size: var(--text-base); min-height: 1.5em; }
  .drill-feedback--correct { background: var(--color-win-bg); color: var(--color-win-text); }
  .drill-feedback--offmeta { background: var(--color-draw-bg); color: var(--color-draw-text); }
  .drill-feedback--unknown { background: var(--color-loss-bg); color: var(--color-loss-text); }

  .drill-show-answer { min-height: 44px; margin: 0 0 var(--space-3); font: inherit; padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; }
`;

function pieceLabel(piece) {
  if (!piece) return null;
  const isWhite = piece === piece.toUpperCase();
  return `${isWhite ? 'white' : 'black'} ${PIECE_NAMES[piece.toLowerCase()] || ''}`.trim();
}

function pieceSpanHtml(piece, glyphs) {
  if (!piece) return '';
  const isWhite = piece === piece.toUpperCase();
  const glyph = glyphs[piece.toLowerCase()];
  return `<span class="board-pc--${isWhite ? 'w' : 'b'}" aria-hidden="true">${glyph}</span>`;
}

/**
 * Renders the drill board as 64 real, individually-focusable buttons (spec:
 * click-to-move plus keyboard, no drag-and-drop -- WCAG 2.2 SC 2.5.7). Every
 * square carries a non-empty aria-label naming the square and, when
 * occupied, the piece on it.
 *
 * @param {Record<string,string>} board square -> FEN piece letter
 * @param {{glyphs: Record<string,string>, flip?: boolean}} opts
 */
function renderDrillBoard(board, { glyphs, flip = false } = {}) {
  const fileOrder = flip ? [...FILES].reverse() : FILES;
  const rankOrder = flip ? RANKS : [...RANKS].reverse();
  const squares = [];
  for (const rank of rankOrder) {
    for (const file of fileOrder) {
      const square = `${file}${rank}`;
      const isDark = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
      const piece = board[square];
      const label = pieceLabel(piece) ? `${square}, ${pieceLabel(piece)}` : `${square}, empty`;
      squares.push(
        `<button type="button" class="board-sq board-sq--${isDark ? 'dark' : 'light'}" data-square="${square}" aria-pressed="false" aria-label="${escapeHtml(label)}">${pieceSpanHtml(piece, glyphs)}</button>`
      );
    }
  }
  return `<div class="board" data-drill-board role="group" aria-label="Drill board">${squares.join('')}</div>`;
}

/**
 * Placeholder shown in the candidate-table slot before the user has
 * attempted this position (or clicked "Show me the answer"). This table
 * used to print the band-typical move, its score, and every other
 * candidate's score right next to the input, spoiling the drill before a
 * first guess. It's now gated behind the exact same trigger the answer feedback panel
 * (#drill-feedback) already used -- an attempt or "Show me the answer" --
 * so neither reveals more than the other. Real candidate data is filled in
 * client-side only (see src/browser/drill.client.js's renderCandidateTable(),
 * called from gradeAndAdvance() alongside setFeedback()); nothing here ever
 * renders the real table server-side, so it isn't visible via "View Page
 * Source" pre-attempt either -- not just hidden by CSS.
 */
const CANDIDATE_TABLE_PLACEHOLDER = '<p class="empty-note">Play a move, or click &ldquo;Show me the answer,&rdquo; to reveal the candidates for this position.</p>';

/**
 * Walks a band's tree (rooted at an oppNode) and returns every full line
 * (opponent ply, user ply, opponent ply, ...) down to the deepest user ply,
 * as plain descriptors -- used for the no-JS-visible details/summary line
 * list (spec 3.6).
 */
function enumerateLines(rootOppNode) {
  const lines = [];
  function walk(oppNode, acc) {
    for (const reply of oppNode.replies) {
      const withOpp = [...acc, { side: 'opponent', san: reply.san, playedPct: reply.playedPct }];
      const userNode = reply.node;
      const top = userNode.candidates[0];
      const withUser = [...withOpp, { side: 'user', san: top.san, playedPct: top.playedPct, winPct: top.winPct }];
      if (userNode.then) {
        walk(userNode.then, withUser);
      } else {
        lines.push(withUser);
      }
    }
  }
  walk(rootOppNode, []);
  return lines;
}

function formatLineText(line) {
  return line
    .map((ply) => {
      if (ply.side === 'opponent') {
        return `${ply.san}${ply.playedPct != null ? ` (${formatPct(ply.playedPct)}%)` : ''}`;
      }
      return `${ply.san}${ply.playedPct != null && ply.winPct != null ? ` (${formatPct(ply.playedPct)}%, ${formatPct(ply.winPct)}% for White)` : ''}`;
    })
    .join(', ');
}

/**
 * @param {object} opts
 * @param {object} opts.drillData baked drill payload (src/buildDrill.js's
 *   buildDrillData output)
 * @param {object} opts.nav nav object for renderHeader (STATIC_NAV plus `drill`)
 * @param {{privacy?: string, about?: string, contact?: string}} [opts.legalLinks]
 * @param {string} [opts.openingLink] filename of the matching opening page
 * @param {string} [opts.repertoireLink] filename of the matching rating-band
 *   repertoire page, for the "keep exploring" section
 */
function renderDrillPage({ drillData, nav, legalLinks, openingLink = 'italian-game.html', repertoireLink }) {
  const bandKeys = Object.keys(drillData.bands);
  const defaultBand = bandKeys.includes(DEFAULT_BAND) ? DEFAULT_BAND : bandKeys[0];
  const rootOpp = drillData.bands[defaultBand];
  const firstReply = rootOpp.replies[0];

  // Progressive enhancement: the visible board is at the position the user
  // actually starts interacting with -- the opening line, plus the opponent's
  // top-played reply for the default band, auto-played the same way a live
  // round opens (spec 3.4/3.6).
  const board = applyUciMoves(
    START_BOARD,
    [...drillData.prefix.map((p) => p.uci), firstReply.uci]
  );

  const title = `Italian Game Opening Drill by Rating Band | ${SITE_NAME}`;
  const description = 'Drill the Italian Game against the move players at your rating actually play. Four rating bands, real Lichess win rates on every move. Free, no signup.';
  const canonical = absoluteUrl('italian-game-drill.html');
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Openings', href: nav.openings },
    { label: drillData.opening.name, href: openingLink },
    { label: 'Drill' },
  ];
  const webApplicationJsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: `${drillData.opening.name} Opening Drill`,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    url: canonical,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
  const jsonLd = [breadcrumbJsonLd(breadcrumbItems), webApplicationJsonLd].join('\n  ');

  const bandOptions = bandKeys
    .map((b) => `<option value="${escapeHtml(b)}"${b === defaultBand ? ' selected' : ''}>${escapeHtml(b)}</option>`)
    .join('');
  const levelOptions = [1, 2, 3, 4]
    .map((lvl) => `<option value="${lvl}"${lvl === 1 ? ' selected' : ''}${lvl > 1 ? ' disabled' : ''}>Level ${lvl}${lvl > 1 ? ' (locked)' : ''}</option>`)
    .join('');

  const linesBlock = bandKeys
    .map((band) => {
      const lines = enumerateLines(drillData.bands[band]);
      const items = lines.map((line) => `<li>${escapeHtml(formatLineText(line))}</li>`).join('');
      return `<h3>${escapeHtml(band)}</h3><ol>${items}</ol>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'website', jsonLd, extraCss: DRILL_CSS })}
<body class="layout--wide">
  ${renderHeader(nav, 'drill')}
  <main>
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      eyebrow: 'Drill',
      title: 'Italian Game drill &mdash; play the move your rating band plays',
      subtitle: 'One opening, drilled move by move: play the Italian Game from move 1 against the replies club players actually pick.',
    })}

    <div class="drill-layout">
      <div class="drill-column-play">
        <fieldset class="drill-controls">
          <legend>Drill settings</legend>
          <label>Rating band
            <select id="drill-band">${bandOptions}</select>
          </label>
          <label>Level
            <select id="drill-level">${levelOptions}</select>
          </label>
        </fieldset>
        <p class="drill-level-progress" id="drill-level-progress">Level 1 unlocked. Play 3 clean rounds to unlock level 2.</p>

        <section aria-labelledby="drill-play-heading">
          <h2 id="drill-play-heading">Play the move</h2>
          <p id="drill-announce" role="status" aria-live="polite">${escapeHtml(drillData.opening.side)} to play. Type a move, or tap a piece then a destination square.</p>
          <form class="drill-move-input" id="drill-move-form">
            <label class="sr-only" for="drill-move-text">Type your move (SAN or UCI)</label>
            <input type="text" id="drill-move-text" name="move" placeholder="e.g. Bc4 or f1c4" autocomplete="off">
            <button type="submit" id="drill-submit">Play</button>
          </form>
          <figure class="board-figure">
            ${renderDrillBoard(board, { glyphs: drillData.glyphs, flip: false })}
            <figcaption>Tap a piece, then tap where it should move &mdash; or type the move above.</figcaption>
          </figure>
          <button type="button" class="drill-show-answer" id="drill-show-answer">Show me the answer</button>
          <p class="drill-feedback" id="drill-feedback" role="status" aria-live="polite"></p>
        </section>
      </div>

      <div class="drill-column-candidates">
        <section aria-labelledby="drill-candidates-heading">
          <h2 id="drill-candidates-heading">Candidates at this position</h2>
          <p class="table-hint">Scroll to see more &rarr;</p>
          <section id="drill-candidate-table" class="table-scroll" tabindex="0" aria-label="Candidate moves at this position">${CANDIDATE_TABLE_PLACEHOLDER}</section>
        </section>
      </div>
    </div>

    <details>
      <summary>See every line in this drill</summary>
      ${linesBlock}
    </details>

    <section>
      <h2>Keep exploring</h2>
      <p><a href="${escapeHtml(openingLink)}">Back to the ${escapeHtml(drillData.opening.name)} overview &rarr;</a></p>
      ${repertoireLink ? `<p><a href="${escapeHtml(repertoireLink)}">Full ${escapeHtml(defaultBand)} repertoire explorer &rarr;</a></p>` : ''}
    </section>

    <script type="application/json" id="drill-data">${JSON.stringify(drillData)}</script>
    <script src="drill.js" defer></script>
  </main>
  ${renderFooter(`Drill data from the <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer</a>, retrieved ${escapeHtml(String(drillData.retrieved).slice(0, 10))}. Your level/streak progress is saved only in your own browser (local storage) &mdash; see the privacy policy.`, legalLinks)}
</body>
</html>
`;
}

module.exports = {
  renderDrillPage,
  renderDrillBoard,
  DRILL_CSS,
};
