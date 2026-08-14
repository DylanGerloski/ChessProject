'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEcoCodeToFamilySlug, familySlugForGame } = require('../src/ingest/familyLookup');

test('buildEcoCodeToFamilySlug: resolves a well-known code to its family slug', () => {
  const map = buildEcoCodeToFamilySlug();
  assert.equal(map.get('C50'), 'italian-game');
  assert.equal(map.get('B20'), 'sicilian-defense');
});

test('familySlugForGame: resolves via the ECO header when it is a known code', () => {
  const map = buildEcoCodeToFamilySlug();
  const slug = familySlugForGame({ ecoCodeToFamilySlug: map, ecoHeader: 'C50', openingHeader: 'Italian Game' });
  assert.equal(slug, 'italian-game');
});

test('familySlugForGame: falls back to slugifying the Opening header when the ECO code is unmapped', () => {
  const map = new Map(); // empty -- simulates an ECO code the dataset doesn't have
  const slug = familySlugForGame({ ecoCodeToFamilySlug: map, ecoHeader: 'Z99', openingHeader: "King's Gambit Accepted: Something" });
  assert.equal(slug, 'kings-gambit-accepted');
});

test('familySlugForGame: returns null when neither header is usable', () => {
  const map = new Map();
  assert.equal(familySlugForGame({ ecoCodeToFamilySlug: map, ecoHeader: '', openingHeader: '' }), null);
  assert.equal(familySlugForGame({ ecoCodeToFamilySlug: map }), null);
});
