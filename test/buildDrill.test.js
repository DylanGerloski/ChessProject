'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DRILL_USER_DEPTH,
  DRILL_OPPONENT_BREADTH,
  DRILL_CANDIDATES,
  buildDrillTree,
  buildDrillData,
} = require('../src/buildDrill');
const { RATING_BANDS } = require('../src/processRepertoire');
const { getOpening } = require('../src/openings');

const ITALIAN = getOpening('italian-game');
const PREFIX_PLAY = ITALIAN.line.map((ply) => ply.uci);

// All squares a1..h8, used only to mint syntactically-valid, distinct 4-char
// UCI strings for synthetic fixture moves below -- these fixture positions
// are not real chess, so nothing here needs to be a legal move.
const SQUARES = [];
for (const file of 'abcdefgh') {
  for (const rank of '12345678') {
    SQUARES.push(`${file}${rank}`);
  }
}

/**
 * Builds a fake Explorer fetch, plus a matching fixture tree with the same
 * branching shape buildDrillTree itself uses (opponent branches per
 * `opponentBreadth`, user shows `candidateCount` candidates and always
 * "plays" the top one). Each position gets one extra, unfollowed candidate
 * so the tests can also confirm buildDrillTree slices to top-N rather than
 * following everything the fixture returns.
 *
 * @returns {{fetchImpl: Function, getCallCount: () => number}}
 */
function fakeDrillExplorerFetch({ userDepth = DRILL_USER_DEPTH, opponentBreadth = DRILL_OPPONENT_BREADTH, candidateCount = DRILL_CANDIDATES } = {}) {
  const responses = new Map();
  let callCount = 0;
  let squareCursor = 0;

  function nextUci() {
    const from = SQUARES[squareCursor % SQUARES.length];
    const to = SQUARES[(squareCursor + 37) % SQUARES.length];
    squareCursor += 1;
    return `${from}${to}`;
  }

  function makeResponse(specs) {
    const white = specs.reduce((sum, s) => sum + s.white, 0);
    const draws = specs.reduce((sum, s) => sum + s.draws, 0);
    const black = specs.reduce((sum, s) => sum + s.black, 0);
    return {
      white,
      draws,
      black,
      moves: specs.map((s, i) => ({ uci: s.uci, san: `M${squareCursor}-${i}`, averageRating: 1700, white: s.white, draws: s.draws, black: s.black })),
      opening: null,
    };
  }

  function makeSpecs(count, baseGames) {
    const specs = [];
    for (let i = 0; i < count; i += 1) {
      const games = baseGames - i * 1000; // strictly descending so sort order is deterministic
      specs.push({ uci: nextUci(), games, white: Math.round(games * 0.5), draws: Math.round(games * 0.1), black: Math.round(games * 0.4) });
    }
    return specs;
  }

  function expandOpponent(play, oppDepth) {
    const breadth = opponentBreadth[oppDepth];
    const specs = makeSpecs(breadth + 1, 1000000); // +1: an extra reply buildDrillTree must NOT follow
    responses.set(play.join(','), makeResponse(specs));
    for (let i = 0; i < breadth; i += 1) {
      const nextPlay = [...play, specs[i].uci];
      expandUser(nextPlay, oppDepth);
    }
  }

  function expandUser(play, oppDepth) {
    const specs = makeSpecs(candidateCount + 1, 500000); // +1: an extra candidate buildDrillTree must slice off
    responses.set(play.join(','), makeResponse(specs));
    const answerUci = specs[0].uci;
    if (oppDepth + 1 < userDepth) {
      const nextPlay = [...play, answerUci];
      expandOpponent(nextPlay, oppDepth + 1);
    }
  }

  expandOpponent(PREFIX_PLAY, 0);

  const fetchImpl = async (url) => {
    callCount += 1;
    const play = new URL(url).searchParams.get('play') || '';
    const json = responses.get(play);
    if (!json) {
      throw new Error(`fakeDrillExplorerFetch: no fixture wired for play="${play}"`);
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => json,
    };
  };

  return { fetchImpl, getCallCount: () => callCount };
}

test('buildDrillTree: 4 levels of userNodes, each with 1-4 candidates and answerUci === candidates[0].uci, then null exactly at depth 4', async () => {
  const { fetchImpl } = fakeDrillExplorerFetch();
  const oppNode = await buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, fetchImpl });

  let depth = 0;
  let node = oppNode;
  while (node) {
    assert.ok(Array.isArray(node.replies) && node.replies.length > 0, `oppNode at depth ${depth} has replies`);
    const userNode = node.replies[0].node;
    assert.ok(userNode.candidates.length >= 1 && userNode.candidates.length <= 4, `userNode at depth ${depth} has 1-4 candidates`);
    assert.equal(userNode.answerUci, userNode.candidates[0].uci, `userNode at depth ${depth} answerUci matches top candidate`);
    depth += 1;
    if (depth === DRILL_USER_DEPTH) {
      assert.equal(userNode.then, null, 'userNode.then is null at the deepest level');
      node = null;
    } else {
      assert.ok(userNode.then && Array.isArray(userNode.then.replies), `userNode.then at depth ${depth - 1} is the next oppNode`);
      node = userNode.then;
    }
  }
  assert.equal(depth, DRILL_USER_DEPTH);
});

test('buildDrillTree: opponent breadth is honoured per ply -- [2,2,1,1] gives 4 distinct lines', async () => {
  const { fetchImpl } = fakeDrillExplorerFetch();
  const oppNode = await buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, fetchImpl });

  assert.equal(oppNode.replies.length, DRILL_OPPONENT_BREADTH[0]);
  let lineCount = 0;
  for (const reply0 of oppNode.replies) {
    const opp1 = reply0.node.then;
    assert.equal(opp1.replies.length, DRILL_OPPONENT_BREADTH[1]);
    for (const reply1 of opp1.replies) {
      const opp2 = reply1.node.then;
      assert.equal(opp2.replies.length, DRILL_OPPONENT_BREADTH[2]);
      for (const reply2 of opp2.replies) {
        const opp3 = reply2.node.then;
        assert.equal(opp3.replies.length, DRILL_OPPONENT_BREADTH[3]);
        lineCount += opp3.replies.length;
      }
    }
  }
  assert.equal(lineCount, 4);
});

test('buildDrillTree: exact fetch-call count is 25 for one band', async () => {
  const { fetchImpl, getCallCount } = fakeDrillExplorerFetch();
  await buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, fetchImpl });
  assert.equal(getCallCount(), 25);
});

test('buildDrillData: exact fetch-call count is 100 across all 4 bands', async () => {
  const { fetchImpl, getCallCount } = fakeDrillExplorerFetch();
  const data = await buildDrillData({ openingSlug: 'italian-game', fetchImpl });
  assert.equal(Object.keys(data.bands).length, Object.keys(RATING_BANDS).length);
  assert.equal(getCallCount(), 100);
});

test('buildDrillData: shape carries opening/prefix/glyphs and one oppNode root per band', async () => {
  const { fetchImpl } = fakeDrillExplorerFetch();
  const data = await buildDrillData({ openingSlug: 'italian-game', fetchImpl });

  assert.equal(data.version, 1);
  assert.equal(data.opening.slug, 'italian-game');
  assert.equal(data.opening.side, 'white');
  assert.deepEqual(data.prefix, ITALIAN.line);
  assert.ok(data.glyphs && typeof data.glyphs.k === 'string');
  assert.ok(typeof data.retrieved === 'string' && !Number.isNaN(Date.parse(data.retrieved)));
  for (const band of Object.keys(RATING_BANDS)) {
    assert.ok(Array.isArray(data.bands[band].replies), `band "${band}" has a root oppNode`);
  }
});

test('buildDrillTree guard: throws when a position returns zero candidates', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ white: 0, draws: 0, black: 0, moves: [], opening: null }),
  });
  await assert.rejects(
    () => buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, userDepth: 1, opponentBreadth: [1], fetchImpl }),
    /zero candidate moves/
  );
});

test('buildDrillTree guard: throws when the top user candidate is a promotion (5-char uci)', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    // First call: opponent's single reply. Second call: the user position,
    // where the top (and only) candidate is a 5-char promotion uci.
    const json = call === 1
      ? { white: 100, draws: 0, black: 0, moves: [{ uci: 'a7a8', san: 'a8-ish', averageRating: 1700, white: 60, draws: 0, black: 40 }], opening: null }
      : { white: 100, draws: 0, black: 0, moves: [{ uci: 'a7a8q', san: 'a8=Q', averageRating: 1700, white: 60, draws: 0, black: 40 }], opening: null };
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
  };
  await assert.rejects(
    () => buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, userDepth: 1, opponentBreadth: [1], fetchImpl }),
    /promotion/
  );
});

test('buildDrillTree guard: throws when the top user candidate has zero games', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    const json = call === 1
      ? { white: 100, draws: 0, black: 0, moves: [{ uci: 'a7a6', san: 'a6', averageRating: 1700, white: 60, draws: 0, black: 40 }], opening: null }
      : { white: 0, draws: 0, black: 0, moves: [{ uci: 'b2b4', san: 'b4', averageRating: 1700, white: 0, draws: 0, black: 0 }], opening: null };
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
  };
  await assert.rejects(
    () => buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, userDepth: 1, opponentBreadth: [1], fetchImpl }),
    /zero games/
  );
});

test('buildDrillTree throws on an unknown rating band', async () => {
  const { fetchImpl } = fakeDrillExplorerFetch();
  await assert.rejects(
    () => buildDrillTree({ ratingBand: 'not-a-band', color: 'white', prefixPlay: PREFIX_PLAY, fetchImpl }),
    /unknown rating band/
  );
});

test('buildDrillData throws on a black-side opening slug (this pilot only supports the white-side drill)', async () => {
  const { fetchImpl } = fakeDrillExplorerFetch();
  await assert.rejects(
    () => buildDrillData({ openingSlug: 'sicilian-defense', fetchImpl }),
    /only a white-side opening/
  );
});

test('buildDrillTree: candidate percentages pass through unmodified from moveStatsFromExplorerResponse', async () => {
  // A single opponent reply (breadth 1), then one user ply so the user
  // candidate's stats can be checked directly against hand-computed values.
  const responseJson = {
    white: 1000,
    draws: 100,
    black: 900,
    moves: [{ uci: 'b2b4', san: 'b4', averageRating: 1700, white: 600, draws: 50, black: 350 }],
    opening: null,
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => responseJson,
  });

  const oppNode = await buildDrillTree({ ratingBand: '1600-1800', color: 'white', prefixPlay: PREFIX_PLAY, userDepth: 1, opponentBreadth: [1], fetchImpl });
  const candidate = oppNode.replies[0].node.candidates[0];
  const movesTotal = 600 + 50 + 350; // this move's own games
  const responseTotal = 1000 + 100 + 900; // response.white + draws + black
  assert.equal(candidate.games, movesTotal);
  assert.equal(candidate.playedPct, Number(((movesTotal / responseTotal) * 100).toFixed(1)));
  assert.equal(candidate.winPct, Number(((600 / movesTotal) * 100).toFixed(1)));
});
