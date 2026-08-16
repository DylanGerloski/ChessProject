'use strict';

// src/browser/bandState.client.js is a real CommonJS module (unlike
// src/browser/drill.client.js, it's a DEPENDENCY other client entry points
// require(), not an esbuild entry point itself -- same shape as
// src/chessPosition.js/src/drillLogic.js, which is why it can export
// normally without tripping buildStatic.test.js's "no leftover
// require()/module.exports in the BUNDLE" check (that check runs against
// the bundled output of an ENTRY point, e.g. repertoire.client.js, not
// against this file's own source). So this test requires it directly,
// after stubbing just enough of `window` for it to run in Node.

const test = require('node:test');
const assert = require('node:assert/strict');

function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    _store: store,
  };
}

/**
 * Fresh require of bandState.client.js against a fresh fake `window` --
 * `require.cache` is cleared first so each test gets its own module-level
 * `listeners` array and its own `hashchange` listener registration, rather
 * than accumulating state across tests in this file.
 */
function freshBandState({ hash = '', storage = makeFakeStorage(), pathname = '/repertoire.html', search = '' } = {}) {
  const modulePath = require.resolve('../src/browser/bandState.client');
  delete require.cache[modulePath];
  const replaceStateCalls = [];
  const hashchangeListeners = [];
  global.window = {
    location: { hash, pathname, search },
    localStorage: storage,
    history: { replaceState: (state, title, url) => replaceStateCalls.push(url) },
    addEventListener: (event, fn) => {
      if (event === 'hashchange') hashchangeListeners.push(fn);
    },
  };
  const mod = require('../src/browser/bandState.client');
  return { ...mod, replaceStateCalls, hashchangeListeners, storage, window: global.window };
}

test.afterEach(() => {
  delete global.window;
});

test('readBandState: with no fragment and no localStorage, returns the default', () => {
  const { readBandState, DEFAULT_STATE } = freshBandState();
  assert.deepEqual(readBandState(), DEFAULT_STATE);
});

test('readBandState: a valid fragment takes priority over localStorage and the default', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: '2000+', pool: 'blitz', color: 'black' }));
  const { readBandState } = freshBandState({ hash: '#band=1400-1600&pool=blitz&color=white', storage });
  assert.deepEqual(readBandState(), { band: '1400-1600', pool: 'blitz', color: 'white' });
});

test('readBandState: falls back to localStorage when the fragment is absent', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: 'u1200', pool: 'rapid_classical', color: 'black' }));
  const { readBandState } = freshBandState({ hash: '', storage });
  assert.deepEqual(readBandState(), { band: 'u1200', pool: 'rapid_classical', color: 'black' });
});

test('readBandState: a band+color-only fragment (pool absent) fills pool from the default and still resolves to the requested band/color -- regression test for the production bug where every emitted deep link (band+color, no pool) silently rendered DEFAULT_STATE instead', () => {
  const { readBandState } = freshBandState({ hash: '#band=1400-1600&color=white' });
  assert.deepEqual(readBandState(), { band: '1400-1600', pool: 'blitz', color: 'white' });
});

test('readBandState: a band+color-only fragment fills the missing pool from localStorage when one is stored, not the hardcoded default', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: '2000+', pool: 'rapid_classical', color: 'black' }));
  const { readBandState } = freshBandState({ hash: '#band=1400-1600&color=white', storage });
  assert.deepEqual(readBandState(), { band: '1400-1600', pool: 'rapid_classical', color: 'white' });
});

test('readBandState: a band-only fragment fills both pool and color from the default', () => {
  const { readBandState } = freshBandState({ hash: '#band=u1200' });
  assert.deepEqual(readBandState(), { band: 'u1200', pool: 'blitz', color: 'white' });
});

test('readBandState: a fragment with none of band/pool/color present (unrelated hash) is not treated as a deep link at all, falling through to localStorage', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: 'u1200', pool: 'bullet', color: 'black' }));
  const { readBandState } = freshBandState({ hash: '#some-other-anchor', storage });
  assert.deepEqual(readBandState(), { band: 'u1200', pool: 'bullet', color: 'black' });
});

test('readBandState: an invalid/unknown fragment value is discarded, falling through to localStorage', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: '1600-1800', pool: 'blitz', color: 'white' }));
  const { readBandState } = freshBandState({ hash: '#band=not-a-real-band&pool=blitz&color=white', storage });
  assert.deepEqual(readBandState(), { band: '1600-1800', pool: 'blitz', color: 'white' });
});

test('readBandState: malformed JSON in localStorage is caught, not thrown, and falls through to the default', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', '{not valid json');
  const { readBandState, DEFAULT_STATE } = freshBandState({ storage });
  assert.deepEqual(readBandState(), DEFAULT_STATE);
});

test('readBandState: a shape-invalid localStorage value (wrong band) is discarded, not used', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: 'not-a-band', pool: 'blitz', color: 'white' }));
  const { readBandState, DEFAULT_STATE } = freshBandState({ storage });
  assert.deepEqual(readBandState(), DEFAULT_STATE);
});

test('writeBandState: persists to localStorage, updates the fragment via history.replaceState, and notifies subscribers', () => {
  const { writeBandState, onBandStateChange, storage, replaceStateCalls } = freshBandState();
  const seen = [];
  onBandStateChange((state) => seen.push(state));

  writeBandState({ band: '1800-2000', pool: 'blitz', color: 'black' });

  assert.deepEqual(JSON.parse(storage.getItem('rb.state')), { band: '1800-2000', pool: 'blitz', color: 'black' });
  assert.equal(replaceStateCalls.length, 1);
  assert.equal(replaceStateCalls[0], '/repertoire.html#band=1800-2000&pool=blitz&color=black');
  assert.deepEqual(seen, [{ band: '1800-2000', pool: 'blitz', color: 'black' }]);
});

test('writeBandState: percent-encodes a band value containing "+" in the fragment', () => {
  const { writeBandState, replaceStateCalls } = freshBandState();
  writeBandState({ band: '2000+', pool: 'blitz', color: 'white' });
  assert.equal(replaceStateCalls[0], '/repertoire.html#band=2000%2B&pool=blitz&color=white');
});

test('writeBandState: throws on an invalid band/pool/color combination rather than silently persisting it', () => {
  const { writeBandState } = freshBandState();
  assert.throws(() => writeBandState({ band: 'not-a-band', pool: 'blitz', color: 'white' }), /invalid state/);
});

test('onBandStateChange: returns an unsubscribe function that actually stops delivery', () => {
  const { writeBandState, onBandStateChange } = freshBandState();
  const seen = [];
  const unsubscribe = onBandStateChange((state) => seen.push(state));
  writeBandState({ band: '1400-1600', pool: 'blitz', color: 'white' });
  unsubscribe();
  writeBandState({ band: '1600-1800', pool: 'blitz', color: 'black' });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { band: '1400-1600', pool: 'blitz', color: 'white' });
});

test('module registers exactly one hashchange listener that re-reads state and notifies subscribers (browser back/forward)', () => {
  const storage = makeFakeStorage();
  const { onBandStateChange, hashchangeListeners, window } = freshBandState({ storage });
  assert.equal(hashchangeListeners.length, 1);

  const seen = [];
  onBandStateChange((state) => seen.push(state));
  // %2B, not a literal "+" -- URLSearchParams decodes an unencoded "+" as a
  // space (confirmed: new URLSearchParams('band=2000+').get('band') ===
  // "2000 "), which is exactly the ambiguity writeBandState's
  // encodeURIComponent avoids on write; a real fragment this app produces
  // is always percent-encoded, so the test input matches that.
  window.location.hash = '#band=2000%2B&pool=blitz&color=black';
  hashchangeListeners[0]();

  assert.deepEqual(seen, [{ band: '2000+', pool: 'blitz', color: 'black' }]);
});
