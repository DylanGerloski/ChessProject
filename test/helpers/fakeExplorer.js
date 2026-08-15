'use strict';

/**
 * Shared fake-fetch helpers for tests that exercise the content build
 * (src/buildContent.js), used by both test/buildContent.test.js and
 * test/buildStatic.test.js so the two don't drift. No live network calls
 * happen anywhere this is used.
 */

const { Chess } = require('chess.js');
const { OPENINGS } = require('../../src/openings');

function fakeResponse(json) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
}

/**
 * A real, currently-legal move at the position reached by replaying
 * `playArr` (a UCI move list) from the starting position -- used by the
 * fallback branch below so a consumer that walks past every configured
 * OPENINGS line (src/buildPack.js's buildPackTree(), which validates every
 * move it's given via chess.js and MAX_PLY=12-deep, unlike every other
 * builder that reads this fixture) never gets handed the SAME hardcoded
 * move (the old fixed 'a2a3'/rootFixture's 'e2e4' opening moves) at a
 * position where it's no longer legal -- which throws
 * "buildPack.fenAfter: illegal move" once the same UCI string is offered
 * twice along one line. Prefers a non-king move (skips castling) purely to
 * avoid re-deriving buildPack.js's own king-captures-rook UCI castling
 * quirk here; falls back to whatever chess.js reports if that's all that's
 * left (an extreme, unlikely-in-these-fixtures endgame position).
 * Returns null if the position is checkmate/stalemate (no legal moves) --
 * callers should treat that the same as "no candidates," matching how a
 * real Explorer response with an empty `moves` array already behaves.
 */
function realLegalMoveAt(playArr) {
  const chess = new Chess();
  for (const uci of playArr) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
  }
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;
  const nonKing = legal.find((m) => m.piece !== 'k') || legal[0];
  return { uci: `${nonKing.from}${nonKing.to}${nonKing.promotion || ''}`, san: nonKing.san };
}

/**
 * A fake fetch smart enough to serve fetchLineWithValidation()'s per-ply
 * move-order check for ALL 10 configured openings (many share a first move,
 * e.g. every 1.e4 opening) -- see src/buildContent.js's own move-order
 * validation for why this matters. For any request whose `play` param isn't
 * a prefix of a configured opening line (e.g. a repertoire-explorer call
 * that has wandered off-book, or the mistake-follow-up call one ply past a
 * full line), it falls back to `fallbackJson` if supplied, or a small
 * generic response otherwise.
 */
function makeSmartExplorerFetch({ fallbackJson = null } = {}) {
  let callCount = 0;

  function nextPliesFor(playArr) {
    const out = [];
    const seen = new Set();
    for (const o of OPENINGS) {
      const prefix = o.line.slice(0, playArr.length).map((p) => p.uci);
      const matches = prefix.length === playArr.length && prefix.every((uci, i) => uci === playArr[i]);
      if (matches && o.line.length > playArr.length && !seen.has(o.line[playArr.length].uci)) {
        seen.add(o.line[playArr.length].uci);
        out.push({ ply: o.line[playArr.length], opening: o });
      }
    }
    return out;
  }

  function fullyMatchedOpening(playArr) {
    return OPENINGS.find(
      (o) => o.line.length === playArr.length && o.line.every((p, i) => p.uci === playArr[i])
    ) || null;
  }

  const fetchImpl = async (url) => {
    callCount += 1;
    const parsed = new URL(url);
    const isMasters = parsed.pathname.includes('/masters');
    const playParam = parsed.searchParams.get('play');
    const playArr = playParam ? playParam.split(',') : [];
    const matchedOpening = fullyMatchedOpening(playArr);

    if (isMasters) {
      return fakeResponse({
        opening: matchedOpening ? { eco: matchedOpening.ecoHint, name: matchedOpening.name } : null,
        white: 4200,
        draws: 3100,
        black: 2600,
        moves: [],
        topGames: matchedOpening
          ? [
              {
                uci: 'a1a1',
                id: '9fWPVa8k',
                winner: 'black',
                white: { name: 'Caruana, Fabiano', rating: 2835 },
                black: { name: 'Carlsen, Magnus', rating: 2863 },
                year: 2020,
                month: '2020-06',
              },
            ]
          : [],
        recentGames: [],
      });
    }

    const candidates = nextPliesFor(playArr);
    if (candidates.length > 0) {
      const moves = candidates.map((c, i) => ({
        uci: c.ply.uci,
        san: c.ply.san,
        averageRating: 1650 + i,
        white: 6000 - i * 500,
        draws: 500,
        black: 5000 - i * 400,
      }));
      return fakeResponse({
        opening: matchedOpening ? { eco: matchedOpening.ecoHint, name: matchedOpening.name } : null,
        white: moves.reduce((s, m) => s + m.white, 0),
        draws: moves.reduce((s, m) => s + m.draws, 0),
        black: moves.reduce((s, m) => s + m.black, 0),
        moves,
        topGames: [],
        recentGames: matchedOpening
          ? [
              {
                uci: moves[0].uci,
                id: 'aB3dEfGh',
                winner: 'white',
                speed: 'blitz',
                white: { name: 'clubplayer1', rating: 1705 },
                black: { name: 'clubplayer2', rating: 1698 },
                year: 2026,
                month: '2026-08',
              },
            ]
          : [],
      });
    }

    // Both the caller-supplied fallbackJson and the built-in generic
    // default below used to carry a FIXED, hardcoded move (fallbackJson's
    // realistic callers pass a real starting-position fixture whose own
    // `moves` are only legal at ply 0; the built-in default hardcoded
    // 'a2a3'). Either one, handed back unchanged at every ply of a deep
    // walk, eventually offers the SAME uci string twice along one line --
    // legal the first time, illegal the second (see realLegalMoveAt()'s own
    // doc comment above for which real consumer this fix is for). Every
    // fallback response instead reports one ACTUALLY legal move for the
    // real position being asked about; every other field (opening/
    // topGames/recentGames/totals) is preserved from fallbackJson when one
    // was supplied, so no existing assertion on those fields changes.
    const realMove = realLegalMoveAt(playArr);
    const fallbackMoves = realMove
      ? [{ uci: realMove.uci, san: realMove.san, averageRating: 1600, white: 3000, draws: 200, black: 1800 }]
      : [];

    if (fallbackJson) {
      return fakeResponse({ ...fallbackJson, moves: fallbackMoves });
    }

    return fakeResponse({
      opening: matchedOpening ? { eco: matchedOpening.ecoHint, name: matchedOpening.name } : null,
      white: 3000,
      draws: 200,
      black: 1800,
      moves: fallbackMoves,
      topGames: [],
      recentGames: [],
    });
  };

  return { fetchImpl, getCallCount: () => callCount };
}

module.exports = { makeSmartExplorerFetch, fakeResponse };
