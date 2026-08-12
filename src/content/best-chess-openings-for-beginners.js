'use strict';

const SLUG = 'best-chess-openings-for-beginners';

const meta = {
  slug: SLUG,
  title: 'Best Chess Openings for Beginners, by Win Rate',
  description: 'The 10 openings this site tracks, ranked by measured score at 1400-1600 rather than by opinion — with the sample size for every number shown.',
  targetQuery: 'best chess openings for beginners',
  related: [],
};

const LOWER_BAND = '1400-1600';

function render(ctx) {
  const { entries, rankOpeningsByScore, escapeHtml, formatPct, formatGamesAbbrev, wrapTable } = ctx;
  const ranked = rankOpeningsByScore(entries, LOWER_BAND);

  const rows = ranked
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td><a href="${escapeHtml(r.slug)}.html">${escapeHtml(r.name)}</a></td><td>${escapeHtml(r.side)}</td><td>${formatGamesAbbrev(r.games)}</td><td>${formatPct(r.scoreForSide)}%</td></tr>`
    )
    .join('');

  return `
    <p>&ldquo;Best opening for beginners&rdquo; gets asked constantly and answered mostly with opinion. This page answers a narrower, checkable version of the question: among the ${entries.length} openings this site tracks, which ones actually score best for the side that plays them at ${escapeHtml(LOWER_BAND)}, based on real Lichess games?</p>

    <div class="callout">This is not a claim that these are the only good openings for beginners, or that a higher score here means &ldquo;easier to learn&rdquo; &mdash; it means players in this rating band who reached this exact position won more often with this piece configuration than with the others on this list. Style, how much you enjoy a position, and how much time you want to spend on theory all matter too, and none of those are measurable from a database.</div>

    <h2>Ranked by score at ${escapeHtml(LOWER_BAND)}</h2>
    ${rows ? wrapTable(`<table><caption class="sr-only">Openings ranked by score at ${escapeHtml(LOWER_BAND)}</caption><thead><tr><th scope="col">#</th><th scope="col">Opening</th><th scope="col">Side</th><th scope="col">Games</th><th scope="col">Score</th></tr></thead><tbody>${rows}</tbody></table>`) : '<p class="empty-note">Band data was not available for this build.</p>'}

    <h2>Why a &ldquo;score&rdquo; isn&rsquo;t the whole story</h2>
    <p>Score here means the standard chess scoring convention (a win counts 1, a draw counts 0.5) as a percentage, for the side whose opening this is, from real games at this rating band. A high score can partly reflect that a line is comfortable and hard to go wrong in, rather than that it&rsquo;s objectively strongest &mdash; which is arguably a better property for a beginner&rsquo;s first opening than raw engine strength would be anyway.</p>

    <h2>Go deeper</h2>
    <p>Every opening in the table above links to its own page with a full rating-band breakdown, common mistakes at this level, and real recent games. See the <a href="openings.html">full openings comparison &rarr;</a> for all four rating bands side by side.</p>
  `;
}

module.exports = { meta, render };
