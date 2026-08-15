'use strict';

/**
 * Pure, ZERO-dependency home for applyExplorerUci() -- extracted out of
 * src/buildPack.js so a module that only needs this one function (like
 * src/bandShards.js and src/browser/bandData.client.js) doesn't also pull
 * in buildPack.js's OWN `require('./explorerSource')`, which in turn
 * requires Node's `fs`/`path`/`crypto` -- fine for build-time code, fatal
 * for anything esbuild has to bundle for the browser (`platform: 'browser'`
 * does not polyfill Node builtins, and CommonJS `require()` pulls in a
 * whole module's top-level requires regardless of which single export is
 * actually used, so requiring buildPack.js for this one function always
 * dragged the fs-dependent chain into any browser bundle that did it).
 * Found while wiring src/browser/openingReport.client.js's esbuild bundle
 * (WS-1 W2) -- the first W-task to actually esbuild-bundle a module that
 * transitively required bandShards.js/bandData.client.js; their own
 * `node --test` unit tests never exercised the real esbuild bundling path,
 * which is why this went undetected until now.
 *
 * buildPack.js re-exports `applyExplorerUci` from here (unchanged public
 * API, unchanged behaviour, unchanged tests) rather than defining it
 * itself, so there is exactly one implementation.
 */

/**
 * Applies one Explorer-sourced UCI move to a live chess.js instance,
 * returning chess.js's own move-result object (throws on illegal input,
 * same as chess.js's own `.move()`).
 *
 * Handles ONE real quirk, found by running this module against live data
 * (not assumed from documentation, same "verified today" discipline
 * src/pgnWrapper.js's header comment uses for this library): the Lichess
 * Opening Explorer API encodes castling as "king captures its own rook"
 * (e1h1/e1a1/e8h8/e8a8 -- the UCI_Chess960 convention) even for an
 * ordinary, non-Chess960 game. chess.js's object-form `.move()` on a normal
 * (non-960) instance does not understand that encoding -- it expects the
 * king's actual landing square (e1g1/e1c1/...). Detected structurally
 * (king's square -> a same-color rook's square), not by string-matching
 * specific squares, so it also covers a hypothetical future Chess960 pack
 * without change, AND is backward-compatible with an already-standard-form
 * UCI move (the `if` simply never fires when `to` is an empty landing
 * square rather than a same-colour rook) -- src/leakAnalysis.js's own
 * header comment relies on exactly this backward-compatibility.
 */
function applyExplorerUci(chess, uci) {
  const from = uci.slice(0, 2);
  let to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const mover = chess.get(from);
  const target = chess.get(to);
  if (mover && mover.type === 'k' && target && target.type === 'r' && target.color === mover.color) {
    to = `${to[0] === 'h' ? 'g' : 'c'}${from[1]}`;
  }
  return chess.move({ from, to, promotion });
}

module.exports = { applyExplorerUci };
