'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { withExplorerCache } = require('../src/explorerCache');

function tmpCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-explorer-cache-'));
}

test('withExplorerCache calls fetchImpl once per URL, serving the second call from disk', async () => {
  const dir = tmpCacheDir();
  try {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount += 1;
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => ({ hit: callCount }) };
    };
    const cached = withExplorerCache(fakeFetch, { cacheDir: dir });

    const first = await cached('https://explorer.lichess.org/lichess?fen=x', {});
    const firstBody = await first.json();
    assert.equal(firstBody.hit, 1);

    const second = await cached('https://explorer.lichess.org/lichess?fen=x', {});
    const secondBody = await second.json();
    assert.equal(secondBody.hit, 1, 'second call should be served from cache, not re-fetched');
    assert.equal(callCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('withExplorerCache does not cache a non-ok response', async () => {
  const dir = tmpCacheDir();
  try {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount += 1;
      return { ok: false, status: 500, statusText: 'Internal Server Error', headers: { get: () => null }, json: async () => ({}) };
    };
    const cached = withExplorerCache(fakeFetch, { cacheDir: dir });
    await cached('https://explorer.lichess.org/lichess?fen=y', {});
    await cached('https://explorer.lichess.org/lichess?fen=y', {});
    assert.equal(callCount, 2, 'a failed response must not be cached');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('withExplorerCache with enabled:false returns fetchImpl unchanged (bypassed entirely)', () => {
  const fakeFetch = async () => {};
  const wrapped = withExplorerCache(fakeFetch, { enabled: false });
  assert.equal(wrapped, fakeFetch);
});

test('different URLs get different cache entries', async () => {
  const dir = tmpCacheDir();
  try {
    const fakeFetch = async (url) => ({
      ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => ({ url }),
    });
    const cached = withExplorerCache(fakeFetch, { cacheDir: dir });
    const a = await (await cached('https://explorer.lichess.org/lichess?fen=a', {})).json();
    const b = await (await cached('https://explorer.lichess.org/lichess?fen=b', {})).json();
    assert.notEqual(a.url, b.url);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
