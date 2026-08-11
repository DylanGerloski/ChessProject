'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  buildStatic,
  buildPlayerLookupBundle,
  bundleBrowserModule,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  assertNoTokenLeak,
} = require('../src/buildStatic');
const { RATING_BANDS } = require('../src/processRepertoire');

const FIXTURES = path.join(__dirname, 'fixtures');
const rootFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));

// A generic fake fetch that answers every Opening Explorer request with the
// same root-position fixture, regardless of the `play` param. It doesn't
// produce a realistic multi-ply tree, but buildStatic() only cares that
// buildRepertoireTree() resolves and returns *some* valid tree shape for
// each of the 8 band/color combinations -- no live network calls are made
// anywhere in this file.
function fakeExplorerFetch() {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => rootFixture,
    };
  };
  return { fetchImpl, getCallCount: () => callCount };
}

function withTempDist(fn) {
  // buildStatic() always writes to the real project dist/ dir (matching
  // build.js/buildRepertoire.js's existing convention of writing under
  // <project root>/dist), so tests run against that same directory. Capture
  // its prior contents and restore them afterwards so running the test
  // suite doesn't clobber a dist/ a human may have generated separately.
  const distDir = path.join(__dirname, '..', 'dist');
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-dist-backup-'));
  const hadDist = fs.existsSync(distDir);
  if (hadDist) {
    for (const entry of fs.readdirSync(distDir)) {
      fs.cpSync(path.join(distDir, entry), path.join(backupDir, entry), { recursive: true });
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      fs.rmSync(distDir, { recursive: true, force: true });
      if (hadDist) {
        fs.mkdirSync(distDir, { recursive: true });
        for (const entry of fs.readdirSync(backupDir)) {
          fs.cpSync(path.join(backupDir, entry), path.join(distDir, entry), { recursive: true });
        }
      }
      fs.rmSync(backupDir, { recursive: true, force: true });
    });
}

test('buildStatic writes all 8 pre-rendered repertoire pages, an index, and the player-lookup page+bundle', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, repertoireLinks } = await buildStatic({ fetchImpl });

    assert.equal(repertoireLinks.length, 8);
    const expectedBands = Object.keys(RATING_BANDS);
    for (const band of expectedBands) {
      for (const color of ['white', 'black']) {
        const file = repertoireFileName(band, color);
        assert.ok(
          repertoireLinks.some((l) => l.file === file),
          `expected a repertoire link for ${file}`
        );
        assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
      }
    }

    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'player.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'player-lookup.js')));
  })
);

test('buildStatic never writes the Lichess API token into any generated file', () =>
  withTempDist(async () => {
    const previousToken = process.env.LICHESS_API_TOKEN;
    process.env.LICHESS_API_TOKEN = 'test-fixture-fake-token-do-not-leak-12345';
    try {
      const { fetchImpl } = fakeExplorerFetch();
      const { outDir } = await buildStatic({ fetchImpl });

      for (const file of fs.readdirSync(outDir)) {
        const full = path.join(outDir, file);
        if (fs.statSync(full).isDirectory()) continue;
        const content = fs.readFileSync(full, 'utf8');
        assert.equal(
          content.includes('test-fixture-fake-token-do-not-leak-12345'),
          false,
          `${file} must not contain the Lichess API token`
        );
      }
    } finally {
      if (previousToken === undefined) delete process.env.LICHESS_API_TOKEN;
      else process.env.LICHESS_API_TOKEN = previousToken;
    }
  })
);

test('assertNoTokenLeak throws if a written file contains the token string', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-token-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'oops.html'), '<p>secret-token-abc123</p>', 'utf8');
    assert.throws(() => assertNoTokenLeak(tmpDir, 'secret-token-abc123'), /token leaked/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('assertNoTokenLeak is a no-op when no token was available to leak', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-token-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'fine.html'), '<p>nothing secret here</p>', 'utf8');
    assert.doesNotThrow(() => assertNoTokenLeak(tmpDir, null));
    assert.doesNotThrow(() => assertNoTokenLeak(tmpDir, undefined));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildPlayerLookupBundle concatenates fetchLichess.js, process.js, render.js, and the browser controller with no leftover require()/module.exports', () => {
  const bundle = buildPlayerLookupBundle();
  assert.match(bundle, /function fetchRatingHistory/);
  assert.match(bundle, /function summarizeRatingHistory/);
  assert.match(bundle, /function renderRatingTable/);
  assert.match(bundle, /class LichessNotFoundError/);
  assert.doesNotMatch(bundle, /\brequire\(/);
  assert.doesNotMatch(bundle, /module\.exports/);
});

test('bundleBrowserModule throws loudly if a source file has no module.exports to strip', () => {
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-bundle-test-')), 'noexports.js');
  fs.writeFileSync(tmpFile, 'function foo() { return 1; }\n', 'utf8');
  assert.throws(() => bundleBrowserModule(tmpFile), /no trailing module\.exports block/);
});

test('indexPage links to player.html and every repertoire file, with no server-only routes', () => {
  const links = [
    { band: '1400-1600', color: 'white', file: 'repertoire-1400-1600-white.html' },
    { band: '1400-1600', color: 'black', file: 'repertoire-1400-1600-black.html' },
  ];
  const html = indexPage(links);
  assert.match(html, /href="player\.html"/);
  assert.match(html, /href="repertoire-1400-1600-white\.html"/);
  assert.match(html, /href="repertoire-1400-1600-black\.html"/);
  assert.doesNotMatch(html, /href="\/repertoire/);
});

test('playerLookupPage references the bundled script and has no server-only routes', () => {
  const html = playerLookupPage();
  assert.match(html, /<script src="player-lookup\.js"><\/script>/);
  assert.match(html, /id="lookup-form"/);
  assert.match(html, /id="username"/);
  assert.match(html, /id="result"/);
  assert.doesNotMatch(html, /action="\/player"/);
});
