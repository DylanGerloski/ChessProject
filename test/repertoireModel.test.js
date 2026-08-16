'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('chess.js');

const {
  VALID_BANDS,
  MAX_REPERTOIRES,
  MAX_PACK_POSITIONS,
  createRepertoire,
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
} = require('../src/repertoireModel');
const { VALID_BANDS: LEAK_VALID_BANDS } = require('../src/leakModel');

test('VALID_BANDS matches leakModel.js VALID_BANDS exactly (spec: kept in sync, not imported)', () => {
  assert.deepEqual([...VALID_BANDS].sort(), [...LEAK_VALID_BANDS].sort());
});

test('createRepertoire rejects an unrecognized side/band/pool', () => {
  assert.throws(() => createRepertoire({ name: 'x', side: 'red', band: '1600-1800' }), /side/);
  assert.throws(() => createRepertoire({ name: 'x', side: 'white', band: 'u1200' }), /band/);
  assert.throws(() => createRepertoire({ name: 'x', side: 'white', band: '1600-1800', pool: 'ultrabullet' }), /pool/);
});

test('createRepertoire produces a valid, empty repertoire', () => {
  const rep = createRepertoire({ name: '  My Opening  ', side: 'white', band: '1600-1800' });
  assert.equal(rep.v, 1);
  assert.equal(rep.name, 'My Opening'); // trimmed
  assert.equal(rep.side, 'white');
  assert.equal(rep.pool, 'blitz'); // default
  assert.equal(rep.root.uci, null);
  assert.deepEqual(rep.root.children, []);
  assert.ok(isValidRepertoire(rep));
});

test('createRepertoire falls back to a default name and caps length', () => {
  const rep = createRepertoire({ name: '   ', side: 'white', band: '1600-1800' });
  assert.equal(rep.name, 'Untitled repertoire');
  const long = createRepertoire({ name: 'x'.repeat(200), side: 'white', band: '1600-1800' });
  assert.equal(long.name.length, 80);
});

test('isOwnPly: white repertoire owns even plies (0, 2, 4...), black owns odd plies', () => {
  assert.equal(isOwnPly('white', []), true); // ply 0
  assert.equal(isOwnPly('white', ['e2e4']), false); // ply 1
  assert.equal(isOwnPly('white', ['e2e4', 'e7e5']), true); // ply 2
  assert.equal(isOwnPly('black', []), false);
  assert.equal(isOwnPly('black', ['e2e4']), true);
});

test('addMove on the owner\'s own ply replaces any existing single child', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  const r1 = addMove(rep, [], 'e2e4');
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.replacedChildren, []); // nothing to replace on first add (empty array, not null -- null is reserved for the true no-op case)
  assert.equal(rep.root.children.length, 1);

  const r2 = addMove(rep, [], 'd2d4');
  assert.equal(r2.changed, true);
  assert.equal(r2.replacedChildren.length, 1);
  assert.equal(r2.replacedChildren[0].uci, 'e2e4');
  assert.deepEqual(rep.root.children.map((c) => c.uci), ['d2d4']);
});

test('addMove on the owner\'s own ply is a no-op (changed:false) re-adding the same move', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  const before = rep.updated;
  const r = addMove(rep, [], 'e2e4');
  assert.equal(r.changed, false);
  assert.equal(rep.updated, before);
});

test('addMove on the opponent\'s ply adds sibling branches, never replaces', () => {
  const rep = createRepertoire({ name: 'x', side: 'black', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  addMove(rep, [], 'd2d4');
  addMove(rep, [], 'c2c4');
  assert.deepEqual(rep.root.children.map((c) => c.uci), ['e2e4', 'd2d4', 'c2c4']);
});

test('addMove on the opponent\'s ply re-clicking an existing branch is a no-op', () => {
  const rep = createRepertoire({ name: 'x', side: 'black', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  const r = addMove(rep, [], 'e2e4');
  assert.equal(r.changed, false);
  assert.equal(rep.root.children.length, 1);
});

test('addMove rejects a non-UCI move string', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  assert.throws(() => addMove(rep, [], 'e4'), /not a valid UCI move/);
  assert.throws(() => addMove(rep, [], 'z9z9'), /not a valid UCI move/);
});

test('addMove throws on a path that does not resolve', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  assert.throws(() => addMove(rep, ['e2e4'], 'e7e5'), /does not resolve/);
});

test('restoreChildren reverses an addMove replacement (undo)', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  const r = addMove(rep, [], 'd2d4');
  restoreChildren(rep, [], r.replacedChildren);
  assert.deepEqual(rep.root.children.map((c) => c.uci), ['e2e4']);
});

test('deleteNode removes a node and its whole subtree', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  addMove(rep, ['e2e4'], 'e7e5');
  addMove(rep, ['e2e4', 'e7e5'], 'g1f3');
  assert.equal(countNodes(rep.root), 3);

  const { removed } = deleteNode(rep, ['e2e4', 'e7e5']);
  assert.equal(removed.uci, 'e7e5');
  assert.equal(countNodes(rep.root), 1); // e2e4 only; e7e5+g1f3 subtree gone
  assert.equal(nodeAtPath(rep.root, ['e2e4', 'e7e5']), null);
});

test('deleteNode throws on the root path', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  assert.throws(() => deleteNode(rep, []), /cannot delete the repertoire root/);
});

test('deleteNode throws on a non-existent path', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  assert.throws(() => deleteNode(rep, ['e2e4']), /no such child|does not resolve/);
});

test('setName sanitizes and bumps updated', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  const before = rep.updated;
  setName(rep, '  New Name  ');
  assert.equal(rep.name, 'New Name');
  assert.ok(rep.updated >= before);
});

test('countNodes counts real moves only, not the root', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  assert.equal(countNodes(rep.root), 0);
  addMove(rep, [], 'e2e4');
  assert.equal(countNodes(rep.root), 1);
});

test('size returns a positive byte count that grows as the tree grows', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  const before = size(rep);
  addMove(rep, [], 'e2e4');
  const after = size(rep);
  assert.ok(after > before);
});

test('toPgn: empty repertoire produces a headers-only PGN with no moves', () => {
  const rep = createRepertoire({ name: 'Empty', side: 'white', band: '1600-1800' });
  const pgn = toPgn(rep);
  assert.match(pgn, /\[Event "Empty"\]/);
  assert.match(pgn, /\*\s*$/);
  // No move tokens: verify chess.js reads it as a game with zero moves.
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  assert.equal(chess.history().length, 0);
});

test('toPgn round-trips a single-line white repertoire through chess.js', () => {
  const rep = createRepertoire({ name: 'Italian', side: 'white', band: '1600-1800' });
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'];
  let path = [];
  for (const uci of moves) {
    addMove(rep, path, uci);
    path = [...path, uci];
  }
  const pgn = toPgn(rep);
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const replayed = chess.history({ verbose: true }).map((m) => m.lan);
  assert.deepEqual(replayed, moves);
});

test('toPgn handles castling correctly (Explorer-form quirk does not leak into export)', () => {
  const rep = createRepertoire({ name: 'Castle', side: 'white', band: '1600-1800' });
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'e1g1'];
  let path = [];
  for (const uci of moves) {
    addMove(rep, path, uci);
    path = [...path, uci];
  }
  const pgn = toPgn(rep);
  assert.match(pgn, /O-O/);
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  assert.deepEqual(chess.history({ verbose: true }).map((m) => m.lan), moves);
});

test('toPgn: a black repertoire with multiple first-move branches exports as a multi-game PGN, each game individually valid', () => {
  const rep = createRepertoire({ name: 'Black defenses', side: 'black', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  addMove(rep, [], 'd2d4');
  addMove(rep, ['e2e4'], 'c7c5');
  addMove(rep, ['d2d4'], 'g8f6');

  const pgn = toPgn(rep);
  const games = pgn.split(/\n\n(?=\[Event)/).map((g) => g.trim()).filter(Boolean);
  assert.equal(games.length, 2);

  const chess1 = new Chess();
  chess1.loadPgn(games[0], { strict: false });
  assert.deepEqual(chess1.history({ verbose: true }).map((m) => m.lan), ['e2e4', 'c7c5']);

  const chess2 = new Chess();
  chess2.loadPgn(games[1], { strict: false });
  assert.deepEqual(chess2.history({ verbose: true }).map((m) => m.lan), ['d2d4', 'g8f6']);
});

test('fromPgn imports a single main line and matches UCI_RE-shaped moves', () => {
  const pgn = '[Event "Test"]\n\n1. e4 e5 2. Nf3 *\n';
  const result = fromPgn(pgn);
  assert.equal(result.ok, true);
  assert.equal(result.moveCount, 3);
  assert.equal(result.root.uci, null);
  assert.equal(result.root.children[0].uci, 'e2e4');
  assert.equal(result.root.children[0].children[0].uci, 'e7e5');
  assert.equal(result.root.children[0].children[0].children[0].uci, 'g1f3');
});

test('fromPgn round-trips toPgn output for a single-line repertoire', () => {
  const rep = createRepertoire({ name: 'RoundTrip', side: 'white', band: '1600-1800' });
  const moves = ['d2d4', 'g8f6', 'c2c4', 'e7e6'];
  let path = [];
  for (const uci of moves) {
    addMove(rep, path, uci);
    path = [...path, uci];
  }
  const pgn = toPgn(rep);
  const imported = fromPgn(pgn);
  assert.equal(imported.ok, true);

  let node = imported.root;
  const replayed = [];
  while (node.children.length > 0) {
    node = node.children[0];
    replayed.push(node.uci);
  }
  assert.deepEqual(replayed, moves);
});

test('fromPgn refuses input that fails pgnWrapper.parsePgnSafe (delegates, does not re-implement)', () => {
  const result = fromPgn('not a pgn at all {{{');
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, 'string');
});

test('fromPgn refuses an oversized PGN via pgnWrapper\'s own byte cap', () => {
  const huge = '[Event "x"]\n\n' + '1. e4 e5 '.repeat(50000) + '*\n';
  const result = fromPgn(huge);
  assert.equal(result.ok, false);
});

test('isValidNode rejects a malformed uci, non-array children, or too many children', () => {
  assert.equal(isValidNode({ uci: null, children: [] }), true);
  assert.equal(isValidNode({ uci: 'e2e4', children: [] }), true);
  assert.equal(isValidNode({ uci: 'not-uci', children: [] }), false);
  assert.equal(isValidNode({ uci: null, children: 'nope' }), false);
  assert.equal(isValidNode({ uci: null, children: new Array(41).fill({ uci: 'e2e4', children: [] }) }), false);
});

test('isValidRepertoire rejects an unrecognized format version, band, or pool', () => {
  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  assert.equal(isValidRepertoire(rep), true);
  assert.equal(isValidRepertoire({ ...rep, v: 2 }), false);
  assert.equal(isValidRepertoire({ ...rep, band: 'u1200' }), false);
  assert.equal(isValidRepertoire({ ...rep, pool: 'ultrabullet' }), false);
  assert.equal(isValidRepertoire({ ...rep, side: 'red' }), false);
  assert.equal(isValidRepertoire(null), false);
  assert.equal(isValidRepertoire('not an object'), false);
});

test('parseRepertoireList: untrusted-on-read discipline -- invalid JSON, wrong shape, and over-cap all refused, never coerced', () => {
  assert.equal(parseRepertoireList(123).ok, false);
  assert.equal(parseRepertoireList('{not json').ok, false);
  assert.equal(parseRepertoireList('{}').ok, false); // not an array
  assert.equal(parseRepertoireList(JSON.stringify([{ garbage: true }])).ok, false);

  const rep = createRepertoire({ name: 'x', side: 'white', band: '1600-1800' });
  const tooMany = new Array(MAX_REPERTOIRES + 1).fill(rep);
  assert.equal(parseRepertoireList(JSON.stringify(tooMany)).ok, false);

  const ok = parseRepertoireList(JSON.stringify([rep]));
  assert.equal(ok.ok, true);
  assert.equal(ok.list.length, 1);
});

test('sanitizeFilename strips path separators, dot-dot sequences, and control characters, and caps length', () => {
  assert.equal(sanitizeFilename('My Italian Repertoire'), 'My Italian Repertoire.pgn');
  // Every ".." occurrence and every "/"/"\" is removed/replaced -- no path
  // traversal or directory separator survives, which is the actual security
  // property; the exact leftover punctuation shape is not load-bearing.
  const traversal = sanitizeFilename('../../etc/passwd');
  assert.ok(!traversal.includes('..'));
  assert.ok(!traversal.includes('/') && !traversal.includes('\\'));
  assert.equal(sanitizeFilename('a\\b/c'), 'a-b-c.pgn');
  assert.equal(sanitizeFilename(`ctrl\x01\x1fchars`), 'ctrlchars.pgn');
  assert.equal(sanitizeFilename(''), 'repertoire.pgn');
  const long = sanitizeFilename('x'.repeat(200));
  assert.ok(long.length <= 84); // 80 + '.pgn'
});

// -----------------------------------------------------------------------
// Multi-variation PGN import (W1b's stated scope -- fromPgn now recovers
// the full branch tree, not just the main line)
// -----------------------------------------------------------------------

test('fromPgn recovers a single top-level variation as a real sibling branch', () => {
  const pgn = '[Event "x"]\n\n1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6 *';
  const result = fromPgn(pgn);
  assert.equal(result.ok, true);
  assert.equal(result.skippedVariations, 0);
  const e4 = result.root.children.find((c) => c.uci === 'e2e4');
  assert.equal(e4.children.length, 2);
  const e5Branch = e4.children.find((c) => c.uci === 'e7e5');
  const c5Branch = e4.children.find((c) => c.uci === 'c7c5');
  assert.ok(e5Branch && c5Branch);
  assert.equal(e5Branch.children[0].uci, 'g1f3'); // main line continues: 2. Nf3 Nc6
  assert.equal(e5Branch.children[0].children[0].uci, 'b8c6');
  assert.equal(c5Branch.children[0].uci, 'g1f3'); // variation's own continuation: 2. Nf3 Nc6
  assert.equal(c5Branch.children[0].children[0].uci, 'b8c6');
});

test('fromPgn recovers nested variations at arbitrary depth', () => {
  // "(3. d4 cxd4)" is nested INSIDE "(2... Nc6 3. Bb5 ... g6)" -- by PGN
  // convention a variation is an alternative to the move it immediately
  // follows in its ENCLOSING line, so the nested variation is an
  // alternative to "3. Bb5" itself -- i.e. a SIBLING of the f1b5 node
  // under b8c6/Nc6, not a child of f1b5. (g6 IS a child of f1b5: it's the
  // outer variation's own continuation after Bb5.)
  const pgn = '[Event "x"]\n\n1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5 (3. d4 cxd4) g6) 3. d4 *';
  const result = fromPgn(pgn);
  assert.equal(result.ok, true);
  assert.equal(result.skippedVariations, 0);
  const e4 = result.root.children[0];
  const c5 = e4.children[0];
  const nf3 = c5.children[0];
  assert.equal(nf3.children.length, 2); // d6 (main) and Nc6 (variation)
  const d6 = nf3.children.find((c) => c.uci === 'd7d6');
  const nc6 = nf3.children.find((c) => c.uci === 'b8c6');
  assert.equal(d6.children[0].uci, 'd2d4'); // main line's own 3. d4
  assert.equal(nc6.children.length, 2); // 3. Bb5 (main within variation) and 3. d4 (nested variation, sibling of Bb5)
  const bb5 = nc6.children.find((c) => c.uci === 'f1b5');
  const nestedD4 = nc6.children.find((c) => c.uci === 'd2d4');
  assert.ok(bb5 && nestedD4);
  assert.equal(bb5.children[0].uci, 'g7g6'); // 3...g6, Bb5's own continuation
  assert.equal(nestedD4.children[0].uci, 'c5d4'); // 3...cxd4, the doubly-nested variation's own move
});

test('fromPgn: exporting a branchy repertoire (toPgn) and re-importing it (fromPgn) reproduces the exact same tree', () => {
  const rep = createRepertoire({ name: 'RoundTrip branchy', side: 'white', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  addMove(rep, ['e2e4'], 'c7c5');
  addMove(rep, ['e2e4'], 'e7e5');
  addMove(rep, ['e2e4', 'c7c5'], 'g1f3');
  addMove(rep, ['e2e4', 'c7c5', 'g1f3'], 'd7d6');
  addMove(rep, ['e2e4', 'c7c5', 'g1f3'], 'b8c6');
  addMove(rep, ['e2e4', 'e7e5'], 'g1f3');
  addMove(rep, ['e2e4', 'e7e5', 'g1f3'], 'b8c6');
  addMove(rep, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 'f1b5');

  const pgn = toPgn(rep);
  const imported = fromPgn(pgn);
  assert.equal(imported.ok, true);
  assert.equal(imported.skippedVariations, 0);

  // Structural comparison ignoring key order -- same shape as the original tree.
  function normalize(node) {
    return { uci: node.uci, children: node.children.map(normalize).sort((a, b) => (a.uci || '').localeCompare(b.uci || '')) };
  }
  assert.deepEqual(normalize(imported.root), normalize(rep.root));
});

test('fromPgn: a multi-game PGN (a black repertoire\'s multi-first-move export) is merged back into one tree', () => {
  const rep = createRepertoire({ name: 'Black defenses', side: 'black', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  addMove(rep, [], 'd2d4');
  addMove(rep, ['e2e4'], 'c7c5');
  addMove(rep, ['e2e4', 'c7c5'], 'g1f3');
  addMove(rep, ['d2d4'], 'g8f6');

  const pgn = toPgn(rep);
  const imported = fromPgn(pgn);
  assert.equal(imported.ok, true);
  assert.equal(imported.root.children.length, 2);
  const e4Branch = imported.root.children.find((c) => c.uci === 'e2e4');
  const d4Branch = imported.root.children.find((c) => c.uci === 'd2d4');
  assert.equal(e4Branch.children[0].uci, 'c7c5');
  assert.equal(e4Branch.children[0].children[0].uci, 'g1f3');
  assert.equal(d4Branch.children[0].uci, 'g8f6');
});

test('fromPgn rejects a document with more games than MAX_IMPORT_GAMES', () => {
  const oneGame = '[Event "x"]\n\n1. e4 e5 *\n\n';
  const many = oneGame.repeat(61);
  const result = fromPgn(many);
  assert.equal(result.ok, false);
  assert.match(result.message, /too many games|more games/);
});

test('fromPgn: a malformed/empty variation is skipped, not fatal to the whole import', () => {
  // An empty variation "()" has no preceding-move to vary -- degrades
  // gracefully (skipped, main line still imports) rather than failing outright.
  const pgn = '[Event "x"]\n\n1. e4 e5 () 2. Nf3 *';
  const result = fromPgn(pgn);
  assert.equal(result.ok, true);
  assert.equal(result.moveCount, 3);
});

test('fromPgn: a large number of top-level sibling variations is bounded and completes quickly (DoS discipline, security-standards.md)', () => {
  let pgn = '1. e4 e5';
  for (let i = 0; i < 500; i += 1) pgn += ' (1. d4 d5)';
  pgn += ' 2. Nf3 *';
  const start = Date.now();
  const result = fromPgn(pgn);
  const elapsedMs = Date.now() - start;
  assert.equal(result.ok, true);
  assert.ok(result.skippedVariations > 0); // over MAX_IMPORT_VARIATIONS, the excess is skipped rather than processed
  assert.ok(elapsedMs < 5000, `expected under 5s, took ${elapsedMs}ms`);
});

test('fromPgn refuses empty input with a friendly message, not a throw', () => {
  assert.equal(fromPgn('').ok, false);
  assert.equal(fromPgn('   ').ok, false);
  assert.equal(fromPgn(null).ok, false);
});

// -----------------------------------------------------------------------
// pack.json import (Repertoire Pack manifest -- spec 3.1 IMPORT, and
// the monetization spec's own section 1.7 #2 untrusted-input rules for this shape)
// -----------------------------------------------------------------------

const VALID_PACK = {
  format: 'repertoire-pack/1',
  id: 'white-1600-1800',
  title: 'White 1600-1800 pack',
  color: 'white',
  band: '1600-1800',
  speeds: ['blitz'],
  source: 'lichess-opening-explorer',
  retrieved: '2026-08-01',
  rule_version: 1,
  threshold_used: 0.02,
  line_count: 1,
  position_count: 2,
  positions: [
    { fen: 'x', ply: 0, side: 'w', san: 'e4', uci: 'e2e4', n: 1000, w: 500, d: 200, l: 300, score: 0.6, wilson: [0.55, 0.65], reach: 1, isOurMove: true },
    { fen: 'x', ply: 1, side: 'b', san: 'c5', uci: 'c7c5', n: 400, w: 180, d: 100, l: 120, score: 0.5, wilson: [0.4, 0.6], reach: 0.4, isOurMove: false },
  ],
};

test('importPackJson imports a valid pack manifest into a Repertoire tree', () => {
  const result = importPackJson(JSON.stringify(VALID_PACK));
  assert.equal(result.ok, true);
  assert.equal(result.side, 'white');
  assert.equal(result.band, '1600-1800');
  assert.equal(result.title, 'White 1600-1800 pack');
  assert.equal(result.root.children[0].uci, 'e2e4');
  assert.equal(result.root.children[0].children[0].uci, 'c7c5');
  assert.equal(result.moveCount, 2);
});

test('importPackJson normalizes Explorer-form castling uci (king-captures-own-rook) to standard form', () => {
  const pack = {
    ...VALID_PACK,
    positions: [
      { ply: 0, uci: 'e2e4' }, { ply: 1, uci: 'e7e5' }, { ply: 2, uci: 'g1f3' }, { ply: 3, uci: 'b8c6' },
      { ply: 4, uci: 'f1b5' }, { ply: 5, uci: 'a7a6' }, { ply: 6, uci: 'e1h1' }, // Explorer-form castling
    ],
  };
  const result = importPackJson(JSON.stringify(pack));
  assert.equal(result.ok, true);
  let node = result.root;
  while (node.children.length > 0) node = node.children[0];
  assert.equal(node.uci, 'e1g1'); // normalized, never the Explorer-form e1h1
});

test('importPackJson refuses an unrecognized/missing format string, never coerces', () => {
  assert.equal(importPackJson(JSON.stringify({ ...VALID_PACK, format: 'something-else/1' })).ok, false);
  assert.equal(importPackJson(JSON.stringify({ ...VALID_PACK, format: undefined })).ok, false);
});

test('importPackJson refuses malformed JSON without throwing', () => {
  const result = importPackJson('{not json');
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, 'string');
});

test('importPackJson refuses a positions array over MAX_PACK_POSITIONS', () => {
  const many = Array.from({ length: MAX_PACK_POSITIONS + 1 }, (_, i) => ({ ply: i === 0 ? 0 : 1, uci: 'e2e4' }));
  const result = importPackJson(JSON.stringify({ ...VALID_PACK, positions: many }));
  assert.equal(result.ok, false);
});

test('importPackJson refuses a non-finite numeric field (Infinity/-Infinity, not representable as JSON NaN)', () => {
  const raw = JSON.stringify({ ...VALID_PACK, positions: [{ ply: 0, uci: 'e2e4' }] }).replace('"uci":"e2e4"', '"uci":"e2e4","score":1e400');
  const result = importPackJson(raw);
  assert.equal(result.ok, false);
});

test('importPackJson refuses a manifest whose move sequence is illegal chess (fails closed, not partially imported)', () => {
  const pack = { ...VALID_PACK, positions: [{ ply: 0, uci: 'e2e5' }] }; // e2-e5 is not a legal pawn move
  const result = importPackJson(JSON.stringify(pack));
  assert.equal(result.ok, false);
});

test('importPackJson: a title containing an HTML-injection payload survives as plain text data, never coerced/stripped -- the caller\'s job (security-standards.md) is to render it via .textContent, never innerHTML', () => {
  const pack = { ...VALID_PACK, title: '<img src=x onerror=alert(1)>' };
  const result = importPackJson(JSON.stringify(pack));
  assert.equal(result.ok, true);
  assert.equal(result.title, '<img src=x onerror=alert(1)>'); // stored as data, not executed -- this module never touches the DOM
});

test('isValidPackJson standalone: rejects missing color/band, empty positions, and non-array positions', () => {
  assert.equal(isValidPackJson(VALID_PACK), true);
  assert.equal(isValidPackJson({ ...VALID_PACK, color: 'red' }), false);
  assert.equal(isValidPackJson({ ...VALID_PACK, band: 123 }), false);
  assert.equal(isValidPackJson({ ...VALID_PACK, positions: [] }), false);
  assert.equal(isValidPackJson({ ...VALID_PACK, positions: 'nope' }), false);
  assert.equal(isValidPackJson(null), false);
});

// -----------------------------------------------------------------------
// mergeTree (multi-repertoire management: import into an EXISTING
// repertoire rather than only ever creating a new one)
// -----------------------------------------------------------------------

test('mergeTree unions a new branch into an existing repertoire without touching what is already there', () => {
  const rep = createRepertoire({ name: 'Target', side: 'white', band: '1600-1800' });
  addMove(rep, [], 'e2e4');
  addMove(rep, ['e2e4'], 'c7c5');

  const imported = fromPgn('1. e4 e5 2. Nf3 Nc6');
  const added = mergeTree(rep, imported.root);
  assert.equal(added, 3); // e7e5, g1f3, b8c6 are new; e2e4 already existed
  assert.equal(rep.root.children.length, 1); // still one e2e4 node, not duplicated
  const e4 = rep.root.children[0];
  assert.equal(e4.children.length, 2); // c7c5 (pre-existing) + e7e5 (merged in)
});

test('mergeTree is idempotent -- merging the same tree twice adds nothing the second time', () => {
  const rep = createRepertoire({ name: 'Target', side: 'white', band: '1600-1800' });
  const imported = fromPgn('1. e4 e5 2. Nf3 Nc6');
  mergeTree(rep, imported.root);
  const secondAdd = mergeTree(rep, imported.root);
  assert.equal(secondAdd, 0);
});

test('mergeTree bumps `updated` only when something was actually added', () => {
  const rep = createRepertoire({ name: 'Target', side: 'white', band: '1600-1800' });
  const before = rep.updated;
  const imported = fromPgn('1. e4 e5');
  mergeTree(rep, imported.root);
  assert.ok(rep.updated >= before);
  const afterFirstMerge = rep.updated;
  mergeTree(rep, imported.root); // no-op second time
  assert.equal(rep.updated, afterFirstMerge);
});
