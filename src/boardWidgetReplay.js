'use strict';

/**
 * "Replay" mode board controller -- steps through a precomputed FEN array
 * with first/prev/next/last controls. No chess.js, no free move input --
 * the position at every step is already known, same as the static diagram
 * this data comes from at build time. Split out of src/boardWidget.js
 * (task B1) purely to keep boardWidget.js's own bundle footprint down to
 * what its leanest consumer (the Explorer's synced panel) needs -- see
 * that file's own header comment for the full esbuild-bundling reasoning.
 * Unlike src/boardWidgetFree.js this split isn't about a heavy dependency
 * (mountReplayBoard needs nothing boardWidget.js doesn't already have);
 * it's purely about this function's own DOM/control-wiring code (~1KB)
 * never shipping to a page (repertoire.html) that has no use for it.
 *
 * Uses createBoard/COLOR from src/boardWidget.js for the shared
 * cm-chessboard setup (same tokens, same theme, same sprite contract)
 * rather than duplicating it.
 */

const { createBoard, COLOR } = require('./boardWidget');

/**
 * @param {HTMLElement} container a wrapper element -- the board mounts into
 *   a child div this function creates, and the replay controls append
 *   after it, so `container` itself can carry the figure/aria-label.
 * @param {{fens: string[], labels?: string[], orientation?: string, startIndex?: number}} opts
 *   `labels[i]`, if given, becomes the announced text for step i (e.g. "1. e4"); falls
 *   back to a plain "Move N of M".
 * @returns {{board: object, goTo: (i: number) => void, destroy: () => void}}
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

module.exports = {
  mountReplayBoard,
};
