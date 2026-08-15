'use strict';

/**
 * Shared board-rendering and CSS helpers for the Drill Engine v2 surfaces
 * (WS-1 spec section 3.3): src/renderDrillHub.js's hub+session page and
 * drill-reference page both require() this module rather than duplicating
 * the board markup or its styles. This file itself renders no whole page
 * (that split moved to renderDrillHub.js -- see this project's own
 * DECISION note below for why).
 *
 * DECISION, stated since a reader who remembers the old single-opening
 * pilot will otherwise wonder where renderDrillPage() went: this module
 * used to render the standalone /italian-game-drill.html page directly,
 * with the full band tree (every line, every band) baked into a
 * server-rendered <script type="application/json"> block. The WS-1 spec's
 * binding SPOILER RULE (section 3.3) forbids exactly that shape: "not in
 * the page's embedded JSON if that JSON is scoped to the current card."
 * The old page's JSON blob held the ENTIRE tree -- every userNode's
 * `candidates[0]` (the answer) sat in the page source before any attempt.
 * That page is now a redirect stub (src/buildStatic.js's
 * DRILL_PILOT_STUB_FILE); its replacement (src/renderDrillHub.js's hub+
 * session page) never embeds more than the CURRENT card's own play path,
 * fetched from src/browser/bandData.client.js per card, never baked in at
 * build time. Nothing here is deleted: renderDrillBoard() and DRILL_CSS
 * are the exact reusable pieces the old page and the new one both need,
 * kept in this one file so there is still exactly one board renderer and
 * one drill stylesheet, not two.
 */

const { escapeHtml } = require('./render');
const { FILES, RANKS } = require('./chessPosition');

const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/**
 * Placeholder shown in the candidate-table slot before an attempt or an
 * explicit reveal. Never replaced with real data server-side -- see the
 * SPOILER RULE note above -- so it isn't visible via "View Page Source"
 * either, not just hidden by CSS.
 */
const CANDIDATE_TABLE_PLACEHOLDER = '<p class="empty-note">Play a move, or click &ldquo;Show me the answer,&rdquo; to reveal the candidates for this position.</p>';

/**
 * Reused, minimal design system additions this asset's pages need beyond
 * SITE_CSS's base (design-standards.md: no new tokens beyond the
 * pre-authorised --color-due-* set -- see src/render.js's THEME_ROLES).
 * Single column below 1024px; a fixed-max-width board column plus a
 * flexible content column at 1024px and up (design-standards.md 4.5).
 */
const DRILL_CSS = `
  @media (min-width: 1024px) {
    .drill-layout {
      display: grid;
      grid-template-columns: minmax(0, 480px) 1fr;
      gap: var(--space-6);
      align-items: start;
    }
    /* [hidden] is an equal-specificity attribute selector to .drill-layout
       above -- without this, the class rule's "display: grid" wins the
       cascade (same specificity, later in source order) and the session
       section renders BEFORE a session starts at >=1024px, even though
       the server-rendered markup carries the hidden attribute (real bug,
       caught by this asset's own visual QA screenshots, not by any
       automated test -- viewport-specific, since below 1024px this rule
       never applies and [hidden]'s UA default "display: none" wins on its
       own). Restores the real UA-default behavior explicitly. */
    .drill-layout[hidden] {
      display: none;
    }
  }

  .drill-verdict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    margin: var(--space-4) 0;
    background: var(--color-surface);
  }
  .drill-verdict-count { font: var(--type-display); font-variant-numeric: tabular-nums; }
  .drill-verdict-count .n { color: var(--color-due-text); }
  .drill-primary-action {
    min-height: 44px; font: inherit; font-weight: 700; padding: var(--space-3) var(--space-5);
    border: none; border-radius: var(--radius-md); background: var(--color-accent-dark);
    color: var(--color-accent-contrast); cursor: pointer;
  }
  .drill-primary-action:disabled { background: var(--color-border-strong); cursor: not-allowed; }
  .drill-due-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-due-bg);
    color: var(--color-due-text);
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .drill-stuck-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-loss-bg);
    color: var(--color-loss-text);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .drill-deck-list, .drill-stuck-list { list-style: none; padding: 0; margin: var(--space-3) 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .drill-deck-row, .drill-stuck-row {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
    padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md);
  }
  .drill-deck-row button, .drill-stuck-row a { min-height: 44px; }

  .drill-seed-card { border: 1px dashed var(--color-border-strong); border-radius: var(--radius-md); padding: var(--space-4); margin: var(--space-4) 0; }
  .drill-seed-form { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; margin-top: var(--space-3); }
  .drill-seed-form label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); color: var(--color-muted); }
  .drill-seed-form select { font: inherit; padding: var(--space-2) var(--space-3); border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }

  .drill-session-length { display: flex; gap: var(--space-2); margin: var(--space-3) 0; }
  .drill-session-length button { min-height: 44px; font: inherit; padding: var(--space-2) var(--space-4); border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; }
  .drill-session-length button[aria-pressed="true"] { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-contrast); }

  .drill-move-input { display: flex; gap: var(--space-3); margin: var(--space-4) 0; }
  .drill-move-input input { flex: 1 1 200px; font: inherit; padding: var(--space-3) var(--space-4); border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md); }
  .drill-move-input button { min-height: 44px; font: inherit; font-weight: 700; padding: var(--space-3) var(--space-5); border: none; border-radius: var(--radius-md); background: var(--color-accent-dark); color: var(--color-accent-contrast); cursor: pointer; }

  button.board-sq { border: none; padding: 0; margin: 0; cursor: pointer; min-width: 44px; min-height: 44px; }
  button.board-sq[aria-pressed="true"] { outline: 3px solid var(--color-focus); outline-offset: -3px; }
  button.board-sq:hover { filter: brightness(0.95); }

  .drill-feedback { border-radius: var(--radius-md); padding: var(--space-4); margin: var(--space-4) 0; font-size: var(--text-base); min-height: 1.5em; transition: background var(--motion-duration-entering) ease; }
  .drill-feedback--correct { background: var(--color-win-bg); color: var(--color-win-text); }
  .drill-feedback--offmeta { background: var(--color-draw-bg); color: var(--color-draw-text); }
  .drill-feedback--unknown { background: var(--color-loss-bg); color: var(--color-loss-text); }

  .drill-show-answer { min-height: 44px; margin: 0 0 var(--space-3); font: inherit; padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; }

  .drill-reference-line { padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border); }
  .drill-reference-line:last-child { border-bottom: none; }

  @media (prefers-reduced-motion: reduce) {
    .drill-feedback { transition: none; }
  }
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
  return `<span class="board-pc--${isWhite ? 'w' : 'b'}" aria-hidden="true">${escapeHtml(glyph)}</span>`;
}

/**
 * Renders a board as 64 real, individually-focusable buttons (click-to-move
 * plus keyboard, no drag-and-drop -- WCAG 2.2 SC 2.5.7). Every square
 * carries a non-empty aria-label naming the square and, when occupied, the
 * piece on it. Used both server-side (the session view's initial position,
 * so the page is readable before drill-hub.js runs) and repainted
 * client-side on every move (src/browser/drill.client.js's paintBoard()).
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

module.exports = {
  renderDrillBoard,
  DRILL_CSS,
  CANDIDATE_TABLE_PLACEHOLDER,
  pieceLabel,
  pieceSpanHtml,
};
