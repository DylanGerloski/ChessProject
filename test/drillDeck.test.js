'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const drillDeck = require('../src/drillDeck');
const { buildLeakReport } = require('../src/leakModel');
const { posKeyFor } = require('../src/bandShards');

function iso(daysFromNow, base = new Date('2026-08-15T12:00:00.000Z')) {
  return new Date(base.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
}

function freshCard(overrides = {}) {
  return {
    id: overrides.id || `1600-1800|white|${'a'.repeat(24)}`,
    play: ['e2e4'],
    fen: null,
    answerUci: 'e7e5',
    answerSan: 'e5',
    side: 'white',
    band: '1600-1800',
    pool: 'blitz',
    openingSlug: 'italian-game',
    openingName: 'Italian Game',
    eco: 'C50',
    source: 'band-meta',
    sm2: { rep: 0, ef: 2.5, intervalDays: 0, dueAt: null, lapses: 0, stuck: false },
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// newDeck / parseDeck / isValidCardShape
// -----------------------------------------------------------------------

test('newDeck: returns an empty, unmigrated v2 deck', () => {
  const deck = drillDeck.newDeck();
  assert.equal(deck.v, 2);
  assert.deepEqual(deck.cards, []);
  assert.equal(deck.migratedV1, false);
});

test('parseDeck: null/empty/garbage input all degrade to a fresh empty deck, never throw', () => {
  assert.deepEqual(drillDeck.parseDeck(null), drillDeck.newDeck());
  assert.deepEqual(drillDeck.parseDeck(''), drillDeck.newDeck());
  assert.deepEqual(drillDeck.parseDeck('not json{{{'), drillDeck.newDeck());
  assert.deepEqual(drillDeck.parseDeck('42'), drillDeck.newDeck());
  assert.deepEqual(drillDeck.parseDeck('null'), drillDeck.newDeck());
  assert.deepEqual(drillDeck.parseDeck(JSON.stringify({ cards: 'not-an-array' })), drillDeck.newDeck());
});

test('parseDeck: round-trips a real deck through serializeDeck unchanged', () => {
  const card = freshCard();
  const deck = { v: 2, cards: [card], migratedV1: true };
  const parsed = drillDeck.parseDeck(drillDeck.serializeDeck(deck));
  assert.deepEqual(parsed, deck);
});

test('parseDeck: drops one malformed card without discarding the whole deck', () => {
  const good = freshCard();
  const bad = { id: 'broken' }; // missing everything else
  const raw = JSON.stringify({ v: 2, cards: [good, bad], migratedV1: false });
  const parsed = drillDeck.parseDeck(raw);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].id, good.id);
});

test('isValidCardShape: rejects a card with neither play nor fen', () => {
  const card = freshCard({ play: undefined, fen: null });
  delete card.play;
  assert.equal(drillDeck.isValidCardShape(card), false);
});

test('isValidCardShape: accepts a pack-sourced card with fen and no play', () => {
  const card = freshCard({ play: null, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', source: 'pack' });
  assert.equal(drillDeck.isValidCardShape(card), true);
});

// -----------------------------------------------------------------------
// addCards
// -----------------------------------------------------------------------

test('addCards: adds genuinely new cards and reports the count', () => {
  const deck = drillDeck.newDeck();
  const { deck: next, addedCount, duplicateCount, capped } = drillDeck.addCards(deck, [freshCard({ id: 'a' }), freshCard({ id: 'b' })]);
  assert.equal(addedCount, 2);
  assert.equal(duplicateCount, 0);
  assert.equal(capped, false);
  assert.equal(next.cards.length, 2);
});

test('addCards: a duplicate id is skipped and the existing card (with its sm2 progress) is untouched', () => {
  const progressed = freshCard({ id: 'a', sm2: { rep: 3, ef: 2.7, intervalDays: 14, dueAt: iso(14).toISOString(), lapses: 1, stuck: false } });
  const deck = { v: 2, cards: [progressed], migratedV1: false };
  const reseed = freshCard({ id: 'a' }); // same id, fresh sm2 -- must NOT overwrite
  const { deck: next, addedCount, duplicateCount } = drillDeck.addCards(deck, [reseed]);
  assert.equal(addedCount, 0);
  assert.equal(duplicateCount, 1);
  assert.deepEqual(next.cards[0].sm2, progressed.sm2);
});

test('addCards: caps at MAX_DECK_CARDS and reports capped:true', () => {
  const existing = Array.from({ length: drillDeck.MAX_DECK_CARDS - 1 }, (_, i) => freshCard({ id: `existing-${i}` }));
  const deck = { v: 2, cards: existing, migratedV1: false };
  const { deck: next, addedCount, capped } = drillDeck.addCards(deck, [freshCard({ id: 'x' }), freshCard({ id: 'y' })]);
  assert.equal(next.cards.length, drillDeck.MAX_DECK_CARDS);
  assert.equal(addedCount, 1);
  assert.equal(capped, true);
});

// -----------------------------------------------------------------------
// cardsDue / buildSessionQueue
// -----------------------------------------------------------------------

test('cardsDue: separates never-attempted (fresh) cards from due-dated cards, and sorts due earliest-first', () => {
  const now = iso(0);
  const cardFresh = freshCard({ id: 'fresh' });
  const cardDueLater = freshCard({ id: 'due-later', sm2: { rep: 1, ef: 2.5, intervalDays: 6, dueAt: iso(-1).toISOString(), lapses: 0, stuck: false } });
  const cardDueEarlier = freshCard({ id: 'due-earlier', sm2: { rep: 1, ef: 2.5, intervalDays: 6, dueAt: iso(-5).toISOString(), lapses: 0, stuck: false } });
  const cardNotYetDue = freshCard({ id: 'not-yet', sm2: { rep: 1, ef: 2.5, intervalDays: 6, dueAt: iso(5).toISOString(), lapses: 0, stuck: false } });
  const deck = { v: 2, cards: [cardFresh, cardDueLater, cardDueEarlier, cardNotYetDue], migratedV1: false };

  const { due, fresh } = drillDeck.cardsDue(deck, now);
  assert.deepEqual(due.map((c) => c.id), ['due-earlier', 'due-later']);
  assert.deepEqual(fresh.map((c) => c.id), ['fresh']);
});

test('buildSessionQueue: due cards first, then fresh, capped at the numeric limit', () => {
  const now = iso(0);
  const due1 = freshCard({ id: 'due1', sm2: { rep: 1, ef: 2.5, intervalDays: 1, dueAt: iso(-1).toISOString(), lapses: 0, stuck: false } });
  const fresh1 = freshCard({ id: 'fresh1' });
  const fresh2 = freshCard({ id: 'fresh2' });
  const deck = { v: 2, cards: [fresh1, due1, fresh2], migratedV1: false };
  const queue = drillDeck.buildSessionQueue(deck, now, 2);
  assert.deepEqual(queue.map((c) => c.id), ['due1', 'fresh1']);
});

test('buildSessionQueue: "all-due" returns only due cards, never mixes in fresh ones', () => {
  const now = iso(0);
  const due1 = freshCard({ id: 'due1', sm2: { rep: 1, ef: 2.5, intervalDays: 1, dueAt: iso(-1).toISOString(), lapses: 0, stuck: false } });
  const fresh1 = freshCard({ id: 'fresh1' });
  const deck = { v: 2, cards: [due1, fresh1], migratedV1: false };
  const queue = drillDeck.buildSessionQueue(deck, now, 'all-due');
  assert.deepEqual(queue.map((c) => c.id), ['due1']);
});

// -----------------------------------------------------------------------
// applyGrade / stuckCards
// -----------------------------------------------------------------------

test('applyGrade: reschedules exactly the named card via scheduler.schedule, leaves others untouched', () => {
  const now = iso(0);
  const a = freshCard({ id: 'a' });
  const b = freshCard({ id: 'b' });
  const deck = { v: 2, cards: [a, b], migratedV1: false };
  const next = drillDeck.applyGrade(deck, 'a', 5, now);
  assert.equal(next.cards[0].sm2.rep, 1);
  assert.deepEqual(next.cards[1].sm2, b.sm2);
});

test('applyGrade: throws on an unknown card id rather than silently no-op-ing', () => {
  const deck = drillDeck.newDeck();
  assert.throws(() => drillDeck.applyGrade(deck, 'nope', 5, iso(0)));
});

test('stuckCards: returns only cards the scheduler flagged stuck', () => {
  const stuck = freshCard({ id: 'stuck', sm2: { rep: 1, ef: 1.3, intervalDays: 3, dueAt: iso(3).toISOString(), lapses: 9, stuck: true } });
  const ok = freshCard({ id: 'ok' });
  const deck = { v: 2, cards: [stuck, ok], migratedV1: false };
  assert.deepEqual(drillDeck.stuckCards(deck).map((c) => c.id), ['stuck']);
});

// -----------------------------------------------------------------------
// decksByOpening
// -----------------------------------------------------------------------

test('decksByOpening: groups by opening, counts due, sorts by due desc then total desc', () => {
  const now = iso(0);
  const italianDue = freshCard({ id: 'i1', openingSlug: 'italian-game', openingName: 'Italian Game', sm2: { rep: 1, ef: 2.5, intervalDays: 1, dueAt: iso(-1).toISOString(), lapses: 0, stuck: false } });
  const italianFresh = freshCard({ id: 'i2', openingSlug: 'italian-game', openingName: 'Italian Game' });
  const sicilianFresh = freshCard({ id: 's1', openingSlug: 'sicilian-defense', openingName: 'Sicilian Defense' });
  const deck = { v: 2, cards: [italianDue, italianFresh, sicilianFresh], migratedV1: false };
  const groups = drillDeck.decksByOpening(deck, now);
  assert.equal(groups[0].openingSlug, 'italian-game');
  assert.equal(groups[0].total, 2);
  assert.equal(groups[0].due, 1);
  assert.equal(groups[1].openingSlug, 'sicilian-defense');
});

// -----------------------------------------------------------------------
// seedFromLeakReport
// -----------------------------------------------------------------------

// leakModel's moveStat shape (validateMoveStat requires `bandGames`) --
// used only by the seedFromLeakReport test below.
function leakMoveStat(uci, san, games = 1000, score = 0.5) {
  return { uci, san, bandGames: games, score, scoreLo: score - 0.02, scoreHi: score + 0.02 };
}

// src/browser/bandData.client.js's real lookup() move shape (field name
// `games`, NOT `bandGames`) -- used by the seedFromBandMeta fake lookupFn
// below, matching the exact contract seedFromBandMeta() reads.
function bandMoveStat(uci, san, games = 1000, score = 0.5) {
  return { uci, san, games, playedPct: null, score, scoreLo: score - 0.02, scoreHi: score + 0.02 };
}

test('seedFromLeakReport: one card per leak, answer = that leak\'s bandMove', () => {
  const { posKey } = posKeyFor(['e2e4']);
  const report = buildLeakReport({
    band: '1600-1800',
    pool: 'blitz',
    username: 'tester',
    gamesFetched: 300,
    gamesUsable: 280,
    gamesInCoverage: 200,
    leaks: [
      {
        id: 'leak-1',
        rank: 0,
        color: 'white',
        play: ['e2e4'],
        posKey,
        ply: 1,
        yourMove: { ...leakMoveStat('e7e5', 'e5', 100, 0.4), yourCount: 30 },
        bandMove: leakMoveStat('c7c5', 'c5', 5000, 0.55),
        costPer100: 2.4,
        opening: { name: 'Italian Game', eco: 'C50', slug: 'italian-game' },
        links: { opening: 'italian-game.html', drill: 'drill.html', builder: 'repertoire-builder.html' },
      },
    ],
  });
  const cards = drillDeck.seedFromLeakReport(report);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].answerUci, 'c7c5');
  assert.equal(cards[0].answerSan, 'c5');
  assert.equal(cards[0].source, 'leak');
  assert.equal(cards[0].band, '1600-1800');
  assert.equal(cards[0].id, `1600-1800|white|${posKey}`);
});

// -----------------------------------------------------------------------
// seedFromBandMeta (fake lookupFn, no network)
// -----------------------------------------------------------------------

test('seedFromBandMeta: walks a synthetic tree via a fake lookupFn and seeds cards only at the opening\'s own side to move', async () => {
  // italian-game: side 'white', line length 5 (odd), so after the prefix
  // it's black to move -- the walk must auto-play black's best-ish reply
  // (branching) before it finds a white-to-move card position.
  const responses = {
    'e2e4,e7e5,g1f3,b8c6,f1c4': { coverage: 'in', games: 10000, moves: [bandMoveStat('g8f6', 'Nf6', 4000, 0.48), bandMoveStat('f8c5', 'Bc5', 3500, 0.5)] },
    'e2e4,e7e5,g1f3,b8c6,f1c4,g8f6': { coverage: 'in', games: 4000, moves: [bandMoveStat('d2d3', 'd3', 2000, 0.52), bandMoveStat('e1g1', 'O-O', 1800, 0.51)] },
    'e2e4,e7e5,g1f3,b8c6,f1c4,f8c5': { coverage: 'in', games: 3500, moves: [bandMoveStat('c2c3', 'c3', 1900, 0.53)] },
  };
  const lookupFn = async ({ play }) => responses[play.join(',')] || { coverage: 'out-of-book', games: 0, moves: [] };

  const cards = await drillDeck.seedFromBandMeta({ band: '1600-1800', pool: 'blitz', openingSlug: 'italian-game', count: 2, lookupFn });
  assert.ok(cards.length >= 1);
  for (const c of cards) {
    assert.equal(c.side, 'white');
    assert.equal(c.source, 'band-meta');
    assert.equal(c.play.length % 2, 0); // white to move => even ply count
  }
});

test('seedFromBandMeta: unknown opening slug throws', async () => {
  await assert.rejects(() => drillDeck.seedFromBandMeta({ band: '1600-1800', pool: 'blitz', openingSlug: 'not-a-real-opening', lookupFn: async () => ({ coverage: 'out-of-book', games: 0, moves: [] }) }));
});

// -----------------------------------------------------------------------
// seedFromRepertoire
// -----------------------------------------------------------------------

test('seedFromRepertoire: cards only at positions where it is the repertoire\'s own side to move', () => {
  // root (empty play, WHITE to move -- root.children holds WHITE's own
  // move e2e4, so this is a card) -> e2e4 node (BLACK to move -- its own
  // children are the opponent's replies, e7e5 is a branch, not a card) ->
  // e7e5 node (WHITE to move again -- g1f3 is OUR answer here, a card).
  const repertoire = {
    v: 1,
    side: 'white',
    band: '1600-1800',
    pool: 'blitz',
    name: 'My Italian',
    root: {
      uci: null,
      children: [
        {
          uci: 'e2e4',
          children: [
            {
              uci: 'e7e5',
              children: [
                { uci: 'g1f3', children: [] },
              ],
            },
          ],
        },
      ],
    },
  };
  const cards = drillDeck.seedFromRepertoire(repertoire, { count: 10 });
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].play, []);
  assert.equal(cards[0].answerUci, 'e2e4');
  assert.deepEqual(cards[1].play, ['e2e4', 'e7e5']);
  assert.equal(cards[1].answerUci, 'g1f3');
  assert.equal(cards[0].side, 'white');
  assert.equal(cards[0].source, 'repertoire');
});

test('seedFromRepertoire: an empty/malformed repertoire yields no cards, never throws', () => {
  assert.deepEqual(drillDeck.seedFromRepertoire(null), []);
  assert.deepEqual(drillDeck.seedFromRepertoire({}), []);
  assert.deepEqual(drillDeck.seedFromRepertoire({ side: 'purple', root: { children: [] } }), []);
});

// -----------------------------------------------------------------------
// seedFromPack (real src/buildPack.js packJsonFromResult() shape)
// -----------------------------------------------------------------------

test('seedFromPack: seeds only isOurMove positions, using fen (never play) and the pack\'s own inline stats', () => {
  const pack = {
    format: 'repertoire-pack/1',
    id: 'pack-1',
    title: 'Italian Game for White',
    color: 'white',
    band: '1600-1800',
    positions: [
      { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ply: 0, side: 'white', san: 'e4', uci: 'e2e4', n: 100000, w: 40000, d: 20000, l: 40000, score: 0.5, wilson: [0.49, 0.51], reach: 1, isOurMove: true },
      { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', ply: 1, side: 'black', san: 'e5', uci: 'e7e5', n: 90000, w: 36000, d: 18000, l: 36000, score: 0.5, wilson: [0.49, 0.51], reach: 0.9, isOurMove: false },
    ],
  };
  const cards = drillDeck.seedFromPack(pack, { count: 10 });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].play, null);
  assert.equal(cards[0].fen, pack.positions[0].fen);
  assert.equal(cards[0].answerUci, 'e2e4');
  assert.equal(cards[0].source, 'pack');
  assert.equal(cards[0].packStats.n, 100000);
});

test('seedFromPack: an unrecognized format yields no cards rather than throwing', () => {
  assert.deepEqual(drillDeck.seedFromPack({ format: 'something-else', positions: [] }), []);
  assert.deepEqual(drillDeck.seedFromPack(null), []);
});

// -----------------------------------------------------------------------
// migrationSeedRequest
// -----------------------------------------------------------------------

test('migrationSeedRequest: translates a real legacy v1 state into a starter-deck request', () => {
  const req = drillDeck.migrationSeedRequest(JSON.stringify({ level: 3, cleanStreak: 2, band: '1800-2000' }));
  assert.deepEqual(req, { band: '1800-2000', count: 6 });
});

test('migrationSeedRequest: clamps an extreme level into the 2-8 range', () => {
  assert.equal(drillDeck.migrationSeedRequest(JSON.stringify({ level: 100, band: '1600-1800' })).count, 8);
  assert.equal(drillDeck.migrationSeedRequest(JSON.stringify({ level: 0, band: '1600-1800' })).count, 2);
});

test('migrationSeedRequest: no legacy value, or malformed JSON, or a wrong shape -> null', () => {
  assert.equal(drillDeck.migrationSeedRequest(null), null);
  assert.equal(drillDeck.migrationSeedRequest(''), null);
  assert.equal(drillDeck.migrationSeedRequest('not json'), null);
  assert.equal(drillDeck.migrationSeedRequest(JSON.stringify({ level: 'not-a-number' })), null);
});
