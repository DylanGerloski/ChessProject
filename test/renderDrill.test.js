'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderDrillPage, renderDrillBoard } = require('../src/renderDrill');
const { renderHeader, NAV_ORDER, NAV_LABELS } = require('../src/render');
const { applyUciMoves, START_BOARD } = require('../src/chessPosition');
const { getApiToken } = require('../src/fetchOpeningExplorer');
const { buildDrillData, DRILL_USER_DEPTH, DRILL_OPPONENT_BREADTH, DRILL_CANDIDATES } = require('../src/buildDrill');
const { getOpening } = require('../src/openings');

const ITALIAN = getOpening('italian-game');
const PREFIX_PLAY = ITALIAN.line.map((p) => p.uci);
const PREFIX_KEY = PREFIX_PLAY.join(',');

const NAV = { player: 'player.html', repertoire: 'index.html', openings: 'openings.html', drill: 'italian-game-drill.html', guides: 'guides.html', faq: 'chess-opening-faq.html' };

// All squares, used only to mint syntactically-valid, distinct 4-char UCI
// strings for synthetic fixture moves below the first ply -- same
// convention as test/buildDrill.test.js's own fake. Only the FIRST
// opponent reply needs to be a real, legal move (it's the only one this
// module ever replays onto a real board -- see renderDrillPage's own
// comment about progressive enhancement); everything deeper is only ever
// used as plain SAN text (the "every line" details block), never
// board-simulated.
const SQUARES = [];
for (const file of 'abcdefgh') {
  for (const rank of '12345678') {
    SQUARES.push(`${file}${rank}`);
  }
}

function fakeDrillFetchImpl() {
  let cursor = 0;
  const responses = new Map();

  function nextUci() {
    const from = SQUARES[cursor % SQUARES.length];
    const to = SQUARES[(cursor + 41) % SQUARES.length];
    cursor += 1;
    return `${from}${to}`;
  }

  function makeResponse(specs) {
    return {
      white: specs.reduce((s, x) => s + x.white, 0),
      draws: specs.reduce((s, x) => s + x.draws, 0),
      black: specs.reduce((s, x) => s + x.black, 0),
      moves: specs.map((s) => ({ uci: s.uci, san: s.san, averageRating: 1700, white: s.white, draws: s.draws, black: s.black })),
      opening: null,
    };
  }

  function expandOpponent(play, oppDepth) {
    const breadth = DRILL_OPPONENT_BREADTH[oppDepth];
    let specs;
    if (play.join(',') === PREFIX_KEY) {
      // Real, legal black replies to "1.e4 e5 2.Nf3 Nc6 3.Bc4" -- the only
      // position renderDrillPage's server-rendered board actually replays.
      specs = [
        { uci: 'f8c5', san: 'Bc5', games: 24000, white: 11000, draws: 3500, black: 9500 },
        { uci: 'g8f6', san: 'Nf6', games: 20000, white: 9000, draws: 2500, black: 8500 },
      ].slice(0, breadth);
    } else {
      specs = [];
      for (let i = 0; i < breadth + 1; i += 1) {
        const games = 5000 - i * 500;
        specs.push({ uci: nextUci(), san: `O${cursor}`, games, white: Math.round(games * 0.5), draws: Math.round(games * 0.1), black: Math.round(games * 0.4) });
      }
    }
    responses.set(play.join(','), makeResponse(specs));
    for (let i = 0; i < breadth; i += 1) {
      expandUser([...play, specs[i].uci], oppDepth);
    }
  }

  function expandUser(play, oppDepth) {
    const specs = [];
    for (let i = 0; i < DRILL_CANDIDATES + 1; i += 1) {
      const games = 4000 - i * 400;
      specs.push({ uci: nextUci(), san: `U${cursor}`, games, white: Math.round(games * 0.55), draws: Math.round(games * 0.1), black: Math.round(games * 0.35) });
    }
    responses.set(play.join(','), makeResponse(specs));
    const answerUci = specs[0].uci;
    if (oppDepth + 1 < DRILL_USER_DEPTH) {
      expandOpponent([...play, answerUci], oppDepth + 1);
    }
  }

  expandOpponent(PREFIX_PLAY, 0);

  return async (url) => {
    const play = new URL(url).searchParams.get('play') || '';
    const json = responses.get(play);
    if (!json) throw new Error(`fakeDrillFetchImpl: no fixture wired for play="${play}"`);
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
  };
}

// Built once (not per-test) -- buildDrillData is deterministic given the
// fake fetch above, and this suite only reads the result, never mutates it.
let drillDataPromise = null;
function getDrillData() {
  if (!drillDataPromise) {
    drillDataPromise = buildDrillData({ openingSlug: 'italian-game', fetchImpl: fakeDrillFetchImpl() });
  }
  return drillDataPromise;
}

test('renderDrillBoard renders exactly 64 real buttons, each with a data-square and a non-empty aria-label', () => {
  const html = renderDrillBoard(START_BOARD, { glyphs: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } });
  const buttons = [...html.matchAll(/<button[^>]*data-square="[a-h][1-8]"[^>]*>/g)];
  assert.equal(buttons.length, 64);
  const squares = new Set();
  for (const [tag] of buttons) {
    const squareMatch = tag.match(/data-square="([a-h][1-8])"/);
    assert.ok(squareMatch, 'every board button has a data-square attribute');
    squares.add(squareMatch[1]);
    const labelMatch = tag.match(/aria-label="([^"]+)"/);
    assert.ok(labelMatch && labelMatch[1].length > 0, 'every board button has a non-empty aria-label');
  }
  assert.equal(squares.size, 64, 'all 64 squares are distinct');
});

test('renderDrillPage: exactly one h1, and the confident (non-hedging) subtitle is present', async () => {
  const drillData = await getDrillData();
  const html = renderDrillPage({ drillData, nav: NAV });
  const h1Matches = [...html.matchAll(/<h1[^>]*>/g)];
  assert.equal(h1Matches.length, 1);
  assert.match(html, /play the Italian Game from move 1/);
  assert.doesNotMatch(html, /\bBeta\b/i);
});

test('renderDrillPage (B3): opts into the wide layout container and wraps controls/board and the candidates table in the two-column grid, without disturbing any id drill.client.js queries by', async () => {
  const drillData = await getDrillData();
  const html = renderDrillPage({ drillData, nav: NAV });
  assert.match(html, /<div class="page page--wide">/);
  assert.match(html, /<div class="drill-layout">/);
  assert.match(html, /<div class="drill-column-play">/);
  assert.match(html, /<div class="drill-column-candidates">/);
  // The two columns are siblings inside .drill-layout: the play column
  // (controls + board) opens before the candidates column.
  const layoutIdx = html.indexOf('<div class="drill-layout">');
  const playIdx = html.indexOf('<div class="drill-column-play">');
  const candidatesIdx = html.indexOf('<div class="drill-column-candidates">');
  assert.ok(layoutIdx < playIdx && playIdx < candidatesIdx);
  // Every id drill.client.js queries by (src/browser/drill.client.js) must
  // still be present -- the grid wrapper only adds ancestor divs, it must
  // never rename/remove an id.
  for (const id of ['drill-band', 'drill-level', 'drill-move-form', 'drill-move-text', 'drill-submit', 'drill-candidate-table', 'drill-show-answer', 'drill-feedback']) {
    assert.match(html, new RegExp(`id="${id}"`), `expected id="${id}" to still be present`);
  }
});

test('renderDrillPage: the candidate table renders only the un-revealed placeholder server-side, never real move/pick%/score% data', async () => {
  const drillData = await getDrillData();
  const html = renderDrillPage({ drillData, nav: NAV });
  const tableSlotMatch = html.match(/<section id="drill-candidate-table"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(tableSlotMatch, 'expected a #drill-candidate-table slot');
  assert.match(tableSlotMatch[1], /empty-note/, 'expected the placeholder note, not a populated table');
  assert.doesNotMatch(tableSlotMatch[1], /<table/, 'no <table> should be server-rendered into the candidate slot before an attempt');
  // The real first-position candidates (Bc5/Nf6, from the fixture's legal
  // reply set) must not appear anywhere in that slot -- they're still
  // legitimately present elsewhere on the page (the #drill-data JSON blob
  // and the collapsed "See every line" <details>), which is unchanged,
  // pre-existing, click-to-reveal-gated behavior this fix doesn't touch.
  assert.doesNotMatch(tableSlotMatch[1], /Bc5|Nf6/, 'the band-typical reply must not be named in the un-revealed candidate slot');
});

test('renderDrillPage: the #drill-data JSON block parses and deep-equals the input drillData', async () => {
  const drillData = await getDrillData();
  const html = renderDrillPage({ drillData, nav: NAV });
  const match = html.match(/<script type="application\/json" id="drill-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a #drill-data JSON block');
  const parsed = JSON.parse(match[1]);
  assert.deepEqual(parsed, drillData);
});

test('renderDrillPage: head has the exact title, a description under 160 chars, a canonical link, and both JSON-LD blocks parse with the expected types', async () => {
  const drillData = await getDrillData();
  const html = renderDrillPage({ drillData, nav: NAV });

  assert.match(html, /<title>Italian Game Opening Drill by Rating Band \| Repertoire Builder<\/title>/);

  const descMatch = html.match(/<meta name="description" content="([^"]*)">/);
  assert.ok(descMatch, 'expected a meta description');
  assert.ok(descMatch[1].length <= 160, `description is ${descMatch[1].length} chars, expected <= 160`);

  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/italian-game-drill\.html">/);

  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = scripts.map((s) => s['@type']);
  assert.ok(types.includes('BreadcrumbList'), 'expected a BreadcrumbList JSON-LD block');
  assert.ok(types.includes('WebApplication'), 'expected a WebApplication JSON-LD block');
});

test('renderDrillPage: the Lichess API token never appears in the rendered output', async () => {
  const drillData = await getDrillData();
  const previousToken = process.env.LICHESS_API_TOKEN;
  process.env.LICHESS_API_TOKEN = 'test-fixture-fake-drill-token-98765';
  try {
    const html = renderDrillPage({ drillData, nav: NAV });
    assert.equal(html.includes(getApiToken()), false);
  } finally {
    if (previousToken === undefined) delete process.env.LICHESS_API_TOKEN;
    else process.env.LICHESS_API_TOKEN = previousToken;
  }
});

test('renderDrillPage: the server-rendered board matches the position after the opening prefix plus the first modelled opponent reply', async () => {
  const drillData = await getDrillData();
  const html = renderDrillPage({ drillData, nav: NAV });

  const firstReply = drillData.bands['1600-1800'].replies[0];
  const expectedBoard = applyUciMoves(START_BOARD, [...drillData.prefix.map((p) => p.uci), firstReply.uci]);
  const destSquare = firstReply.uci.slice(2, 4);
  const originSquare = firstReply.uci.slice(0, 2);

  assert.ok(expectedBoard[destSquare], 'sanity check: the reply actually places a piece on its destination square');
  assert.ok(!expectedBoard[originSquare], 'sanity check: the reply actually vacates its origin square');

  assert.match(html, new RegExp(`data-square="${destSquare}"[^>]*aria-label="${destSquare}, black `));
  assert.match(html, new RegExp(`data-square="${originSquare}"[^>]*aria-label="${originSquare}, empty"`));
});

test('NAV_ORDER/NAV_LABELS include drill, and a 2-key server.js-style nav still renders without it', () => {
  assert.ok(NAV_ORDER.includes('drill'));
  // The nav label must not imply a general drill hub that doesn't exist
  // yet -- only the Italian Game has a drill so far.
  assert.equal(NAV_LABELS.drill, 'Italian Game Drill');
  const html = renderHeader({ player: '/', repertoire: '/repertoire' });
  assert.doesNotMatch(html, /Italian Game Drill/);
});
