'use strict';

/**
 * Interactive board component (Phase 7c) -- browser-only, bundled by
 * esbuild into a page's own entry point (see src/browser/*.client.js for
 * the pattern). This module is the "controller" half of the board
 * component -- one visual component, four modes (static/replay/free/sync),
 * same markup and tokens in all of them, only the controller differs. The
 * static (no-JS) markup half is src/boardSvg.js, used directly by
 * renderContent.js at build time. "sync" (added for the Opening Explorer's
 * synced board panel) is display-only with no owned controls -- see
 * mountSyncBoard's own doc comment below.
 *
 * "Replay" mode lives in src/boardWidgetReplay.js and "free" mode
 * (full legal-move input, needs chess.js) lives in src/boardWidgetFree.js
 * -- both SEPARATE modules, not here, deliberately, as of task B1. Every
 * page that require()s THIS module pays for everything in it, because
 * esbuild's CommonJS bundling includes a whole required module regardless
 * of which of its exports a caller actually destructures (no per-export
 * tree-shaking across a CJS require() boundary) -- so this file stays down
 * to exactly what the leanest consumer (the Explorer's synced panel,
 * src/browser/repertoire.client.js, which only ever needs createBoard +
 * mountSyncBoard) needs. Confirmed by measurement, not assumed: this split
 * is what keeps repertoire.js under its 160KB hard budget (spec section
 * 2.1.5) -- see boardWidgetReplay.js/boardWidgetFree.js's own header
 * comments for the other two modes.
 *
 * Contract for any page that mounts a board from this module: the page's
 * server-rendered HTML must already include boardSvg.js's
 * spriteDefsHtml() output once, before this module runs. cm-chessboard
 * (see below) looks for that same element id
 * (boardSvg.SPRITE_WRAPPER_ID, "cm-chessboard-sprite") and, finding it
 * already in the DOM, never issues its own sprite fetch -- which is what
 * keeps this working under a file:// URL. Skipping that include still
 * "works" over https (cm-chessboard falls back to an XMLHttpRequest for
 * the sprite file) but breaks the file:// invariant this site otherwise
 * guarantees for every page except one that genuinely needs live,
 * client-side move exploration.
 *
 * Uses cm-chessboard 8.13.0 (MIT, license-screened via `npm view` against
 * the OSV.dev vulnerability database) plus its Accessibility extension (a
 * real <table> position view, a pieces-as-list view, a move form, and an
 * ARIA live region -- verified by reading
 * node_modules/cm-chessboard/src/extensions/accessibility/Accessibility.js
 * directly, not assumed from the README). Never loads cm-chessboard's own
 * assets/chessboard.css (which ships hardcoded hex colors) -- theming is
 * the `.cm-chessboard.repertoire-theme` block in src/render.js's SITE_CSS,
 * wired to this project's own design tokens.
 */

const { Chessboard, COLOR, BORDER_TYPE, FEN } = require('cm-chessboard/src/Chessboard.js');
const { Accessibility } = require('cm-chessboard/src/extensions/accessibility/Accessibility.js');

// cm-chessboard's animationDuration is a plain JS number (milliseconds), not
// a CSS value it reads itself -- there is no way to hand it a var()
// reference directly. Reading the live computed value keeps the token
// (src/render.js's --motion-duration-piece) the single source of truth
// instead of a second hardcoded "200" living here; the literal fallback
// below only covers a computed-style read failing outright (e.g. this
// module under a test harness with no stylesheet loaded).
function motionDurationMs(varName, fallbackMs) {
  if (typeof getComputedStyle !== 'function') return fallbackMs;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const ms = parseFloat(raw);
  return Number.isFinite(ms) ? ms : fallbackMs;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Low-level mount shared by mountSyncBoard here, mountReplayBoard in
 * src/boardWidgetReplay.js, and mountFreeBoard in src/boardWidgetFree.js.
 * Exported (not private) so those sibling modules can reuse it without
 * duplicating cm-chessboard's setup -- see this file's own header comment
 * for why those two modes had to move out rather than just calling in.
 *
 * @param {HTMLElement} container
 * @param {{position?: string, orientation?: string, inputEnabled?: boolean}} opts
 */
function createBoard(container, { position = FEN.start, orientation = COLOR.white, inputEnabled = false } = {}) {
  container.classList.add('cm-chessboard-widget');
  const animationDuration = prefersReducedMotion() ? 0 : motionDurationMs('--motion-duration-piece', 200);
  const board = new Chessboard(container, {
    position,
    orientation,
    responsive: true,
    assetsCache: true, // no-op network-wise as long as the page pre-embeds the sprite -- see this file's header comment
    style: {
      cssClass: 'repertoire-theme',
      showCoordinates: true,
      // 'frame' (not 'none'): reserves a dedicated border band outside the
      // 8x8 grid for the a-h/1-8 coordinate labels, instead of drawing them
      // inside the outer-rank/file squares where they visibly overprinted
      // the pieces standing there -- see the matching CSS comment in
      // src/render.js's SITE_CSS for the full explanation.
      borderType: BORDER_TYPE.frame,
      pieces: { file: 'pieces/cburnett-standard.svg', tileSize: 40 },
      animationDuration,
    },
    extensions: [
      { class: Accessibility, props: { keyboardMoveInput: true } },
    ],
  });
  if (inputEnabled) {
    container.classList.add('input-enabled');
  }
  return board;
}

/**
 * "Sync" mode: display-only, no move input, no owned control group -- the
 * position is driven entirely by an external caller. Contrast
 * mountReplayBoard (src/boardWidgetReplay.js -- owns a fixed fens[] array
 * plus first/prev/next/last controls) and mountFreeBoard
 * (src/boardWidgetFree.js -- owns chess.js-backed move input): this mode
 * owns nothing but the board itself, because its caller
 * (src/browser/repertoire.client.js's synced panel) already owns the
 * "which line is selected" state in the move tree and just needs a place to
 * paint whatever FEN that resolves to. Kept as its own function rather than
 * bent out of mountReplayBoard: two unrelated state machines don't belong
 * in one function.
 *
 * @param {HTMLElement} container
 * @param {{fen?: string, orientation?: string}} opts
 * @returns {{board: object, setFen: (fen: string, animate?: boolean) => void,
 *   setOrientation: (color: string) => void, destroy: () => void}}
 */
function mountSyncBoard(container, { fen = FEN.start, orientation = COLOR.white } = {}) {
  const board = createBoard(container, { position: fen, orientation, inputEnabled: false });
  return {
    board,
    setFen(nextFen, animate = true) {
      board.setPosition(nextFen, animate && !prefersReducedMotion());
    },
    setOrientation(color) {
      board.setOrientation(color);
    },
    destroy() { board.destroy(); },
  };
}

module.exports = {
  COLOR,
  FEN,
  createBoard,
  mountSyncBoard,
};
