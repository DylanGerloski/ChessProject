'use strict';

// src/browser/bandHeaderControl.client.js is an esbuild ENTRY point (like
// src/browser/repertoire.client.js), but unlike src/browser/drill.client.js
// it has real require()s (bandState.client.js) rather than being a
// dependency-free IIFE -- same shape test/bandState.test.js already
// established for bandState.client.js itself: require it directly in
// Node after stubbing just enough of `window`/`document` for its
// DOMContentLoaded-or-immediate init() to run for real.

const test = require('node:test');
const assert = require('node:assert/strict');

function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };
}

function makeFakeSelect(initialValue) {
  const listeners = {};
  return {
    value: initialValue,
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    fireChange(newValue) {
      this.value = newValue;
      (listeners.change || []).forEach((fn) => fn());
    },
  };
}

/**
 * Loads a fresh copy of bandHeaderControl.client.js (and, transitively, a
 * fresh bandState.client.js -- both cleared from require.cache) against a
 * fake `window`/`document`. `select` is `null` to simulate a page that
 * didn't render the control (the no-op path); otherwise a fake <select>
 * element returned by makeFakeSelect().
 */
function freshBandHeaderControl({ select, hash = '', storage = makeFakeStorage(), readyState = 'complete' } = {}) {
  const bandStatePath = require.resolve('../src/browser/bandState.client');
  const controlPath = require.resolve('../src/browser/bandHeaderControl.client');
  delete require.cache[bandStatePath];
  delete require.cache[controlPath];

  const domContentLoadedListeners = [];
  global.window = {
    location: { hash, pathname: '/repertoire-builder.html', search: '' },
    localStorage: storage,
    history: { replaceState: () => {} },
    addEventListener: (event, fn) => {
      if (event === 'hashchange') { /* bandState.client.js's own listener -- not under test here */ }
    },
  };
  global.document = {
    readyState,
    querySelector: (sel) => (sel === '[data-band-header-control]' ? select : null),
    addEventListener: (event, fn) => {
      if (event === 'DOMContentLoaded') domContentLoadedListeners.push(fn);
    },
  };

  require('../src/browser/bandHeaderControl.client');
  return { domContentLoadedListeners, storage, window: global.window };
}

test.afterEach(() => {
  delete global.window;
  delete global.document;
});

test('no matching <select> on the page: init() is a no-op, does not throw', () => {
  assert.doesNotThrow(() => freshBandHeaderControl({ select: null }));
});

test('document already complete (not "loading"): runs init() immediately and syncs the select to the saved band', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: '2000+', pool: 'blitz', color: 'black' }));
  const select = makeFakeSelect('1600-1800'); // server-rendered default
  freshBandHeaderControl({ select, storage });
  assert.equal(select.value, '2000+');
});

test('document still loading: defers init() to DOMContentLoaded', () => {
  const select = makeFakeSelect('1600-1800');
  const { domContentLoadedListeners } = freshBandHeaderControl({ select, readyState: 'loading' });
  assert.equal(select.value, '1600-1800', 'should not have run yet');
  assert.equal(domContentLoadedListeners.length, 1);
  domContentLoadedListeners[0]();
  assert.equal(select.value, '1600-1800', 'default state matches server-rendered default -- no repaint needed');
});

test('a fresh visit with no saved state leaves the server-rendered default selected (zero DOM churn)', () => {
  const select = makeFakeSelect('1600-1800');
  freshBandHeaderControl({ select });
  assert.equal(select.value, '1600-1800');
});

test('changing the select writes the new band to bandState, preserving the existing pool and color', () => {
  const storage = makeFakeStorage();
  storage.setItem('rb.state', JSON.stringify({ band: '1600-1800', pool: 'rapid_classical', color: 'black' }));
  const select = makeFakeSelect('1600-1800');
  freshBandHeaderControl({ select, storage });

  select.fireChange('1800-2000');

  const persisted = JSON.parse(storage.getItem('rb.state'));
  assert.deepEqual(persisted, { band: '1800-2000', pool: 'rapid_classical', color: 'black' }, 'band changes, pool/color are preserved untouched');
});

test('an external band change (e.g. the in-page picker on repertoire.html) re-syncs this select via onBandStateChange', () => {
  const storage = makeFakeStorage();
  const select = makeFakeSelect('1600-1800');
  freshBandHeaderControl({ select, storage });

  // Simulate another part of the page calling writeBandState() directly
  // (same module instance -- require.cache was populated by the control's
  // own require('./bandState.client') call above).
  const { writeBandState } = require('../src/browser/bandState.client');
  writeBandState({ band: '1400-1600', pool: 'blitz', color: 'white' });

  assert.equal(select.value, '1400-1600');
});

test('an unsupported/invalid saved band (outside the four real bands) falls back to the default rather than leaving the select on an unmatched value', () => {
  const storage = makeFakeStorage();
  // Not achievable through any real UI today (see src/render.js's
  // HEADER_BAND_OPTIONS comment on the WS-1 scope boundary), but
  // bandState.client.js's own validation enum is wider than this
  // control's SUPPORTED_BANDS -- defend the DOM against that gap directly
  // rather than assuming it can never happen.
  storage.setItem('rb.state', JSON.stringify({ band: 'u1200', pool: 'blitz', color: 'white' }));
  const select = makeFakeSelect('1600-1800');
  freshBandHeaderControl({ select, storage });
  assert.equal(select.value, '1600-1800', 'falls back to bandState.client.js DEFAULT_STATE.band');
});
