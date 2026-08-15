'use strict';

const { Chess } = require('chess.js');
// Was `node:crypto` -- swapped for a dependency-free, byte-for-byte
// identical SHA-1 (see src/sha1.js's own header comment) because this
// module is require()'d by src/bandShards.js, which src/browser/
// bandData.client.js (the WS-1 runtime read path every client surface
// uses) needs in an esbuild browser bundle, and Node's `crypto` module
// cannot be bundled for `platform: 'browser'`. Found while wiring WS-1 W2's
// client bundle -- the first W-task to actually esbuild-bundle a module
// that transitively required this file; test/sha1.test.js proves the
// output is identical to `crypto.createHash('sha1')` for every input, so
// no already-committed shard posKey is invalidated by this change.
const { sha1Hex } = require('../sha1');

/**
 * SAN -> position walk. chess.js is already a devDependency
 * (BSD-2-Clause, build-time only, same as src/pgnWrapper.js and
 * src/ecoData.js already use it) -- this module adds no new dependency.
 */

/**
 * A FEN's EPD (Extended Position Description): board + side-to-move +
 * castling rights + en-passant square, with the two clock fields dropped.
 * Two games reaching "the same position" by different move orders, at
 * different points in their own clocks, must key identically -- that's the
 * whole point of keying aggregates by position rather than by move path.
 */
function fenToEpd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * posKey = first 24 hex chars (96 bits) of sha1(EPD). 96 bits keeps files
 * small while leaving collision probability negligible (~1e-17 at 1e6
 * stored positions).
 */
function posKeyFromEpd(epd) {
  return sha1Hex(epd).slice(0, 24);
}

/**
 * Walks a game's SAN move-prefix through chess.js, returning one node per
 * position visited (length `min(sanMoves.length, maxPlies) + 1`, including
 * the starting position at index 0). `node.move` is the move that was
 * played to REACH that node from the previous one (null for index 0).
 *
 * Stops (returns a shorter array) the instant chess.js rejects a move as
 * illegal/unparseable -- a truncated 16-ply SAN prefix can genuinely split
 * a move in half only in pathological cases (the prefix boundary lands
 * mid-move never happens for whole-token SAN, but a corrupted/garbled
 * upstream record is always possible), and this must degrade to "shorter
 * usable prefix" rather than throwing and losing the whole game.
 *
 * @param {string[]} sanMoves
 * @param {{maxPlies?: number}} [opts]
 * @returns {Array<{posKey: string, epd: string, ply: number,
 *   move: {uci: string, san: string} | null}>}
 */
function walkPositions(sanMoves, { maxPlies = 16 } = {}) {
  const chess = new Chess();
  const startEpd = fenToEpd(chess.fen());
  const nodes = [{ posKey: posKeyFromEpd(startEpd), epd: startEpd, ply: 0, move: null }];

  const limit = Math.min(sanMoves.length, maxPlies);
  for (let i = 0; i < limit; i += 1) {
    let moveResult;
    try {
      moveResult = chess.move(sanMoves[i], { strict: false });
    } catch (err) {
      break;
    }
    if (!moveResult) break;
    const epd = fenToEpd(chess.fen());
    nodes.push({
      posKey: posKeyFromEpd(epd),
      epd,
      ply: i + 1,
      move: { uci: moveResult.lan, san: moveResult.san },
    });
  }
  return nodes;
}

module.exports = {
  fenToEpd,
  posKeyFromEpd,
  walkPositions,
};
