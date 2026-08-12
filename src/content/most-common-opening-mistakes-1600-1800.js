'use strict';

// NOTE: named/slugged for the 1600-1800 band deliberately, not 1400-1600 --
// findCommonMistakes() (src/processOpenings.js) only runs against
// model.defaultBand (1600-1800, see src/buildContent.js's DEFAULT_BAND),
// since that's the only band phase 1 fetches per-move reply data for. A
// slug/title claiming "1400-1600" would misstate which band this data
// actually comes from -- see this project's public-repo-hygiene and honesty
// conventions (don't publish a page whose own title is inaccurate).
const SLUG = 'most-common-opening-mistakes-1600-1800';

const meta = {
  slug: SLUG,
  title: 'The Most Common Opening Mistakes at 1600-1800',
  description: "Moves that are played often but score badly at 1600-1800, aggregated across every opening this site tracks -- true by arithmetic, not by engine evaluation.",
  targetQuery: 'most common opening mistakes club level',
  related: [],
};

function render(ctx) {
  const { entries, aggregateMistakesAcrossOpenings, escapeHtml } = ctx;
  const all = aggregateMistakesAcrossOpenings(entries);

  const items = all
    .slice(0, 10)
    .map((m) => {
      const follow = m.punishingReply
        ? ` The most common answer, <strong>${escapeHtml(m.punishingReply.san)}</strong>, scores ${
            m.punishingReply.winPct != null ? Number((m.punishingReply.winPct + m.punishingReply.drawPct / 2).toFixed(1)) : '?'
          }% for the side punishing it.`
        : '';
      return `<li class="callout">In the <a href="${escapeHtml(m.slug)}.html">${escapeHtml(m.name)}</a>, <strong>${escapeHtml(m.san)}</strong> is played in ${m.playedPct}% of games at ${escapeHtml(m.defaultBand)} but scores only ${m.score}% for ${escapeHtml(m.opponentColor)}.${follow}</li>`;
    })
    .join('');

  return `
    <p>Every opening page on this site computes "common mistakes" the same honest way: a move that's played often enough to matter, but that scores badly for the side playing it, according to real games at that rating band. No engine evaluation, no "this loses a piece" claims -- just a move's actual result rate compared to how often it gets played. This page pulls those results together across all ${entries.length} openings this site tracks, worst-scoring first.</p>

    ${all.length === 0
      ? '<p class="empty-note">No qualifying mistakes were found across the tracked openings in this build -- that itself is a real result, not a placeholder.</p>'
      : `<h2>Ranked worst-scoring first</h2><ul style="list-style:none; padding:0; margin:0;">${items}</ul>`}

    <h2>How to read this</h2>
    <p>"Scores only X%" uses standard chess scoring (a win counts 1, a draw counts 0.5) as a percentage. A move sitting at 40% isn't losing by force -- it's simply performing below break-even in practice at this rating band, in this exact position, in the sample of games this site's build actually saw. That's a statement about a rating band's habits, not a claim about the objective evaluation of the move.</p>

    <h2>Go deeper</h2>
    <p>Each opening's own page has the full breakdown by rating band, top replies, and real recent club games. See the <a href="openings.html">full openings comparison &rarr;</a>.</p>
  `;
}

module.exports = { meta, render };
