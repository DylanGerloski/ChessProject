'use strict';

/**
 * Shared fake-fetch helpers for tests that exercise the content build
 * (src/buildContent.js), used by both test/buildContent.test.js and
 * test/buildStatic.test.js so the two don't drift. No live network calls
 * happen anywhere this is used.
 */

const { OPENINGS } = require('../../src/openings');

function fakeResponse(json) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
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

    if (fallbackJson) {
      return fakeResponse(fallbackJson);
    }

    return fakeResponse({
      opening: matchedOpening ? { eco: matchedOpening.ecoHint, name: matchedOpening.name } : null,
      white: 3000,
      draws: 200,
      black: 1800,
      moves: [{ uci: 'a2a3', san: 'a3', averageRating: 1600, white: 3000, draws: 200, black: 1800 }],
      topGames: [],
      recentGames: [],
    });
  };

  return { fetchImpl, getCallCount: () => callCount };
}

module.exports = { makeSmartExplorerFetch, fakeResponse };
