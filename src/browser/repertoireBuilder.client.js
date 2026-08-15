'use strict';

/**
 * Repertoire Builder v1 (spec section 3.1) -- esbuild entry point for
 * repertoire-builder.html's bundle (src/buildStatic.js's
 * buildRepertoireBuilderBundle() call, unchanged by this task -- see
 * src/renderRepertoireBuilder.js's header comment).
 *
 * Everything here runs entirely in the visitor's browser: repertoires are
 * built, saved (localStorage key rb.repertoires.v1, spec 3.1 PERSISTENCE),
 * and exported with zero data ever sent to any server. Band data
 * (src/browser/bandData.client.js) is a static, same-origin fetch of this
 * site's own committed shard files -- also never a third-party call.
 *
 * State model: `current` is always either `null` (no repertoire open) or a
 * direct reference into `repertoires` (the parsed localStorage array) --
 * mutating `current` via src/repertoireModel.js's ops therefore mutates the
 * array in place with no separate write-back step; persist() just
 * re-serializes the whole array.
 *
 * `path` is the current board position as an array of NORMALIZED
 * (standard chess.js long-algebraic, never Explorer-form) UCI moves from
 * the repertoire root -- the single source of truth this module keeps for
 * "where the board currently is", mirrored into the mounted board's own
 * `chess` instance, the move-path breadcrumb, and every bandData.lookup()
 * call.
 */

const {
  createRepertoire,
  nodeAtPath,
  isOwnPly,
  addMove,
  deleteNode,
  setName,
  countNodes,
  size,
  toPgn,
  parseRepertoireList,
  sanitizeFilename,
  STORAGE_KEY,
  MAX_REPERTOIRES,
  MAX_TOTAL_BYTES,
} = require('../repertoireModel');
const { lookup: lookupBandData } = require('./bandData.client');
const { readBandState } = require('./bandState.client');
const { mountFreeBoard, COLOR } = require('../boardWidget');
// buildPackCore.js, not buildPack.js -- see src/repertoireModel.js's own
// import comment / src/buildPackCore.js's header for why.
const { applyExplorerUci } = require('../buildPackCore');
const { formatInterval } = require('../stats');
const { escapeHtml, formatPct } = require('../render');
// eslint-disable-next-line global-require -- chess.js already a hard
// dependency of boardWidget.js/bandData.client.js; used here only for
// scratch replays (normalizing a candidate move, deriving SAN for the
// tree), never for anything visitor-supplied without going through
// applyExplorerUci first.
const { Chess } = require('chess.js');

(function () {
  const rootEl = document.getElementById('rb-workspace');
  if (!rootEl) return; // markup not present (shouldn't happen on this page) -- nothing to wire up

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let repertoires = [];
  let current = null; // reference into `repertoires`, or null
  let path = []; // normalized UCI moves from the root, current board position
  let boardHandle = null;
  let orientation = COLOR.white;
  let lastLookup = null; // most recent 'in'-coverage bandData result, for the out-of-book panel
  let undoSnapshot = null; // { repertoireJson, path } captured before the last mutating action
  let saveDebounce = null;
  let createBand = readDefaultBand();
  let activeMobilePanel = 'band';

  function readDefaultBand() {
    // Read-only use of the site-wide band state (spec: bandState.client.js
    // is "THE WS-1.4 INTEGRATION POINT" and must not gain a second source
    // of truth) -- purely a friendly default for the "create repertoire"
    // band picker, never written back to from here.
    try {
      const state = readBandState();
      const offered = document.querySelectorAll('.rb-band-choice[data-band]');
      for (const btn of offered) {
        if (btn.getAttribute('data-band') === state.band) return state.band;
      }
    } catch (err) {
      // fall through to the server-rendered default below
    }
    return null; // keep whatever the server-rendered aria-pressed default already shows
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const libraryEl = document.getElementById('rb-library');
  const createPanel = document.getElementById('rb-create-panel');
  const createForm = document.getElementById('rb-create-form');
  const nameInput = document.getElementById('rb-name-input');
  const bandChoiceGroup = document.getElementById('rb-band-choice-group');
  const savedPanel = document.getElementById('rb-saved-panel');
  const savedItemsEl = document.getElementById('rb-saved-items');
  const newBtn = document.getElementById('rb-new-btn');

  const workspaceEl = document.getElementById('rb-workspace');
  const currentNameEl = document.getElementById('rb-current-name');
  const savedNoteEl = document.getElementById('rb-saved-note');
  const exportBtn = document.getElementById('rb-export-btn');
  const renameBtn = document.getElementById('rb-rename-btn');
  const closeBtn = document.getElementById('rb-close-btn');
  const segmentedEl = document.querySelector('.rb-segmented');
  const tabBand = document.getElementById('rb-tab-band');
  const tabTree = document.getElementById('rb-tab-tree');
  const bandPanel = document.getElementById('rb-band-panel');
  const treePanel = document.getElementById('rb-tree-panel');
  const boardEl = document.getElementById('rb-board');
  const movePathEl = document.getElementById('rb-move-path');
  const flipBtn = document.getElementById('rb-flip-btn');
  const resetBtn = document.getElementById('rb-reset-btn');
  const undoBtn = document.getElementById('rb-undo-btn');
  const bandTableWrapper = document.getElementById('rb-band-table-wrapper');
  const treeRootEl = document.getElementById('rb-tree-root');
  const nodeCountEl = document.getElementById('rb-node-count');

  // ---------------------------------------------------------------------
  // Persistence (spec 3.1 PERSISTENCE)
  // ---------------------------------------------------------------------

  function loadRepertoires() {
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      repertoires = [];
      return;
    }
    if (!raw) {
      repertoires = [];
      return;
    }
    const result = parseRepertoireList(raw);
    if (result.ok) {
      repertoires = result.list;
      return;
    }
    // Never a silent wipe (spec 3.1): offer a real recovery path -- export
    // whatever bytes are still there, or start fresh.
    repertoires = [];
    showRecoveryBanner(raw, result.error);
  }

  function showRecoveryBanner(raw, errorMessage) {
    const banner = document.createElement('div');
    banner.className = 'rb-out-of-book';
    banner.setAttribute('role', 'alert');
    const p = document.createElement('p');
    p.textContent = `Your saved repertoires could not be read (${errorMessage}). You can export what is still there, or start fresh.`;
    banner.appendChild(p);
    const exportRawBtn = document.createElement('button');
    exportRawBtn.type = 'button';
    exportRawBtn.className = 'btn-secondary';
    exportRawBtn.textContent = 'Export raw data';
    exportRawBtn.addEventListener('click', () => downloadText('repertoire-builder-recovery.json', raw));
    const startFreshBtn = document.createElement('button');
    startFreshBtn.type = 'button';
    startFreshBtn.className = 'btn-secondary';
    startFreshBtn.textContent = 'Start fresh (clears unreadable data)';
    startFreshBtn.addEventListener('click', () => {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      banner.remove();
    });
    banner.appendChild(exportRawBtn);
    banner.appendChild(startFreshBtn);
    libraryEl.insertBefore(banner, libraryEl.firstChild);
  }

  function setSavedNote(state, text) {
    savedNoteEl.textContent = text;
    savedNoteEl.setAttribute('data-state', state);
  }

  function persistNow() {
    const payload = JSON.stringify(repertoires);
    const bytes = size(repertoires);
    if (bytes > MAX_TOTAL_BYTES) {
      setSavedNote('error', 'Could not save: your saved repertoires are too large. Delete one, or export and remove it.');
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, payload);
      setSavedNote('saved', `Saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setSavedNote('error', 'Could not save (your browser storage may be full or disabled).');
    }
  }

  // Visible "Saving..." within 100ms of the action (design-standards.md's
  // response-time rule), actual write debounced at 500ms (spec 3.1).
  function schedulePersist() {
    setSavedNote('saving', 'Saving…');
    if (saveDebounce) window.clearTimeout(saveDebounce);
    saveDebounce = window.setTimeout(persistNow, 500);
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------
  // Undo (single level, spec 3.1: "with an undo")
  // ---------------------------------------------------------------------

  function snapshotForUndo() {
    if (!current) return;
    undoSnapshot = { repertoireJson: JSON.stringify(current), path: path.slice() };
    undoBtn.disabled = false;
  }

  function performUndo() {
    if (!undoSnapshot || !current) return;
    const restored = JSON.parse(undoSnapshot.repertoireJson);
    Object.assign(current, restored);
    path = undoSnapshot.path;
    undoSnapshot = null;
    undoBtn.disabled = true;
    rebuildBoardAtPath();
    renderMovePath();
    renderTree();
    refreshBandTable();
    schedulePersist();
  }

  // ---------------------------------------------------------------------
  // Chess replay helpers
  // ---------------------------------------------------------------------

  /** A fresh Chess() replayed to `path` (normalized standard UCI, safe via applyExplorerUci). */
  function chessAtPath(p) {
    const chess = new Chess();
    for (const uci of p) {
      applyExplorerUci(chess, uci);
    }
    return chess;
  }

  /** Normalizes an Explorer-form (or already-standard) uci at the CURRENT path into this project's standard chess.js form, and returns the move's SAN too. */
  function normalizeUciAtCurrentPath(uci) {
    const chess = chessAtPath(path);
    const result = applyExplorerUci(chess, uci);
    return { uci: `${result.from}${result.to}${result.promotion || ''}`, san: result.san, fen: chess.fen() };
  }

  // ---------------------------------------------------------------------
  // Board mount / move commit
  // ---------------------------------------------------------------------

  function rebuildBoardAtPath() {
    const chess = chessAtPath(path);
    if (boardHandle) {
      boardHandle.reset(chess.fen());
    } else {
      boardHandle = mountFreeBoard(boardEl, { fen: chess.fen(), orientation, onMove: onBoardMove });
    }
    undoBtn.disabled = !undoSnapshot;
  }

  function onBoardMove(moveInfo) {
    // mountFreeBoard's onMove gives {san, fen, isGameOver}, not uci --
    // boardHandle.chess is the SAME chess.js instance that just made the
    // move (see boardWidget.js's mountFreeBoard), so its own history is the
    // correct, cheapest source for the move actually played.
    const history = boardHandle.chess.history({ verbose: true });
    const last = history[history.length - 1];
    if (!last) return;
    const uci = `${last.from}${last.to}${last.promotion || ''}`;
    commitMove(uci, { alreadyOnBoard: true });
  }

  /**
   * @param {string} uci already normalized, standard chess.js form.
   * @param {{alreadyOnBoard?: boolean}} [opts] true when the board's own
   *   cm-chessboard visual already reflects this move (a real drag/click on
   *   the board itself) -- false (the default, band-row clicks) means this
   *   function must also drive the board's visual via reset().
   */
  function commitMove(uci, { alreadyOnBoard = false } = {}) {
    if (!current) return;
    snapshotForUndo();
    lastLookup = null; // invalidated by any move; refreshBandTable() will repopulate the 'last covered' fallback naturally as new lookups succeed
    addMove(current, path, uci);
    path = [...path, uci];
    if (!alreadyOnBoard) {
      const chess = chessAtPath(path);
      boardHandle.reset(chess.fen());
    }
    renderMovePath();
    renderTree();
    refreshBandTable();
    schedulePersist();
  }

  function jumpToPath(newPath) {
    path = newPath;
    rebuildBoardAtPath();
    renderMovePath();
    renderTree();
    refreshBandTable();
  }

  // ---------------------------------------------------------------------
  // Move-path breadcrumb
  // ---------------------------------------------------------------------

  function renderMovePath() {
    const ol = document.createElement('ol');
    const startLi = document.createElement('li');
    if (path.length === 0) {
      startLi.setAttribute('aria-current', 'page');
      startLi.textContent = 'Starting position';
      ol.appendChild(startLi);
    } else {
      const startBtn = document.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'rb-crumb-link';
      startBtn.textContent = 'Start';
      startBtn.addEventListener('click', () => jumpToPath([]));
      startLi.appendChild(startBtn);
      ol.appendChild(startLi);

      const chess = new Chess();
      path.forEach((uci, i) => {
        const result = applyExplorerUci(chess, uci);
        const sep = document.createElement('li');
        sep.className = 'breadcrumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '/';
        ol.appendChild(sep);
        const li = document.createElement('li');
        const isLast = i === path.length - 1;
        if (isLast) {
          li.setAttribute('aria-current', 'page');
          li.textContent = result.san;
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'rb-crumb-link';
          btn.textContent = result.san;
          const targetPath = path.slice(0, i + 1);
          btn.addEventListener('click', () => jumpToPath(targetPath));
          li.appendChild(btn);
        }
        ol.appendChild(li);
      });
    }
    movePathEl.replaceChildren(ol);
  }

  // ---------------------------------------------------------------------
  // Tree rendering (spec 3.1: full-width, arrow-key navigation, Enter jumps board, delete-with-confirm)
  // ---------------------------------------------------------------------

  function renderTree() {
    if (!current) {
      treeRootEl.replaceChildren();
      nodeCountEl.textContent = '';
      return;
    }
    nodeCountEl.textContent = `${countNodes(current.root)} move${countNodes(current.root) === 1 ? '' : 's'} saved`;
    const chess = new Chess();
    const rootUl = buildTreeLevel(current.root, [], chess);
    treeRootEl.replaceChildren(...rootUl.childNodes);
  }

  function buildTreeLevel(node, nodePath, chess) {
    const ul = document.createElement('ul');
    ul.className = 'rb-tree';
    ul.setAttribute('role', 'group');
    for (const child of node.children) {
      const result = applyExplorerUci(chess, child.uci);
      const childPath = [...nodePath, child.uci];
      const li = document.createElement('li');
      li.setAttribute('role', 'none');

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rb-tree-node-row';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('tabindex', '-1');
      row.dataset.path = JSON.stringify(childPath);
      const isCurrent = pathsEqual(childPath, path);
      if (isCurrent) row.setAttribute('aria-current', 'true');
      const label = document.createElement('span');
      label.textContent = result.san;
      row.appendChild(label);

      const delBtn = document.createElement('span');
      delBtn.className = 'rb-tree-delete';
      delBtn.setAttribute('role', 'button');
      delBtn.setAttribute('tabindex', '-1');
      delBtn.setAttribute('aria-label', `Delete ${result.san} and everything after it`);
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmAndDelete(childPath, result.san);
      });

      row.addEventListener('click', () => jumpToPath(childPath));
      row.addEventListener('keydown', (e) => onTreeKeydown(e, row));
      li.appendChild(row);
      li.appendChild(delBtn);

      if (child.children.length > 0) {
        li.appendChild(buildTreeLevel(child, childPath, chess));
      }
      ul.appendChild(li);
      chess.undo();
    }
    return ul;
  }

  function pathsEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function confirmAndDelete(nodePath, san) {
    const node = nodeAtPath(current.root, nodePath);
    if (!node) return;
    const descendants = countNodes(node);
    const suffix = descendants > 0 ? ` and its ${descendants} following move${descendants === 1 ? '' : 's'}` : '';
    // eslint-disable-next-line no-alert -- native confirm is the deliberate choice for this task's budget (spec: "behind a confirm that names the count"); no custom modal component built here.
    if (!window.confirm(`Delete ${san}${suffix}?`)) return;
    snapshotForUndo();
    deleteNode(current, nodePath);
    if (path.length >= nodePath.length && pathsEqual(path.slice(0, nodePath.length), nodePath)) {
      // the board was somewhere inside the deleted subtree -- back up to the deleted node's parent
      jumpToPath(nodePath.slice(0, -1));
    } else {
      renderTree();
    }
    schedulePersist();
  }

  // Roving-tabindex arrow-key navigation (WAI-ARIA treeview pattern):
  // Up/Down move focus across the flattened, currently-visible row order;
  // Right moves into the first child; Left moves to the parent; Enter/Space
  // jumps the board to that row's position.
  function onTreeKeydown(e, row) {
    const rows = $$('.rb-tree-node-row', treeRootEl);
    const idx = rows.indexOf(row);
    if (idx === -1) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(rows[Math.min(idx + 1, rows.length - 1)]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(rows[Math.max(idx - 1, 0)]);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const li = row.closest('li');
      const childRow = li && $('ul .rb-tree-node-row', li);
      if (childRow) focusRow(childRow);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const parentUl = row.closest('li').parentElement;
      const parentRow = parentUl && parentUl.closest('li') && $(':scope > .rb-tree-node-row', parentUl.closest('li'));
      if (parentRow) focusRow(parentRow);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      jumpToPath(JSON.parse(row.dataset.path));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Keyboard-reachable equivalent of the row's own delete (x) control,
      // which is deliberately tabindex="-1" (a roving-tabindex treeview
      // exposes one stop per row, not two) -- without this, a keyboard-only
      // visitor could navigate the tree but never delete a node from it.
      e.preventDefault();
      const label = row.querySelector('span') ? row.querySelector('span').textContent : '';
      confirmAndDelete(JSON.parse(row.dataset.path), label);
    }
  }

  function focusRow(row) {
    if (!row) return;
    $$('.rb-tree-node-row', treeRootEl).forEach((r) => r.setAttribute('tabindex', '-1'));
    row.setAttribute('tabindex', '0');
    row.focus();
  }

  // ---------------------------------------------------------------------
  // Band reply table (spec 3.1: THE live band table -- the whole point)
  // ---------------------------------------------------------------------

  function inRepertoireUci() {
    const node = nodeAtPath(current.root, path);
    if (!node) return new Set();
    return new Set(node.children.map((c) => c.uci));
  }

  async function refreshBandTable() {
    if (!current) return;
    const requestPath = path;
    bandTableWrapper.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'rb-empty-note';
    loading.textContent = 'Loading band data…';
    bandTableWrapper.appendChild(loading);

    const result = await lookupBandData({ play: path, band: current.band, pool: current.pool });
    if (requestPath !== path) return; // a newer move superseded this in-flight lookup

    if (result.coverage === 'unavailable') {
      bandTableWrapper.replaceChildren();
      const p = document.createElement('p');
      p.className = 'rb-empty-note';
      p.textContent = 'Band data could not be loaded right now (are you offline?). You can keep building your repertoire; the table will retry on your next move.';
      bandTableWrapper.appendChild(p);
      return;
    }

    if (result.coverage === 'out-of-book') {
      renderOutOfBook();
      return;
    }

    lastLookup = result;
    renderBandRows(result);
  }

  function renderOutOfBook() {
    bandTableWrapper.replaceChildren();
    const div = document.createElement('div');
    div.className = 'rb-out-of-book';
    const h4 = document.createElement('h4');
    h4.textContent = 'Past the band data';
    div.appendChild(h4);
    const p = document.createElement('p');
    const bandLabel = current.band;
    p.textContent = lastLookup
      ? `Fewer than the tracked minimum games at ${bandLabel} reach this position. At the position just before it, ${lastLookup.games.toLocaleString()} games were tracked (${lastLookup.retrieved || 'date unknown'}).`
      : `Fewer than the tracked minimum games at ${bandLabel} reach this position.`;
    div.appendChild(p);
    const p2 = document.createElement('p');
    p2.textContent = 'This is fine — keep building your repertoire from your own knowledge. You can still play moves on the board.';
    div.appendChild(p2);
    bandTableWrapper.appendChild(div);
  }

  function renderBandRows(result) {
    const yours = inRepertoireUci();
    const table = document.createElement('table');
    table.className = 'rb-band-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Move</th><th class="num">Games</th><th class="num">Played</th><th class="num">Score</th><th></th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    const sorted = result.moves.slice().sort((a, b) => b.games - a.games);
    for (const m of sorted) {
      const normalized = normalizeUciAtCurrentPath(m.uci);
      const isYours = yours.has(normalized.uci);
      const tr = document.createElement('tr');
      if (isYours) tr.className = 'rb-band-row--yours';

      const sanTd = document.createElement('td');
      sanTd.textContent = m.san;
      tr.appendChild(sanTd);

      const gamesTd = document.createElement('td');
      gamesTd.className = 'num';
      gamesTd.textContent = m.games.toLocaleString();
      tr.appendChild(gamesTd);

      const pctTd = document.createElement('td');
      pctTd.className = 'num';
      pctTd.textContent = m.playedPct != null ? `${formatPct(m.playedPct * 100)}%` : '–';
      tr.appendChild(pctTd);

      const scoreTd = document.createElement('td');
      scoreTd.className = 'num';
      const halfWidth = m.scoreHi != null && m.scoreLo != null ? (m.scoreHi - m.scoreLo) / 2 : null;
      scoreTd.textContent = `${formatPct(m.score * 100)}%`;
      if (halfWidth != null) {
        const ci = document.createElement('span');
        ci.className = 'ci';
        ci.textContent = ` ${formatInterval(halfWidth)}`;
        scoreTd.appendChild(ci);
      }
      tr.appendChild(scoreTd);

      const actionTd = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rb-play-btn';
      btn.setAttribute('aria-pressed', isYours ? 'true' : 'false');
      btn.textContent = isYours ? 'In your repertoire' : 'Play this move';
      btn.addEventListener('click', () => commitMove(normalized.uci));
      actionTd.appendChild(btn);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const provenance = document.createElement('p');
    provenance.className = 'rb-provenance';
    provenance.textContent = `${result.games.toLocaleString()} games at ${current.band} (${current.pool}), retrieved ${result.retrieved || 'unknown date'}.`;

    bandTableWrapper.replaceChildren(table, provenance);
  }

  // ---------------------------------------------------------------------
  // Library (create / open / delete repertoires)
  // ---------------------------------------------------------------------

  function renderLibrary() {
    if (repertoires.length === 0) {
      savedPanel.hidden = true;
      createPanel.hidden = false;
      return;
    }
    createPanel.hidden = true;
    savedPanel.hidden = false;
    savedItemsEl.replaceChildren();
    for (const rep of repertoires) {
      const li = document.createElement('li');
      li.className = 'rb-saved-item';
      const meta = document.createElement('div');
      const nameEl = document.createElement('strong');
      nameEl.textContent = rep.name;
      const metaLine = document.createElement('div');
      metaLine.className = 'rb-saved-item-meta';
      metaLine.textContent = `${rep.side === 'white' ? 'White' : 'Black'} · ${rep.band} · ${countNodes(rep.root)} moves`;
      meta.appendChild(nameEl);
      meta.appendChild(metaLine);

      const actions = document.createElement('div');
      actions.className = 'rb-saved-item-actions';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn-primary';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => openRepertoire(rep.id));
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-secondary';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => deleteRepertoire(rep.id, rep.name));
      actions.appendChild(openBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(meta);
      li.appendChild(actions);
      savedItemsEl.appendChild(li);
    }
  }

  function deleteRepertoire(id, name) {
    // eslint-disable-next-line no-alert -- native confirm, same deliberate choice as confirmAndDelete() above.
    if (!window.confirm(`Delete the whole repertoire "${name}"? This cannot be undone.`)) return;
    repertoires = repertoires.filter((r) => r.id !== id);
    persistNow();
    renderLibrary();
  }

  function openRepertoire(id) {
    const rep = repertoires.find((r) => r.id === id);
    if (!rep) return;
    current = rep;
    path = [];
    orientation = current.side === 'black' ? COLOR.black : COLOR.white;
    undoSnapshot = null;
    undoBtn.disabled = true;
    libraryEl.hidden = true;
    workspaceEl.hidden = false;
    currentNameEl.textContent = current.name;
    setSavedNote('idle', '');
    if (boardHandle) {
      boardHandle.destroy();
      boardHandle = null;
    }
    rebuildBoardAtPath();
    renderMovePath();
    renderTree();
    refreshBandTable();
  }

  function closeWorkspace() {
    if (boardHandle) {
      boardHandle.destroy();
      boardHandle = null;
    }
    current = null;
    path = [];
    workspaceEl.hidden = true;
    libraryEl.hidden = false;
    renderLibrary();
  }

  function handleCreateSubmit(e) {
    e.preventDefault();
    if (repertoires.length >= MAX_REPERTOIRES) {
      window.alert(`You already have ${MAX_REPERTOIRES} saved repertoires, the most this tool keeps. Delete one first.`); // eslint-disable-line no-alert -- native alert, same deliberate minimal-UI choice as the confirm() calls above.
      return;
    }
    const name = nameInput.value;
    const side = $('input[name="rb-side"]:checked').value;
    const bandBtn = $('.rb-band-choice[aria-pressed="true"]', bandChoiceGroup);
    const band = bandBtn ? bandBtn.getAttribute('data-band') : '1600-1800';
    const rep = createRepertoire({ name, side, band });
    repertoires.push(rep);
    nameInput.value = '';
    persistNow();
    openRepertoire(rep.id);
  }

  // ---------------------------------------------------------------------
  // Toolbar: flip, reset, undo, export, rename, close, mobile segmented tabs
  // ---------------------------------------------------------------------

  function setActiveMobilePanel(panel) {
    activeMobilePanel = panel;
    bandPanel.classList.toggle('rb-panel-hidden', panel !== 'band');
    treePanel.classList.toggle('rb-panel-hidden', panel !== 'tree');
    tabBand.setAttribute('aria-selected', String(panel === 'band'));
    tabTree.setAttribute('aria-selected', String(panel === 'tree'));
  }

  segmentedEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-panel]');
    if (!btn) return;
    setActiveMobilePanel(btn.getAttribute('data-panel'));
  });

  flipBtn.addEventListener('click', () => {
    orientation = orientation === COLOR.white ? COLOR.black : COLOR.white;
    if (boardHandle) boardHandle.board.setOrientation(orientation);
  });

  resetBtn.addEventListener('click', () => jumpToPath([]));
  undoBtn.addEventListener('click', performUndo);

  exportBtn.addEventListener('click', () => {
    if (!current) return;
    const pgn = toPgn(current);
    downloadText(sanitizeFilename(current.name), pgn);
  });

  renameBtn.addEventListener('click', () => {
    if (!current) return;
    // eslint-disable-next-line no-alert -- native prompt, same deliberate minimal-UI choice as elsewhere in this file.
    const next = window.prompt('Rename this repertoire', current.name);
    if (next == null) return;
    setName(current, next);
    currentNameEl.textContent = current.name;
    persistNow();
    renderLibrary();
  });

  closeBtn.addEventListener('click', closeWorkspace);
  newBtn.addEventListener('click', () => {
    savedPanel.hidden = true;
    createPanel.hidden = false;
  });

  bandChoiceGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.rb-band-choice');
    if (!btn) return;
    $$('.rb-band-choice', bandChoiceGroup).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
  });

  createForm.addEventListener('submit', handleCreateSubmit);

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    if (createBand) {
      $$('.rb-band-choice', bandChoiceGroup).forEach((b) => {
        b.setAttribute('aria-pressed', b.getAttribute('data-band') === createBand ? 'true' : 'false');
      });
    }
    loadRepertoires();
    renderLibrary();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
