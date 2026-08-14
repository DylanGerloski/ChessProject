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

function isValidState(candidate) {
  return Boolean(candidate)
    && BANDS.indexOf(candidate.band) !== -1
    && POOLS.indexOf(candidate.pool) !== -1
    && COLORS.indexOf(candidate.color) !== -1;
}

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
  var candidate = { band: params.get('band'), pool: params.get('pool'), color: params.get('color') };
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
}

var listeners = [];

function notifyListeners(state) {
  for (var i = 0; i < listeners.length; i += 1) {
    listeners[i](state);
  }
}

/**
 * @param {function({band:string,pool:string,color:string}):void} fn called
 *   on every writeBandState() call AND on a browser back/forward navigation
 *   that changes the fragment (a `hashchange` event) -- so a subscriber
 *   reacts to both the picker it drew and history navigation it didn't.
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
