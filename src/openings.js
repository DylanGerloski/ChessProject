'use strict';

/**
 * The fixed set of 10 opening pages this build produces (spec section 1.2).
 * Deliberately fixed -- see spec section 3.4 ("why templated per-opening
 * pages are not scaled-content abuse here"): no programmatic expansion, no
 * "one page per ECO code". `line` is the defining move sequence from the
 * start position; `ecoHint`/API-returned `opening.eco` are cross-checked at
 * build time (src/buildContent.js), never assumed equal.
 *
 * Pure data + pure helpers only -- no I/O, unit-testable in isolation.
 */

const OPENINGS = [
  {
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
  },
  {
    slug: 'ruy-lopez',
    name: 'Ruy Lopez',
    ecoHint: 'C60',
    side: 'white',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'f1b5', san: 'Bb5' },
    ],
  },
  {
    slug: 'scotch-game',
    name: 'Scotch Game',
    ecoHint: 'C44',
    side: 'white',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'd2d4', san: 'd4' },
    ],
  },
  {
    slug: 'sicilian-defense',
    name: 'Sicilian Defense',
    ecoHint: 'B20',
    side: 'black',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'c7c5', san: 'c5' },
    ],
  },
  {
    slug: 'french-defense',
    name: 'French Defense',
    ecoHint: 'C00',
    side: 'black',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e6', san: 'e6' },
    ],
  },
  {
    slug: 'caro-kann-defense',
    name: 'Caro-Kann Defense',
    ecoHint: 'B10',
    side: 'black',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'c7c6', san: 'c6' },
    ],
  },
  {
    slug: 'scandinavian-defense',
    name: 'Scandinavian Defense',
    ecoHint: 'B01',
    side: 'black',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'd7d5', san: 'd5' },
    ],
  },
  {
    slug: 'queens-gambit',
    name: "Queen's Gambit",
    ecoHint: 'D06',
    side: 'white',
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'd7d5', san: 'd5' },
      { uci: 'c2c4', san: 'c4' },
    ],
  },
  {
    slug: 'london-system',
    name: 'London System',
    ecoHint: 'D02',
    side: 'white',
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'd7d5', san: 'd5' },
      { uci: 'c1f4', san: 'Bf4' },
    ],
  },
  {
    slug: 'kings-indian-defense',
    name: "King's Indian Defense",
    ecoHint: 'E60',
    side: 'black',
    line: [
      { uci: 'd2d4', san: 'd4' },
      { uci: 'g8f6', san: 'Nf6' },
      { uci: 'c2c4', san: 'c4' },
      { uci: 'g7g6', san: 'g6' },
    ],
  },
];

// Static filenames this build already writes outside of openings.js's own
// slugs (existing tool pages + hub pages), used by the collision check
// below. Guide/article slugs (src/content/*.js) aren't individually listed
// here -- buildStatic.js's own assertFilenamesUnique() checks the full,
// final file list (repertoire + opening + guide + hub + compliance pages)
// after every page is actually written, which is the authoritative check.
const RESERVED_STATIC_FILENAMES = [
  'index.html',
  'player.html',
  'player-lookup.js',
  'openings.html',
  'guides.html',
  'chess-opening-faq.html',
  'italian-game-drill.html',
];

function getOpening(slug) {
  return OPENINGS.find((o) => o.slug === slug) || null;
}

function slugToFilename(slug) {
  return `${slug}.html`;
}

function assertOpeningsWellFormed() {
  const seenSlugs = new Set();
  for (const o of OPENINGS) {
    if (!/^[a-z0-9-]+$/.test(o.slug)) {
      throw new Error(`openings.js: slug "${o.slug}" is not URL-safe`);
    }
    if (seenSlugs.has(o.slug)) {
      throw new Error(`openings.js: duplicate slug "${o.slug}"`);
    }
    seenSlugs.add(o.slug);
    if (RESERVED_STATIC_FILENAMES.includes(slugToFilename(o.slug))) {
      throw new Error(`openings.js: slug "${o.slug}" collides with a reserved static filename`);
    }
    if (o.side !== 'white' && o.side !== 'black') {
      throw new Error(`openings.js: "${o.slug}" has invalid side "${o.side}"`);
    }
    if (!Array.isArray(o.line) || o.line.length === 0) {
      throw new Error(`openings.js: "${o.slug}" has an empty line`);
    }
    for (const ply of o.line) {
      if (!ply.uci || !ply.san) {
        throw new Error(`openings.js: "${o.slug}" has a ply missing uci/san`);
      }
    }
  }
  return true;
}

module.exports = {
  OPENINGS,
  RESERVED_STATIC_FILENAMES,
  getOpening,
  slugToFilename,
  assertOpeningsWellFormed,
};
