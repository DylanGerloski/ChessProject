'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildContentPages } = require('../src/buildContent');
const { buildOpeningModel } = require('../src/processOpenings');
const { renderOpeningPage } = require('../src/renderContent');
const { OPENINGS } = require('../src/openings');
const { makeSmartExplorerFetch, fakeResponse } = require('./helpers/fakeExplorer');

const FIXTURES = path.join(__dirname, 'fixtures');
const italianFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-italian-1600.json'), 'utf8'));
const mastersItalianFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'masters-italian.json'), 'utf8'));

// Unlike buildStatic.test.js's withTempDist (which intentionally exercises
// the real project dist/ dir), these tests use their own throwaway temp
// directory per test. node:test runs test *files* concurrently by default,
// and buildStatic.test.js already claims the real dist/ dir for its own
// backup/restore dance -- sharing it here would race the two files against
// each other and corrupt both. Passing outDir explicitly (buildContentPages
// accepts it) keeps this file fully isolated.
function withTempDist(fn) {
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-content-dist-'));
  return Promise.resolve()
    .then(() => fn(tmpDist))
    .finally(() => {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    });
}

test('buildContentPages writes 10 opening pages plus the openings hub, all with a unique title/description and one H1', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });

    assert.equal(written.length, 11); // 10 openings + 1 hub

    const titles = new Set();
    const descriptions = new Set();
    for (const page of written) {
      assert.ok(fs.existsSync(path.join(outDir, page.file)), `${page.file} should exist on disk`);
      const h1Matches = page.html.match(/<h1[ >]/g) || [];
      assert.equal(h1Matches.length, 1, `${page.file} should have exactly one H1`);
      assert.ok(page.title, `${page.file} should have a <title>`);
      assert.ok(!titles.has(page.title), `${page.file}'s title "${page.title}" must be unique`);
      titles.add(page.title);
      if (page.description) {
        assert.ok(page.description.length <= 160, `${page.file}'s meta description must be <=160 chars`);
        assert.ok(!descriptions.has(page.description), `${page.file}'s description must be unique`);
        descriptions.add(page.description);
      }
      assert.match(page.html, /<link rel="canonical" href="https:\/\/dylangerloski\.github\.io\/ChessProject\//);
    }
  })
);

test('buildContentPages never writes the Lichess API token into any generated content page', () =>
  withTempDist(async (outDir) => {
    const previousToken = process.env.LICHESS_API_TOKEN;
    process.env.LICHESS_API_TOKEN = 'content-fixture-fake-token-do-not-leak-98765';
    try {
      const { fetchImpl } = makeSmartExplorerFetch();
      const { written } = await buildContentPages({ fetchImpl, outDir });
      for (const page of written) {
        assert.equal(page.html.includes('content-fixture-fake-token-do-not-leak-98765'), false, `${page.file} must not contain the token`);
      }
    } finally {
      if (previousToken === undefined) delete process.env.LICHESS_API_TOKEN;
      else process.env.LICHESS_API_TOKEN = previousToken;
    }
  })
);

test('buildContentPages fails loudly on a move-order mismatch instead of publishing wrong chess', () =>
  withTempDist(async (outDir) => {
    const badFetch = async () =>
      fakeResponse({ opening: null, white: 10, draws: 1, black: 9, moves: [{ uci: 'h2h4', san: 'h4', white: 10, draws: 1, black: 9 }] });
    await assert.rejects(() => buildContentPages({ fetchImpl: badFetch, outDir }), /ply 0 expects/);
  })
);

test('the openings hub links to all 10 opening pages', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });
    const hub = written.find((p) => p.file === 'openings.html');
    for (const o of OPENINGS) {
      assert.match(hub.html, new RegExp(`href="${o.slug}\\.html"`), `hub should link to ${o.slug}.html`);
    }
  })
);

test('buildOpeningModel + renderOpeningPage handle a realistic full-shape fixture (per-move opening names, recentGames, master names) without crashing', () => {
  const openingConfig = OPENINGS.find((o) => o.slug === 'italian-game');
  const model = buildOpeningModel({
    openingConfig,
    bandResponses: { '1600-1800': italianFixture },
    mastersResponse: mastersItalianFixture,
    defaultBand: '1600-1800',
    minGamesForPct: 1000,
  });
  assert.equal(model.eco, 'C50');
  assert.equal(model.topReplies[0].opening.name, 'Italian Game: Giuoco Piano');
  assert.equal(model.masterGames[0].white.name, 'Caruana, Fabiano');
  assert.equal(model.recentGames.length, 1);

  const html = renderOpeningPage({
    model,
    openingConfig,
    nav: { repertoire: 'index.html', openings: 'openings.html', player: 'player.html' },
    related: [],
    repertoireLinks: { white: 'repertoire-1600-1800-white.html', black: 'repertoire-1600-1800-black.html' },
  });
  assert.match(html, /Caruana, Fabiano/);
  assert.match(html, /Italian Game: Giuoco Piano/);
  const h1Matches = html.match(/<h1[ >]/g) || [];
  assert.equal(h1Matches.length, 1);
});
