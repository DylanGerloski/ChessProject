'use strict';

/**
 * Homepage hero live demo (Board Visibility spec, task B3). Bundled by
 * src/buildStatic.js's buildHomeDemoBundle() into dist/home-demo.js, loaded
 * `defer` from index.html -- the homepage's first first-party JS bundle
 * (spec section 2.3 calls this out explicitly as the real risk of this
 * piece: everything else about the page stays working with JS disabled,
 * this one small panel does not).
 *
 * Move input is a small allowlist-only handler, NOT
 * src/boardWidgetFree.js's mountFreeBoard (chess.js-backed full legality).
 * Measured directly before writing this file: createBoard() +
 * boardWidgetFree.js's chess.js dependency together already bundle to
 * ~120.7KB uncompressed, over spec section 2.3's <=120KB budget before a
 * single byte of this page's own code. That section names the exact
 * fallback for this situation -- "restrict input to the three
 * pre-authored replies via a UCI allowlist and drop chess.js entirely" --
 * so this file does that: it accepts ONLY the from/to square pairs listed
 * in the build-time #home-demo-data block below, and rejects everything
 * else via cm-chessboard's own input state machine (the same
 * moveInputStarted/validateMoveInput mechanism mountFreeBoard uses for
 * real chess.js legality -- just checked against a fixed allowlist here
 * instead of a rules engine). This is a real, disclosed narrowing from the
 * spec's stated ideal ("never refuse a legal move") -- an arbitrary legal
 * Black reply that is not one of the three baked-in moves is rejected the
 * same as an illegal one would be, because there is no rules engine here
 * to tell the two apart. Interaction mechanics (click-to-move, drag) are
 * unaffected -- cm-chessboard drives those regardless of which handler
 * validates a proposed move.
 *
 * Data comes from the #home-demo-data JSON block src/buildStatic.js's
 * indexPage() bakes at build time (real 1600-1800/Black Opening Explorer
 * numbers, same pipeline repertoire.html's own combos use) -- never a
 * runtime fetch, per spec section 2.3's "build-time constants" rule.
 */
const { createBoard, COLOR } = require('../boardWidget');
const { INPUT_EVENT_TYPE } = require('cm-chessboard/src/Chessboard.js');

// The position after 1. e4 -- a fixed, well-known FEN, not derived from the
// fetched tree data (cm-chessboard's setPosition only ever needs the
// piece-placement field, so a build-time-derived FEN would have worked
// here too, but a literal constant is simpler and needs no
// src/chessPosition.js dependency for a single fixed opening move).
var START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function readData() {
  var el = document.getElementById('home-demo-data');
  if (!el) return null;
  try {
    var parsed = JSON.parse(el.textContent);
    return parsed && parsed.replies && typeof parsed.replies === 'object' ? parsed : null;
  } catch (err) {
    return null; // corrupt/missing data -- leave the reserved box unmounted rather than guess
  }
}

function replyCaption(reply) {
  return reply.san + ' - played by ' + reply.playedPct + '% of Black at 1600-1800, scoring ' + reply.score + '% for Black.';
}

/**
 * Allowlist-only move-input mount (see this file's header comment for why
 * this exists instead of src/boardWidgetFree.js's mountFreeBoard). Accepts
 * exactly the UCI moves that are keys of `replies`; every other attempted
 * move is declined by cm-chessboard's own input handling (the piece
 * returns to its square, nothing commits).
 *
 * @param {HTMLElement} container
 * @param {{fen: string, orientation: string, replies: Object<string, object>, onMove: (uci: string) => void}} opts
 */
function mountAllowlistBoard(container, opts) {
  var board = createBoard(container, { position: opts.fen, orientation: opts.orientation, inputEnabled: true });
  var replies = opts.replies;

  function findUci(from, to) {
    var keys = Object.keys(replies);
    for (var i = 0; i < keys.length; i += 1) {
      var uci = keys[i];
      if (uci.slice(0, 2) === from && uci.slice(2, 4) === to) return uci;
    }
    return null;
  }

  board.enableMoveInput(function (event) {
    switch (event.type) {
      case INPUT_EVENT_TYPE.moveInputStarted: {
        var keys = Object.keys(replies);
        for (var i = 0; i < keys.length; i += 1) {
          if (keys[i].slice(0, 2) === event.squareFrom) return true;
        }
        return false;
      }
      case INPUT_EVENT_TYPE.validateMoveInput:
        return findUci(event.squareFrom, event.squareTo) !== null;
      case INPUT_EVENT_TYPE.moveInputFinished: {
        if (event.legalMove) {
          var uci = findUci(event.squareFrom, event.squareTo);
          if (uci && typeof opts.onMove === 'function') opts.onMove(uci);
        }
        return undefined;
      }
      default:
        return undefined;
    }
  });

  return {
    board: board,
    reset: function (fen) {
      board.setPosition(fen, false);
    },
  };
}

function init() {
  var mount = document.getElementById('home-demo-board');
  if (!mount) return; // no reserved box on this build/page -- nothing to do

  var data = readData();
  if (!data) return; // no baked data -- leave the empty reserved box (no layout shift either way, it's aspect-ratio boxed)

  var captionEl = document.getElementById('home-demo-caption');
  var resetBtn = document.getElementById('home-demo-reset');
  var initialCaption = captionEl ? captionEl.textContent : '';

  var handle = mountAllowlistBoard(mount, {
    fen: START_FEN,
    orientation: COLOR.black,
    replies: data.replies,
    onMove: function (uci) {
      if (!captionEl) return;
      var reply = data.replies[uci];
      if (reply) captionEl.textContent = replyCaption(reply);
    },
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      handle.reset(START_FEN);
      if (captionEl) captionEl.textContent = initialCaption;
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
