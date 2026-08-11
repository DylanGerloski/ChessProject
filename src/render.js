'use strict';

/**
 * Rendering layer: a pure function that turns already-processed data into an
 * HTML string. No framework, no templating engine -- just template
 * literals. Kept separate from build.js/server.js so it can be reused by
 * both the static generator and the local dev server.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRatingTable(ratingRows) {
  if (ratingRows.length === 0) {
    return '<p>No rating history found.</p>';
  }
  const rows = ratingRows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.variant)}</td>
        <td>${row.current ?? '-'}</td>
        <td>${row.peak ?? '-'}</td>
        <td>${row.low ?? '-'}</td>
        <td>${row.change >= 0 ? '+' : ''}${row.change ?? '-'}</td>
        <td>${row.gamesRecorded}</td>
      </tr>`
    )
    .join('');

  return `
    <table>
      <thead>
        <tr><th>Variant</th><th>Current</th><th>Peak</th><th>Low</th><th>Change</th><th>Data points</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderGamesTable(gameSummary) {
  if (gameSummary.totalGames === 0) {
    return '<p>No recent games found.</p>';
  }
  const rows = gameSummary.results
    .map(
      (r) => `
      <tr class="result-${r.result}">
        <td>${r.date || '-'}</td>
        <td>${escapeHtml(r.opponent)}</td>
        <td>${r.opponentRating ?? '-'}</td>
        <td>${escapeHtml(r.color)}</td>
        <td>${escapeHtml(r.variant)} / ${escapeHtml(r.speed)}</td>
        <td>${escapeHtml(r.result)}</td>
      </tr>`
    )
    .join('');

  return `
    <p>${gameSummary.wins}W / ${gameSummary.losses}L / ${gameSummary.draws}D
       out of ${gameSummary.totalGames} games (win rate ${gameSummary.winRate}%,
       avg opponent rating ${gameSummary.avgOpponentRating ?? 'n/a'})</p>
    <table>
      <thead>
        <tr><th>Date</th><th>Opponent</th><th>Opp. rating</th><th>Color</th><th>Variant/Speed</th><th>Result</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * @param {{username: string, ratingRows: Array, gameSummary: object}} data
 * @returns {string} a full standalone HTML document
 */
function renderPlayerPage({ username, ratingRows, gameSummary }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(username)} - Lichess stats (proof of concept)</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { margin-bottom: 0; }
    .subtitle { color: #666; margin-top: 0.25rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; }
    th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    tr.result-win { background: #eafaf0; }
    tr.result-loss { background: #fdecec; }
    tr.result-draw { background: #fafafa; }
    footer { color: #999; font-size: 0.8rem; margin-top: 3rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(username)}</h1>
  <p class="subtitle">Lichess rating history and recent games (engineering pipeline proof of concept)</p>

  <h2>Ratings by variant</h2>
  ${renderRatingTable(ratingRows)}

  <h2>Recent games</h2>
  ${renderGamesTable(gameSummary)}

  <footer>Data source: <a href="https://lichess.org/api">lichess.org/api</a>. Generated locally; not deployed or published.</footer>
</body>
</html>
`;
}

function renderRepertoireNode(node) {
  const winPct = node.winPct ?? '-';
  const drawPct = node.drawPct ?? '-';
  const lossPct = node.lossPct ?? '-';
  const ratingNote = node.averageRating ? ` &middot; avg rating ${node.averageRating}` : '';
  const children = node.children && node.children.length > 0
    ? `<ul>${node.children.map(renderRepertoireNode).join('')}</ul>`
    : '';

  return `
    <li>
      <span class="move move-${escapeHtml(node.mover)}">${escapeHtml(node.san)}</span>
      <span class="stats">${node.games.toLocaleString()} games (${node.playedPct ?? '-'}% of this position)
        &middot; ${node.mover} W/D/L: ${winPct}% / ${drawPct}% / ${lossPct}%${ratingNote}</span>
      ${children}
    </li>`;
}

function renderRepertoireTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) {
    return '<p>No repertoire data found for this rating band and color.</p>';
  }
  return `<ul class="repertoire-tree">${tree.map(renderRepertoireNode).join('')}</ul>`;
}

/**
 * @param {{ratingBand: string, color: string, opening: {eco:string,name:string}|null,
 *   totals: {white:number,draws:number,black:number}|null, tree: Array,
 *   nav?: {player: string, repertoire: string}}} data `nav` lets callers point
 *   the top-of-page links at either the dynamic dev-server routes (the
 *   default, used by server.js) or flat static filenames (used by the
 *   static build, e.g. {player: 'player.html', repertoire: 'index.html'}).
 * @returns {string} a full standalone HTML document
 */
function renderRepertoirePage({ ratingBand, color, opening, totals, tree, nav = { player: '/', repertoire: '/repertoire' } }) {
  const totalGames = totals ? totals.white + totals.draws + totals.black : null;
  const openingNote = opening ? ` &mdash; starting from ${escapeHtml(opening.name)} (${escapeHtml(opening.eco)})` : '';
  const totalsNote = totals
    ? `<p>${totalGames.toLocaleString()} games played from the starting position in this rating band
        (${totals.white.toLocaleString()}W / ${totals.draws.toLocaleString()}D / ${totals.black.toLocaleString()}L).</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Opening repertoire explorer (${escapeHtml(ratingBand)}, ${escapeHtml(color)}) - Lichess stats POC</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    nav { margin-bottom: 1.5rem; }
    nav a { margin-right: 1rem; }
    h1 { margin-bottom: 0; }
    .subtitle { color: #666; margin-top: 0.25rem; }
    ul.repertoire-tree, ul.repertoire-tree ul { list-style: none; padding-left: 1.25rem; border-left: 2px solid #eee; }
    ul.repertoire-tree { padding-left: 0; border-left: none; }
    li { margin: 0.6rem 0; }
    .move { font-weight: 600; margin-right: 0.5rem; }
    .move-white { color: #234; }
    .move-black { color: #555; font-style: italic; }
    .stats { color: #666; font-size: 0.85rem; }
    footer { color: #999; font-size: 0.8rem; margin-top: 3rem; }
  </style>
</head>
<body>
  <nav><a href="${escapeHtml(nav.player)}">Player lookup</a><a href="${escapeHtml(nav.repertoire)}">Repertoire explorer</a></nav>
  <h1>Opening repertoire explorer</h1>
  <p class="subtitle">Rating band ${escapeHtml(ratingBand)}, playing as ${escapeHtml(color)}${openingNote}</p>
  ${totalsNote}
  <p>Most-played moves at each ply for players in this rating band, with win/draw/loss rates per move.
     Your color's plies show the top choices actually played at this rating; the opponent's replies show
     only their single most common response, to keep the tree readable.</p>
  ${renderRepertoireTree(tree)}
  <footer>Data source: <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer API</a>
    (explorer.lichess.ovh, keyless, no account required). Generated locally; not deployed or published.</footer>
</body>
</html>
`;
}

module.exports = {
  renderPlayerPage,
  renderRepertoireTree,
  renderRepertoirePage,
  escapeHtml,
};
