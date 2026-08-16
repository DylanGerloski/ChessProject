'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { START_BOARD, applyUciMove, applyUciMoves, boardFromFen, fenFromBoard } = require('../src/chessPosition');

test('applyUciMove: normal move relocates the piece and clears the origin square', () => {
  const board = applyUciMove(START_BOARD, 'e2e4');
  assert.equal(board.e4, 'P');
  assert.equal(board.e2, undefined);
  // Original board is untouched (pure function).
  assert.equal(START_BOARD.e2, 'P');
});

test('applyUciMove: capture replaces the defending piece', () => {
  let board = applyUciMoves(START_BOARD, ['e2e4', 'd7d5']);
  board = applyUciMove(board, 'e4d5');
  assert.equal(board.d5, 'P');
  assert.equal(board.e4, undefined);
});

test('applyUciMove: kingside castling moves both king and rook', () => {
  const ucis = ['g1f3', 'g8f6', 'g2g3', 'g7g6', 'f1g2', 'f8g7', 'e1g1'];
  const board = applyUciMoves(START_BOARD, ucis);
  assert.equal(board.g1, 'K');
  assert.equal(board.f1, 'R');
  assert.equal(board.e1, undefined);
  assert.equal(board.h1, undefined);
});

test('applyUciMove: queenside castling moves both king and rook', () => {
  const ucis = [
    'd2d4', 'd7d5', 'c1f4', 'c8f5', 'b1c3', 'b8c6', 'd1d2', 'd8d7', 'e1c1',
  ];
  const board = applyUciMoves(START_BOARD, ucis);
  assert.equal(board.c1, 'K');
  assert.equal(board.d1, 'R');
  assert.equal(board.e1, undefined);
  assert.equal(board.a1, undefined);
});

test('applyUciMove: en passant removes the captured pawn from its own square', () => {
  const ucis = ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'];
  const board = applyUciMoves(START_BOARD, ucis);
  assert.equal(board.d6, 'P');
  assert.equal(board.d5, undefined, 'the passed pawn must be removed, not left on d5');
  assert.equal(board.e5, undefined);
});

test('applyUciMove: promotion replaces the pawn with the promoted piece, respecting color', () => {
  const board = { ...START_BOARD };
  delete board.h8; // clear the corner so the pawn has somewhere to promote to
  board.h7 = undefined;
  const withPawn = { ...board, h7: 'P' };
  delete withPawn.h2;
  const promoted = applyUciMove(withPawn, 'h7h8q');
  assert.equal(promoted.h8, 'Q');
  assert.equal(promoted.h7, undefined);

  const blackPawn = { h2: 'p' };
  const blackPromoted = applyUciMove(blackPawn, 'h2h1n');
  assert.equal(blackPromoted.h1, 'n');
});

test('the Italian Game line produces the expected board on a handful of squares', () => {
  const ucis = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
  const board = applyUciMoves(START_BOARD, ucis);
  assert.equal(board.c4, 'B', 'white bishop should be on c4');
  assert.equal(board.f1, undefined, 'f1 should be empty after Bc4');
  assert.equal(board.f3, 'N', "white knight should be on f3");
  assert.equal(board.c6, 'n', "black knight should be on c6");
  assert.equal(board.e4, 'P');
  assert.equal(board.e5, 'p');
  assert.equal(board.e2, undefined);
  assert.equal(board.e7, undefined);
});

test('applyUciMove throws a clear error when the origin square is empty', () => {
  assert.throws(() => applyUciMove(START_BOARD, 'e5e6'), /no piece on e5/);
});

// ---------------------------------------------------------------------
// fenFromBoard -- the Explorer synced board panel's inverse of
// boardFromFen (src/render.js's renderRepertoireNode / task B1). Only the
// piece-placement field is real; see the function's own doc comment.
// ---------------------------------------------------------------------

test('fenFromBoard: the start position round-trips to the well-known starting FEN placement field', () => {
  const fen = fenFromBoard(START_BOARD);
  assert.equal(fen.split(' ')[0], 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
});

test('fenFromBoard: round-trips through boardFromFen for a mid-game position (Italian Game)', () => {
  const ucis = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
  const board = applyUciMoves(START_BOARD, ucis);
  const fen = fenFromBoard(board);
  // Round-trip through the module's own inverse function -- every occupied
  // square must come back exactly as it went in.
  const roundTripped = boardFromFen(fen);
  assert.deepEqual(roundTripped, board);
});

test('fenFromBoard: an empty board serializes to eight "8" rank rows', () => {
  const fen = fenFromBoard({});
  assert.equal(fen.split(' ')[0], '8/8/8/8/8/8/8/8');
});

test('fenFromBoard: run-length-encodes gaps correctly around a single piece mid-rank', () => {
  const fen = fenFromBoard({ e4: 'P' });
  assert.equal(fen.split(' ')[0], '8/8/8/8/4P3/8/8/8');
});

test('fenFromBoard: emits fixed placeholder fields after the piece placement (never a legality-grade FEN)', () => {
  const fen = fenFromBoard(START_BOARD);
  assert.equal(fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
});
