'use strict';

/**
 * Page controller for the collapsed static opening-repertoire page
 * (dist/repertoire.html, WS-3.2 section 2). This is the esbuild entry
 * point for repertoire.js (see src/buildStatic.js's buildRepertoireBundle()):
 * a real CommonJS module that require()s src/browser/bandState.client.js
 * and src/render.js directly, bundled the same way playerLookup.client.js/
 * drill.client.js already are (one self-contained IIFE, no runtime
 * require(), works from a file:// URL).
 *
 * repertoire.html server-renders ONE band+color combination in full
 * (spec section 2.1's binding rule -- a crawler with JS disabled sees a
 * complete page for the default band+color). This controller's only job is
 * to swap that markup client-side when readBandState() (fragment >
 * localStorage > default, see bandState.client.js) resolves to a DIFFERENT
 * combination than the one already rendered -- using the pre-baked
 * #repertoire-data JSON block (every band x color combination this build
 * produced, embedded once at build time; never fetched at runtime, since
 * the whole set is a few KB -- see that build step's own header comment
 * for why this page doesn't use the dist/data/ shard-fetch path WS-1.4's
 * future general position explorer will).
 *
 * Wrapped in an IIFE only to keep its own helper names out of the bundle's
 * top-level scope, matching this project's other browser entry points.
 */
const { readBandState, writeBandState, onBandStateChange } = require('./bandState.client');
const { renderRepertoireTree } = require('../render');

(function () {
  function $(selector) {
    return document.querySelector(selector);
  }

  var dataEl = document.getElementById('repertoire-data');
  if (!dataEl) return; // no repertoire data present -- nothing to wire up

  var payload;
  try {
    payload = JSON.parse(dataEl.textContent);
  } catch (err) {
    return; // corrupt data -- leave the server-rendered default as-is
  }
  if (!payload || !payload.combos) return;

  function comboKey(band, color) {
    return band + '|' + color;
  }

  function comboFor(state) {
    return Object.prototype.hasOwnProperty.call(payload.combos, comboKey(state.band, state.color))
      ? payload.combos[comboKey(state.band, state.color)]
      : null;
  }

  function isDefaultState(state) {
    return Boolean(payload.default) && state.band === payload.default.band && state.color === payload.default.color;
  }

  function paint(state) {
    var combo = comboFor(state);
    if (!combo) return; // this page only bakes the fixed band x color set it built -- an unknown combo leaves the DOM untouched

    var subtitleEl = $('#repertoire-subtitle-text');
    if (subtitleEl) {
      var openingNote = combo.opening
        ? ' - starting from ' + combo.opening.name + ' (' + combo.opening.eco + ')'
        : '';
      subtitleEl.textContent = 'Rating band ' + combo.ratingBand + ', playing as ' + combo.color + openingNote;
    }

    var totalsEl = $('#repertoire-totals');
    if (totalsEl) {
      if (combo.totals) {
        var totalGames = combo.totals.white + combo.totals.draws + combo.totals.black;
        totalsEl.textContent = totalGames.toLocaleString() +
          ' games played from the starting position in this rating band (' +
          combo.totals.white.toLocaleString() + 'W / ' +
          combo.totals.draws.toLocaleString() + 'D / ' +
          combo.totals.black.toLocaleString() + 'L).';
        totalsEl.hidden = false;
      } else {
        totalsEl.textContent = '';
        totalsEl.hidden = true;
      }
    }

    var treeEl = $('#repertoire-tree');
    if (treeEl) {
      // combo.tree is this build's own already-escaped-per-field aggregate
      // data (every san/games/rating value renderRepertoireTree() emits was
      // already passed through render.js's escapeHtml() when this same
      // function built the server-rendered default state) -- not
      // visitor-supplied input, so this innerHTML assignment carries the
      // same trust level as the page's own initial server-rendered markup,
      // not a new untrusted-HTML sink.
      treeEl.innerHTML = renderRepertoireTree(combo.tree);
    }

    updatePickerActive(state);
  }

  function updatePickerActive(state) {
    var pills = document.querySelectorAll('.band-pill[data-band]');
    for (var i = 0; i < pills.length; i += 1) {
      var pill = pills[i];
      var active = pill.getAttribute('data-band') === state.band && pill.getAttribute('data-color') === state.color;
      if (active) {
        pill.setAttribute('aria-current', 'true');
      } else {
        pill.removeAttribute('aria-current');
      }
    }
  }

  function init() {
    var initialState = readBandState();
    // Only repaint if the resolved state differs from the server-rendered
    // default -- the default state's numbers are already correct in the
    // markup (spec 2.1's binding rule), so the common case (a fresh visit,
    // nothing in the fragment or localStorage) does zero DOM churn.
    if (isDefaultState(initialState)) {
      updatePickerActive(initialState);
    } else {
      paint(initialState);
    }

    var picker = $('.band-picker');
    if (picker) {
      picker.addEventListener('click', function (event) {
        var target = event.target;
        var pill = target && typeof target.closest === 'function' ? target.closest('.band-pill[data-band]') : null;
        if (!pill) return;
        var band = pill.getAttribute('data-band');
        var color = pill.getAttribute('data-color');
        if (!band || !color) return;
        event.preventDefault();
        var current = readBandState();
        writeBandState({ band: band, pool: current.pool, color: color });
      });
    }

    onBandStateChange(paint);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
