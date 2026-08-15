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
const { parsePgnSafe, splitPgnHeaderAndMovetext, findTopLevelParenSpans } = require('./pgnWrapper');

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

// --- Import (spec 3.1 IMPORT, W1b's stated scope) --------------------------

// Repertoire Pack manifest format string (src/buildPack.js's
// packJsonFromResult -- the one other place in this codebase that writes
// this literal). MAX_PACK_POSITIONS mirrors security-standards.md /
// the monetization spec's own section 1.7 #2 stated cap.
const PACK_FORMAT = 'repertoire-pack/1';
const MAX_PACK_POSITIONS = 2000;
const MAX_PACK_JSON_BYTES = 2 * 1024 * 1024; // 2 MB -- same order of magnitude as pgnWrapper's own MAX_PGN_BYTES headroom reasoning; a real pack tops out around a few hundred KB.
const MAX_PACK_PLY = 60; // matches MAX_TREE_DEPTH's sanity ceiling below

// Caps the number of PGN variation branches one import will attempt to
// recover (security-standards.md: a hand-written parser over untrusted
// text needs an explicit size cap, not just a byte cap -- see
// importPgnTree()'s doc comment for why a variation COUNT cap is the right
// shape here, distinct from pgnWrapper's own byte/paren-depth caps). A
// real prepared repertoire has a handful of branch points; 100 is
// generous headroom over that while bounding the O(variations x document
// size) re-parse cost this importer's design requires.
const MAX_IMPORT_VARIATIONS = 100;

// Whole-document caps for a (possibly multi-game) PGN import -- checked
// before splitting into per-game text (MAX_IMPORT_PGN_BYTES) and after
// (MAX_IMPORT_GAMES), so a many-tiny-games adversarial file can't dodge
// the byte cap the way a many-tiny-variations file dodges MAX_PGN_BYTES
// without MAX_IMPORT_VARIATIONS. MAX_IMPORT_GAMES is generous over any
// realistic multi-game export this tool itself produces (bounded by
// MAX_NODE_CHILDREN root branches) while still bounding adversarial input.
const MAX_IMPORT_PGN_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_IMPORT_GAMES = 60;

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
 * Imports visitor-supplied PGN text into a fresh Node TREE -- including
 * variations, not just the main line (spec 3.1 IMPORT: "a .pgn file or
 * paste"; this is W1b's stated scope, completing the "KNOWN LIMITATION"
 * W1a's original single-line version of this function documented).
 * Always through pgnWrapper.parsePgnSafe first, on the FULL original text,
 * unconditionally -- the untrusted-PGN discipline security-standards.md
 * and pgnWrapper.js's own header comment require, and the ONLY thing in
 * this whole import path that talks to chess.js's real PGN grammar/move
 * legality. That first call is also what makes everything below safe:
 * `parsePgnSafe`'s own `scanParenDepth` pre-scan already proved the
 * document's parentheses are balanced and within `MAX_PAREN_DEPTH`
 * BEFORE chess.js's real recursive-descent grammar even ran, and a
 * successful `chess.loadPgn()` (which this module verified empirically
 * DOES walk into and legality-check every variation's moves, even though
 * it then discards them from its own public API -- see this file's test
 * suite) proves every token in the document, main line AND every
 * variation, is a legal chess move in its own context.
 *
 * WHY THIS ISN'T "a second parser" (the standing instruction this task
 * was given): chess.js exposes no public way to read back the variation
 * structure it just legality-checked (`chess.history()`/`chess.pgn()`
 * both silently drop it -- verified directly against this project's
 * pinned chess.js 1.4.0). Recovering that structure without re-deriving
 * chess rules by hand works like this instead: `findTopLevelParenSpans`
 * (pgnWrapper.js) is a purely STRUCTURAL span-finder -- the exact same
 * single-pass, comment-skipping technique as `scanParenDepth`, extended
 * to also record `(...)` boundaries -- with zero opinion about what a
 * legal move is. For each span found, this function reconstructs a
 * SYNTHETIC PGN fragment (real SAN tokens already proven legal, from the
 * true game start, plus the span's own raw text) and re-parses THAT
 * through `parsePgnSafe` again -- so every actual move-legality decision,
 * for the main line and for every variation at every depth, is still made
 * by chess.js exactly once via `parsePgnSafe`, never by a hand-rolled
 * substitute. `findTopLevelParenSpans` is called recursively on each
 * variation's own inner text to recover nested variations the same way.
 *
 * SECURITY: bounded by `MAX_IMPORT_VARIATIONS` (see that constant's doc
 * comment) -- each variation span triggers up to two re-parses of the
 * text preceding it, an O(variations x document size) cost that isn't
 * itself the classic nested-quantifier ReDoS shape but is still
 * unbounded work if the SPAN COUNT alone isn't capped (e.g. thousands of
 * sibling top-level variations packed near the end of a large document).
 * See test/repertoireModel.test.js's "does not hang" test for the timed
 * assertion this reasoning is checked against, matching the same
 * "refuses or completes in under 2s, assert it, don't hope" discipline
 * the monetization spec's own section 1.7 #1 requires for the PGN import surface.
 *
 * A variation this function cannot cleanly re-attach (a genuinely
 * malformed slice -- should not happen given the whole document already
 * passed `parsePgnSafe` once, but handled defensively rather than
 * assumed) is skipped rather than failing the whole import; the returned
 * `skippedVariations` count makes that honest rather than silent.
 *
 * MULTI-GAME DOCUMENTS: `toPgn`'s own doc comment explains why a `side:
 * 'black'` repertoire with more than one first move prepared against
 * exports as SEVERAL games joined in one file, not one game with a ply-0
 * variation (pgnFromTree's public shape can't express a branch at the
 * very root). Reading that shape back therefore needs to happen one game
 * at a time -- `splitPgnGames` (purely structural, same header-line-vs-
 * movetext-line technique as `splitPgnHeaderAndMovetext`) finds each
 * game's boundaries, `importSingleGamePgn` runs the single-game algorithm
 * above on each one, and the resulting per-game trees are UNION-merged
 * into one combined root (`unionMergeChildren`, the same op `mergeTree`
 * uses) -- which is exactly correct here: each game contributes exactly
 * one distinct root branch (a different first move), so merging them
 * back at the root reconstructs the original multi-branch tree. An
 * ordinary single-game PGN (the overwhelmingly common case -- anything
 * from Lichess Study, ChessBase, or this tool's own `side: 'white'`
 * export) is just `splitPgnGames` returning one game and behaving
 * identically to the pre-multi-game version of this function.
 *
 * @param {string} pgnText
 * @returns {{ok:true, root:object, moveCount:number, skippedVariations:number} | {ok:false, message:string}}
 */
function fromPgn(pgnText) {
  if (typeof pgnText !== 'string' || pgnText.trim().length === 0) {
    return { ok: false, message: 'Paste a PGN to import.' };
  }
  if (byteLength(pgnText) > MAX_IMPORT_PGN_BYTES) {
    return { ok: false, message: `That PGN is too large (limit ${MAX_IMPORT_PGN_BYTES / 1024} KB).` };
  }

  const games = splitPgnGames(pgnText);
  if (games.length === 0) {
    return { ok: false, message: 'Paste a PGN to import.' };
  }
  if (games.length > MAX_IMPORT_GAMES) {
    return { ok: false, message: `That PGN has more games than can be imported at once (limit ${MAX_IMPORT_GAMES}).` };
  }

  const root = emptyNode();
  const counterRef = { count: 0, skipped: 0 };
  for (const gameText of games) {
    const single = importSingleGamePgn(gameText, counterRef);
    if (!single.ok) return single;
    unionMergeChildren(root, single.root);
  }

  if (!isValidNode(root)) {
    return { ok: false, message: 'That PGN produced a repertoire tree too large or deep to import.' };
  }

  return { ok: true, root, moveCount: countNodes(root), skippedVariations: counterRef.skipped };
}

/**
 * Splits a (possibly multi-game) PGN document into one text string per
 * game -- purely structural (a new header block starting after movetext
 * has already been seen means a new game began), never a legality
 * decision; every resulting game string still goes through
 * `parsePgnSafe` individually in `importSingleGamePgn`. Same anchored,
 * no-nested-quantifier line scan as `splitPgnHeaderAndMovetext`.
 */
function splitPgnGames(pgnText) {
  const lines = pgnText.split('\n');
  const games = [];
  let current = [];
  let sawMovetext = false;
  for (const line of lines) {
    const isHeaderLine = /^\s*\[.*\]\s*$/.test(line);
    if (isHeaderLine && sawMovetext) {
      games.push(current.join('\n'));
      current = [];
      sawMovetext = false;
    }
    current.push(line);
    if (!isHeaderLine && line.trim().length > 0) sawMovetext = true;
  }
  if (current.some((l) => l.trim().length > 0)) games.push(current.join('\n'));
  return games;
}

/** The single-game import algorithm fromPgn's doc comment describes, extracted so fromPgn can run it once per game in a multi-game document. `counterRef` is shared across every game in the same import, so MAX_IMPORT_VARIATIONS bounds the WHOLE document's total variation-processing cost, not just one game's. */
function importSingleGamePgn(pgnText, counterRef) {
  const topResult = parsePgnSafe(pgnText);
  if (!topResult.ok) return { ok: false, message: topResult.message };

  const root = emptyNode();
  let node = root;
  for (const move of topResult.moves) {
    if (typeof move.uci !== 'string' || !UCI_RE.test(move.uci)) {
      return { ok: false, message: 'That PGN contains a move this importer could not read as a standard move.' };
    }
    const child = { uci: move.uci, children: [] };
    node.children.push(child);
    node = child;
  }

  const { movetext } = splitPgnHeaderAndMovetext(pgnText);
  attachVariations(root, movetext, [], counterRef);

  return { ok: true, root };
}

/** Builds a parseable synthetic PGN document from real, already-legal SAN tokens plus one raw text tail, for re-parsing through parsePgnSafe (see fromPgn's doc comment). Never called with input that hasn't already passed a full parsePgnSafe check upstream. */
function reparseFragment(sanTokensSoFar, rawTail) {
  const movetext = [...sanTokensSoFar, rawTail].join(' ').trim();
  if (movetext.length === 0) return { ok: false, moves: [] };
  return parsePgnSafe(`${movetext} *`);
}

/**
 * Recursively finds and re-attaches every variation in `segmentText` (see
 * fromPgn's doc comment for the full algorithm). `prefixSan` is the real
 * SAN move sequence, from the true game start, needed to replay to the
 * position immediately BEFORE `segmentText` begins. Mutates `root` in
 * place; `counterRef` is a shared { count, skipped } object bounding total
 * work across the whole (recursive) import via MAX_IMPORT_VARIATIONS.
 */
function attachVariations(root, segmentText, prefixSan, counterRef) {
  const spans = findTopLevelParenSpans(segmentText);
  for (const [start, end] of spans) {
    if (counterRef.count >= MAX_IMPORT_VARIATIONS) {
      counterRef.skipped += 1;
      continue;
    }
    counterRef.count += 1;

    const beforeResult = reparseFragment(prefixSan, segmentText.slice(0, start));
    if (!beforeResult.ok || beforeResult.moves.length <= prefixSan.length) {
      counterRef.skipped += 1;
      continue;
    }
    const branchSan = beforeResult.moves.slice(0, -1).map((m) => m.san);
    const branchUci = beforeResult.moves.slice(0, -1).map((m) => m.uci);

    const innerText = segmentText.slice(start + 1, end);
    const innerResult = reparseFragment(branchSan, innerText);
    if (!innerResult.ok || innerResult.moves.length <= branchSan.length) {
      counterRef.skipped += 1;
      continue;
    }
    const newUcis = innerResult.moves.slice(branchSan.length).map((m) => m.uci);

    const parent = nodeAtPath(root, branchUci);
    if (parent) {
      let cursor = parent;
      for (const uci of newUcis) {
        let child = cursor.children.find((c) => c.uci === uci);
        if (!child) {
          if (cursor.children.length >= MAX_NODE_CHILDREN) break;
          child = { uci, children: [] };
          cursor.children.push(child);
        }
        cursor = child;
      }
    }

    attachVariations(root, innerText, branchSan, counterRef);
  }
}

/**
 * Shape-validates and imports a Repertoire Pack manifest (pack.json,
 * src/buildPack.js's `packJsonFromResult` output -- spec 3.1 IMPORT, and
 * the monetization spec's own section 1.7 #2 untrusted-input rules for this exact
 * artifact: "format" must equal exactly, "positions" under a hard length
 * cap, every numeric field range-checked, unknown format refused never
 * coerced). `positions` is a FLATTENED depth-first-preorder walk of the
 * pack's tree (buildPack.js's `flattenPositions`, not a tree itself) --
 * rebuilt into a real Node tree here purely from each entry's `ply`
 * (depth from the pack's own root, itself ply 0 -- see buildPack.js's
 * `buildPackTree`), using a per-ply "last node seen" stack: DFS preorder
 * guarantees a ply-P entry's parent is always whichever ply-(P-1) node was
 * most recently pushed, with no need to trust or replay `fen`/`side`.
 *
 * Every uci is Explorer-form (the Lichess Opening Explorer's
 * king-captures-own-rook castling encoding this codebase's own
 * `applyExplorerUci` exists to normalize -- see that function's and
 * repertoireModel's own header comments) -- normalized here by REPLAYING
 * the whole tree through a live chess.js instance, which doubles as this
 * import's real legality check (spec 1.7 #2's "every FEN validated by
 * chess.js before it reaches the board": this project replays moves
 * rather than trusting the manifest's own `fen` strings, a strictly
 * stronger check that also gets normalization for free -- the manifest's
 * `fen` field is never read or trusted). Any illegal move anywhere in the
 * tree fails the WHOLE import (never a partial/coerced result -- "unknown
 * format refused, never coerced" extends to "an internally inconsistent
 * one is too", since a corrupt manifest is not a case this importer
 * should try to partially salvage the way a merely-malformed PGN
 * variation is, per this module's own DoS-bounding reasoning above).
 *
 * @param {string} rawText
 * @returns {{ok:true, root:object, side:string, band:string|null, title:string, moveCount:number} | {ok:false, message:string}}
 */
function importPackJson(rawText) {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return { ok: false, message: 'Paste or choose a pack file to import.' };
  }
  if (byteLength(rawText) > MAX_PACK_JSON_BYTES) {
    return { ok: false, message: `That file is too large (limit ${MAX_PACK_JSON_BYTES / 1024} KB) to be a repertoire pack.` };
  }
  let candidate;
  try {
    candidate = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, message: 'That does not look like a valid pack file (not valid JSON).' };
  }
  if (!isValidPackJson(candidate)) {
    return { ok: false, message: `That file is not a recognized repertoire pack (expected format "${PACK_FORMAT}").` };
  }

  const root = treeFromPackPositions(candidate.positions);
  if (!normalizePackTree(root)) {
    return { ok: false, message: 'That pack file contains a move sequence this importer could not read as legal chess moves.' };
  }
  if (!isValidNode(root)) {
    return { ok: false, message: 'That pack produced a repertoire tree too large or deep to import.' };
  }

  return {
    ok: true,
    root,
    side: candidate.color,
    band: VALID_BANDS.has(candidate.band) ? candidate.band : null,
    title: typeof candidate.title === 'string' && candidate.title.trim().length > 0 ? candidate.title.trim().slice(0, MAX_NAME_LENGTH) : 'Imported pack',
    moveCount: countNodes(root),
  };
}

function isFiniteNumberOrNull(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

/** One entry of pack.json's flat `positions` array (spec 1.7 #2: "every numeric field Number.isFinite and range-checked"). Only the fields this importer actually uses (`uci`, `ply`) are structurally required; the stats fields (n/w/d/l/score/wilson/reach) are validated when present but never required -- this importer discards them (the live band table looks up fresh data, spec 3.1), so a manifest missing them is still a usable import. */
function isValidPackPosition(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.uci !== 'string' || !UCI_RE.test(p.uci)) return false;
  if (!Number.isInteger(p.ply) || p.ply < 0 || p.ply > MAX_PACK_PLY) return false;
  if (!isFiniteNumberOrNull(p.n) || (p.n != null && p.n < 0)) return false;
  if (!isFiniteNumberOrNull(p.score) || (p.score != null && (p.score < 0 || p.score > 1))) return false;
  if (!isFiniteNumberOrNull(p.reach) || (p.reach != null && (p.reach < 0 || p.reach > 1))) return false;
  return true;
}

function isValidPackJson(candidate) {
  return Boolean(candidate)
    && typeof candidate === 'object'
    && candidate.format === PACK_FORMAT
    && (candidate.color === 'white' || candidate.color === 'black')
    && typeof candidate.band === 'string'
    && Array.isArray(candidate.positions)
    && candidate.positions.length > 0
    && candidate.positions.length <= MAX_PACK_POSITIONS
    && candidate.positions.every(isValidPackPosition);
}

/** Rebuilds a Node tree from pack.json's flat, depth-first-preorder `positions` array -- see importPackJson's doc comment for the "last node seen per ply" reconstruction this relies on. Uci values are still Explorer-form at this point; normalizePackTree() below normalizes them. */
function treeFromPackPositions(positions) {
  const root = emptyNode();
  const lastAtPly = []; // lastAtPly[k] = the most recently created node at ply k
  for (const pos of positions) {
    const parent = pos.ply === 0 ? root : lastAtPly[pos.ply - 1];
    if (!parent) continue; // a ply-P entry with no ply-(P-1) predecessor yet -- malformed ordering, skip defensively rather than mis-attach it
    const node = { uci: pos.uci, children: [] };
    parent.children.push(node);
    lastAtPly[pos.ply] = node;
  }
  return root;
}

/** Replays `root`'s whole tree through a fresh chess.js instance via applyExplorerUci, normalizing every node's uci in place (Explorer-form -> this project's standard form) and doubling as the real legality check. Returns false (leaving the tree partially normalized -- callers must discard it, never persist) the moment any move is illegal. */
function normalizePackTree(root) {
  const chess = new Chess();
  function walk(node) {
    for (const child of node.children) {
      let moveResult;
      try {
        moveResult = applyExplorerUci(chess, child.uci);
      } catch (err) {
        return false;
      }
      child.uci = `${moveResult.from}${moveResult.to}${moveResult.promotion || ''}`;
      const childOk = walk(child);
      chess.undo();
      if (!childOk) return false;
    }
    return true;
  }
  return walk(root);
}

/**
 * Multi-repertoire management (task title's other half): merges an
 * already-imported Node tree (`sourceRoot` -- from fromPgn/importPackJson,
 * already normalized/validated) into an EXISTING repertoire's tree, in
 * place. Pure set-union on uci children -- a uci already present at a
 * given position is left untouched (its own subtree, and any `note`, are
 * never overwritten by an import); a new uci is appended as an additional
 * branch, respecting MAX_NODE_CHILDREN the same way a manual addMove()
 * would. Deliberately does NOT apply addMove()'s "own ply replaces"
 * semantics -- an import is describing existing prepared lines (both
 * "your" moves and opponent replies already resolved by whoever built the
 * source), not a single new choice the live board just made, so a union
 * merge is the correct, non-destructive operation. Returns the number of
 * newly added nodes so the caller can report something honest ("12 new
 * moves added" / "nothing new -- already in this repertoire").
 *
 * @param {object} targetRepertoire mutated in place; `updated` bumped iff anything was actually added.
 * @param {object} sourceRoot
 * @returns {number} nodes added
 */
function mergeTree(targetRepertoire, sourceRoot) {
  const added = unionMergeChildren(targetRepertoire.root, sourceRoot);
  if (added > 0) targetRepertoire.updated = new Date().toISOString();
  return added;
}

/**
 * The actual recursive set-union walk `mergeTree` (merging an import into
 * an existing saved repertoire) and `fromPgn` (recombining a multi-game
 * PGN document's separately-imported games back into one tree, since each
 * game is really just one root branch of the same original repertoire --
 * see fromPgn's own doc comment) both need. A uci already present at a
 * given position is left untouched; a new one is appended as an
 * additional branch, respecting MAX_NODE_CHILDREN.
 *
 * @returns {number} nodes newly added to `targetNode`'s subtree.
 */
function unionMergeChildren(targetNode, sourceNode) {
  let added = 0;
  for (const sourceChild of sourceNode.children) {
    let targetChild = targetNode.children.find((c) => c.uci === sourceChild.uci);
    if (!targetChild) {
      if (targetNode.children.length >= MAX_NODE_CHILDREN) continue;
      targetChild = { uci: sourceChild.uci, children: [] };
      targetNode.children.push(targetChild);
      added += 1;
    }
    added += unionMergeChildren(targetChild, sourceChild);
  }
  return added;
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
  PACK_FORMAT,
  MAX_PACK_POSITIONS,
  MAX_PACK_JSON_BYTES,
  MAX_IMPORT_VARIATIONS,
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
  importPackJson,
  mergeTree,
  isValidNode,
  isValidRepertoire,
  isValidPackJson,
  parseRepertoireList,
  sanitizeFilename,
  sanitizeName,
};
