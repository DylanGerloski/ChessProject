'use strict';

/**
 * Pure include/exclude + bucketing decision for one game's headers. No
 * I/O -- takes the plain headers object `pgnStream.js` emits, returns a
 * plain decision object.
 */

// Bucket by the AVERAGE of both players' ratings, matching how the Lichess
// Opening Explorer buckets -- keeps these numbers comparable to the
// existing (Explorer-sourced) figures already published on the site. Adds
// sub-1200 coverage (u1200) that the Explorer's own fixed buckets don't
// offer at all.
const BANDS = [
  { key: 'u1200', min: -Infinity, max: 1200 },
  { key: '1200-1400', min: 1200, max: 1400 },
  { key: '1400-1600', min: 1400, max: 1600 },
  { key: '1600-1800', min: 1600, max: 1800 },
  { key: '1800-2000', min: 1800, max: 2000 },
  { key: '2000+', min: 2000, max: Infinity },
];

// Three published pools. blitz is the DEFAULT displayed pool -- deliberately
// unchanged from what the site already shows, so switching the data source
// doesn't also silently restate every currently-published figure.
const POOL_FOR_SPEED = {
  ultraBullet: 'bullet',
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid_classical',
  classical: 'rapid_classical',
  // correspondence intentionally has no pool -- excluded outright (a
  // different population: opening books, days per move).
};

const BALANCED_ELO_WINDOW = 50;

// Longest-needle-first so "ultrabullet" is never mis-matched as "bullet".
const SPEED_KEYWORDS = [
  { needle: 'ultrabullet', speed: 'ultraBullet' },
  { needle: 'correspondence', speed: 'correspondence' },
  { needle: 'classical', speed: 'classical' },
  { needle: 'bullet', speed: 'bullet' },
  { needle: 'blitz', speed: 'blitz' },
  { needle: 'rapid', speed: 'rapid' },
];

/**
 * Derives a speed from the Event header ("Rated Blitz game", "Rated
 * UltraBullet tournament", ...) via a case-insensitive substring search
 * rather than a strict "Rated X game" regex -- deliberately tolerant of a
 * suffix this module hasn't seen (arena/swiss event names vary), since the
 * real header wording has not been verified against a live download.
 * Returns null rather than throwing when nothing recognizable is found.
 */
function speedFromEventHeader(eventValue) {
  if (typeof eventValue !== 'string') return null;
  const lower = eventValue.toLowerCase();
  for (const { needle, speed } of SPEED_KEYWORDS) {
    if (lower.includes(needle)) return speed;
  }
  return null;
}

/**
 * Derives a speed from the TimeControl header ("180+0", or "-" for
 * correspondence/unlimited) using Lichess's own published speed-bucket
 * thresholds (estimated game duration = base + 40*increment, in seconds).
 * This is the CROSS-CHECK against the Event header, not the primary
 * source.
 */
function speedFromTimeControl(timeControl) {
  if (typeof timeControl !== 'string') return null;
  const trimmed = timeControl.trim();
  if (trimmed === '-') return 'correspondence';
  const m = /^(\d+)\+(\d+)$/.exec(trimmed);
  if (!m) return null;
  const base = Number(m[1]);
  const increment = Number(m[2]);
  const total = base + 40 * increment;
  if (total < 29) return 'ultraBullet';
  if (total < 179) return 'bullet';
  if (total < 479) return 'blitz';
  if (total < 1499) return 'rapid';
  return 'classical';
}

function bandForRating(avgElo) {
  for (const b of BANDS) {
    if (avgElo >= b.min && avgElo < b.max) return b.key;
  }
  return BANDS[BANDS.length - 1].key;
}

/**
 * @param {Record<string,string>} headers one game's parsed PGN headers.
 * @returns {{include: false, reason: string} |
 *   {include: true, band: string, pool: string, speed: string,
 *    balanced: boolean, avgElo: number, whiteElo: number, blackElo: number,
 *    speedDisagreement: boolean}}
 */
function classifyGame(headers) {
  const h = headers || {};
  const result = h.Result;
  if (result !== '1-0' && result !== '0-1' && result !== '1/2-1/2') {
    return { include: false, reason: 'result' };
  }

  const whiteElo = Number(h.WhiteElo);
  const blackElo = Number(h.BlackElo);
  if (
    h.WhiteElo === undefined || h.BlackElo === undefined
    || h.WhiteElo === '' || h.BlackElo === ''
    || !Number.isFinite(whiteElo) || !Number.isFinite(blackElo)
  ) {
    return { include: false, reason: 'missing-elo' };
  }

  const eventSpeed = speedFromEventHeader(h.Event);
  const tcSpeed = speedFromTimeControl(h.TimeControl);
  const speedDisagreement = Boolean(eventSpeed && tcSpeed && eventSpeed !== tcSpeed);
  // Event header is primary (Lichess's own classification); TimeControl is
  // the fallback when Event is missing/unrecognized.
  const speed = eventSpeed || tcSpeed;

  if (!speed) return { include: false, reason: 'unknown-speed' };
  if (speed === 'correspondence') return { include: false, reason: 'correspondence' };

  const pool = POOL_FOR_SPEED[speed];
  if (!pool) return { include: false, reason: 'unmapped-speed' };

  const avgElo = (whiteElo + blackElo) / 2;
  return {
    include: true,
    band: bandForRating(avgElo),
    pool,
    speed,
    balanced: Math.abs(whiteElo - blackElo) <= BALANCED_ELO_WINDOW,
    avgElo,
    whiteElo,
    blackElo,
    speedDisagreement,
  };
}

/** 1-0 / 1/2-1/2 / 0-1 -> the single-letter key used throughout aggregate.js. */
function resultLetter(result) {
  if (result === '1-0') return 'w';
  if (result === '1/2-1/2') return 'd';
  if (result === '0-1') return 'l';
  return null;
}

module.exports = {
  BANDS,
  POOL_FOR_SPEED,
  BALANCED_ELO_WINDOW,
  speedFromEventHeader,
  speedFromTimeControl,
  bandForRating,
  classifyGame,
  resultLetter,
};
