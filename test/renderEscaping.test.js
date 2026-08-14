'use strict';

// Regression coverage for the site's HTML-escaping discipline: escapeHtml()
// must cover all five HTML-significant characters (& < > " '), and every
// interpolation in renderGamesTable() must go through it -- not just the
// fields that happened to be wrapped already. All game-summary fields
// tested here (date, opponent, rating, color, variant, speed, result)
// ultimately come from the Lichess API, so they're treated as untrusted
// even though they're not visitor-typed input.

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, renderGamesTable } = require('../src/render');

test('escapeHtml escapes all five HTML-significant characters, including the apostrophe', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml("O'Brien"), 'O&#39;Brien');
});

test('escapeHtml leaves ordinary text untouched', () => {
  assert.equal(escapeHtml('hello world'), 'hello world');
});

function summaryWith(result) {
  return {
    totalGames: 1,
    wins: 1,
    losses: 0,
    draws: 0,
    winRate: 100,
    avgOpponentRating: 1500,
    results: [result],
  };
}

test('renderGamesTable escapes r.opponent, r.color, r.variant, r.speed (regression -- already covered before this fix)', () => {
  const html = renderGamesTable(
    summaryWith({
      date: '2026-01-01',
      opponent: '<script>alert(1)</script>',
      opponentRating: 1500,
      color: '"><img src=x>',
      variant: "<b>bold'</b>",
      speed: '<i>blitz</i>',
      result: 'win',
    })
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /"><img src=x>/);
  assert.doesNotMatch(html, /<b>bold'<\/b>/);
  assert.doesNotMatch(html, /<i>blitz<\/i>/);
});

test('renderGamesTable escapes r.date (previously unescaped)', () => {
  const html = renderGamesTable(
    summaryWith({
      date: '<script>alert("date")</script>',
      opponent: 'someone',
      opponentRating: 1500,
      color: 'white',
      variant: 'standard',
      speed: 'blitz',
      result: 'win',
    })
  );
  assert.doesNotMatch(html, /<script>alert\("date"\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;date&quot;\)&lt;\/script&gt;/);
});

test('renderGamesTable escapes r.opponentRating (previously unescaped)', () => {
  const html = renderGamesTable(
    summaryWith({
      date: '2026-01-01',
      opponent: 'someone',
      opponentRating: '<script>alert("rating")</script>',
      color: 'white',
      variant: 'standard',
      speed: 'blitz',
      result: 'win',
    })
  );
  assert.doesNotMatch(html, /<script>alert\("rating"\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;rating&quot;\)&lt;\/script&gt;/);
});

test('renderGamesTable escapes the class="result-..." attribute interpolation of r.result (previously unescaped)', () => {
  const html = renderGamesTable(
    summaryWith({
      date: '2026-01-01',
      opponent: 'someone',
      opponentRating: 1500,
      color: 'white',
      variant: 'standard',
      speed: 'blitz',
      result: '"><script>alert("result")</script>',
    })
  );
  assert.doesNotMatch(html, /class="result-"><script>/);
  assert.doesNotMatch(html, /<script>alert\("result"\)<\/script>/);
});

test('renderGamesTable handles a real apostrophe in opponent name without breaking the markup', () => {
  const html = renderGamesTable(
    summaryWith({
      date: '2026-01-01',
      opponent: "O'Brien",
      opponentRating: 1500,
      color: 'white',
      variant: 'standard',
      speed: 'blitz',
      result: 'win',
    })
  );
  assert.match(html, /O&#39;Brien/);
});

test('renderGamesTable falls back to "-" for a missing date/rating without throwing', () => {
  const html = renderGamesTable(
    summaryWith({
      date: null,
      opponent: 'someone',
      opponentRating: null,
      color: 'white',
      variant: 'standard',
      speed: 'blitz',
      result: 'draw',
    })
  );
  assert.match(html, /<td>-<\/td>/);
});
