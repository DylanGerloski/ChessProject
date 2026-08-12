'use strict';

/**
 * Editorial guide (phase 2 of the content-depth build). Every number in
 * `render()` is pulled from `ctx.entries` at build time -- the same
 * already-fetched opening models the opening pages themselves use -- so this
 * file has no hand-typed statistics to go stale or be wrong. See this
 * project's TESTING.md for how to regenerate it and where the human-review
 * step belongs before this ships publicly.
 */

const SLUG = 'how-to-beat-the-london-system';

const meta = {
  slug: SLUG,
  title: 'How to Beat the London System',
  description: "The London System (1.d4 d5 2.Bf4) scores well for White at club level — here's what the data says Black's best replies actually are, not just opinion.",
  targetQuery: 'how to beat the london system',
  related: ['london-system', 'queens-gambit'],
};

function render(ctx) {
  const { entries, escapeHtml, formatPct, wrapTable } = ctx;
  const entry = entries.find((e) => e.openingConfig.slug === 'london-system');
  if (!entry) {
    return '<p class="empty-note">London System data was not available in this build.</p>';
  }
  const { model } = entry;
  const mainBand = model.bands.find((b) => b.band === model.defaultBand) || model.bands[0];

  const withScore = (model.topReplies || []).map((m) => ({
    ...m,
    blackScore: m.winPct == null || m.drawPct == null ? null : Number((m.winPct + m.drawPct / 2).toFixed(1)),
  }));
  const byScore = [...withScore].filter((m) => m.blackScore != null).sort((a, b) => b.blackScore - a.blackScore);
  const byPopularity = [...withScore].sort((a, b) => b.games - a.games);

  const bestRows = byScore
    .slice(0, 3)
    .map(
      (m) => `<tr><td><a href="https://lichess.org/analysis/pgn/${encodeURIComponent(m.san)}">${escapeHtml(m.san)}</a></td><td>${m.games.toLocaleString()}</td><td>${formatPct(m.playedPct)}%</td><td>${formatPct(m.blackScore)}%</td></tr>`
    )
    .join('');

  const mostCommon = byPopularity[0];

  const mistakesHtml = (model.mistakes || []).length
    ? `<ul>${model.mistakes
        .map(
          (m) => `<li class="callout"><strong>${escapeHtml(m.san)}</strong> is played in ${formatPct(m.playedPct)}% of games in this exact position, but scores only ${formatPct(m.score)}% for Black at ${escapeHtml(model.defaultBand)}${
            m.punishingReply
              ? ` &mdash; White&rsquo;s most common answer, <strong>${escapeHtml(m.punishingReply.san)}</strong>, scores ${formatPct(m.punishingReply.winPct + m.punishingReply.drawPct / 2)}% for White.`
              : '.'
          }</li>`
        )
        .join('')}</ul>`
    : '<p class="empty-note">No move at this band is both common and clearly low-scoring against the London here &mdash; there is no obvious trap to warn about at this position.</p>';

  return `
    <p>The London System (1.d4 d5 2.Bf4) has a reputation as a low-theory, hard-to-punish opening for White, and the data mostly backs that up: across the games this site tracked, White scores ${mainBand.scoreForSide != null ? `${formatPct(mainBand.scoreForSide)}%` : 'a solid share'} at ${escapeHtml(model.defaultBand)} from ${mainBand.games.toLocaleString()} games. That doesn&rsquo;t mean every reply for Black is equally good.</p>

    <h2>What the data shows</h2>
    <p>Looking at the most common replies to 2.Bf4 in this position, the highest-scoring options for Black &mdash; ranked by actual result, not by popularity &mdash; are:</p>
    ${bestRows ? wrapTable(`<table><caption class="sr-only">Best-scoring replies for Black against the London System</caption><thead><tr><th scope="col">Move</th><th scope="col">Games</th><th scope="col">Played</th><th scope="col">Score for Black</th></tr></thead><tbody>${bestRows}</tbody></table>`) : '<p class="empty-note">Not enough reply data was available for this build.</p>'}
    ${mostCommon ? `<p>For comparison, the single most commonly played reply here is <strong>${escapeHtml(mostCommon.san)}</strong> (${mostCommon.games.toLocaleString()} games) &mdash; popular is not automatically the same as best-scoring, which is exactly why this table is sorted by score rather than by frequency.</p>` : ''}

    <h2>A mistake the data flags</h2>
    <p>Independent of any specific &ldquo;trap,&rdquo; the numbers on this exact position highlight moves that are common but underperform:</p>
    ${mistakesHtml}

    <h2>See the full page</h2>
    <p>For the complete rating-band breakdown, model games, and recent club games in this line, see the <a href="london-system.html">London System opening page &rarr;</a>.</p>
  `;
}

module.exports = { meta, render };
