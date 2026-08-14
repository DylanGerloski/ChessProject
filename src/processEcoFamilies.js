'use strict';

/**
 * Pure processing for T1 family hub pages: turns already-fetched Opening
 * Explorer responses for a family's main line into the same shape
 * src/renderContent.js's renderBandsTable() already knows how to render
 * (`{side, bands: [...]}`) -- reuses processOpenings.js's scoreFor() rather
 * than reimplementing the win/draw/loss-for-side math, so the two tiers
 * can never silently disagree about how a percentage is computed.
 */

const { scoreFor } = require('./processOpenings');

/**
 * @param {object} opts
 * @param {'white'|'black'} opts.side ecoFamilies.js's sideForLine() output
 *   for this family's main line.
 * @param {Record<string, {white:number, draws:number, black:number}|null>} opts.bandResponses
 *   band name -> Opening Explorer /lichess response for the main line's
 *   final position, one per processRepertoire.js's RATING_BANDS key.
 * @param {number} [opts.minGamesForPct] below this many games, suppress the
 *   percentage rather than print a noisy one from a tiny sample -- same
 *   default and same reasoning as processOpenings.js's buildOpeningModel.
 * @returns {{side:string, bands: Array<{band:string, games:number,
 *   whitePct:number|null, drawPct:number|null, blackPct:number|null,
 *   scoreForSide:number|null, enoughData:boolean}>}}
 */
function buildFamilyBandStats({ side, bandResponses, minGamesForPct = 1000 }) {
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
      scoreForSide: enoughData ? scoreFor(totals, side) : null,
      enoughData,
    };
  });
  return { side, bands };
}

module.exports = {
  buildFamilyBandStats,
};
