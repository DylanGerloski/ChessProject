'use strict';

/**
 * Markup for the content layer: board diagrams, opening pages, the openings
 * hub, editorial guide articles, the guides hub, and the FAQ page.
 * Deliberately a SEPARATE module from render.js (which is concatenated
 * verbatim into the browser bundle -- see that file's own header comment) --
 * this module MAY require() render.js/site.js/chessPosition.js because it is
 * never bundled into anything that runs in a visitor's browser; every
 * content page is fully pre-rendered static HTML with zero client-side JS.
 *
 * Titles, meta descriptions, and canonical links are in scope on every page
 * type here -- they were never treated as optional, since a page without
 * them isn't a finished page. JSON-LD structured data (BreadcrumbList on
 * every page below that renders a visible breadcrumb, Article on guide
 * pages, FAQPage on the FAQ page) is built via src/structuredData.js and
 * passed through renderDocumentHead's `jsonLd` param -- each block mirrors
 * only what that same page already renders visibly, never anything extra.
 */

const { escapeHtml, formatPct, renderDocumentHead, renderHeader, renderFooter, wrapTable, renderPageHead } = require('./render');
const { START_BOARD, applyUciMoves } = require('./chessPosition');
const { SITE_NAME, SITE_AUTHOR, BUILD_DATE, absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd, articleJsonLd, faqPageJsonLd } = require('./structuredData');
const { spriteDefsHtml, renderBoardDiagram, pieceAttributionHtml } = require('./boardSvg');

// Still used by src/buildDrill.js -> src/renderDrill.js for the Italian
// Game drill's own board (a separate, button-based, keyboard-operable
// implementation -- see renderDrill.js's renderDrillBoard/pieceSpanHtml).
// That board is untouched by Phase 7c: it already has its own click/
// keyboard accessibility story, and swapping its glyphs for the SVG sprite
// is a reasonable follow-on but a distinct piece of work, not this task's
// stated scope (the interactive-board component + this file's static
// diagram). PIECE_GLYPH stays exported for exactly that caller.
const PIECE_GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

// This module's pages are always part of the static build (never dynamic
// dev-server routes -- see this file's own header comment), so unlike
// render.js's renderRepertoirePage(), these footer links can be hardcoded to
// the static compliance-page filenames directly rather than threaded
// through as a parameter. Keep in sync with buildStatic.js's LEGAL_LINKS,
// which points at the same three flat filenames.
const CONTENT_LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html' };

/**
 * @param {Record<string,string>} board square -> FEN piece letter (see chessPosition.js)
 * @param {{flip?: boolean, label: string}} opts `label` becomes both the
 *   aria-label and the visible figcaption text -- nothing on this page is
 *   diagram-only, so a missing piece render degrades to "diagram missing",
 *   never "content missing".
 *
 * Phase 7c: renders real Cburnett SVG piece artwork (src/boardSvg.js)
 * instead of the old per-platform Unicode glyph + text-shadow hack this
 * function used before -- same `.board`/`.board-sq` markup and
 * `--color-board-light`/`--color-board-dark` tokens, so no other CSS
 * changed. Includes the page-level sprite-definitions block (spriteDefsHtml())
 * inline since exactly one board renders per content page today; a future
 * page with more than one board must call spriteDefsHtml() itself, once,
 * and pass a board-only render instead (see boardSvg.js's own header
 * comment).
 */
function renderBoard(board, opts = {}) {
  return `${spriteDefsHtml()}${renderBoardDiagram(board, opts)}`;
}

/**
 * @param {Array<{label:string, href?:string}>} items the last item should
 *   have no `href` (it's the current page).
 */
function renderBreadcrumb(items) {
  const parts = items
    .map((item, i) => {
      const isLast = i === items.length - 1;
      return isLast || !item.href
        ? `<li aria-current="page">${escapeHtml(item.label)}</li>`
        : `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`;
    })
    .join('<li class="breadcrumb-sep" aria-hidden="true">/</li>');
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol>${parts}</ol></nav>`;
}

/**
 * @param {Array<{label:string, href:string, note?:string}>} items
 */
function renderRelated(items, heading = 'Related') {
  if (!items || items.length === 0) return '';
  const cards = items
    .map(
      (i) => `<div class="card card--nav"><h3><a href="${escapeHtml(i.href)}">${escapeHtml(i.label)}</a></h3>${
        i.note ? `<p>${escapeHtml(i.note)}</p>` : ''
      }</div>`
    )
    .join('');
  return `<section><h2>${escapeHtml(heading)}</h2><div class="card-grid">${cards}</div></section>`;
}

/**
 * An opening card for an entry page (homepage "Openings by real win
 * rate" list, the openings hub) that carries the WDL bar + score number for
 * the site's default 1600-1800 band inline, so a visitor never has to click
 * through two pages to see whether an opening is worth their time. Reads
 * the exact same `model.bands` array renderBandsTable() already consumes
 * for the opening's own page -- no separate fetch, no separate model.
 * Falls back to a plain nav-style card (no bar, no number) whenever that
 * band isn't populated/doesn't have enough games -- this NEVER approximates
 * or invents a score.
 * @param {{slug: string}} openingConfig
 * @param {{name: string, eco: string, side: string, bands?: Array}} model
 * @param {string} [extraClass] e.g. 'card--outline' for a demoted homepage card
 * @returns {string}
 */
function renderOpeningStatCard(openingConfig, model, extraClass = '') {
  const href = `${escapeHtml(openingConfig.slug)}.html`;
  const band = (model.bands || []).find((b) => b.band === '1600-1800') || null;
  const hasData = band && band.enoughData && band.scoreForSide != null && band.whitePct != null;
  const classes = ['card', hasData ? 'card--stat' : 'card--nav', extraClass].filter(Boolean).join(' ');
  if (!hasData) {
    return `<div class="${classes}"><h3><a href="${href}">${escapeHtml(model.name)}</a></h3><p>${escapeHtml(model.eco)}, playing as ${escapeHtml(model.side)}</p></div>`;
  }
  return `<div class="${classes}">
    <h3><a href="${href}">${escapeHtml(model.name)}</a></h3>
    <div class="card-wdl-row">${wdlBar(band.whitePct, band.drawPct, band.blackPct, `White/draw/black at 1600-1800: ${formatPct(band.whitePct)}% / ${formatPct(band.drawPct)}% / ${formatPct(band.blackPct)}%`)}</div>
    <p class="card-score">Scores ${formatPct(band.scoreForSide)}% for ${escapeHtml(model.side)} at 1600-1800 (${band.games.toLocaleString()} games)</p>
  </div>`;
}

function formatGamesAbbrev(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** "1.e4 e5 2.Nf3 Nc6 3.Bc4" style move text from an openings.js `line` array. */
function formatSanLine(line) {
  return line
    .map((ply, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}.${ply.san}` : ply.san))
    .join(' ');
}

function lichessAnalysisUrl(line) {
  return `https://lichess.org/analysis/pgn/${encodeURIComponent(formatSanLine(line))}`;
}

function lichessOpeningUrl(name) {
  return `https://lichess.org/opening/${encodeURIComponent(name.replace(/\s+/g, '_'))}`;
}

/**
 * @param {{large?: boolean}} [opts] `large` widens the bar to fill its
 *   cell (`.wdl-bar--lg`, render.js), used only for the one hero table per
 *   opening page (renderBandsTable below). The adjacent percentages
 *   (.wdl-label) always render too, so color is never the sole encoding.
 *
 * Rendered as an inline <svg> with three <rect> segments on a 0-100 viewBox
 * (x/width map directly to the percentages), not <span style="width:X%">.
 * Each segment's width is a real per-row data value, and there is no way to
 * express that as a static CSS class -- but html-validate's no-inline-style
 * rule flags any `style` attribute outright, on any element. SVG rect x/
 * width are geometry attributes, not the flagged `style` attribute, so this
 * keeps the exact same stacked-percentage-bar visual with zero inline
 * styles. The <svg><title> child (not the HTML `title` attribute, which
 * `aria-label-misuse` would flag on a non-widget/landmark element) is both
 * the accessible name and the native hover tooltip.
 */
function wdlBar(winPct, drawPct, lossPct, title, opts = {}) {
  if (winPct == null) return '<span class="wdl-label">not enough games</span>';
  const barClass = opts.large ? 'wdl-bar wdl-bar--lg' : 'wdl-bar';
  const drawX = winPct;
  const lossX = winPct + drawPct;
  return `<svg class="${barClass}" viewBox="0 0 100 12" preserveAspectRatio="none" role="img"><title>${escapeHtml(title)}</title><rect class="wdl-seg--win" x="0" y="0" width="${winPct}" height="12"></rect><rect class="wdl-seg--draw" x="${drawX}" y="0" width="${drawPct}" height="12"></rect><rect class="wdl-seg--loss" x="${lossX}" y="0" width="${lossPct}" height="12"></rect></svg>
    <span class="wdl-label">${formatPct(winPct)}% / ${formatPct(drawPct)}% / ${formatPct(lossPct)}%</span>`;
}

function renderBandsTable(model) {
  const rows = model.bands
    .map((b) => {
      if (!b.enoughData) {
        return `<tr><td>${escapeHtml(b.band)}</td><td class="num">${b.games.toLocaleString()}</td><td colspan="4" class="rep-pct">Not enough games at this band yet.</td></tr>`;
      }
      return `<tr>
        <td>${escapeHtml(b.band)}</td>
        <td class="num">${b.games.toLocaleString()}</td>
        <td>${wdlBar(b.whitePct, b.drawPct, b.blackPct, `White/draw/black: ${formatPct(b.whitePct)}% / ${formatPct(b.drawPct)}% / ${formatPct(b.blackPct)}%`, { large: true })}</td>
        <td class="num">${formatPct(b.scoreForSide)}%</td>
      </tr>`;
    })
    .join('');
  return wrapTable(`
    <table>
      <caption class="sr-only">Win/draw/loss rate by rating band</caption>
      <thead>
        <tr><th scope="col">Rating band</th><th scope="col" class="num">Games</th><th scope="col">White / draw / Black</th><th scope="col" class="num">Score for ${escapeHtml(model.side)}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`, 'Win/draw/loss rate by rating band');
}

function renderTopRepliesTable(model) {
  if (model.topReplies.length === 0) {
    return '<p class="empty-note">No reply data available for this band yet.</p>';
  }
  const rows = model.topReplies
    .map((m) => {
      const label = m.opening ? ` <span class="rep-pct">(${escapeHtml(m.opening.name)})</span>` : '';
      return `<tr>
        <td><a href="https://lichess.org/analysis/pgn/${encodeURIComponent(m.san)}">${escapeHtml(m.san)}</a>${label}</td>
        <td class="num">${m.games.toLocaleString()}</td>
        <td class="num">${formatPct(m.playedPct)}%</td>
        <td>${wdlBar(m.winPct, m.drawPct, m.lossPct, `${m.san} win/draw/loss`)}</td>
      </tr>`;
    })
    .join('');
  return wrapTable(`
    <table>
      <caption class="sr-only">Most common replies at ${escapeHtml(model.defaultBand)}</caption>
      <thead><tr><th scope="col">Move</th><th scope="col" class="num">Games</th><th scope="col" class="num">Played</th><th scope="col">Win / draw / loss</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`, `Most common replies at ${model.defaultBand}`);
}

function renderMistakesSection(model) {
  if (model.mistakes.length === 0) {
    return '<p class="empty-note">No move at this band is both common and clearly low-scoring &mdash; players at this rating aren&rsquo;t making an obvious mistake here.</p>';
  }
  const items = model.mistakes
    .map((m) => {
      const base = `<strong>${escapeHtml(m.san)}</strong> is played in ${formatPct(m.playedPct)}% of games here but scores only ${formatPct(m.score)}% for ${escapeHtml(model.opponentColor)}.`;
      const follow = m.punishingReply
        ? ` After ${escapeHtml(m.san)}, <strong>${escapeHtml(m.punishingReply.san)}</strong> is the most common answer and scores ${m.punishingReply.winPct != null ? formatPct(m.punishingReply.winPct + m.punishingReply.drawPct / 2) : '?'}% for ${escapeHtml(model.side)}.`
        : '';
      return `<li class="callout">${base}${follow}</li>`;
    })
    .join('');
  return `<ul class="callout-list">${items}</ul>`;
}

function renderGameRows(games, { asMaster = false } = {}) {
  if (!games || games.length === 0) return null;
  return games
    .map((g) => {
      const white = g.white ? `${escapeHtml(g.white.name)} (${g.white.rating ?? '?'})` : 'White';
      const black = g.black ? `${escapeHtml(g.black.name)} (${g.black.rating ?? '?'})` : 'Black';
      const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½';
      const link = g.id ? `https://lichess.org/${escapeHtml(g.id)}` : null;
      const dateNote = g.year ? `${g.year}` : '';
      return `<tr>
        <td>${white}</td>
        <td>${black}</td>
        <td>${result}</td>
        <td>${dateNote}</td>
        <td>${link ? `<a href="${link}">View game</a>` : '–'}</td>
      </tr>`;
    })
    .join('');
}

function renderGamesTable(games, caption) {
  const rows = renderGameRows(games);
  if (!rows) return '<p class="empty-note">No games available for this section yet.</p>';
  return wrapTable(`
    <table>
      <caption class="sr-only">${escapeHtml(caption)}</caption>
      <thead><tr><th scope="col">White</th><th scope="col">Black</th><th scope="col">Result</th><th scope="col">Year</th><th scope="col">Game</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`, caption);
}

/**
 * @param {object} opts
 * @param {object} opts.model output of processOpenings.buildOpeningModel
 * @param {object} opts.openingConfig the matching openings.js entry (for line/slug)
 * @param {object} opts.nav nav object for renderHeader (STATIC_NAV plus `openings`)
 * @param {Array<{label,href,note}>} [opts.related]
 * @param {{white:string, black:string}} [opts.repertoireLinks] filenames of
 *   the matching repertoire-<band>-<color>.html pages for "Build a
 *   repertoire from here"
 * @param {string} [opts.drillFile] filename of the matching opening-drill
 *   page (single-opening drill pilot). When present, a "Drill this opening"
 *   CTA section is emitted right after "The position"; when absent (every
 *   opening page except the pilot's), this function's output is byte-for-byte
 *   identical to before the drill pilot existed.
 */
function renderOpeningPage({ model, openingConfig, nav, related = [], repertoireLinks = {}, drillFile = null }) {
  const line = openingConfig.line;
  const board = applyUciMoves(START_BOARD, line.map((p) => p.uci));
  const flip = openingConfig.side === 'black';
  const sanLine = formatSanLine(line);
  const mainBand = model.bands.find((b) => b.band === model.defaultBand) || model.bands[0];
  // Literal &amp; (not a raw &) -- this string is interpolated directly into
  // the page subtitle below with no further escaping pass (unlike sanLine/
  // model.side right next to it, which go through escapeHtml() at the call
  // site), matching how every other static entity in this codebase's
  // templates (&mdash;, &rarr;, etc.) is written pre-escaped inline.
  const totalGamesNote = mainBand && mainBand.games
    ? `data from ${mainBand.games.toLocaleString()} Lichess blitz &amp; rapid games at ${escapeHtml(model.defaultBand)}`
    : 'data from Lichess blitz &amp; rapid games';

  const title = pageTitle(`${model.name} (${model.eco}): Win Rates by Rating`);
  let description = mainBand && mainBand.scoreForSide != null
    ? `${model.name} (${sanLine}) scores ${formatPct(mainBand.scoreForSide)}% for ${model.side} across ${formatGamesAbbrev(mainBand.games)} Lichess games. Win rates, replies, and master games by rating.`
    : `${model.name} (${model.eco}): win rates, replies, and master games by rating band, from real Lichess data.`;
  // Meta descriptions must stay <=160 chars (spec 2.2) -- fall back to a
  // shorter form rather than truncate mid-sentence for the handful of
  // longer opening names/lines (e.g. "King's Indian Defense").
  if (description.length > 160) {
    description = mainBand && mainBand.scoreForSide != null
      ? `${model.name} scores ${formatPct(mainBand.scoreForSide)}% for ${model.side} across ${formatGamesAbbrev(mainBand.games)} Lichess games. Win rates, replies, and master games by rating.`
      : `${model.name} (${model.eco}): win rates and master games by rating band, from real Lichess data.`;
  }
  const canonical = absoluteUrl(`${openingConfig.slug}.html`);
  const openingFile = `${openingConfig.slug}.html`;
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Openings', href: nav.openings }, { label: model.name, href: openingFile }];

  const repFile = repertoireLinks[openingConfig.side];

  // Computed as a variable (not an inline `${drillFile ? ... : ''}` in the
  // template below) specifically so the "no drill on this page" case
  // contributes NOTHING -- an inline empty ternary at an indented call
  // site, immediately followed by a blank template line for readability,
  // leaves a text node that is only whitespace before the next real line;
  // html-validate's no-trailing-whitespace flags exactly that. See
  // src/render.js's renderPageHead doc comment for the general form of
  // this same bug.
  const drillCtaHtml = drillFile
    ? `<section class="drill-cta">
      <h2>Drill this opening</h2>
      <p>Play the position out move by move and find out instantly whether you picked what players at your rating
        actually pick &mdash; and what that move scores.</p>
      <p><a href="${escapeHtml(drillFile)}">Open the Italian Game drill &rarr;</a></p>
    </section>

    `
    : '';

  // Same reasoning as drillCtaHtml just above: renderRelated() legitimately
  // returns '' when there's nothing related to show, and interpolating
  // that at an indented "    ${...}" template line -- immediately followed
  // by more literal content on the next line -- would leave a whitespace-
  // only line when it's empty.
  const relatedSection = renderRelated(related, 'Related openings');
  const relatedHtml = relatedSection ? `\n\n    ${relatedSection}` : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'article', jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
  ${renderHeader(nav, 'openings')}
  <main>
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      eyebrow: 'Opening guide',
      title: `${escapeHtml(model.name)} (${escapeHtml(model.eco)}) &mdash; win rates at club level`,
      subtitle: `${escapeHtml(sanLine)}, playing as ${escapeHtml(model.side)} &mdash; ${totalGamesNote}.`,
    })}

    <h2>The position</h2>
    <figure class="board-figure">
      ${renderBoard(board, { flip, label: `Position after ${sanLine}` })}
      <figcaption>Position after ${escapeHtml(sanLine)}.
        <a href="${lichessAnalysisUrl(line)}">Open this line on Lichess &rarr;</a> &middot;
        <a href="${lichessOpeningUrl(model.name)}">${escapeHtml(model.name)} on Lichess</a>
      </figcaption>
    </figure>

    ${drillCtaHtml}<h2>How it scores at your rating</h2>
    ${renderBandsTable(model)}

    <h2>What ${escapeHtml(model.opponentColor)} actually plays next</h2>
    <p>Top replies at ${escapeHtml(model.defaultBand)}:</p>
    ${renderTopRepliesTable(model)}

    <h2>Common mistakes at ${escapeHtml(model.defaultBand)}</h2>
    ${renderMistakesSection(model)}

    <h2>Model games</h2>
    <p>Real games from the Lichess masters database.</p>
    ${renderGamesTable(model.masterGames, 'Master games in this line')}

    <h2>Recent club games in this line</h2>
    <p>Recent rated games at ${escapeHtml(model.defaultBand)} &mdash; not model games, just what actually happens at that rating.</p>
    ${renderGamesTable(model.recentGames, 'Recent games in this line')}

    <h2>Build a repertoire from here</h2>
    <p>See the full move tree for players in your rating band:
      ${repFile ? `<a href="${escapeHtml(repFile)}">${escapeHtml(model.defaultBand)} repertoire explorer (${escapeHtml(openingConfig.side)}) &rarr;</a>` : 'no repertoire explorer is published for this opening.'}
    </p>${relatedHtml}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer</a> (lichess database, blitz + rapid), retrieved ${BUILD_DATE}. Master games from the Lichess masters database. ${pieceAttributionHtml()}`, CONTENT_LEGAL_LINKS)}
</body>
</html>
`;
}

/**
 * @param {Array<{openingConfig:object, model:object}>} entries
 * @param {object} opts
 * @param {object} opts.nav
 * @param {{href:string, familyCount:number, lineCount:number}} [opts.ecoIndexLink]
 *   Phase 7d: when given, adds a "Browse the full ECO index" card linking to
 *   the T2 family/ECO-code browse index -- optional and defaulted to
 *   nothing so a caller that hasn't built that index yet (or a test that
 *   doesn't pass it) renders byte-identical output to before Phase 7d.
 */
function renderOpeningsHub(entries, { nav, ecoIndexLink = null }) {
  const title = `Chess Openings by Real Win Rate | ${SITE_NAME}`;
  const description = `${entries.length} chess openings compared by real Lichess win rate, move-by-move, across four rating bands from 1400 to 2000+.`;
  const canonical = absoluteUrl('openings.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Openings', href: 'openings.html' }];

  const rows = entries
    .map(({ openingConfig, model }) => {
      const band = model.bands.find((b) => b.band === '1600-1800') || model.bands[0];
      return `<tr>
        <td><a href="${escapeHtml(openingConfig.slug)}.html">${escapeHtml(model.name)}</a></td>
        <td>${escapeHtml(model.eco)}</td>
        <td>${escapeHtml(formatSanLine(openingConfig.line))}</td>
        <td class="num">${band ? band.games.toLocaleString() : '–'}</td>
        <td class="num">${band && band.scoreForSide != null ? `${formatPct(band.scoreForSide)}%` : 'n/a'}</td>
      </tr>`;
    })
    .join('');

  // Every card below carries its 1600-1800 WDL bar + score inline
  // (renderOpeningStatCard, defined above) -- same fallback-to-plain-card
  // rule as the homepage's equivalent list, never an approximated number.
  const cards = entries
    .map(({ openingConfig, model }) => renderOpeningStatCard(openingConfig, model))
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
  ${renderHeader(nav, 'openings')}
  <main>
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Chess openings by real win rate</h1>
    <p class="subtitle">Ranked by the score each opening actually gets for its own side in real Lichess games at
      1600-1800. Sample size is shown for every row &mdash; a rate over a small sample is not a signal.</p>

    <h2>Compare all ${entries.length} openings</h2>
    ${wrapTable(`
      <table>
        <caption class="sr-only">Opening comparison at 1600-1800</caption>
        <thead>
          <tr><th scope="col">Opening</th><th scope="col">ECO</th><th scope="col">First moves</th><th scope="col" class="num">Games (1600-1800)</th><th scope="col" class="num">Score for its side</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`, 'Opening comparison at 1600-1800')}

    <h2>Browse by opening</h2>
    <div class="card-grid">${cards}</div>

    ${ecoIndexLink ? `<h2>Browse the full ECO index</h2>
    <p class="repertoire-intro">Every one of the ${ecoIndexLink.lineCount.toLocaleString()} named lines in the standard Encyclopaedia of Chess Openings
       classification, grouped into ${ecoIndexLink.familyCount} opening families &mdash;
       <a href="${escapeHtml(ecoIndexLink.href)}">browse the ECO index &rarr;</a></p>` : ''}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</body>
</html>
`;
}

/**
 * Full page wrapper for one editorial guide/article (phase 2). The article's
 * OWN markup (headings, tables, callouts -- all built from real computed
 * data, see src/content/*.js) is passed in pre-rendered as `bodyHtml`; this
 * function only owns the shared document chrome (head/nav/breadcrumb/
 * dateline/footer), same division of labor as renderOpeningPage.
 *
 * Emits BreadcrumbList and Article JSON-LD (phase 3). Article's `author`
 * comes from src/site.js's SITE_AUTHOR, which is the site name as an
 * Organization -- never an invented person (see that file's own comment).
 * `meta.datePublished`/BUILD_DATE map to Article's datePublished/dateModified.
 *
 * @param {object} opts
 * @param {{slug:string, title:string, description:string, datePublished:string}} opts.meta
 * @param {string} opts.bodyHtml pre-rendered article content (inside <article class="prose">)
 * @param {object} opts.nav nav object for renderHeader (STATIC_NAV plus `guides`/`faq`)
 * @param {Array<{label,href,note}>} [opts.related]
 */
function renderArticlePage({ meta, bodyHtml, nav, related = [] }) {
  const title = pageTitle(meta.title);
  const canonical = absoluteUrl(`${meta.slug}.html`);
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Guides', href: nav.guides }, { label: meta.title, href: `${meta.slug}.html` }];
  const jsonLd = [
    breadcrumbJsonLd(breadcrumbItems),
    articleJsonLd({
      headline: meta.title,
      description: meta.description,
      datePublished: meta.datePublished,
      dateModified: BUILD_DATE,
      url: canonical,
      authorName: SITE_AUTHOR,
      publisherName: SITE_NAME,
    }),
  ].join('\n  ');

  // See renderOpeningPage's relatedHtml (above) for why this is precomputed
  // rather than interpolated inline: renderRelated() can legitimately
  // return '', and this function's own leading indentation carries the
  // "\n    " prefix instead of the template site, so an empty result
  // contributes nothing (not a whitespace-only line).
  const relatedSection = renderRelated(related, 'Related');
  const relatedHtml = relatedSection ? `\n    ${relatedSection}` : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description: meta.description, canonical, ogType: 'article', jsonLd })}
<body>
  ${renderHeader(nav, 'guides')}
  <main>
    ${renderBreadcrumb(breadcrumbItems)}
    <article class="prose">
      <h1 class="page-title">${escapeHtml(meta.title)}</h1>
      <p class="article-meta">Published ${escapeHtml(meta.datePublished)} &middot; data refreshed ${BUILD_DATE}.</p>
      ${bodyHtml.trim()}
    </article>${relatedHtml}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}. This article is written to reflect that data &mdash; not a substitute for a coach&rsquo;s judgment about your own games.`, CONTENT_LEGAL_LINKS)}
</body>
</html>
`;
}

/**
 * @param {Array<{slug:string, title:string, description:string}>} articles
 * @param {object} opts
 * @param {object} opts.nav
 */
function renderGuidesHub(articles, { nav }) {
  const title = `Chess Opening Guides, Backed by Real Data | ${SITE_NAME}`;
  const description = `${articles.length} data-grounded guides on opening choice, common mistakes, and rating-band trends, backed by real Lichess Opening Explorer numbers.`;
  const canonical = absoluteUrl('guides.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Guides', href: 'guides.html' }];

  const cards = articles
    .map(
      (a) => `<div class="card card--nav"><h3><a href="${escapeHtml(a.slug)}.html">${escapeHtml(a.title)}</a></h3><p>${escapeHtml(a.description)}</p></div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
  ${renderHeader(nav, 'guides')}
  <main>
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Chess opening guides</h1>
    <p class="subtitle">${articles.length} articles, each grounded in this site&rsquo;s own Lichess Opening Explorer data &mdash; not opinion.</p>
    <div class="card-grid">${cards}</div>
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</body>
</html>
`;
}

/**
 * @param {object} opts
 * @param {Array<{question:string, answerHtml:string}>} opts.faqs `answerHtml`
 *   is already-escaped/pre-built markup (may include internal links), never
 *   raw user input.
 * @param {object} opts.nav
 */
function renderFaqPage({ faqs, nav }) {
  const title = `Chess Opening FAQ: Data-Backed Answers | ${SITE_NAME}`;
  const description = 'Plain-language answers about chess openings, ECO codes, and how to read Lichess Opening Explorer data — grounded in this site\'s own numbers where possible.';
  const canonical = absoluteUrl('chess-opening-faq.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'FAQ', href: 'chess-opening-faq.html' }];
  // FAQPage JSON-LD lives ONLY on this page, never bolted onto any other --
  // FAQ rich results were removed by Google on 2026-05-07, so this is for
  // parsing value only, not a SERP-feature bet.
  const jsonLd = [breadcrumbJsonLd(breadcrumbItems), faqPageJsonLd(faqs)].join('\n  ');

  const items = faqs.map((f) => `<h2>${escapeHtml(f.question)}</h2>${f.answerHtml}`).join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd })}
<body>
  ${renderHeader(nav, 'faq')}
  <main>
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Chess opening FAQ</h1>
    <p class="subtitle">Plain answers &mdash; most of them backed directly by this site&rsquo;s own Lichess data, not just opinion.</p>
    <div class="prose">${items}</div>
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</body>
</html>
`;
}

module.exports = {
  renderBoard,
  renderBreadcrumb,
  renderRelated,
  renderOpeningStatCard,
  renderOpeningPage,
  renderOpeningsHub,
  renderArticlePage,
  renderGuidesHub,
  renderFaqPage,
  formatSanLine,
  formatGamesAbbrev,
  lichessAnalysisUrl,
  lichessOpeningUrl,
  PIECE_GLYPH,
  // Exported for src/renderEcoPages.js (Phase 7d family hub pages), which
  // needs the exact same win/draw/loss-bar and 4-band table markup this
  // module already builds for a T0 opening page -- previously private to
  // this file, now shared so the two tiers can never render that number
  // two different ways.
  wdlBar,
  renderBandsTable,
};
