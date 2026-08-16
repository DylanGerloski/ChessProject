'use strict';

// REWRITE, stated for anyone comparing this to the pre-WS-1 version: this
// file used to test renderDrillPage (the old single-opening pilot's
// standalone page, including its #drill-data JSON block). That function no
// longer exists -- src/renderDrill.js is now a shared CSS/placeholder
// helper module for src/renderDrillHub.js's real hub+session and reference
// pages (see that module's own header comment for the full explanation).
//
// UPDATE: this file's own board renderer (renderDrillBoard,
// pieceLabel, pieceSpanHtml -- a hand-rolled 64-unicode-glyph-button board)
// was removed. drill.html's board is now the real cm-chessboard component
// (src/boardWidgetDrill.js) with a server-rendered static-SVG-diagram
// fallback (src/boardSvg.js's renderBoardDiagram, tested in
// test/boardSvg.test.js). This file tests what actually remains here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { DRILL_CSS, CANDIDATE_TABLE_PLACEHOLDER } = require('../src/renderDrill');

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

test('DRILL_CSS: no longer defines the removed button.board-sq rules (the real cm-chessboard component owns its own square styling now)', () => {
  assert.doesNotMatch(DRILL_CSS, /board-sq/);
});
