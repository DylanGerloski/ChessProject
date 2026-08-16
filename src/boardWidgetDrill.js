'use strict';

/**
 * "Drill" mode board controller -- permissive move input, NO chess.js
 * legality check. Split out of src/boardWidget.js (same reasoning as
 * boardWidgetFree.js/boardWidgetReplay.js: esbuild's CommonJS bundling
 * pulls in a whole required module regardless of which export a caller
 * uses, so each mode lives in its own file to keep a page's bundle down to
 * what it actually needs -- see boardWidget.js's own header comment).
 *
 * WHY NO CHESS.JS: the drill's
 * real move validator is src/drillLogic.js's gradeMove(), which already
 * grades an input move against the CURRENT card's own fetched candidate
 * list (src/browser/drill.client.js's pendingCandidates) -- "correct" /
 * "offmeta" (a real move, just not the band-typical one) / "unknown" (not
 * recognised at all). That grading is orthogonal to whatever the board
 * component does with a click or drag, so this mode never asks cm-chessboard
 * to itself decide whether a move is legal -- moveInputStarted accepts any
 * occupied square (matching the previous board's "select a square with a
 * piece on it" behaviour) and validateMoveInput always accepts, exactly
 * like the previous button-based board's "click one square, then any other
 * square" flow (which never checked chess legality either -- gradeMove()
 * downstream turns a chess-illegal or off-meta input into real, useful
 * feedback text rather than a silent rejection). The one real behaviour
 * change from adopting a genuine drag/click board: the attempted move now
 * visually completes on the board (a natural, expected property of a real
 * chessboard component, and arguably better feedback than the previous
 * board's total lack of visual movement) instead of leaving the pieces
 * static until the next card loads.
 *
 * Uses createBoard from src/boardWidget.js for the shared cm-chessboard
 * setup (same tokens, same theme, same sprite contract).
 */

const { INPUT_EVENT_TYPE } = require('cm-chessboard/src/Chessboard.js');
const { createBoard, COLOR } = require('./boardWidget');

/**
 * @param {HTMLElement} container
 * @param {{fen?: string, orientation?: string, onMove?: (info: {squareFrom: string, squareTo: string}) => void}} opts
 * @returns {{board: object, setFen: (fen: string, animate?: boolean) => void, destroy: () => void}}
 */
function mountDrillBoard(container, { fen, orientation = COLOR.white, onMove } = {}) {
  const board = createBoard(container, { position: fen, orientation, inputEnabled: true });

  function fireMove(squareFrom, squareTo) {
    if (typeof onMove === 'function' && squareFrom && squareTo && squareFrom !== squareTo) {
      onMove({ squareFrom, squareTo });
    }
  }

  // Ordinary click/drag input funnels through here (moveInputFinished).
  board.enableMoveInput((event) => {
    switch (event.type) {
      case INPUT_EVENT_TYPE.moveInputStarted:
        return !!event.piece;
      case INPUT_EVENT_TYPE.validateMoveInput:
        return true;
      case INPUT_EVENT_TYPE.moveInputFinished:
        if (event.legalMove) fireMove(event.squareFrom, event.squareTo);
        return undefined;
      default:
        return undefined;
    }
  });

  // cm-chessboard's Accessibility extension (already enabled by
  // createBoard, see boardWidget.js) provides a "move piece" form and
  // arrow-key board navigation for screen-reader/keyboard-only visitors.
  // BOTH of those call `chessboard.movePiece(from, to, animated)` directly
  // (verified by reading node_modules/cm-chessboard/src/extensions/
  // accessibility/Accessibility.js's MovePieceForm and KeyboardMoveInput
  // classes) rather than going through the moveInputFinished event above --
  // so without this wrapper, a screen-reader visitor's submitted move would
  // silently move the piece but never reach gradeAndAdvance(), a real
  // accessibility regression against the previous board (where every square
  // was a real, keyboard-reachable <button>). Wrapping the instance's own
  // movePiece method (rather than patching the class) catches both paths
  // since MovePieceForm/KeyboardMoveInput hold a reference to this exact
  // board instance.
  const originalMovePiece = board.movePiece.bind(board);
  board.movePiece = (squareFrom, squareTo, animated) => {
    const result = originalMovePiece(squareFrom, squareTo, animated);
    fireMove(squareFrom, squareTo);
    return result;
  };

  return {
    board,
    setFen(nextFen, animate = true) {
      board.setPosition(nextFen, animate);
    },
    destroy() { board.destroy(); },
  };
}

module.exports = {
  mountDrillBoard,
};
