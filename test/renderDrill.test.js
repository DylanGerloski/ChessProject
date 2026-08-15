'use strict';

// REWRITE, stated for anyone comparing this to the pre-WS-1 version: this
// file used to test renderDrillPage (the old single-opening pilot's
// standalone page, including its #drill-data JSON block). That function no
// longer exists -- src/renderDrill.js is now a shared board/CSS helper
// module for src/renderDrillHub.js's real hub+session and reference pages
// (see that module's own header comment for the full explanation). This
// file tests what actually remains here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderDrillBoard, DRILL_CSS, CANDIDATE_TABLE_PLACEHOLDER, pieceLabel, pieceSpanHtml } = require('../src/renderDrill');
const { START_BOARD, applyUciMoves } = require('../src/chessPosition');

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

test('renderDrillBoard: renders exactly 64 real, individually-focusable buttons', () => {
  const html = renderDrillBoard(START_BOARD, { glyphs: GLYPHS });
  const matches = html.match(/<button type="button" class="board-sq/g);
  assert.equal(matches.length, 64);
});

test('renderDrillBoard: every square carries a non-empty aria-label naming the square and any piece on it', () => {
  const html = renderDrillBoard(START_BOARD, { glyphs: GLYPHS });
  assert.match(html, /aria-label="e1, white king"/);
  assert.match(html, /aria-label="e8, black king"/);
  assert.match(html, /aria-label="e4, empty"/);
  assert.doesNotMatch(html, /aria-label=""/);
});

test('renderDrillBoard: unflipped renders a8 first (black home rank at the top, White\'s own view)', () => {
  const html = renderDrillBoard(START_BOARD, { glyphs: GLYPHS, flip: false });
  const firstSquareIdx = html.indexOf('data-square="');
  assert.match(html.slice(firstSquareIdx, firstSquareIdx + 20), /data-square="a8"/);
});

test('renderDrillBoard: flipped renders h1 first (Black\'s own view)', () => {
  const html = renderDrillBoard(START_BOARD, { glyphs: GLYPHS, flip: true });
  const firstSquareIdx = html.indexOf('data-square="');
  assert.match(html.slice(firstSquareIdx, firstSquareIdx + 20), /data-square="h1"/);
});

test('renderDrillBoard: reflects real moves played onto the board (position after 1.e4 e5)', () => {
  const board = applyUciMoves(START_BOARD, ['e2e4', 'e7e5']);
  const html = renderDrillBoard(board, { glyphs: GLYPHS });
  assert.match(html, /aria-label="e4, white pawn"/);
  assert.match(html, /aria-label="e5, black pawn"/);
  assert.match(html, /aria-label="e2, empty"/);
});

test('renderDrillBoard: escapes a hostile piece glyph map value rather than injecting it raw', () => {
  const hostileGlyphs = { ...GLYPHS, p: '<img src=x onerror=alert(1)>' };
  const board = { e4: 'P' };
  const html = renderDrillBoard(board, { glyphs: hostileGlyphs });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test('pieceLabel: names color and piece type, null for an empty square', () => {
  assert.equal(pieceLabel('K'), 'white king');
  assert.equal(pieceLabel('n'), 'black knight');
  assert.equal(pieceLabel(null), null);
  assert.equal(pieceLabel(undefined), null);
});

test('pieceSpanHtml: wraps the glyph in an aria-hidden span with the correct color class, empty string for no piece', () => {
  assert.match(pieceSpanHtml('K', GLYPHS), /<span class="board-pc--w" aria-hidden="true">♚<\/span>/);
  assert.match(pieceSpanHtml('n', GLYPHS), /<span class="board-pc--b" aria-hidden="true">♞<\/span>/);
  assert.equal(pieceSpanHtml(null, GLYPHS), '');
});

test('CANDIDATE_TABLE_PLACEHOLDER: never contains real candidate-table markup (no <table>) -- the spoiler-rule placeholder shape', () => {
  assert.doesNotMatch(CANDIDATE_TABLE_PLACEHOLDER, /<table/);
  assert.match(CANDIDATE_TABLE_PLACEHOLDER, /empty-note/);
});

test('DRILL_CSS: references only the pre-authorised --color-due-* tokens (spec 3.5), no ad-hoc hex/new accent', () => {
  assert.match(DRILL_CSS, /var\(--color-due-text\)/);
  assert.match(DRILL_CSS, /var\(--color-due-bg\)/);
  // No literal hex colors anywhere in this stylesheet fragment (design-
  // standards.md: no hardcoded hex outside DESIGN_TOKENS).
  assert.doesNotMatch(DRILL_CSS, /#[0-9a-fA-F]{3,6}\b/);
});

test('DRILL_CSS: never contains the literal PLACEHOLDER sentinel string (buildStatic.js fails the build if it does)', () => {
  assert.doesNotMatch(DRILL_CSS, /PLACEHOLDER/);
});

test('DRILL_CSS: honors prefers-reduced-motion for the one transition it declares (WCAG 2.2 SC 2.3.3)', () => {
  assert.match(DRILL_CSS, /prefers-reduced-motion:\s*reduce/);
});
