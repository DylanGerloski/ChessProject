'use strict';

// Coverage for src/boardSvg.js: the static (no-JS) board diagram that
// replaced the old Unicode-glyph + text-shadow rendering on content pages
// (Phase 7c), plus the shared sprite-embedding and attribution helpers the
// interactive component (src/boardWidget.js) also depends on.

const test = require('node:test');
const assert = require('node:assert/strict');
const { START_BOARD, applyUciMoves } = require('../src/chessPosition');
const {
  SPRITE_WRAPPER_ID,
  spriteDefsHtml,
  pieceMarkupHtml,
  renderBoardDiagram,
  pieceAttributionHtml,
  readSpriteInner,
} = require('../src/boardSvg');

test('readSpriteInner returns the twelve piece <g id="..."> groups, no XML declaration or license comment', () => {
  const inner = readSpriteInner();
  assert.doesNotMatch(inner, /<\?xml/);
  assert.doesNotMatch(inner, /CC BY-SA 3\.0/); // license text stays only in the on-disk file + CBURNETT-LICENSE.txt
  for (const id of ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']) {
    assert.match(inner, new RegExp(`id="${id}"`), `expected a <g id="${id}"> group`);
  }
});

test('spriteDefsHtml embeds the sprite under the exact id cm-chessboard itself looks for, hidden without display:none', () => {
  const html = spriteDefsHtml();
  assert.match(html, new RegExp(`id="${SPRITE_WRAPPER_ID}"`));
  assert.equal(SPRITE_WRAPPER_ID, 'cm-chessboard-sprite');
  assert.doesNotMatch(html, /display:\s*none/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
});

test('pieceMarkupHtml returns "" for an empty square, and a <use> referencing the color-prefixed id for an occupied one', () => {
  assert.equal(pieceMarkupHtml(undefined), '');
  assert.equal(pieceMarkupHtml(''), '');
  assert.match(pieceMarkupHtml('K'), /<use href="#wk"><\/use>/);
  assert.match(pieceMarkupHtml('n'), /<use href="#bn"><\/use>/);
  assert.match(pieceMarkupHtml('P'), /class="board-piece"/);
  assert.match(pieceMarkupHtml('P'), /viewBox="0 0 40 40"/);
});

test('renderBoardDiagram renders exactly 64 squares, alternating light/dark, with one piece per occupied square', () => {
  const html = renderBoardDiagram(START_BOARD, { label: 'Starting position' });
  const squareCount = (html.match(/class="board-sq /g) || []).length;
  assert.equal(squareCount, 64);
  const lightCount = (html.match(/board-sq--light/g) || []).length;
  const darkCount = (html.match(/board-sq--dark/g) || []).length;
  assert.equal(lightCount, 32);
  assert.equal(darkCount, 32);
  const pieceCount = (html.match(/class="board-piece"/g) || []).length;
  assert.equal(pieceCount, 32); // full starting position
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Starting position"/);
});

test('renderBoardDiagram escapes the label (untrusted-input discipline, same as the old renderBoard)', () => {
  const html = renderBoardDiagram(START_BOARD, { label: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderBoardDiagram: flip reorders squares (a8 first when flipped, a1 first otherwise) and still renders the right piece per square', () => {
  // After 1. e4, white pawn sits on e4, empty on e2.
  const board = applyUciMoves(START_BOARD, ['e2e4']);
  const normal = renderBoardDiagram(board, { label: 'after 1. e4' });
  const flipped = renderBoardDiagram(board, { flip: true, label: 'after 1. e4, flipped' });
  assert.notEqual(normal, flipped);
  // Both still describe the same real position: 16 white + 16 black pieces total.
  assert.equal((normal.match(/class="board-piece"/g) || []).length, 32);
  assert.equal((flipped.match(/class="board-piece"/g) || []).length, 32);
});

test('pieceAttributionHtml names the CC BY-SA 3.0 license and links to the real Wikimedia Commons source', () => {
  const html = pieceAttributionHtml();
  assert.match(html, /CC BY-SA 3\.0/);
  assert.match(html, /creativecommons\.org\/licenses\/by-sa\/3\.0/);
  assert.match(html, /commons\.wikimedia\.org/);
});
