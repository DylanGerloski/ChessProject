'use strict';

/**
 * Orchestrates the content-page build: fetch -> validate -> model -> render
 * -> write, for the 10 opening pages plus the openings hub (phase 1 scope).
 * Exports buildContentPages({fetchImpl}) so the
 * whole pipeline is testable with a fake fetch and fixture data, mirroring
 * buildStatic.js's own fetchImpl-injection convention -- no live network
 * calls happen anywhere except when the real build is actually run.
 */

const fs = require('fs');
const path = require('path');

const { OPENINGS, assertOpeningsWellFormed } = require('./openings');
const { RATING_BANDS, DEFAULT_SPEEDS } = require('./processRepertoire');
const { fetchExplorerMoves } = require('./fetchOpeningExplorer');
const { buildOpeningModel, findCommonMistakes, opponentOf } = require('./processOpenings');
const { renderOpeningPage, renderOpeningsHub } = require('./renderContent');

const DEFAULT_BAND = '1600-1800';
const OUT_DIR = path.join(__dirname, '..', 'dist');

function repertoireFileName(band, color) {
  const safeBand = band.replace(/[^\w-]/g, '');
  return `repertoire-${safeBand}-${color}.html`;
}

/**
 * Walks an opening's defining line ply-by-ply, validating at each step that
 * the configured SAN/UCI actually appears among the API's candidate moves
 * for that position (spec section 1.2's "move-order validation" -- the
 * guard against publishing a wrong move order without needing a chess
 * engine). The final call in the chain plays the FULL line and its response
 * is returned as the position data for `ratings`/`speeds`, so this single
 * walk both validates the line AND fetches the default band's data.
 *
 * @throws if a configured ply never appears among the API's candidates,
 *   even after retrying with a larger `moves` window.
 */
async function fetchLineWithValidation({ slug, line, ratings, speeds, fetchImpl, movesPerRequest = 12 }) {
  let response = null;
  for (let i = 0; i < line.length; i += 1) {
    const playSoFar = line.slice(0, i).map((p) => p.uci);
    response = await fetchExplorerMoves({ play: playSoFar, ratings, speeds, moves: movesPerRequest, fetchImpl });
    let found = (response.moves || []).some((m) => m.uci === line[i].uci);
    if (!found) {
      response = await fetchExplorerMoves({ play: playSoFar, ratings, speeds, moves: 15, fetchImpl });
      found = (response.moves || []).some((m) => m.uci === line[i].uci);
    }
    if (!found) {
      const apiMoves = (response.moves || []).map((m) => `${m.san}/${m.uci}`).join(', ') || '(no candidate moves returned)';
      throw new Error(
        `openings.js: ${slug} ply ${i} expects ${line[i].san}/${line[i].uci}, API says: ${apiMoves}`
      );
    }
  }
  // Final call: the full line played, which is also the position we need
  // stats for. Requests recentGames too (spec 1.3b) -- same call, no extra cost.
  const fullPlay = line.map((p) => p.uci);
  response = await fetchExplorerMoves({
    play: fullPlay, ratings, speeds, moves: movesPerRequest, recentGames: 4, fetchImpl,
  });
  return response;
}

/**
 * Fetches everything one opening page needs: the default band (with
 * move-order validation), the other 3 bands, the masters database (model
 * games), and -- if a common mistake is found -- the follow-up position
 * showing the featured side's most common punishing reply.
 */
async function fetchOpeningData(openingConfig, { fetchImpl }) {
  const defaultRatings = RATING_BANDS[DEFAULT_BAND];
  const bandResponses = {};

  bandResponses[DEFAULT_BAND] = await fetchLineWithValidation({
    slug: openingConfig.slug,
    line: openingConfig.line,
    ratings: defaultRatings,
    speeds: DEFAULT_SPEEDS,
    fetchImpl,
  });

  const apiOpening = bandResponses[DEFAULT_BAND].opening;
  if (apiOpening && apiOpening.eco && apiOpening.eco !== openingConfig.ecoHint) {
    // eslint-disable-next-line no-console
    console.warn(
      `buildContent: ${openingConfig.slug} ecoHint is ${openingConfig.ecoHint} but the API reports ${apiOpening.eco} -- using the API's value on the page.`
    );
  }

  const fullPlay = openingConfig.line.map((p) => p.uci);
  for (const band of Object.keys(RATING_BANDS)) {
    if (band === DEFAULT_BAND) continue;
    bandResponses[band] = await fetchExplorerMoves({
      play: fullPlay, ratings: RATING_BANDS[band], speeds: DEFAULT_SPEEDS, moves: 12, fetchImpl,
    });
  }

  const mastersResponse = await fetchExplorerMoves({
    play: fullPlay, database: 'masters', moves: 8, topGames: 5, fetchImpl,
  });

  const opponentColor = opponentOf(openingConfig.side);
  const mistakes = findCommonMistakes(bandResponses[DEFAULT_BAND], opponentColor);
  let mistakeFollowUpResponse = null;
  if (mistakes.length > 0) {
    mistakeFollowUpResponse = await fetchExplorerMoves({
      play: [...fullPlay, mistakes[0].uci],
      ratings: defaultRatings,
      speeds: DEFAULT_SPEEDS,
      moves: 8,
      fetchImpl,
    });
  }

  return { bandResponses, mastersResponse, mistakeFollowUpResponse };
}

/** 3 sibling openings: same side first, then any others -- never padded with irrelevant pages (spec 1.8). */
function pickRelated(openingConfig, allEntries) {
  const others = allEntries.filter((e) => e.openingConfig.slug !== openingConfig.slug);
  const sameSide = others.filter((e) => e.openingConfig.side === openingConfig.side);
  const rest = others.filter((e) => e.openingConfig.side !== openingConfig.side);
  return [...sameSide, ...rest].slice(0, 3);
}

function extractTitle(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/);
  return match ? match[1] : null;
}

function extractDescription(html) {
  const match = html.match(/<meta name="description" content="([\s\S]*?)">/);
  return match ? match[1] : null;
}

/**
 * Fails the build loudly (spec section 1.9) on a duplicate title, a
 * duplicate meta description, a missing title, or an over-length title
 * (>65 chars, spec 2.2) or description (>160 chars, spec 2.2) -- a half-built
 * dist/ that silently ships bad SEO metadata is worse than a failed build.
 */
function assertPageMetadata(written) {
  const seenTitles = new Map();
  const seenDescriptions = new Map();
  for (const page of written) {
    if (!page.title) {
      throw new Error(`buildContent: ${page.file} has no <title>`);
    }
    if (page.title.length > 65) {
      throw new Error(`buildContent: ${page.file}'s title is ${page.title.length} chars, over the 65 cap: "${page.title}"`);
    }
    if (seenTitles.has(page.title)) {
      throw new Error(`buildContent: duplicate title between ${seenTitles.get(page.title)} and ${page.file}: "${page.title}"`);
    }
    seenTitles.set(page.title, page.file);

    if (page.description) {
      if (page.description.length > 160) {
        throw new Error(`buildContent: ${page.file}'s meta description is ${page.description.length} chars, over the 160 cap`);
      }
      if (seenDescriptions.has(page.description)) {
        throw new Error(`buildContent: duplicate meta description between ${seenDescriptions.get(page.description)} and ${page.file}`);
      }
      seenDescriptions.set(page.description, page.file);
    }
  }
}

/**
 * @param {object} opts
 * @param {Function} [opts.fetchImpl] injectable fetch, default global fetch
 * @param {string} [opts.outDir] where to write the generated files
 * @param {object} [opts.nav] nav object passed to renderHeader -- only the
 *   pages that exist yet should be keys here (phase 1: repertoire, openings, player)
 * @returns {Promise<{written: Array<{file, html, slug, title, description}>}>}
 */
async function buildContentPages({ fetchImpl = fetch, outDir = OUT_DIR, nav = { repertoire: 'index.html', openings: 'openings.html', player: 'player.html' } } = {}) {
  assertOpeningsWellFormed();
  fs.mkdirSync(outDir, { recursive: true });

  const entries = [];
  for (const openingConfig of OPENINGS) {
    const { bandResponses, mastersResponse, mistakeFollowUpResponse } = await fetchOpeningData(openingConfig, { fetchImpl });
    const model = buildOpeningModel({
      openingConfig, bandResponses, mastersResponse, mistakeFollowUpResponse, defaultBand: DEFAULT_BAND,
    });
    entries.push({ openingConfig, model });
  }

  const repertoireLinks = { white: repertoireFileName(DEFAULT_BAND, 'white'), black: repertoireFileName(DEFAULT_BAND, 'black') };

  const written = [];
  for (const entry of entries) {
    const related = pickRelated(entry.openingConfig, entries).map((r) => ({
      label: r.model.name,
      href: `${r.openingConfig.slug}.html`,
    }));
    const html = renderOpeningPage({ model: entry.model, openingConfig: entry.openingConfig, nav, related, repertoireLinks });
    const file = `${entry.openingConfig.slug}.html`;
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    written.push({ file, html, slug: entry.openingConfig.slug, title: extractTitle(html), description: extractDescription(html) });
  }

  const hubHtml = renderOpeningsHub(entries, { nav });
  fs.writeFileSync(path.join(outDir, 'openings.html'), hubHtml, 'utf8');
  written.push({ file: 'openings.html', html: hubHtml, slug: 'openings-hub', title: extractTitle(hubHtml), description: extractDescription(hubHtml) });

  assertPageMetadata(written);

  return { written, entries };
}

module.exports = {
  buildContentPages,
  fetchOpeningData,
  fetchLineWithValidation,
  repertoireFileName,
  DEFAULT_BAND,
  pickRelated,
  assertPageMetadata,
};
