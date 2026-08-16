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
 * Also drives the synced board panel added for the Board Visibility spec
 * (task B1): a persistent cm-chessboard instance
 * (src/boardWidget.js's mountSyncBoard) that shows the position after
 * whichever tree row is currently selected. Every #repertoire-tree row is a
 * real <button> carrying its own full `data-uci-path` from the tree root
 * (src/render.js's renderRepertoireNode) -- selecting one replays that path
 * with src/chessPosition.js's applyUciMoves()/fenFromBoard() (no chess
 * engine, no build-time FEN precomputation) and hands the resulting FEN to
 * the board. Click delegation is wired once on #repertoire-tree itself
 * (never on individual row buttons), so it keeps working after paint()
 * below replaces the tree's innerHTML on a band/color change.
 *
 * Wrapped in an IIFE only to keep its own helper names out of the bundle's
 * top-level scope, matching this project's other browser entry points.
 */
const { readBandState, writeBandState, onBandStateChange } = require('./bandState.client');
const { renderRepertoireTree } = require('../render');
const { mountSyncBoard, COLOR, FEN } = require('../boardWidget');
const { START_BOARD, applyUciMoves, fenFromBoard } = require('../chessPosition');

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

  // ---- Synced board panel (Board Visibility spec, task B1) -------------
  // Untrusted-DOM-readback shape (security-standards.md): data-uci-path
  // only ever originates from this project's own build-time payload, but
  // it is still validated here before being replayed, same discipline as
  // any other DOM-read value -- a malformed/tampered value is rejected
  // outright (no DOM write, board stays on its previous position).
  var UCI_PATH_RE = /^([a-h][1-8][a-h][1-8][qrbn]?)( [a-h][1-8][a-h][1-8][qrbn]?)*$/;
  var boardMountEl = document.getElementById('repertoire-board-mount');
  var boardHintEl = document.getElementById('repertoire-board-hint');
  var boardStatusEl = document.getElementById('repertoire-board-status');
  var boardHandle = boardMountEl ? mountSyncBoard(boardMountEl, { orientation: orientationFor(readBandState().color) }) : null;

  function orientationFor(color) {
    return color === 'black' ? COLOR.black : COLOR.white;
  }

  function resetBoard(color) {
    if (boardHandle) {
      boardHandle.setOrientation(orientationFor(color));
      boardHandle.setFen(FEN.start, false);
    }
    if (boardHintEl) {
      boardHintEl.hidden = false;
      boardHintEl.textContent = 'Pick a move to see the position.';
    }
    if (boardStatusEl) boardStatusEl.textContent = '';
  }

  function clearRowSelection(treeEl) {
    var rows = treeEl.querySelectorAll('.rep-node-row');
    for (var i = 0; i < rows.length; i += 1) {
      rows[i].setAttribute('aria-pressed', 'false');
      rows[i].classList.remove('rep-node-row--ancestor');
    }
  }

  // Walks from `rowEl`'s own <li> up to the tree root, returning every
  // ancestor node's row button in LEAF-TO-ROOT order. Relies on each row
  // button being its <li>'s first child in document order (renderRepertoireNode
  // always emits the button before that node's own <ul> of children), so a
  // plain (unscoped) querySelector on the ancestor <li> finds that <li>'s
  // OWN row first -- never a deeper-nested one -- with no extra bookkeeping.
  function ancestorRows(rowEl) {
    var rows = [];
    var li = rowEl.closest('li');
    while (li) {
      var ul = li.parentElement;
      var parentLi = ul && ul.parentElement && ul.parentElement.tagName === 'LI' ? ul.parentElement : null;
      if (!parentLi) break;
      var parentRow = parentLi.querySelector('.rep-node-row');
      if (parentRow) rows.push(parentRow);
      li = parentLi;
    }
    return rows;
  }

  function moveLabel(rowEl) {
    var ply = Number(rowEl.getAttribute('data-ply'));
    var san = rowEl.getAttribute('data-san') || '';
    var mover = ply % 2 === 0 ? 'white' : 'black';
    var moveNumber = Math.floor(ply / 2) + 1;
    return { text: mover === 'white' ? moveNumber + '. ' + san : san, ply: ply };
  }

  // "After 1. e4 e5 2. Nf3 - white to move" -- the navigation announcement
  // (spec 2.1.3). This is distinct from, and doesn't duplicate, cm-chessboard's
  // own Accessibility extension live region (that one describes the BOARD;
  // this one describes which LINE is now selected).
  function announceSelection(rowEl) {
    if (!boardStatusEl) return;
    var line = ancestorRows(rowEl).reverse().concat([rowEl]).map(moveLabel);
    var text = line.map(function (m) { return m.text; }).join(' ');
    var lastPly = line[line.length - 1].ply;
    var nextMover = (lastPly + 1) % 2 === 0 ? 'white' : 'black';
    boardStatusEl.textContent = 'After ' + text + ' - ' + nextMover + ' to move';
  }

  function selectRow(treeEl, rowEl) {
    var uciPath = rowEl.getAttribute('data-uci-path') || '';
    if (!UCI_PATH_RE.test(uciPath)) return;
    var board;
    try {
      board = applyUciMoves(START_BOARD, uciPath.split(' '));
    } catch (err) {
      return; // leaves the board on its previous position, per security-standards.md
    }
    clearRowSelection(treeEl);
    rowEl.setAttribute('aria-pressed', 'true');
    ancestorRows(rowEl).forEach(function (ancestor) { ancestor.classList.add('rep-node-row--ancestor'); });
    if (boardHandle) boardHandle.setFen(fenFromBoard(board), true);
    if (boardHintEl) boardHintEl.hidden = true;
    announceSelection(rowEl);
  }

  // Delegated on #repertoire-tree itself (a stable element across
  // band/color changes) rather than on individual row buttons, so this
  // keeps working after paint() below replaces the tree's innerHTML --
  // guarded so re-wiring the same element twice (e.g. a second paint())
  // never double-registers the listener.
  function wireTreeSelection(treeEl) {
    if (!treeEl || treeEl.dataset.syncBoardWired === 'true') return;
    treeEl.dataset.syncBoardWired = 'true';
    treeEl.addEventListener('click', function (event) {
      var row = event.target && typeof event.target.closest === 'function' ? event.target.closest('.rep-node-row') : null;
      if (row && treeEl.contains(row)) selectRow(treeEl, row);
    });
  }
  // ------------------------------------------------------------------------

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
      wireTreeSelection(treeEl);
    }

    // A band/color change always resets the board -- the previously
    // selected line no longer exists in the freshly-painted tree (a new
    // set of <button> rows, every one starting at aria-pressed="false").
    resetBoard(state.color);

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
    // nothing in the fragment or localStorage) does zero DOM churn. The
    // board panel still needs wiring either way -- it is new functionality,
    // not gated by whether a repaint happened (boardHandle above was
    // already mounted at this same initialState's orientation, so the
    // default-state path needs no reset(), only the click delegation).
    var initialTreeEl = $('#repertoire-tree');
    if (isDefaultState(initialState)) {
      updatePickerActive(initialState);
      wireTreeSelection(initialTreeEl);
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
