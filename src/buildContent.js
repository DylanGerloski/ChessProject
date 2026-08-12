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
const {
  buildOpeningModel,
  findCommonMistakes,
  opponentOf,
  rankOpeningsByScore,
  aggregateMistakesAcrossOpenings,
  scoreRangeAcrossBands,
} = require('./processOpenings');
const {
  renderOpeningPage,
  renderOpeningsHub,
  renderArticlePage,
  renderGuidesHub,
  renderFaqPage,
  formatSanLine,
  formatGamesAbbrev,
  lichessAnalysisUrl,
  lichessOpeningUrl,
} = require('./renderContent');
const { escapeHtml, formatPct, wrapTable } = require('./render');
const { BUILD_DATE } = require('./site');

// Editorial guides (phase 2). Each module exports {meta, render(ctx)} -- see
// any file under src/content/ for the shared contract. This is a FIXED list,
// deliberately shorter than the original 8-article plan: two candidate
// topics -- "what 1200-rated players actually play" and "Italian Game
// traps" -- were dropped here because the data this build actually has
// (per-position band/reply stats for 10 fixed lines) doesn't support the
// first without inventing move-popularity data this site doesn't fetch, and
// the second would require asserting named-trap chess analysis ("this loses
// a piece") without every claim being either site-data-backed or sourced to
// an authoritative external reference, which needs a level of chess-domain
// verification this build isn't equipped to do responsibly. The remaining 6
// are all built entirely from ctx.entries (this build's own already-fetched
// opening data) -- no hand-typed statistics.
const GUIDES = [
  require('./content/how-to-beat-the-london-system'),
  require('./content/best-chess-openings-for-beginners'),
  require('./content/sicilian-vs-french-vs-caro-kann'),
  require('./content/most-common-opening-mistakes-1600-1800'),
  require('./content/should-you-study-openings-under-1500'),
  require('./content/scandinavian-defense-at-club-level'),
];

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
 * (>70 chars, spec 2.2) or description (>160 chars, spec 2.2) -- a half-built
 * dist/ that silently ships bad SEO metadata is worse than a failed build.
 */
function assertPageMetadata(written) {
  const seenTitles = new Map();
  const seenDescriptions = new Map();
  for (const page of written) {
    if (!page.title) {
      throw new Error(`buildContent: ${page.file} has no <title>`);
    }
    if (page.title.length > 70) {
      throw new Error(`buildContent: ${page.file}'s title is ${page.title.length} chars, over the 70 cap: "${page.title}"`);
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
 *   pages that exist yet should be keys here (phase 2: repertoire, openings, guides, faq, player)
 * @param {Object<string,string>} [opts.drillPages] maps an opening slug to
 *   its drill page filename (single-opening drill pilot). An opening whose
 *   slug isn't a key here renders with no drill CTA -- unchanged output.
 * @returns {Promise<{written: Array<{file, html, slug, title, description}>}>}
 */
async function buildContentPages({
  fetchImpl = fetch,
  outDir = OUT_DIR,
  nav = { repertoire: '/', openings: 'openings.html', guides: 'guides.html', faq: 'chess-opening-faq.html', player: 'player.html' },
  drillPages = {},
} = {}) {
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
    const drillFile = drillPages[entry.openingConfig.slug] || null;
    const html = renderOpeningPage({ model: entry.model, openingConfig: entry.openingConfig, nav, related, repertoireLinks, drillFile });
    const file = `${entry.openingConfig.slug}.html`;
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    written.push({ file, html, slug: entry.openingConfig.slug, title: extractTitle(html), description: extractDescription(html) });
  }

  const hubHtml = renderOpeningsHub(entries, { nav });
  fs.writeFileSync(path.join(outDir, 'openings.html'), hubHtml, 'utf8');
  written.push({ file: 'openings.html', html: hubHtml, slug: 'openings-hub', title: extractTitle(hubHtml), description: extractDescription(hubHtml) });

  // Phase 2: guides (editorial articles) + guides hub + FAQ. Built from the
  // SAME `entries` this build already fetched for the opening pages -- no
  // extra Explorer requests, no hand-typed statistics (spec 1.6's "ground
  // this in actual research, not assumption", applied to the numbers
  // themselves, not just topic selection).
  const { written: guideWritten, summaries: guideSummaries } = buildGuidePages(entries, { nav, outDir });
  written.push(...guideWritten);

  const guidesHubEntry = buildGuidesHubPage(guideSummaries, { nav, outDir });
  written.push(guidesHubEntry);

  const faqEntry = buildFaqPageFile(entries, { nav, outDir });
  written.push(faqEntry);

  assertPageMetadata(written);

  return { written, entries };
}

/**
 * Renders and writes every entry in GUIDES (src/content/*.js), passing each
 * one a ctx object built from this build's own already-computed opening
 * data plus the shared render/format helpers those modules need -- content
 * modules never require() renderContent.js themselves (would risk a
 * circular require; renderContent.js doesn't depend on buildContent.js
 * either way, but the ctx-injection keeps the direction one-way and the
 * modules trivially testable with a hand-built ctx).
 */
function buildGuidePages(entries, { nav, outDir }) {
  const ctx = {
    entries,
    rankOpeningsByScore,
    aggregateMistakesAcrossOpenings,
    scoreRangeAcrossBands,
    formatSanLine,
    formatGamesAbbrev,
    lichessAnalysisUrl,
    lichessOpeningUrl,
    escapeHtml,
    formatPct,
    wrapTable,
  };

  const written = [];
  const summaries = [];
  for (const guide of GUIDES) {
    const related = (guide.meta.related || [])
      .map((slug) => entries.find((e) => e.openingConfig.slug === slug))
      .filter(Boolean)
      .map((e) => ({ label: e.model.name, href: `${e.openingConfig.slug}.html` }));
    const bodyHtml = guide.render(ctx);
    const meta = { ...guide.meta, datePublished: BUILD_DATE };
    const html = renderArticlePage({ meta, bodyHtml, nav, related });
    const file = `${guide.meta.slug}.html`;
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    written.push({ file, html, slug: guide.meta.slug, title: extractTitle(html), description: extractDescription(html) });
    summaries.push({ slug: guide.meta.slug, title: guide.meta.title, description: guide.meta.description });
  }
  return { written, summaries };
}

function buildGuidesHubPage(summaries, { nav, outDir }) {
  const html = renderGuidesHub(summaries, { nav });
  fs.writeFileSync(path.join(outDir, 'guides.html'), html, 'utf8');
  return { file: 'guides.html', html, slug: 'guides-hub', title: extractTitle(html), description: extractDescription(html) };
}

/**
 * The 12 FAQ questions from spec section 1.5, answered where possible from
 * this build's own `entries` data (never a fabricated statistic) and
 * otherwise as plain, honest prose -- e.g. "how is this site funded" states
 * the real current answer (voluntary support links, no ads yet) rather than
 * a generic placeholder.
 */
function buildFaqEntries(entries) {
  const rankedBeginnerBand = rankOpeningsByScore(entries, '1400-1600');
  const topBeginner = rankedBeginnerBand[0] || null;

  return [
    {
      question: 'What is a chess opening?',
      answerHtml: `<p>An opening is the sequence of moves that starts a chess game, before the position becomes unique to that specific game. This site tracks <a href="openings.html">10 well-known openings &rarr;</a> and shows how they actually score in real games, by rating band.</p>`,
    },
    {
      question: 'Do I need to memorize openings to improve?',
      answerHtml: `<p>No &mdash; standard improvement advice, especially below about 1500, prioritizes tactics and endgame technique over opening memorization. See <a href="should-you-study-openings-under-1500.html">Should you study openings under 1500? &rarr;</a> for what this site&rsquo;s own data shows about how much opening choice actually moves the needle by rating.</p>`,
    },
    {
      question: 'What is the best first move for beginners?',
      answerHtml: topBeginner
        ? `<p>There&rsquo;s no single objectively &ldquo;best&rdquo; first move, but among the openings this site tracks, <a href="${escapeHtml(topBeginner.slug)}.html">${escapeHtml(topBeginner.name)}</a> currently scores highest for its side at the 1400-1600 rating band. See the <a href="best-chess-openings-for-beginners.html">full ranking &rarr;</a> for all of them, and why &ldquo;highest score&rdquo; isn&rsquo;t the whole answer.</p>`
        : `<p>There&rsquo;s no single objectively &ldquo;best&rdquo; first move. See the <a href="best-chess-openings-for-beginners.html">beginner openings ranked by score &rarr;</a> for how the openings this site tracks actually compare.</p>`,
    },
    {
      question: 'What does ECO mean?',
      answerHtml: `<p>ECO stands for &ldquo;Encyclopaedia of Chess Openings&rdquo; &mdash; a standard code (like C50 or B20) chess databases use to classify openings. Every opening page on this site shows its ECO code, sourced directly from the Lichess Opening Explorer API.</p>`,
    },
    {
      question: 'Which openings score best at my rating?',
      answerHtml: `<p>It depends on your rating band and which side you&rsquo;re playing. See the <a href="openings.html">openings comparison table &rarr;</a>, which breaks every tracked opening down by rating band (1400-1600 through 2000+).</p>`,
    },
    {
      question: 'Why do win rates differ by rating band?',
      answerHtml: `<p>Different rating bands make different mistakes at different rates in the same position &mdash; see <a href="most-common-opening-mistakes-1600-1800.html">the most common opening mistakes at 1600-1800 &rarr;</a> for concrete examples pulled from this site&rsquo;s own data.</p>`,
    },
    {
      question: 'What is a "system" opening, like the London System?',
      answerHtml: `<p>A &ldquo;system&rdquo; opening is one where a side plays roughly the same setup regardless of what the opponent does, trading some flexibility for lower theory requirements. See the <a href="london-system.html">London System page &rarr;</a> and the <a href="how-to-beat-the-london-system.html">how to beat it guide &rarr;</a> for what the actual data shows.</p>`,
    },
    {
      question: 'How many openings should I learn?',
      answerHtml: `<p>Most improvement advice suggests one solid response to 1.e4, one to 1.d4, and a small number of systems as White &mdash; not a large repertoire. This site deliberately tracks a fixed set of 10 openings rather than trying to cover everything, for the same reason.</p>`,
    },
    {
      question: "What's the difference between the Lichess database and the masters database?",
      answerHtml: `<p>The Lichess database aggregates real games played by everyone on Lichess, filterable by rating band &mdash; that&rsquo;s what powers the &ldquo;how it scores at your rating&rdquo; section on every opening page. The masters database is a separate, much smaller set of real games played by titled/master-level players, used for the &ldquo;model games&rdquo; section. This site shows both side by side deliberately, so you can see how masters play a line versus how it actually goes at club level.</p>`,
    },
    {
      question: 'Are these stats from blitz or classical games?',
      answerHtml: `<p>Blitz and rapid games from the Lichess database (the two fastest time controls with enough volume to give reliable numbers at every rating band this site tracks). Classical games are not included &mdash; there generally isn&rsquo;t enough volume at most rating bands to compute a trustworthy percentage from them.</p>`,
    },
    {
      question: 'How often is the data updated?',
      answerHtml: `<p>Whenever this site is rebuilt from live Lichess data &mdash; there is no live/real-time updating between rebuilds. This build's data was retrieved ${escapeHtml(BUILD_DATE)}.</p>`,
    },
    {
      question: 'How is this site funded?',
      answerHtml: `<p>Currently through voluntary support links (Ko-fi, Buy Me a Coffee) shown in the footer of every page &mdash; no advertising currently runs on this site. See the <a href="about.html">About page &rarr;</a> and <a href="privacy.html">Privacy policy &rarr;</a> for the full, current answer.</p>`,
    },
  ];
}

function buildFaqPageFile(entries, { nav, outDir }) {
  const faqs = buildFaqEntries(entries);
  const html = renderFaqPage({ faqs, nav });
  fs.writeFileSync(path.join(outDir, 'chess-opening-faq.html'), html, 'utf8');
  return { file: 'chess-opening-faq.html', html, slug: 'faq', title: extractTitle(html), description: extractDescription(html) };
}

module.exports = {
  buildContentPages,
  fetchOpeningData,
  fetchLineWithValidation,
  repertoireFileName,
  DEFAULT_BAND,
  pickRelated,
  assertPageMetadata,
  buildGuidePages,
  buildGuidesHubPage,
  buildFaqEntries,
  buildFaqPageFile,
  GUIDES,
};
