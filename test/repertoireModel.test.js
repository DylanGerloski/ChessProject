'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('chess.js');

const {
  VALID_BANDS,
  MAX_REPERTOIRES,
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
  isValidNode,
  isValidRepertoire,
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
