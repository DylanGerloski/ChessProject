'use strict';

/**
 * Interactive board component (Phase 7c) -- browser-only, bundled by
 * esbuild into a page's own entry point (see src/browser/*.client.js for
 * the pattern; no page mounts this yet, that's follow-on work). This
 * module is the "controller" half of the board component -- one visual
 * component, three modes (static/replay/free), same markup and tokens in
 * all three, only the controller differs. The static (no-JS) markup half
 * is src/boardSvg.js, used directly by renderContent.js at build time.
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

const { Chessboard, INPUT_EVENT_TYPE, COLOR, BORDER_TYPE, FEN } = require('cm-chessboard/src/Chessboard.js');
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
 * Low-level mount shared by mountReplayBoard/mountFreeBoard below. Not
 * exported -- callers pick a mode-specific function so "free" mode can't
 * accidentally be built without its chess.js legality wiring.
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
      borderType: BORDER_TYPE.none,
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
 * "Replay" mode: steps through a precomputed FEN array
 * with first/prev/next/last controls. No chess.js, no free move input --
 * the position at every step is already known, same as the static diagram
 * this data comes from at build time. Returns a handle so a caller can
 * `.destroy()` it (e.g. if the page swaps in a different line).
 *
 * @param {HTMLElement} container a wrapper element -- the board mounts into
 *   a child div this function creates, and the replay controls append
 *   after it, so `container` itself can carry the figure/aria-label.
 * @param {{fens: string[], labels?: string[], orientation?: string, startIndex?: number}} opts
 *   `labels[i]`, if given, becomes the announced text for step i (e.g. "1. e4"); falls
 *   back to a plain "Move N of M".
 */
function mountReplayBoard(container, { fens, labels = [], orientation = COLOR.white, startIndex = 0 } = {}) {
  if (!Array.isArray(fens) || fens.length === 0) {
    throw new Error('mountReplayBoard: fens must be a non-empty array');
  }
  const boardEl = document.createElement('div');
  container.appendChild(boardEl);
  const board = createBoard(boardEl, { position: fens[startIndex], orientation, inputEnabled: false });

  const controls = document.createElement('div');
  controls.className = 'board-replay-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Board replay controls');
  const status = document.createElement('p');
  status.className = 'sr-only';
  status.setAttribute('aria-live', 'polite');
  const makeBtn = (label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', title);
    controls.appendChild(b);
    return b;
  };
  const firstBtn = makeBtn('⏮', 'First move');
  const prevBtn = makeBtn('‹', 'Previous move');
  const nextBtn = makeBtn('›', 'Next move');
  const lastBtn = makeBtn('⏭', 'Last move');
  container.appendChild(controls);
  container.appendChild(status);

  let index = startIndex;

  function announce() {
    status.textContent = labels[index] || `Move ${index + 1} of ${fens.length}`;
  }

  function render(animated) {
    board.setPosition(fens[index], animated);
    firstBtn.disabled = index === 0;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === fens.length - 1;
    lastBtn.disabled = index === fens.length - 1;
    announce();
  }

  firstBtn.addEventListener('click', () => { index = 0; render(true); });
  prevBtn.addEventListener('click', () => { index = Math.max(0, index - 1); render(true); });
  nextBtn.addEventListener('click', () => { index = Math.min(fens.length - 1, index + 1); render(true); });
  lastBtn.addEventListener('click', () => { index = fens.length - 1; render(true); });

  render(false);

  return {
    board,
    goTo(i) { index = Math.max(0, Math.min(fens.length - 1, i)); render(true); },
    destroy() { board.destroy(); },
  };
}

/**
 * "Free" mode: full legal-move input, backed by chess.js (BSD-2-Clause,
 * already a devDependency for the build-time data pipeline; see
 * package.json). Every move cm-chessboard's own input state machine
 * proposes is checked against chess.js before being accepted; on
 * acceptance the position is re-synced from chess.js's own FEN
 * (`board.setPosition(chess.fen(), true)`)
 * rather than trusted from cm-chessboard's naive from->to square move, so
 * captures, castling, en passant, and promotion all render correctly (a
 * known, small side effect: a special move animates twice -- once
 * optimistically by cm-chessboard's own input handling, once corrected by
 * this resync -- the standard integration pattern for this library with an
 * external rules engine).
 *
 * Promotion always resolves to a queen for now (no promotion-choice
 * dialog wired up in this task) -- a real limitation, not a stub: a future
 * task adding one only needs to change the `promotion: 'q'` below and
 * surface a choice before calling chess.move().
 *
 * @param {HTMLElement} container
 * @param {{fen?: string, orientation?: string, onMove?: (info: {san: string, fen: string, isGameOver: boolean}) => void}} opts
 */
function mountFreeBoard(container, { fen, orientation = COLOR.white, onMove } = {}) {
  // eslint-disable-next-line global-require -- chess.js only loaded on pages that need free-mode input
  const { Chess } = require('chess.js');
  const chess = (fen && fen !== 'start') ? new Chess(fen) : new Chess();
  const board = createBoard(container, { position: chess.fen(), orientation, inputEnabled: true });

  board.enableMoveInput((event) => {
    switch (event.type) {
      case INPUT_EVENT_TYPE.moveInputStarted: {
        const legalFromHere = chess.moves({ square: event.squareFrom, verbose: true });
        return legalFromHere.length > 0;
      }
      case INPUT_EVENT_TYPE.validateMoveInput: {
        const legalFromHere = chess.moves({ square: event.squareFrom, verbose: true });
        return legalFromHere.some((m) => m.to === event.squareTo);
      }
      case INPUT_EVENT_TYPE.moveInputFinished: {
        if (event.legalMove) {
          const result = chess.move({ from: event.squareFrom, to: event.squareTo, promotion: 'q' });
          if (result) {
            board.setPosition(chess.fen(), true);
            if (typeof onMove === 'function') {
              onMove({ san: result.san, fen: chess.fen(), isGameOver: chess.isGameOver() });
            }
          }
        }
        return undefined;
      }
      default:
        return undefined;
    }
  });

  return {
    board,
    chess,
    reset(newFen) {
      if (!newFen || newFen === 'start') {
        chess.reset();
      } else {
        chess.load(newFen);
      }
      board.setPosition(chess.fen(), false);
    },
    destroy() { board.destroy(); },
  };
}

module.exports = {
  COLOR,
  mountReplayBoard,
  mountFreeBoard,
};
