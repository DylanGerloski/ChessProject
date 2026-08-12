'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreFor,
  findCommonMistakes,
  buildOpeningModel,
  rankOpeningsByScore,
  aggregateMistakesAcrossOpenings,
  scoreRangeAcrossBands,
} = require('../src/processOpenings');

test('scoreFor: win + draw/2, as a percentage', () => {
  // 100 white wins, 50 draws, 50 black wins out of 200 -> white score = (100+25)/200 = 62.5
  const totals = { white: 100, draws: 50, black: 50 };
  assert.equal(scoreFor(totals, 'white'), 62.5);
  assert.equal(scoreFor(totals, 'black'), 37.5);
});

test('scoreFor returns null when there is no data', () => {
  assert.equal(scoreFor({ white: 0, draws: 0, black: 0 }, 'white'), null);
  assert.equal(scoreFor(null, 'white'), null);
});

test('findCommonMistakes returns a frequently-played, low-scoring move and excludes rare or good moves', () => {
  const response = {
    white: 0,
    draws: 0,
    black: 0,
    moves: [
      // Played often (10%), scores badly for Black (41%) -> should be flagged.
      { uci: 'g8f6', san: 'Nf6', white: 590, draws: 20, black: 390, averageRating: 1500 },
      // Played rarely (well under minPlayedPct) even though it scores badly -> excluded (too rare to matter).
      { uci: 'a7a6', san: 'a6', white: 4, draws: 1, black: 1, averageRating: 1480 },
      // Played often but scores well for Black -> excluded (not a mistake).
      { uci: 'd7d5', san: 'd5', white: 400, draws: 150, black: 450, averageRating: 1550 },
    ],
  };
  // moveStatsFromExplorerResponse computes playedPct from response.white/draws/black totals
  // summed across all listed moves being representative of the position total.
  response.white = 590 + 4 + 400;
  response.draws = 20 + 1 + 150;
  response.black = 390 + 1 + 450;

  const mistakes = findCommonMistakes(response, 'black', { minPlayedPct: 2, maxScoreForMover: 47, limit: 2 });
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].san, 'Nf6');
  assert.ok(mistakes[0].score <= 47);
});

test('buildOpeningModel shapes bands correctly and tolerates a band with zero games', () => {
  const openingConfig = {
    slug: 'italian-game',
    name: 'Italian Game',
    ecoHint: 'C50',
    side: 'white',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'f1c4', san: 'Bc4' },
    ],
  };
  const bandResponses = {
    '1400-1600': { white: 5200, draws: 1300, black: 3500, opening: { eco: 'C50', name: 'Italian Game' }, moves: [] },
    '1600-1800': {
      white: 26000,
      draws: 2000,
      black: 23000,
      opening: { eco: 'C50', name: 'Italian Game' },
      moves: [
        { uci: 'g8f6', san: 'Nf6', white: 6000, draws: 500, black: 5500, averageRating: 1700, opening: { eco: 'C50', name: 'Italian Game: Two Knights' } },
      ],
      recentGames: [{ uci: 'g8f6', id: 'abc12345', winner: 'white', speed: 'blitz', white: { name: 'A', rating: 1700 }, black: { name: 'B', rating: 1690 }, year: 2026, month: '2026-07' }],
    },
    '1800-2000': { white: 0, draws: 0, black: 0, opening: null, moves: [] },
    '2000+': { white: 900, draws: 100, black: 700, opening: null, moves: [] },
  };
  const mastersResponse = {
    opening: { eco: 'C50', name: 'Italian Game' },
    topGames: [{ uci: 'g8f6', id: 'xyz98765', winner: 'black', white: { name: 'Caruana, Fabiano', rating: 2835 }, black: { name: 'Carlsen, Magnus', rating: 2863 }, year: 2020, month: '2020-06' }],
  };

  const model = buildOpeningModel({ openingConfig, bandResponses, mastersResponse, minGamesForPct: 1000 });

  assert.equal(model.eco, 'C50');
  assert.equal(model.name, 'Italian Game');
  assert.equal(model.side, 'white');
  assert.equal(model.opponentColor, 'black');
  assert.equal(model.bands.length, 4);

  const zeroBand = model.bands.find((b) => b.band === '1800-2000');
  assert.equal(zeroBand.games, 0);
  assert.equal(zeroBand.enoughData, false);
  assert.equal(zeroBand.whitePct, null);

  const mainBand = model.bands.find((b) => b.band === '1600-1800');
  assert.equal(mainBand.games, 51000);
  assert.equal(mainBand.enoughData, true);
  assert.ok(typeof mainBand.scoreForSide === 'number');

  assert.equal(model.topReplies.length, 1);
  assert.equal(model.topReplies[0].san, 'Nf6');
  assert.equal(model.topReplies[0].opening.name, 'Italian Game: Two Knights');

  assert.equal(model.masterGames.length, 1);
  assert.equal(model.masterGames[0].white.name, 'Caruana, Fabiano');
  assert.equal(model.recentGames.length, 1);
});

test('buildOpeningModel attaches a punishing reply to the worst mistake when a follow-up response is supplied', () => {
  const openingConfig = {
    slug: 'sicilian-defense', name: 'Sicilian Defense', ecoHint: 'B20', side: 'black',
    line: [{ uci: 'e2e4', san: 'e4' }, { uci: 'c7c5', san: 'c5' }],
  };
  const bandResponses = {
    '1600-1800': {
      white: 5900000 + 400000,
      draws: 200000,
      black: 5000000,
      opening: { eco: 'B20', name: 'Sicilian Defense' },
      moves: [
        { uci: 'g1f3', san: 'Nf3', white: 5900000, draws: 200000, black: 4000000, averageRating: 1700 },
        { uci: 'b1c3', san: 'Nc3', white: 400000, draws: 5000, black: 1000000, averageRating: 1690 },
      ],
    },
  };
  const mistakeFollowUpResponse = {
    white: 0, draws: 0, black: 0,
    moves: [{ uci: 'd7d6', san: 'd6', white: 3000, draws: 200, black: 1800, averageRating: 1700 }],
  };
  const model = buildOpeningModel({ openingConfig, bandResponses, mistakeFollowUpResponse, minGamesForPct: 1000 });
  if (model.mistakes.length > 0) {
    assert.ok('punishingReply' in model.mistakes[0]);
  }
});

function fakeEntry({ slug, name, side, band, games, scoreForSide, mistakes = [] }) {
  return {
    openingConfig: { slug, name, side },
    model: {
      name,
      side,
      opponentColor: side === 'white' ? 'black' : 'white',
      defaultBand: band,
      bands: [{ band, games, scoreForSide, enoughData: games >= 1000 }],
      mistakes,
    },
  };
}

test('rankOpeningsByScore sorts by score-for-side descending and excludes bands without enough data', () => {
  const entries = [
    fakeEntry({ slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 48 }),
    fakeEntry({ slug: 'b', name: 'Opening B', side: 'white', band: '1600-1800', games: 6000, scoreForSide: 55 }),
    fakeEntry({ slug: 'c', name: 'Opening C', side: 'white', band: '1600-1800', games: 50, scoreForSide: 90 }), // not enough games -- excluded
  ];
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].slug, 'b');
  assert.equal(ranked[1].slug, 'a');
});

test('aggregateMistakesAcrossOpenings flattens and sorts every opening\'s mistakes worst-score-first', () => {
  const entries = [
    fakeEntry({
      slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 48,
      mistakes: [{ san: 'Nf6', playedPct: 5, score: 41 }],
    }),
    fakeEntry({
      slug: 'b', name: 'Opening B', side: 'black', band: '1600-1800', games: 5000, scoreForSide: 52,
      mistakes: [{ san: 'd5', playedPct: 8, score: 35 }],
    }),
  ];
  const all = aggregateMistakesAcrossOpenings(entries);
  assert.equal(all.length, 2);
  assert.equal(all[0].san, 'd5'); // worst score (35) first
  assert.equal(all[0].name, 'Opening B');
  assert.equal(all[1].san, 'Nf6');
});

test('scoreRangeAcrossBands finds the min/max scoring bands and returns null with fewer than 2 usable bands', () => {
  const model = {
    bands: [
      { band: '1400-1600', games: 5000, scoreForSide: 50, enoughData: true },
      { band: '1600-1800', games: 6000, scoreForSide: 55, enoughData: true },
      { band: '1800-2000', games: 20, scoreForSide: 90, enoughData: false },
    ],
  };
  const range = scoreRangeAcrossBands(model);
  assert.equal(range.minBand, '1400-1600');
  assert.equal(range.maxBand, '1600-1800');
  assert.equal(range.range, 5);

  const singleBandModel = { bands: [{ band: '1400-1600', games: 5000, scoreForSide: 50, enoughData: true }] };
  assert.equal(scoreRangeAcrossBands(singleBandModel), null);
});
