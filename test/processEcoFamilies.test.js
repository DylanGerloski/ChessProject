'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFamilyBandStats } = require('../src/processEcoFamilies');
const { RATING_BANDS } = require('../src/processRepertoire');

test('buildFamilyBandStats: computes whitePct/drawPct/blackPct/scoreForSide per band when there is enough data', () => {
  const bandResponses = {
    '1600-1800': { white: 6000, draws: 2000, black: 2000 },
  };
  const { side, bands } = buildFamilyBandStats({ side: 'white', bandResponses, minGamesForPct: 1000 });
  assert.equal(side, 'white');
  assert.equal(bands.length, 1);
  const b = bands[0];
  assert.equal(b.band, '1600-1800');
  assert.equal(b.games, 10000);
  assert.equal(b.whitePct, 60);
  assert.equal(b.drawPct, 20);
  assert.equal(b.blackPct, 20);
  assert.equal(b.enoughData, true);
  // score = (wins + draws/2) / total * 100 = (6000 + 1000) / 10000 * 100 = 70
  assert.equal(b.scoreForSide, 70);
});

test('buildFamilyBandStats: scoreForSide is computed for the given side even when it is black', () => {
  const bandResponses = { '1600-1800': { white: 5000, draws: 1000, black: 4000 } };
  const { bands } = buildFamilyBandStats({ side: 'black', bandResponses, minGamesForPct: 1000 });
  // black score = (4000 + 500) / 10000 * 100 = 45
  assert.equal(bands[0].scoreForSide, 45);
});

test('buildFamilyBandStats: below minGamesForPct, suppresses every percentage rather than printing a noisy one', () => {
  const bandResponses = { '1600-1800': { white: 10, draws: 2, black: 8 } };
  const { bands } = buildFamilyBandStats({ side: 'white', bandResponses, minGamesForPct: 1000 });
  const b = bands[0];
  assert.equal(b.games, 20);
  assert.equal(b.enoughData, false);
  assert.equal(b.whitePct, null);
  assert.equal(b.drawPct, null);
  assert.equal(b.blackPct, null);
  assert.equal(b.scoreForSide, null);
});

test('buildFamilyBandStats: a null/missing response for a band is treated as zero games, not a crash', () => {
  const bandResponses = { '1600-1800': null, '1800-2000': undefined };
  const { bands } = buildFamilyBandStats({ side: 'white', bandResponses });
  assert.equal(bands.length, 2);
  for (const b of bands) {
    assert.equal(b.games, 0);
    assert.equal(b.enoughData, false);
  }
});

test('buildFamilyBandStats: emits one entry per key actually present in bandResponses, in that order', () => {
  const bandResponses = {};
  for (const band of Object.keys(RATING_BANDS)) bandResponses[band] = { white: 100, draws: 0, black: 0 };
  const { bands } = buildFamilyBandStats({ side: 'white', bandResponses, minGamesForPct: 1 });
  assert.deepEqual(bands.map((b) => b.band), Object.keys(RATING_BANDS));
});
