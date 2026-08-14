'use strict';

const SLUG = 'scandinavian-defense-at-club-level';

const meta = {
  slug: SLUG,
  title: 'The Scandinavian Defense at Club Level',
  description: '1...d5 gets dismissed as unsound in beginner advice. Here is its measured score by rating band, from real Lichess games at every level this site tracks.',
  targetQuery: 'scandinavian defense at club level',
  related: ['scandinavian-defense', 'caro-kann-defense', 'french-defense'],
};

function render(ctx) {
  const { entries, rankOpeningsByScore, escapeHtml, formatPct, wrapTable } = ctx;
  const entry = entries.find((e) => e.openingConfig.slug === 'scandinavian-defense');
  if (!entry) {
    return '<p class="empty-note">Scandinavian Defense data was not available in this build.</p>';
  }
  const { model } = entry;

  const bandRows = model.bands
    .map((b) =>
      b.enoughData
        ? `<tr><td>${escapeHtml(b.band)}</td><td>${b.games.toLocaleString()}</td><td>${formatPct(b.scoreForSide)}%</td></tr>`
        : `<tr><td>${escapeHtml(b.band)}</td><td>${b.games.toLocaleString()}</td><td colspan="1">not enough games</td></tr>`
    )
    .join('');

  const rankedAtMain = rankOpeningsByScore(
    entries.filter((e) => e.model.side === 'black'),
    model.defaultBand
  );
  const position = rankedAtMain.findIndex((r) => r.slug === 'scandinavian-defense');

  const topTries = (model.topReplies || []).slice(0, 5);
  const tryRows = topTries
    .map((m) => `<tr><td><a href="https://lichess.org/analysis/pgn/${encodeURIComponent(m.san)}">${escapeHtml(m.san)}</a></td><td>${m.games.toLocaleString()}</td><td>${formatPct(m.playedPct)}%</td></tr>`)
    .join('');

  return `
    <p>1...d5 in reply to 1.e4 &mdash; the Scandinavian Defense &mdash; is a recurring target in beginner-advice threads: &ldquo;gives up the center too early,&rdquo; &ldquo;loses time moving the queen twice.&rdquo; Whatever the theoretical merits, here&rsquo;s what actually happens in the games this site tracked.</p>

    <h2>Score by rating band</h2>
    ${wrapTable(`<table><caption class="sr-only">Scandinavian Defense score for Black by rating band</caption><thead><tr><th scope="col">Rating band</th><th scope="col">Games</th><th scope="col">Score for Black</th></tr></thead><tbody>${bandRows}</tbody></table>`, 'Scandinavian Defense score for Black by rating band')}

    ${position >= 0
      ? `<p>Among the ${rankedAtMain.length} Black-side openings this site tracks with enough data at ${escapeHtml(model.defaultBand)}, the Scandinavian ranks <strong>#${position + 1}</strong> by score. That&rsquo;s a concrete, checkable answer to &ldquo;is it actually bad&rdquo; &mdash; see how it compares directly on the <a href="openings.html">full openings comparison &rarr;</a>.</p>`
      : ''}

    <h2>What White tries most often</h2>
    <p>The most common replies White plays against 1...d5 in this position, by frequency:</p>
    ${tryRows ? wrapTable(`<table><caption class="sr-only">Most common White replies against the Scandinavian Defense</caption><thead><tr><th scope="col">Move</th><th scope="col">Games</th><th scope="col">Played</th></tr></thead><tbody>${tryRows}</tbody></table>`, 'Most common White replies against the Scandinavian Defense') : '<p class="empty-note">No reply data was available for this build.</p>'}

    <h2>Reading this honestly</h2>
    <p>A defense scoring competitively at club level doesn&rsquo;t settle the theoretical debate about its soundness at the very top &mdash; master-level theory and club-level practice are different questions, and this site&rsquo;s masters-database data (see the opening page below) is worth checking too. What this page does show is that &ldquo;unsound&rdquo; as often used in beginner forums usually means &ldquo;objectively imperfect,&rdquo; not &ldquo;loses in practice at your rating.&rdquo;</p>

    <h2>Go deeper</h2>
    <p>See the full <a href="scandinavian-defense.html">Scandinavian Defense page &rarr;</a> for master games, recent club games, and common mistakes in this exact line.</p>
  `;
}

module.exports = { meta, render };
