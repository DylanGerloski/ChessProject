'use strict';

/**
 * Rating-band / pool / color state -- the single source of truth for
 * "which slice of the data is this visitor looking at", shared across every
 * page that lets a visitor switch it. Priority order, per spec (WS-3.2
 * section 2.3): URL FRAGMENT > localStorage > default. A fragment (never a
 * query string -- see src/buildStatic.js's repertoire.html header comment
 * for why) makes a deep link fully bookmarkable/shareable without creating
 * a second indexable URL; localStorage remembers a visitor's preference
 * across pages/visits; the default covers a first-ever visit with nothing
 * set.
 *
 * THIS MODULE IS THE WS-1.4 INTEGRATION POINT. A future site-wide header
 * control (WS-1.4, band persistence) calls writeBandState() and
 * re-renders whatever it controls; it must not introduce a second source
 * of truth for the band/pool/color -- read and write state only through
 * this module's readBandState()/writeBandState().
 *
 * CROSS-BUNDLE NOTIFICATION: src/buildStatic.js gives band-header.js
 * (bandHeaderControl.client.js) and each page's own client bundle (e.g.
 * repertoire.client.js) SEPARATE esbuild entry points, so each loaded page
 * runs its own independent copy of this module -- its own module-scoped
 * `listeners` array, and its own registered window listeners. A
 * writeBandState() call in one bundle's copy can therefore never reach
 * another bundle's onBandStateChange() subscribers through the in-module
 * `listeners` array alone (bug: the header band <select> saved state but
 * never repainted repertoire.html). Fixed by
 * ALSO dispatching a window-level CustomEvent (BAND_STATE_EVENT below) on
 * every write; every bundle's copy of this module listens for that event
 * on window and re-notifies ITS OWN local listeners, closing the loop
 * across bundle boundaries via the one channel that is actually shared: a
 * real browser event on the shared `window` object rather than JS module
 * state, which esbuild does not (and by design should not) dedupe across
 * separate entry points. The dispatching bundle's own listeners are still
 * notified synchronously and directly (see writeBandState() below) rather
 * than via its own event round-trip, so `INSTANCE_ID` tags each dispatch
 * and the receiving handler skips a detail tagged with its own instance
 * id -- otherwise the dispatching bundle would double-notify its own
 * subscribers (once directly, once via its own window listener catching
 * its own event).
 *
 * SECURITY: localStorage is untrusted on read (a value from a previous,
 * possibly-outdated or tampered-with page load) -- the stored JSON is
 * parsed inside try/catch, then shape-validated against the known
 * band/pool/color enums below -- an
 * unrecognized or malformed value is discarded, never used. The URL
 * fragment is untrusted input too: parsed with URLSearchParams (never
 * regex-spliced into HTML) and validated against the same enums. Neither
 * source's raw value is ever written to innerHTML, href, or src by this
 * module -- callers that display a band/pool/color string must use
 * .textContent (or escapeHtml() for HTML-string templating), same as any
 * other untrusted value.
 */

var STORAGE_KEY = 'rb.state';

// Matches src/ingest/gameFilter.js's BANDS keys (the full 6-band set this
// pipeline now supports, including the u1200/1200-1400 sub-1400 coverage
// WS-1.4 is what actually exposes) and POOL_FOR_SPEED's 3 pool values. A
// page that only offers a subset (WS-3.2's repertoire.html offers the
// original 4 bands x 2 colors, pool pinned to 'blitz') still validates
// against the FULL enum here -- narrowing to what one particular page
// supports is that page's own concern, not this shared module's.
var BANDS = ['u1200', '1200-1400', '1400-1600', '1600-1800', '1800-2000', '2000+'];
var POOLS = ['bullet', 'blitz', 'rapid_classical'];
var COLORS = ['white', 'black'];

var DEFAULT_STATE = { band: '1600-1800', pool: 'blitz', color: 'white' };

// Window-level event name used to bridge writeBandState() across separate
// esbuild bundles -- see the CROSS-BUNDLE NOTIFICATION header comment
// above. INSTANCE_ID is unique per loaded copy of this module (i.e. per
// bundle, since each bundle's own require() gives it a fresh top-level
// module evaluation) so a bundle can tell its own dispatch apart from
// another bundle's when the event bounces back to it on the shared
// window.
var BAND_STATE_EVENT = 'rb:bandstatechange';
var INSTANCE_ID = 'bs-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);

function isValidState(candidate) {
  return Boolean(candidate)
    && BANDS.indexOf(candidate.band) !== -1
    && POOLS.indexOf(candidate.pool) !== -1
    && COLORS.indexOf(candidate.color) !== -1;
}

/**
 * Parses band/pool/color out of the URL fragment. Tolerant of a PARTIAL
 * fragment: any of the three keys that is simply absent from the fragment
 * (never present in the URL at all) is filled in from localStorage-or-
 * default before validating, so a band-only or band+color-only link (which
 * is what src/buildContent.js and src/buildStatic.js actually emit -- see
 * this file's own header comment) resolves to the band/color the visitor
 * asked for instead of silently falling through to DEFAULT_STATE. This is
 * deliberately narrower than "any invalid value is tolerated": a key that
 * IS present but holds an unrecognized value (params.get() returns a
 * non-null string that fails the enum check) is left as-is and the whole
 * fragment is still discarded by the isValidState() check below -- that
 * preserves the existing "malformed/tampered fragment is discarded, not
 * partially trusted" behavior for a key that's present-but-wrong, and only
 * changes behavior for a key that's absent-and-therefore-null.
 */
function fromFragment() {
  if (typeof window === 'undefined') return null;
  var hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  var params;
  try {
    params = new URLSearchParams(hash.slice(1));
  } catch (err) {
    return null;
  }
  var band = params.get('band');
  var pool = params.get('pool');
  var color = params.get('color');
  // None of the three keys present at all -- this hash isn't a band/pool/
  // color deep link (could be an unrelated anchor), so don't manufacture a
  // state from thin air; let readBandState() fall through to localStorage/
  // default exactly as it did before this fragment was even read.
  if (band === null && pool === null && color === null) return null;
  var fallback = fromLocalStorage() || DEFAULT_STATE;
  var candidate = {
    band: band === null ? fallback.band : band,
    pool: pool === null ? fallback.pool : pool,
    color: color === null ? fallback.color : color,
  };
  return isValidState(candidate) ? candidate : null;
}

function fromLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  var raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null; // private-browsing / storage-disabled can throw on read too
  }
  if (!raw) return null;
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  return isValidState(parsed) ? { band: parsed.band, pool: parsed.pool, color: parsed.color } : null;
}

/** @returns {{band:string, pool:string, color:string}} */
function readBandState() {
  return fromFragment() || fromLocalStorage() || {
    band: DEFAULT_STATE.band,
    pool: DEFAULT_STATE.pool,
    color: DEFAULT_STATE.color,
  };
}

/**
 * Persists `state` to localStorage and reflects it in the URL fragment via
 * history.replaceState (no new history entry, no navigation/reload), then
 * notifies every onBandStateChange() subscriber. Throws on an invalid
 * state -- callers (a band-picker click handler) are expected to only ever
 * construct a state from the same known enums, never from free-typed input.
 *
 * @param {{band:string, pool:string, color:string}} state
 */
function writeBandState(state) {
  if (!isValidState(state)) {
    throw new Error('writeBandState: invalid state, must be a known band/pool/color combination');
  }
  var clean = { band: state.band, pool: state.pool, color: state.color };
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch (err) {
      // Storage can throw (private browsing, quota) -- the fragment update
      // below still reflects the change on THIS page even if it can't be
      // remembered for next time.
    }
  }
  if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
    var fragment = 'band=' + encodeURIComponent(clean.band) + '&pool=' + encodeURIComponent(clean.pool) + '&color=' + encodeURIComponent(clean.color);
    var base = window.location.pathname + (window.location.search || '');
    window.history.replaceState(null, '', base + '#' + fragment);
  }
  notifyListeners(clean);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
    // Cross-bundle bridge -- see CROSS-BUNDLE NOTIFICATION comment above.
    // This bundle's own listeners were already notified synchronously by
    // notifyListeners(clean) just above; INSTANCE_ID lets the event
    // handler below recognize and skip this bundle's own dispatch when it
    // bounces back on window, so only OTHER bundles' listeners fire from
    // it.
    window.dispatchEvent(new window.CustomEvent(BAND_STATE_EVENT, { detail: { state: clean, source: INSTANCE_ID } }));
  }
}

var listeners = [];

function notifyListeners(state) {
  for (var i = 0; i < listeners.length; i += 1) {
    listeners[i](state);
  }
}

/**
 * @param {function({band:string,pool:string,color:string}):void} fn called
 *   on every writeBandState() call (this bundle's own AND, via the
 *   BAND_STATE_EVENT bridge, any other bundle's on the same page) AND on a
 *   browser back/forward navigation that changes the fragment (a
 *   `hashchange` event) -- so a subscriber reacts to a picker it drew, a
 *   picker a DIFFERENT bundle on the same page drew, and history
 *   navigation it didn't.
 * @returns {function():void} unsubscribe
 */
function onBandStateChange(fn) {
  listeners.push(fn);
  return function unsubscribe() {
    var idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', function () {
    notifyListeners(readBandState());
  });
  window.addEventListener(BAND_STATE_EVENT, function (evt) {
    var detail = evt && evt.detail;
    if (!detail || detail.source === INSTANCE_ID) return; // our own dispatch -- already notified directly in writeBandState()
    if (isValidState(detail.state)) {
      notifyListeners({ band: detail.state.band, pool: detail.state.pool, color: detail.state.color });
    }
  });
}

module.exports = {
  readBandState,
  writeBandState,
  onBandStateChange,
  BANDS,
  POOLS,
  COLORS,
  DEFAULT_STATE,
};
