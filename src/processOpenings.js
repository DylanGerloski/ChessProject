'use strict';

/**
 * Pure processing for per-opening content pages. No I/O -- everything here
 * takes already-fetched Opening Explorer responses and openings.js config in,
 * and returns plain view-model data out, same convention as
 * processRepertoire.js (whose moveStatsFromExplorerResponse() this reuses
 * rather than re-implementing the percentage math).
 *
 * A note on whose "mistakes" this analyzes: every entry in openings.js
 * defines `line` as the featured side's OWN defining move sequence, so the
 * position reached after playing it is always the OPPONENT's move -- e.g.
 * the Italian Game's line ends on White's 3.Bc4, so Black is to move next.
 * That means "common mistakes" and "what people actually play next" are
 * naturally about how the opponent tends to respond, which is the useful
 * framing for a page about *playing* that opening ("here's how club players
 * often go wrong against you, and how to punish it").
 */

const { moveStatsFromExplorerResponse } = require('./processRepertoire');

function opponentOf(side) {
  return side === 'white' ? 'black' : 'white';
}

/**
 * @param {{white:number, draws:number, black:number}} totals
 * @param {'white'|'black'} color
 * @returns {number|null} standard chess scoring (win=1, draw=0.5) as a
 *   percentage for `color`, or null if there's no data.
 */
function scoreFor(totals, color) {
  if (!totals) return null;
  const white = totals.white || 0;
  const draws = totals.draws || 0;
  const black = totals.black || 0;
  const total = white + draws + black;
  if (total <= 0) return null;
  const winsForColor = color === 'white' ? white : black;
  return Number((((winsForColor + draws / 2) / total) * 100).toFixed(1));
}

/**
 * Finds moves that are played often enough to matter at this rating but
 * score badly for the side playing them -- a claim true by arithmetic, not
 * an assertion of chess knowledge (spec section 3.3).
 *
 * @param {object} response an Opening Explorer response for the position
 * @param {'white'|'black'} moverColor whose candidate moves to evaluate
 * @param {{minPlayedPct?:number, maxScoreForMover?:number, limit?:number}} opts
 * @returns {Array} moves (each carrying a `score` field), worst score first
 */
function findCommonMistakes(response, moverColor, opts = {}) {
  const { minPlayedPct = 2, maxScoreForMover = 47, limit = 2 } = opts;
  const moves = moveStatsFromExplorerResponse(response, moverColor);
  return moves
    .map((m) => ({
      ...m,
      score: m.winPct == null || m.drawPct == null ? null : Number((m.winPct + m.drawPct / 2).toFixed(1)),
    }))
    .filter((m) => m.playedPct != null && m.playedPct >= minPlayedPct && m.score != null && m.score <= maxScoreForMover)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

/**
 * Assembles one opening page's full view-model from already-fetched Explorer
 * responses. See module doc for why `mistakes`/`topReplies` are computed for
 * the opponent's color, not the featured side's.
 *
 * @param {object} opts
 * @param {object} opts.openingConfig one entry from openings.js's OPENINGS
 * @param {Record<string, object|null>} opts.bandResponses band name -> /lichess response
 * @param {object|null} opts.mastersResponse /masters response for the same line
 * @param {object|null} opts.mistakeFollowUpResponse /lichess response for the
 *   position after the single worst mistake found in the default band
 * @param {string} [opts.defaultBand]
 * @param {number} [opts.minGamesForPct] below this many games, suppress
 *   percentages for that band rather than print a noisy one (spec 5.7)
 */
function buildOpeningModel({
  openingConfig,
  bandResponses,
  mastersResponse = null,
  mistakeFollowUpResponse = null,
  defaultBand = '1600-1800',
  minGamesForPct = 1000,
}) {
  const opponentColor = opponentOf(openingConfig.side);
  const defaultResp = bandResponses ? bandResponses[defaultBand] : null;

  // eco: authoritative from the API when available (spec 1.2 -- print the
  // API's value if it disagrees with ecoHint, never assume equal).
  // name: always the curated openings.js name, deliberately NOT the API's
  // per-position name. The API's `opening.name` at a given position can be
  // a much longer, more specific classification than the opening this page
  // is actually about (observed live: the London System position returned
  // "Queen's Pawn Game: Accelerated London System" -- accurate, but it blew
  // past the 65-char title cap and would have made the page's own H1,
  // title, breadcrumb, and URL slug all disagree with each other). Keeping
  // one short, human-chosen name everywhere is both an SEO-length
  // requirement and a coherence one.
  const apiOpening = defaultResp && defaultResp.opening ? defaultResp.opening : null;
  const eco = apiOpening && apiOpening.eco ? apiOpening.eco : openingConfig.ecoHint;
  const name = openingConfig.name;

  const bands = Object.keys(bandResponses || {}).map((band) => {
    const resp = bandResponses[band];
    const totals = { white: (resp && resp.white) || 0, draws: (resp && resp.draws) || 0, black: (resp && resp.black) || 0 };
    const games = totals.white + totals.draws + totals.black;
    const enoughData = games >= minGamesForPct;
    return {
      band,
      games,
      whitePct: enoughData ? Number(((totals.white / games) * 100).toFixed(1)) : null,
      drawPct: enoughData ? Number(((totals.draws / games) * 100).toFixed(1)) : null,
      blackPct: enoughData ? Number(((totals.black / games) * 100).toFixed(1)) : null,
      scoreForSide: enoughData ? scoreFor(totals, openingConfig.side) : null,
      enoughData,
    };
  });

  const openingByUci = {};
  if (defaultResp && Array.isArray(defaultResp.moves)) {
    for (const m of defaultResp.moves) {
      if (m.opening) openingByUci[m.uci] = m.opening;
    }
  }
  const topReplies = defaultResp
    ? moveStatsFromExplorerResponse(defaultResp, opponentColor)
        .slice(0, 6)
        .map((m) => ({ ...m, opening: openingByUci[m.uci] || null }))
    : [];

  const mistakes = defaultResp ? findCommonMistakes(defaultResp, opponentColor) : [];
  if (mistakes.length > 0 && mistakeFollowUpResponse) {
    const punishingReplies = moveStatsFromExplorerResponse(mistakeFollowUpResponse, openingConfig.side);
    mistakes[0] = { ...mistakes[0], punishingReply: punishingReplies[0] || null };
  }

  const masterGames = mastersResponse && Array.isArray(mastersResponse.topGames) ? mastersResponse.topGames : [];
  const recentGames = defaultResp && Array.isArray(defaultResp.recentGames) ? defaultResp.recentGames : [];

  return {
    slug: openingConfig.slug,
    eco,
    name,
    side: openingConfig.side,
    opponentColor,
    line: openingConfig.line,
    defaultBand,
    bands,
    topReplies,
    mistakes,
    masterGames,
    recentGames,
  };
}

/**
 * Ranks the 10 tracked openings by score-for-its-own-side at one rating
 * band, for cross-opening comparison articles (phase 2). Openings whose
 * band doesn't have enough games yet (see buildOpeningModel's
 * minGamesForPct) are left out entirely rather than shown with a noisy
 * percentage -- same "don't print a confident number from 8 games" rule as
 * the per-opening page itself.
 *
 * @param {Array<{openingConfig:object, model:object}>} entries
 * @param {string} band a RATING_BANDS key, e.g. '1600-1800'
 * @returns {Array<{slug,name,side,band,games,scoreForSide}>} best score first
 */
function rankOpeningsByScore(entries, band) {
  return entries
    .map(({ openingConfig, model }) => {
      const b = (model.bands || []).find((x) => x.band === band);
      return {
        slug: openingConfig.slug,
        name: model.name,
        side: model.side,
        band,
        games: b ? b.games : 0,
        scoreForSide: b ? b.scoreForSide : null,
        enoughData: b ? b.enoughData : false,
      };
    })
    .filter((e) => e.enoughData)
    .sort((a, b) => b.scoreForSide - a.scoreForSide);
}

/**
 * Flattens every opening's already-computed `mistakes` (findCommonMistakes
 * output, see buildOpeningModel) into one list tagged with which opening and
 * side it came from, worst-scoring first -- the data source for the
 * "most common opening mistakes" article (phase 2), which is unique to this
 * site precisely because nobody else aggregates this across openings.
 *
 * @param {Array<{openingConfig:object, model:object}>} entries
 * @returns {Array<{slug,name,opponentColor,defaultBand,san,playedPct,score,punishingReply}>}
 */
function aggregateMistakesAcrossOpenings(entries) {
  const out = [];
  for (const { openingConfig, model } of entries) {
    for (const m of model.mistakes || []) {
      out.push({
        slug: openingConfig.slug,
        name: model.name,
        opponentColor: model.opponentColor,
        defaultBand: model.defaultBand,
        san: m.san,
        playedPct: m.playedPct,
        score: m.score,
        punishingReply: m.punishingReply || null,
      });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

/**
 * For a single opening's model, the spread between its highest- and
 * lowest-scoring rating band (bands with enough data only) -- how much the
 * featured side's score for this exact line moves across 1400-1600 through
 * 2000+. Used by the "does opening choice matter under 1500" article to ask
 * a computable version of that question instead of asserting an opinion.
 *
 * @param {object} model output of buildOpeningModel
 * @returns {{minBand:string, minScore:number, maxBand:string, maxScore:number, range:number}|null}
 *   null if fewer than 2 bands have enough data to compare.
 */
function scoreRangeAcrossBands(model) {
  const withData = (model.bands || []).filter((b) => b.enoughData && b.scoreForSide != null);
  if (withData.length < 2) return null;
  const min = withData.reduce((a, b) => (b.scoreForSide < a.scoreForSide ? b : a));
  const max = withData.reduce((a, b) => (b.scoreForSide > a.scoreForSide ? b : a));
  return {
    minBand: min.band,
    minScore: min.scoreForSide,
    maxBand: max.band,
    maxScore: max.scoreForSide,
    range: Number((max.scoreForSide - min.scoreForSide).toFixed(1)),
  };
}

module.exports = {
  scoreFor,
  findCommonMistakes,
  buildOpeningModel,
  opponentOf,
  rankOpeningsByScore,
  aggregateMistakesAcrossOpenings,
  scoreRangeAcrossBands,
};
