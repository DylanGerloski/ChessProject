'use strict';

/**
 * Test-only esbuild entry point (Phase 7c verification) -- mounts
 * src/boardWidget.js's replay and free modes for
 * test/boardWidget.browser.test.js to drive with Playwright. Never part of
 * the real site build (src/buildStatic.js does not reference this file);
 * lives under test/fixtures/ for that reason, same separation
 * public-repo-hygiene.md draws between shipped source and local-only
 * planning/verification artifacts.
 */
const { mountReplayBoard, mountFreeBoard } = require('../../src/boardWidget');

const REPLAY_FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
];

window.__boardDemo = {};

const replayContainer = document.getElementById('replay-board');
if (replayContainer) {
  window.__boardDemo.replay = mountReplayBoard(replayContainer, {
    fens: REPLAY_FENS,
    labels: ['Start', '1. e4', '1. e4 e5'],
  });
}

const freeContainer = document.getElementById('free-board');
const freeStatus = document.getElementById('free-status');
if (freeContainer) {
  window.__boardDemo.free = mountFreeBoard(freeContainer, {
    onMove(info) {
      if (freeStatus) freeStatus.textContent = `last move: ${info.san} (${info.fen})`;
    },
  });
}
