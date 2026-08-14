'use strict';

// Regression coverage for the site's HTML-escaping discipline:
// src/browser/drill.client.js's renderCandidateTable() builds the
// opening-drill candidate-move table by string concatenation from Lichess
// Opening Explorer data (c.san and siblings) and assigns it via innerHTML.
// That data is baked in at build time rather than typed by a visitor, but
// it's still third-party API content, so every interpolation must be
// escaped the same as a live user input would be.
//
// drill.client.js is a browser-only IIFE with no module exports and no
// test hook (adding one that leaves a literal `module.exports =` in the
// source would trip buildStatic.test.js's own "no leftover
// require()/module.exports in the bundle" regression check, since this
// file is concatenated as plain <script> text, unstripped, into dist/drill.js
// -- see src/buildStatic.js's buildDrillBundle()). Instead, this test
// stubs just enough of `document`/`window` (plus the chessPosition.js/
// drillLogic.js globals the file expects to already be in scope when
// bundled -- see this file's own header comment) to let the *real*,
// unmodified module run its normal unconditional startRound() call at load
// time, which drives the exact renderCandidateTable() code path under
// test. No source changes for testability, no leaked Node artifacts.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DRILL_CLIENT_PATH = path.join(__dirname, '..', 'src', 'browser', 'drill.client.js');
const { START_BOARD, applyUciMove, applyUciMoves } = require('../src/chessPosition');
const { normalizeMoveInput, gradeMove, pickReply, applyRoundResult } = require('../src/drillLogic');

function noop() {}

/**
 * Loads and runs the real drill.client.js against a minimal DOM/global
 * stub, with `candidates` injected as the opponent-reply node's candidate
 * list -- the same shape playOpponentPly()/gradeAndAdvance() read to call
 * renderCandidateTable(). Since the candidate table is now gated behind an
 * attempt (see src/renderDrill.js's CANDIDATE_TABLE_PLACEHOLDER and this
 * file's own resetCandidateTable()), this harness also captures the table's state
 * immediately after startRound() (before any attempt) and then simulates a
 * "Show me the answer" click (the same reveal trigger a real user
 * interaction uses) to drive the post-reveal renderCandidateTable() call
 * under test. Returns `{ el, preRevealHtml }` so tests can check both.
 */
function runDrillClientWithCandidates(candidates) {
  const candidateTableEl = { innerHTML: '' };
  const drillData = {
    prefix: [],
    glyphs: {},
    bands: {
      'test-band': {
        replies: [
          {
            uci: 'e2e4',
            san: 'e4',
            playedPct: 100,
            node: { candidates, answerUci: candidates[0].uci || 'e7e5' },
          },
        ],
      },
    },
  };

  let showAnswerHandler = null;
  const elementsById = {
    'drill-data': { textContent: JSON.stringify(drillData) },
    'drill-move-form': { addEventListener: noop },
    'drill-move-text': { value: '' },
    'drill-band': { value: '', addEventListener: noop },
    'drill-level': { options: [], value: '', addEventListener: noop },
    'drill-candidate-table': candidateTableEl,
    'drill-show-answer': {
      addEventListener: function (evt, handler) {
        if (evt === 'click') showAnswerHandler = handler;
      },
    },
  };
  const boardRootStub = {
    addEventListener: noop,
    querySelectorAll: function () {
      return [];
    },
  };

  global.document = {
    getElementById: function (id) {
      return Object.prototype.hasOwnProperty.call(elementsById, id) ? elementsById[id] : null;
    },
    querySelector: function () {
      return boardRootStub;
    },
  };
  global.window = {
    localStorage: {
      getItem: function () {
        return null;
      },
      setItem: noop,
    },
  };
  // drill.client.js is normally concatenated directly after
  // chessPosition.js and drillLogic.js into one shared top-level scope
  // (see this file's own header comment) -- replicate that here as
  // globals rather than requiring drill.client.js to import them, since it
  // never does in production.
  global.START_BOARD = START_BOARD;
  global.applyUciMove = applyUciMove;
  global.applyUciMoves = applyUciMoves;
  global.normalizeMoveInput = normalizeMoveInput;
  global.gradeMove = gradeMove;
  global.pickReply = pickReply;
  global.applyRoundResult = applyRoundResult;

  delete require.cache[require.resolve(DRILL_CLIENT_PATH)];
  let preRevealHtml;
  try {
    require(DRILL_CLIENT_PATH);
    // startRound() has now run once at load (same as a real page load) --
    // capture the table's state before any attempt, then simulate clicking
    // "Show me the answer" to trigger the real post-reveal code path.
    preRevealHtml = candidateTableEl.innerHTML;
    if (showAnswerHandler) showAnswerHandler();
  } finally {
    delete global.document;
    delete global.window;
    delete global.START_BOARD;
    delete global.applyUciMove;
    delete global.applyUciMoves;
    delete global.normalizeMoveInput;
    delete global.gradeMove;
    delete global.pickReply;
    delete global.applyRoundResult;
  }

  return { el: candidateTableEl, preRevealHtml };
}

test('drill.client.js keeps the candidate table gated -- no candidate data in the DOM until an attempt or "Show me the answer"', () => {
  const { preRevealHtml } = runDrillClientWithCandidates([
    { san: 'Nf3', uci: 'e7e5', playedPct: 42.0, winPct: 55.5, games: 1234 },
  ]);
  assert.doesNotMatch(preRevealHtml, /Nf3/, 'the band-typical move must not appear before an attempt');
  assert.doesNotMatch(preRevealHtml, /<table/, 'no candidate table markup should exist before the reveal trigger');
  assert.match(preRevealHtml, /empty-note/, 'expected the same placeholder src/renderDrill.js server-renders');
});

test('drill.client.js renderCandidateTable escapes a malicious c.san value instead of injecting it raw via innerHTML', () => {
  const { el } = runDrillClientWithCandidates([
    { san: '<img src=x onerror=alert(1)>', uci: 'e7e5', playedPct: 42.0, winPct: 55.5, games: 1234 },
  ]);
  assert.doesNotMatch(el.innerHTML, /<img src=x onerror=alert\(1\)>/);
  assert.match(el.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('drill.client.js renderCandidateTable escapes an apostrophe in c.san without breaking the row markup', () => {
  const { el } = runDrillClientWithCandidates([{ san: "N'x", uci: 'e7e5', playedPct: 10, winPct: 50, games: 5 }]);
  assert.match(el.innerHTML, /N&#39;x/);
});

test('drill.client.js renderCandidateTable renders an ordinary candidate row unchanged in substance, after the reveal trigger', () => {
  const { el } = runDrillClientWithCandidates([
    { san: 'Nf3', uci: 'e7e5', playedPct: 42.0, winPct: 55.5, games: 1234 },
  ]);
  assert.match(el.innerHTML, /<td>Nf3<\/td>/);
  assert.match(el.innerHTML, /42\.0%/);
  assert.match(el.innerHTML, /55\.5%/);
  assert.match(el.innerHTML, /1,234/);
});

test('drill.client.js renderCandidateTable falls back to "-" for null playedPct/winPct without throwing', () => {
  const { el } = runDrillClientWithCandidates([{ san: 'e4', uci: 'e7e5', playedPct: null, winPct: null, games: 0 }]);
  assert.match(el.innerHTML, /<td>-<\/td>/);
});
