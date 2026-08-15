'use strict';

/**
 * Pure data model for a user-built chess opening repertoire (spec section
 * 3.1, "MODEL"). No DOM, no localStorage I/O, no fetch -- every persistence
 * *decision* (when to save, debouncing, quota handling, the visible "Saved"
 * state) is src/browser/repertoireBuilder.client.js's job; this module only
 * knows how to build, mutate, measure, validate and serialize the tree, so
 * every one of those operations is independently testable with no DOM.
 *
 * Node shape (spec 3.1): `{ uci: string|null, children: Node[], note?: string }`.
 * `uci` is ALWAYS this project's normalized, standard chess.js long-algebraic
 * form (e.g. "e1g1" for kingside castling) -- NEVER the Lichess Opening
 * Explorer's king-captures-own-rook encoding (see src/buildPack.js's
 * applyExplorerUci doc comment for that quirk). Every caller adding a move
 * sourced from band-table data (which arrives in Explorer form) must
 * normalize it first -- src/browser/repertoireBuilder.client.js's
 * addMoveFromBandRow() does this by replaying the candidate through
 * applyExplorerUci and storing the move RESULT's own from/to/promotion,
 * never the raw shard uci string. Storing one consistent encoding
 * everywhere is what keeps addMove/toPgn/nodeAtPath from needing to special-
 * case castling at every call site.
 *
 * The tree's root node represents "no move played yet" (`uci: null`); its
 * children are the actual ply-0 moves. A repertoire whose `side` is
 * 'black' can legitimately have MULTIPLE root children (several first
 * moves White might play that the user is preparing against) -- see
 * toPgn()'s doc comment for how that's exported.
 *
 * Repertoire shape: `{ v:1, id, name, side:'white'|'black', band, pool,
 *   created, updated, root: Node }`.
 */

const { Chess } = require('chess.js');
// buildPackCore.js, not buildPack.js -- the latter requires ./explorerSource
// (fs/path) at module load, which breaks any browser bundle needing these
// two pure helpers (see buildPackCore.js's own header comment). This
// module is required by src/browser/repertoireBuilder.client.js, so it
// must stay on the browser-safe import path.
const { applyExplorerUci, pgnFromTree } = require('./buildPackCore');
const { parsePgnSafe } = require('./pgnWrapper');

const FORMAT_VERSION = 1;
const VALID_SIDES = new Set(['white', 'black']);

// The four rating bands the shard pipeline actually crawls (spec 2.1 /
// spec 3.4's scope boundary -- the below-1400 band is not buildable in
// WS-1). Kept as a local literal, matching src/leakModel.js's VALID_BANDS
// exactly, rather than importing that module -- this keeps repertoireModel.js
// a standalone, dependency-light module with no risk of pulling in anything
// leak-report-shaped. test/repertoireModel.test.js asserts these stay
// identical to leakModel.js's own set.
const VALID_BANDS = new Set(['1400-1600', '1600-1800', '1800-2000', '2000+']);
const VALID_POOLS = new Set(['bullet', 'blitz', 'rapid_classical']);

const MAX_REPERTOIRES = 10; // spec 3.1 PERSISTENCE
const MAX_TOTAL_BYTES = 1024 * 1024; // 1 MB, spec 3.1 PERSISTENCE
const MAX_NAME_LENGTH = 80;
const MAX_NODE_CHILDREN = 40; // sanity cap per node, well above any real repertoire's branching factor
const MAX_TREE_DEPTH = 60; // guards a pathological/adversarial or corrupt document, same spirit as pgnWrapper.js's MAX_PAREN_DEPTH

const STORAGE_KEY = 'rb.repertoires.v1';

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return Buffer.byteLength(str, 'utf8'); // Node test environment fallback
}

/**
 * Not a security-sensitive id (never used as a capability or secret --
 * only a localStorage array key and a DOM data attribute), so a timestamp
 * plus a short random suffix is enough to avoid same-millisecond
 * collisions from two rapid "create" clicks.
 */
function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `rep_${Date.now().toString(36)}${rand}`;
}

function sanitizeName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const base = trimmed.length > 0 ? trimmed : 'Untitled repertoire';
  return base.slice(0, MAX_NAME_LENGTH);
}

function emptyNode() {
  return { uci: null, children: [] };
}

/**
 * @param {{name?:string, side:'white'|'black', band:string, pool?:string}} opts
 * @returns {object} a new Repertoire, empty (root has no children yet).
 */
function createRepertoire({ name, side, band, pool = 'blitz' } = {}) {
  if (!VALID_SIDES.has(side)) throw new Error(`createRepertoire: side must be "white" or "black", got ${JSON.stringify(side)}`);
  if (!VALID_BANDS.has(band)) throw new Error(`createRepertoire: unrecognized band ${JSON.stringify(band)}`);
  if (!VALID_POOLS.has(pool)) throw new Error(`createRepertoire: unrecognized pool ${JSON.stringify(pool)}`);
  const now = new Date().toISOString();
  return {
    v: FORMAT_VERSION,
    id: newId(),
    name: sanitizeName(name),
    side,
    band,
    pool,
    created: now,
    updated: now,
    root: emptyNode(),
  };
}

/**
 * @param {object} root
 * @param {string[]} [path] UCI moves from the root.
 * @returns {object|null} the Node at `path`, or null if it doesn't exist.
 */
function nodeAtPath(root, path = []) {
  let node = root;
  for (const uci of path) {
    if (!node || !Array.isArray(node.children)) return null;
    const next = node.children.find((c) => c.uci === uci);
    if (!next) return null;
    node = next;
  }
  return node;
}

/**
 * True when the move about to be played at `path` (i.e. the move that
 * would become the child at ply `path.length`) is the repertoire owner's
 * OWN move -- ply parity (even ply = White to move) matched against the
 * repertoire's `side`. Spec 3.1: "on your turn the chosen move becomes
 * YOUR move ... on the opponent's turn the chosen move becomes a BRANCH".
 */
function isOwnPly(side, path) {
  const plyIsWhite = path.length % 2 === 0;
  return plyIsWhite === (side === 'white');
}

/**
 * Adds `uci` as a child of the node at `path`.
 *
 * On the repertoire owner's own ply this REPLACES any existing child (spec
 * 3.1: "exactly one per position, replacing any previous choice, with an
 * undo") -- the caller gets the replaced children array back
 * (`replacedChildren`) so it can implement undo via restoreChildren() below.
 * On the opponent's ply this ADDS a sibling branch (multiple allowed); if a
 * child with the same `uci` already exists, this is a no-op that returns
 * the existing node unchanged (clicking an already-prepared branch again
 * navigates to it rather than duplicating it).
 *
 * @param {object} repertoire mutated in place; `updated` bumped on any real change.
 * @param {string[]} path
 * @param {string} uci must already be normalized, standard chess.js UCI.
 * @returns {{node: object, replacedChildren: object[]|null, changed: boolean}}
 */
function addMove(repertoire, path, uci) {
  if (!UCI_RE.test(uci)) throw new Error(`addMove: "${uci}" is not a valid UCI move`);
  const parent = nodeAtPath(repertoire.root, path);
  if (!parent) throw new Error('addMove: path does not resolve to a node in this repertoire');

  if (isOwnPly(repertoire.side, path)) {
    if (parent.children.length === 1 && parent.children[0].uci === uci) {
      return { node: parent.children[0], replacedChildren: null, changed: false };
    }
    const replacedChildren = parent.children;
    const node = { uci, children: [] };
    parent.children = [node];
    repertoire.updated = new Date().toISOString();
    return { node, replacedChildren, changed: true };
  }

  const existing = parent.children.find((c) => c.uci === uci);
  if (existing) return { node: existing, replacedChildren: null, changed: false };
  const node = { uci, children: [] };
  parent.children.push(node);
  repertoire.updated = new Date().toISOString();
  return { node, replacedChildren: null, changed: true };
}

/**
 * Undo counterpart to addMove()'s `replacedChildren` -- restores the
 * children array at `path` to a prior snapshot.
 */
function restoreChildren(repertoire, path, children) {
  const parent = nodeAtPath(repertoire.root, path);
  if (!parent) throw new Error('restoreChildren: path does not resolve to a node in this repertoire');
  parent.children = children;
  repertoire.updated = new Date().toISOString();
}

/**
 * Deletes the node at `path` from its parent -- its whole subtree goes with
 * it, since it's detached with `children` still attached. Throws on the
 * root path (`[]`); the root is never itself deletable.
 *
 * @returns {{removed: object, parentPath: string[]}}
 */
function deleteNode(repertoire, path) {
  if (!Array.isArray(path) || path.length === 0) throw new Error('deleteNode: cannot delete the repertoire root');
  const parentPath = path.slice(0, -1);
  const targetUci = path[path.length - 1];
  const parent = nodeAtPath(repertoire.root, parentPath);
  if (!parent) throw new Error('deleteNode: path does not resolve to a node in this repertoire');
  const index = parent.children.findIndex((c) => c.uci === targetUci);
  if (index === -1) throw new Error('deleteNode: no such child at this path');
  const [removed] = parent.children.splice(index, 1);
  repertoire.updated = new Date().toISOString();
  return { removed, parentPath };
}

function setName(repertoire, name) {
  repertoire.name = sanitizeName(name);
  repertoire.updated = new Date().toISOString();
}

/** Counts real moves (nodes with a non-null uci) -- the root itself never counts, it holds no move. */
function countNodes(root) {
  let count = 0;
  function walk(node) {
    for (const child of node.children || []) {
      count += 1;
      walk(child);
    }
  }
  walk(root);
  return count;
}

/** Serialized byte size of `repertoire` -- what MAX_TOTAL_BYTES is checked against (per-repertoire or summed across a list, caller's choice). */
function size(value) {
  return byteLength(JSON.stringify(value));
}

function pgnHeaderEscape(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function defaultHeaders(repertoire) {
  const isoDate = repertoire.updated || repertoire.created || '';
  const dateStr = /^\d{4}-\d{2}-\d{2}/.test(isoDate) ? isoDate.slice(0, 10).replace(/-/g, '.') : '????.??.??';
  return {
    Event: repertoire.name || 'Repertoire',
    Site: 'https://repertoire-builder.com',
    Date: dateStr,
    Round: '-',
    White: repertoire.side === 'white' ? 'You' : 'Opponent',
    Black: repertoire.side === 'black' ? 'You' : 'Opponent',
    Result: '*',
  };
}

/**
 * Replays `node`'s children onto `chess` (which already holds the position
 * BEFORE any of them), building buildPack.js's pgnFromTree()-shaped nodes
 * (`fen`/`ply`/`san`/`children`) one level at a time. Every candidate move
 * is applied via applyExplorerUci (a safe passthrough for an
 * already-standard uci -- see this module's header comment) so a
 * not-yet-normalized Explorer-form uci reaching this function some other
 * way still replays correctly, then undone before the next sibling so
 * `chess` is left exactly as handed in.
 */
function adaptChildren(node, chess, ply) {
  return (node.children || []).map((child) => {
    const moveResult = applyExplorerUci(chess, child.uci);
    const adapted = {
      fen: chess.fen(),
      ply,
      san: moveResult.san,
      uci: child.uci,
      isOurMove: false, // repertoire export carries no band-stat annotation (spec 3.1 doesn't ask for one); commentFor() is a no-op without it
      children: adaptChildren(child, chess, ply + 1),
    };
    chess.undo();
    return adapted;
  });
}

/**
 * Serializes `repertoire` as PGN, reusing buildPack.js's pgnFromTree
 * (spec 3.1: "toPgn REUSES buildPack.js's pgnFromTree (adapting the tree
 * shape) rather than writing a second variation serializer").
 *
 * pgnFromTree's public shape only ever renders ONE top-level move (it
 * always calls its own internal renderLine wrapped around a single root
 * node) -- variations at any DEEPER ply nest correctly via that same
 * function, but a genuine fork at ply 0 (only possible for a `side:
 * 'black'` repertoire, where the opponent's first move is itself a branch
 * point) cannot be expressed as PGN variations on a single root without
 * reaching into buildPack.js's own unexported renderLine/renderSingleLine
 * helpers, which is out of this task's file footprint. The adaptation
 * this function makes instead: each of the repertoire root's children
 * becomes its OWN complete PGN game, and multiple games are joined into
 * one multi-game PGN document (blank-line separated, ordinary PGN, the
 * same shape a "several games in one .pgn file" export from any chess
 * database tool produces) -- both chess.js's own loadPgn and Lichess
 * Study read a multi-game file correctly (Study imports each game as its
 * own chapter). The common case (a `side: 'white'` repertoire, or a
 * `side: 'black'` repertoire the user has only ever answered one first
 * move against) has exactly one root child and therefore produces an
 * ordinary single-game PGN, byte-identical to calling pgnFromTree directly.
 *
 * @param {object} repertoire
 * @param {Record<string,string>} [headers] overrides for defaultHeaders()
 * @returns {string} one or more PGN games, trailing newline included.
 */
function toPgn(repertoire, headers = {}) {
  const finalHeaders = { ...defaultHeaders(repertoire), ...headers };
  const topLevel = repertoire.root.children || [];

  if (topLevel.length === 0) {
    const headerLines = Object.entries(finalHeaders)
      .map(([k, v]) => `[${k} "${pgnHeaderEscape(v)}"]`)
      .join('\n');
    return `${headerLines}\n\n*\n`;
  }

  const chess = new Chess();
  const games = topLevel.map((branch) => {
    const moveResult = applyExplorerUci(chess, branch.uci);
    const adaptedRoot = {
      fen: chess.fen(),
      ply: 0,
      san: moveResult.san,
      uci: branch.uci,
      isOurMove: false,
      children: adaptChildren(branch, chess, 1),
    };
    chess.undo();
    return pgnFromTree(adaptedRoot, finalHeaders);
  });
  return games.join('\n');
}

/**
 * Imports a single line of moves from visitor-supplied PGN text into a
 * fresh Node tree, always through pgnWrapper.parsePgnSafe first (spec 3.1:
 * "fromPgn runs input through pgnWrapper.parsePgnSafe first, always" --
 * the untrusted-PGN discipline security-standards.md and pgnWrapper.js's
 * own header comment require).
 *
 * KNOWN LIMITATION, documented rather than silently dropped: chess.js's
 * `history()` (what parsePgnSafe's `moves` array is built from) returns
 * only the PGN's MAIN line -- variations present in the pasted text are
 * parsed (so a malformed/over-nested one is still safely rejected) but not
 * recovered into branches here. A full multi-variation-aware import is
 * W1b's own scope (the real "import a .pgn file or pack.json" UI); this
 * pure op gives a correct single-line import today, which is what this
 * module's own round-trip test (export a single-line repertoire, re-import
 * it, compare) exercises.
 *
 * @param {string} pgnText
 * @returns {{ok:true, root:object, moveCount:number} | {ok:false, message:string}}
 */
function fromPgn(pgnText) {
  const parsed = parsePgnSafe(pgnText);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const root = emptyNode();
  let node = root;
  for (const move of parsed.moves) {
    if (typeof move.uci !== 'string' || !UCI_RE.test(move.uci)) {
      return { ok: false, message: 'That PGN contains a move this importer could not read as a standard move.' };
    }
    const child = { uci: move.uci, children: [] };
    node.children.push(child);
    node = child;
  }
  return { ok: true, root, moveCount: parsed.moves.length };
}

/**
 * Shape-validates a Node read from an untrusted source (localStorage, or a
 * fromPgn/import result before it's trusted). Recursion-depth capped the
 * same way pgnWrapper.js caps PGN variation nesting -- a real repertoire
 * built through addMove() is nowhere near MAX_TREE_DEPTH plies deep.
 */
function isValidNode(candidate, depth = 0) {
  if (depth > MAX_TREE_DEPTH) return false;
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.uci !== null && !UCI_RE.test(candidate.uci)) return false;
  if (!Array.isArray(candidate.children) || candidate.children.length > MAX_NODE_CHILDREN) return false;
  return candidate.children.every((c) => isValidNode(c, depth + 1));
}

/**
 * Shape-validates one whole Repertoire document read from an untrusted
 * source (security-standards.md: "localStorage is untrusted on read").
 * Every consumer of a stored repertoire reads it through this function
 * (via parseRepertoireList below), never `JSON.parse` directly.
 */
function isValidRepertoire(candidate) {
  return Boolean(candidate)
    && typeof candidate === 'object'
    && candidate.v === FORMAT_VERSION
    && typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 64
    && typeof candidate.name === 'string' && candidate.name.length > 0 && candidate.name.length <= MAX_NAME_LENGTH
    && VALID_SIDES.has(candidate.side)
    && VALID_BANDS.has(candidate.band)
    && VALID_POOLS.has(candidate.pool)
    && typeof candidate.created === 'string' && !Number.isNaN(Date.parse(candidate.created))
    && typeof candidate.updated === 'string' && !Number.isNaN(Date.parse(candidate.updated))
    && isValidNode(candidate.root);
}

/**
 * Parses/validates the whole `rb.repertoires.v1` localStorage payload. The
 * ONE path repertoireBuilder.client.js should use to read it -- never
 * `JSON.parse` directly (security-standards.md).
 *
 * @param {string} raw
 * @returns {{ok:true, list:object[]} | {ok:false, error:string}}
 */
function parseRepertoireList(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'expected a string' };
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${err.message}` };
  }
  if (!Array.isArray(doc)) return { ok: false, error: 'expected an array' };
  if (doc.length > MAX_REPERTOIRES) return { ok: false, error: `more than ${MAX_REPERTOIRES} repertoires stored` };
  if (!doc.every((r) => isValidRepertoire(r))) return { ok: false, error: 'one or more stored repertoires failed shape validation' };
  return { ok: true, list: doc };
}

/** Filename-safe slug for a .pgn export: strips path separators, dot-dot sequences and control characters, caps length (spec 3.1 EXPORT). */
function sanitizeFilename(name, ext = 'pgn') {
  const stripped = String(name || 'repertoire')
    .split('').filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f).join('')
    .split('..').join('')
    .split('/').join('-')
    .split('\\').join('-')
    // Also strip the Windows-reserved filename characters -- not required by
    // spec 3.1's own wording (path separators/dot-dot/control chars only),
    // but a downloaded .pgn is a real file on a real filesystem, and this
    // set is otherwise silently mangled or rejected by Windows specifically.
    .split(/[<>:"|?*]/).join('')
    .trim();
  const base = (stripped.length > 0 ? stripped : 'repertoire').slice(0, 80);
  return `${base}.${ext}`;
}

module.exports = {
  FORMAT_VERSION,
  VALID_SIDES,
  VALID_BANDS,
  VALID_POOLS,
  MAX_REPERTOIRES,
  MAX_TOTAL_BYTES,
  MAX_NAME_LENGTH,
  STORAGE_KEY,
  UCI_RE,
  createRepertoire,
  emptyNode,
  nodeAtPath,
  isOwnPly,
  addMove,
  restoreChildren,
  deleteNode,
  setName,
  countNodes,
  size,
  toPgn,
  fromPgn,
  isValidNode,
  isValidRepertoire,
  parseRepertoireList,
  sanitizeFilename,
  sanitizeName,
};
