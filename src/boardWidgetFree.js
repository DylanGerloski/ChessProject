'use strict';

/**
 * "Free" mode board controller -- full legal-move input, backed by chess.js
 * (BSD-2-Clause, already a devDependency for the build-time data pipeline;
 * see package.json). Split out of src/boardWidget.js (task B1) so that
 * `require('chess.js')` (~107KB uncompressed) is only ever pulled into a
 * page's bundle by the pages that actually need free-move input
 * (eco-explorer.html, repertoire-builder.html) -- see boardWidget.js's own
 * header comment for the full esbuild-bundling reasoning this split exists
 * to satisfy. Never require() this module from boardWidget.js itself, or
 * from any page that only needs replay/sync display (repertoire.html's
 * synced panel among them).
 *
 * Uses createBoard/COLOR from src/boardWidget.js for the shared cm-chessboard
 * setup (same tokens, same theme, same sprite contract) rather than
 * duplicating it.
 */

const { INPUT_EVENT_TYPE } = require('cm-chessboard/src/Chessboard.js');
const { createBoard, COLOR } = require('./boardWidget');

/**
 * Every move cm-chessboard's own input state machine proposes is checked
 * against chess.js before being accepted; on acceptance the position is
 * re-synced from chess.js's own FEN (`board.setPosition(chess.fen(), true)`)
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
  mountFreeBoard,
};
