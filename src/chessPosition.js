'use strict';

/**
 * Minimal board-state tracker for rendering static position diagrams from a
 * UCI move list. NO legal-move generation and NO check detection -- every
 * move list this project plays comes straight from the Lichess Opening
 * Explorer API and is legal by construction (spec section 3.9). This module
 * only needs to know where the pieces physically end up after normal moves,
 * castling, en passant, and promotion.
 *
 * Board representation: a plain object keyed by algebraic square ('e4') to
 * a single FEN piece letter (uppercase = white, lowercase = black), or no
 * key at all for an empty square. Every function here is pure -- it returns
 * a new board object rather than mutating its input.
 */

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const START_BOARD = {
  a1: 'R', b1: 'N', c1: 'B', d1: 'Q', e1: 'K', f1: 'B', g1: 'N', h1: 'R',
  a2: 'P', b2: 'P', c2: 'P', d2: 'P', e2: 'P', f2: 'P', g2: 'P', h2: 'P',
  a7: 'p', b7: 'p', c7: 'p', d7: 'p', e7: 'p', f7: 'p', g7: 'p', h7: 'p',
  a8: 'r', b8: 'n', c8: 'b', d8: 'q', e8: 'k', f8: 'b', g8: 'n', h8: 'r',
};

/**
 * Applies one UCI move ("e2e4", "e7e8q", ...) to a board, returning a new
 * board. Handles the three special cases a legal-by-construction move list
 * still needs: castling (king moves two files -> move the rook too), en
 * passant (pawn captures diagonally onto an empty square -> remove the
 * captured pawn), and promotion (5th UCI character replaces the piece).
 */
function applyUciMove(board, uci) {
  if (typeof uci !== 'string' || uci.length < 4) {
    throw new Error(`applyUciMove: invalid uci "${uci}"`);
  }
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length > 4 ? uci[4] : null;
  const piece = board[from];
  if (!piece) {
    throw new Error(`applyUciMove: no piece on ${from} for move "${uci}"`);
  }

  const next = { ...board };
  delete next[from];

  const isWhite = piece === piece.toUpperCase();
  const isPawn = piece.toUpperCase() === 'P';
  const isKing = piece.toUpperCase() === 'K';

  // En passant: a pawn moving diagonally onto a square with nothing on it
  // must be capturing the pawn that just passed it, which sits on the
  // departure rank / arrival file.
  if (isPawn && from[0] !== to[0] && !board[to]) {
    delete next[`${to[0]}${from[1]}`];
  }

  // Castling: king moves exactly two files -> move the matching rook too.
  if (isKing && Math.abs(FILES.indexOf(to[0]) - FILES.indexOf(from[0])) === 2) {
    const rank = from[1];
    if (to[0] === 'g') {
      next[`f${rank}`] = next[`h${rank}`];
      delete next[`h${rank}`];
    } else if (to[0] === 'c') {
      next[`d${rank}`] = next[`a${rank}`];
      delete next[`a${rank}`];
    }
  }

  next[to] = promo ? (isWhite ? promo.toUpperCase() : promo.toLowerCase()) : piece;
  return next;
}

function applyUciMoves(board, ucis) {
  return ucis.reduce((b, uci) => applyUciMove(b, uci), board);
}

/**
 * Parses a FEN's piece-placement field (the part before the first space)
 * into this module's board shape. Added for the WS-1 Drill Engine v2 spec
 * (section 3.3, seeding source 4): a pack.json position carries only its
 * resulting `fen`, not the UCI path that reached it, so a pack-seeded
 * drill card renders its board from FEN directly rather than by replaying
 * `applyUciMoves` from START_BOARD -- see src/drillDeck.js's own header
 * comment for the full explanation of that shape gap. No legality
 * checking (same invariant as the rest of this module): a malformed FEN
 * either throws (empty/missing ranks) or silently produces a board that
 * doesn't reflect 64 squares, which is the caller's problem to validate,
 * same as applyUciMove's "legal by construction" assumption.
 *
 * @param {string} fen a full or partial FEN string; only the first
 *   whitespace-separated field (piece placement) is read.
 * @returns {Record<string,string>} board shape, same as START_BOARD.
 */
function boardFromFen(fen) {
  if (typeof fen !== 'string' || fen.length === 0) {
    throw new Error(`boardFromFen: invalid fen "${fen}"`);
  }
  const placement = fen.split(' ')[0];
  const ranks = placement.split('/');
  if (ranks.length !== 8) {
    throw new Error(`boardFromFen: expected 8 ranks, got ${ranks.length} in "${fen}"`);
  }
  const board = {};
  ranks.forEach((rankStr, i) => {
    const rank = RANKS[7 - i]; // FEN's first rank row is rank 8
    let file = 0;
    for (const ch of rankStr) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else {
        if (file > 7) throw new Error(`boardFromFen: rank "${rankStr}" overflows 8 files`);
        board[`${FILES[file]}${rank}`] = ch;
        file += 1;
      }
    }
  });
  return board;
}

module.exports = {
  FILES,
  RANKS,
  START_BOARD,
  applyUciMove,
  applyUciMoves,
  boardFromFen,
};
