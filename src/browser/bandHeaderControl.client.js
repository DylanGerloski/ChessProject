'use strict';

/**
 * Site-wide header band-persistence control (WS-1 spec section 3.4, task
 * W4). The one interactive element src/render.js's renderHeader() emits on
 * every page that shows band-dependent numbers -- see that function's own
 * BAND_CONTROL_PAGES comment for exactly which `active` pages, and
 * renderBandHeaderControl() for the server-rendered <select> markup this
 * module wires up.
 *
 * Reads and writes state EXCLUSIVELY through bandState.client.js's
 * readBandState()/writeBandState()/onBandStateChange() -- per that
 * module's own header comment ("must not introduce a second source of
 * truth for the band/pool/color"), this file owns only the DOM wiring for
 * the <select data-band-header-control> element, no band/pool/color logic
 * of its own.
 *
 * Deliberately BAND ONLY (not pool/color) -- this control's whole job is
 * band persistence (the WS-1.4 directive's own name for it), so a change
 * here always preserves whatever pool/color the visitor already had.
 *
 * esbuild entry point (src/buildStatic.js's buildBandHeaderControlBundle()),
 * bundled into dist/band-header.js and loaded (deferred) on every page that
 * renders the control -- same bundling shape as
 * src/browser/repertoire.client.js. A page with no matching element (the
 * common case for every OTHER page, and the placeholder pages before their
 * follow-on task lands) is a no-op: this module finds nothing and returns.
 */
const { readBandState, writeBandState, onBandStateChange, BANDS, DEFAULT_STATE } = require('./bandState.client');

// The four real bands this control offers -- MUST match src/render.js's
// own HEADER_BAND_OPTIONS (test/render.test.js asserts the two stay in
// sync) and processRepertoire.js's RATING_BANDS keys. Derived by filtering
// bandState.client.js's own BANDS enum (rather than a second independent
// hardcoded list) so this file can never drift from bandState.client.js's
// canonical set on its own -- see src/render.js's HEADER_BAND_OPTIONS
// comment for the full scope-boundary reasoning (WS-1 spec 3.4: no
// sub-1400 band yet, Non-Negotiable 4 forbids shipping an empty one).
var UNSUPPORTED_BANDS = ['u1200', '1200-1400'];
var SUPPORTED_BANDS = BANDS.filter(function (band) {
  return UNSUPPORTED_BANDS.indexOf(band) === -1;
});

(function () {
  if (typeof document === 'undefined') return;

  function init() {
    var select = document.querySelector('[data-band-header-control]');
    if (!select) return; // this page didn't render the control -- nothing to wire up

    function syncFromState(state) {
      var band = state && SUPPORTED_BANDS.indexOf(state.band) !== -1 ? state.band : DEFAULT_STATE.band;
      if (select.value !== band) select.value = band;
    }

    // Only repaint if the resolved state differs from what's already
    // server-rendered (HEADER_BAND_DEFAULT in src/render.js, kept in sync
    // with DEFAULT_STATE.band) -- the common case (a fresh visit, nothing
    // in the fragment or localStorage) does zero DOM churn, same pattern
    // src/browser/repertoire.client.js's init() uses.
    syncFromState(readBandState());

    select.addEventListener('change', function () {
      if (SUPPORTED_BANDS.indexOf(select.value) === -1) return; // defensive -- every <option> value is server-rendered from this same list
      var current = readBandState();
      writeBandState({ band: select.value, pool: current.pool, color: current.color });
    });

    // Reacts to a change made anywhere else that shares this state --
    // repertoire.html's own in-page band+color picker, or a browser
    // back/forward navigation that changes the URL fragment (bandState.
    // client.js's own hashchange listener).
    onBandStateChange(syncFromState);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
