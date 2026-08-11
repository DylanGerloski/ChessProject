'use strict';

/**
 * Page controller for the static player-lookup page (dist/player.html).
 *
 * This file is NOT loaded via CommonJS module loading -- it's appended as plain text
 * after fetchLichess.js, process.js, and render.js by
 * buildStatic.js's buildPlayerLookupBundle(), so it runs in the same
 * top-level scope and can call fetchRatingHistory / fetchRecentGames /
 * summarizeRatingHistory / summarizeGames / renderRatingTable /
 * renderGamesTable / escapeHtml / LichessNotFoundError / LichessRateLimitError
 * / LichessApiError directly, without any import statement.
 *
 * It calls Lichess's already-public, keyless general API
 * (https://lichess.org/api) directly from the visitor's browser. No Lichess
 * API token is used, read, or referenced anywhere in this file.
 *
 * Wrapped in an IIFE only to keep its own helper names (lookupPlayer, $,
 * etc.) out of the shared top-level scope the bundled modules above it use;
 * it still reads their declarations via normal closure/script-scope lookup.
 */
(function () {
  function $(selector) {
    return document.querySelector(selector);
  }

  function setStatus(html) {
    $('#result').innerHTML = html;
  }

  async function lookupPlayer(username) {
    setStatus('<p class="status-message status-message--loading">Loading&hellip;</p>');
    try {
      const [history, games] = await Promise.all([
        fetchRatingHistory(username),
        fetchRecentGames(username, { max: 15 }),
      ]);
      const ratingRows = summarizeRatingHistory(history);
      const gameSummary = summarizeGames(games, username);
      setStatus(`
        <h2>${escapeHtml(username)}</h2>
        <h3>Ratings by variant</h3>
        ${renderRatingTable(ratingRows)}
        <h3>Recent games</h3>
        ${renderGamesTable(gameSummary)}
      `);
    } catch (err) {
      if (err instanceof LichessNotFoundError) {
        setStatus(`<p class="status-message status-message--error">No such Lichess user: ${escapeHtml(username)}</p>`);
      } else if (err instanceof LichessRateLimitError) {
        setStatus('<p class="status-message status-message--error">Lichess API rate limit hit, try again shortly.</p>');
      } else if (err instanceof LichessApiError) {
        setStatus(`<p class="status-message status-message--error">Lichess API request failed: ${escapeHtml(err.message)}</p>`);
      } else if (err instanceof TypeError) {
        // A raw fetch()/network failure (offline, CORS block, etc) surfaces
        // as a TypeError with no useful HTTP status attached.
        setStatus(`<p class="status-message status-message--error">Could not reach the Lichess API from this page (network error or the browser blocked the cross-origin request). Details: ${escapeHtml(err.message)}</p>`);
      } else {
        setStatus(`<p class="status-message status-message--error">Lookup failed: ${escapeHtml(err.message)}</p>`);
      }
    }
  }

  function init() {
    const form = $('#lookup-form');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = $('#username').value.trim();
      if (!username) return;
      const url = new URL(window.location.href);
      url.searchParams.set('username', username);
      window.history.replaceState(null, '', url);
      lookupPlayer(username);
    });

    const params = new URLSearchParams(window.location.search);
    const prefill = params.get('username');
    if (prefill) {
      $('#username').value = prefill;
      lookupPlayer(prefill);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
