#!/usr/bin/env node
'use strict';

/**
 * Generates test/fixtures/ingest/sample.pgn -- a SYNTHETIC stand-in for a
 * "200-500 real games captured once from a database dump prefix" fixture.
 *
 * WHY SYNTHETIC, NOT CAPTURED (disclosed honestly, not silently
 * substituted): the environment this file was written in had no working
 * network-download tool available, so a real capture of a Lichess database
 * dump prefix was not possible at the time. See TESTING.md for the full
 * disclosure and the recommended follow-up.
 *
 * Consequence: whether the real dump's PGN header set and field ordering
 * exactly match what's assumed below is UNVERIFIED by this fixture. The
 * header tag set/order/values here are modeled on Lichess's publicly
 * documented PGN export convention (Event/Site/White/Black/Result/UTCDate/
 * UTCTime/WhiteElo/BlackElo/WhiteRatingDiff/BlackRatingDiff/ECO/Opening/
 * TimeControl/Termination), which this project's own
 * src/ingest/gameFilter.js and pgnStream.js are written to tolerate
 * deviations from (case-insensitive substring speed matching,
 * missing-header handling that excludes rather than crashes) -- but
 * "tolerates a mismatch gracefully" is not the same as "verified correct".
 * A real capture should replace this file before any live ingest against
 * the real dump is ever run.
 *
 * The move data itself IS real: opening prefixes are drawn from this
 * project's own vendored, CC0-licensed data/eco/ dataset (src/ecoData.js),
 * each one extended by a few additional plies chosen from chess.js's own
 * legal-move generator (seeded, deterministic) -- so every game in the
 * fixture is a genuinely legal chess game, even though it was not actually
 * played by two humans on lichess.org.
 *
 * Deterministic (a fixed seed), so re-running this script reproduces the
 * exact same fixture byte-for-byte -- re-run only if the generation logic
 * itself changes, not to get "different" synthetic data.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');
const { buildEcoDataset } = require('../../src/ecoData');

const OUT_PATH = path.join(__dirname, '..', '..', 'test', 'fixtures', 'ingest', 'sample.pgn');
const GAME_COUNT = 320;

// Small xorshift32 PRNG -- deterministic given a fixed seed, no dependency.
function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

const rng = makeRng(0xC0FFEE);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const SPEED_PROFILES = [
  { speed: 'blitz', event: 'Rated Blitz game', tc: '180+2', weight: 5 },
  { speed: 'bullet', event: 'Rated Bullet game', tc: '60+0', weight: 2 },
  { speed: 'ultraBullet', event: 'Rated UltraBullet game', tc: '15+0', weight: 1 },
  { speed: 'rapid', event: 'Rated Rapid game', tc: '600+5', weight: 2 },
  { speed: 'classical', event: 'Rated Classical game', tc: '1800+30', weight: 1 },
  { speed: 'correspondence', event: 'Rated Correspondence game', tc: '-', weight: 1 },
];
const SPEED_TABLE = SPEED_PROFILES.flatMap((p) => Array(p.weight).fill(p));

const RESULTS = ['1-0', '1-0', '0-1', '0-1', '1/2-1/2'];
const TERMINATIONS = ['Normal', 'Normal', 'Normal', 'Time forfeit'];

// A band-spanning set of (whiteElo, blackElo) pairs so every one of the
// six ingest bands (u1200 .. 2000+) gets real coverage, with a mix of
// balanced (<=50 gap) and unbalanced pairs to exercise both.
const ELO_PAIRS = [
  [980, 1010], [1050, 1350], [1150, 1180],
  [1250, 1290], [1300, 1520], [1380, 1410],
  [1450, 1470], [1500, 1750], [1550, 1590],
  [1650, 1680], [1620, 1900], [1720, 1740],
  [1850, 1880], [1800, 2050], [1920, 1950],
  [2050, 2080], [2100, 2400], [2200, 2230],
];

function pickOpeningLines() {
  const { lines } = buildEcoDataset();
  const wantedFamilies = [
    'Italian Game', 'Sicilian Defense', 'French Defense',
    "Queen's Gambit Declined", 'Caro-Kann Defense', 'Ruy Lopez',
    'English Opening', 'Scandinavian Defense', "King's Indian Defense",
    'London System', "Queen's Pawn Game", 'Vienna Game',
    'Slav Defense', 'Nimzo-Larsen Attack', "Bird's Opening",
  ];
  const picked = [];
  for (const family of wantedFamilies) {
    const candidates = lines.filter((l) => l.family === family && l.plies.length >= 4 && l.plies.length <= 8);
    if (candidates.length > 0) picked.push(candidates[0]);
  }
  return picked;
}

/** Extends a line's SAN prefix by `extra` additional plies of real, legal (chess.js-verified) but pseudo-random continuation moves. */
function extendLine(sanPrefix, extra) {
  const chess = new Chess();
  for (const san of sanPrefix) chess.move(san, { strict: false });
  const sans = [...sanPrefix];
  for (let i = 0; i < extra; i += 1) {
    const legalMoves = chess.moves();
    if (legalMoves.length === 0) break;
    const next = pick(legalMoves);
    chess.move(next, { strict: false });
    sans.push(next);
  }
  return sans;
}

function formatMovetext(sanMoves, result) {
  const parts = [];
  for (let i = 0; i < sanMoves.length; i += 1) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(sanMoves[i]);
  }
  parts.push(result);
  // Wrap at ~80 chars, matching a typical PGN exporter -- not load-bearing
  // for parsing (pgnStream.js joins lines back together), just readability.
  const words = parts;
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length + 1 > 80) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

function siteId() {
  let id = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 8; i += 1) id += alphabet[Math.floor(rng() * alphabet.length)];
  return id;
}

function main() {
  const openingLines = pickOpeningLines();
  if (openingLines.length === 0) throw new Error('generateSyntheticIngestFixture: no opening lines picked');

  const games = [];
  for (let i = 0; i < GAME_COUNT; i += 1) {
    const line = pick(openingLines);
    const extra = 4 + Math.floor(rng() * 10); // total prefix length varies, well past MAX_PLIES=16 for most
    const sanMoves = extendLine(line.plies.map((p) => p.san), extra);
    const speedProfile = pick(SPEED_TABLE);
    const [whiteElo, blackElo] = pick(ELO_PAIRS);
    const result = speedProfile.speed === 'correspondence' ? pick(RESULTS) : pick(RESULTS);
    const day = 1 + Math.floor(rng() * 3); // first 3 days of the month, per the "prefix" assumption
    const hh = String(Math.floor(rng() * 24)).padStart(2, '0');
    const mm = String(Math.floor(rng() * 60)).padStart(2, '0');
    const ss = String(Math.floor(rng() * 60)).padStart(2, '0');

    // A handful of deliberately excludable games, to exercise gameFilter's
    // exclusion paths against real-shaped-but-incomplete headers.
    const dropElo = i % 47 === 0; // missing rating -> excluded
    const ongoing = i % 61 === 0; // Result "*" -> excluded

    const headers = [
      ['Event', speedProfile.event],
      ['Site', `https://lichess.org/${siteId()}`],
      ['White', `Player${1000 + i}`],
      ['Black', `Player${2000 + i}`],
      ['Result', ongoing ? '*' : result],
      ['UTCDate', `2026.07.0${day}`],
      ['UTCTime', `${hh}:${mm}:${ss}`],
      ['WhiteElo', dropElo ? '?' : String(whiteElo)],
      ['BlackElo', dropElo ? '?' : String(blackElo)],
      ['WhiteRatingDiff', dropElo ? '?' : String(Math.floor(rng() * 17) - 8)],
      ['BlackRatingDiff', dropElo ? '?' : String(Math.floor(rng() * 17) - 8)],
      ['ECO', line.eco],
      ['Opening', line.name],
      ['TimeControl', speedProfile.tc],
      ['Termination', ongoing ? 'Unterminated' : pick(TERMINATIONS)],
    ];

    const headerBlock = headers.map(([k, v]) => `[${k} "${v}"]`).join('\n');
    const movetext = ongoing ? '*' : formatMovetext(sanMoves, result);
    games.push(`${headerBlock}\n\n${movetext}`);
  }

  const text = `${games.join('\n\n')}\n`;
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, text, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`generateSyntheticIngestFixture: wrote ${games.length} games, ${Buffer.byteLength(text, 'utf8')} bytes, to ${OUT_PATH}`);
}

if (require.main === module) main();

module.exports = { main };
