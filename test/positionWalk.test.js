'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fenToEpd, posKeyFromEpd, walkPositions } = require('../src/ingest/positionWalk');

test('fenToEpd: drops the two clock fields', () => {
  assert.equal(
    fenToEpd('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  );
});

test('posKeyFromEpd: deterministic, 24 hex chars', () => {
  const epd = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  const key = posKeyFromEpd(epd);
  assert.equal(key.length, 24);
  assert.match(key, /^[0-9a-f]{24}$/);
  assert.equal(key, posKeyFromEpd(epd));
});

test('posKeyFromEpd: transposition -- two different move orders reaching the identical FEN produce the identical posKey', () => {
  const chessA = walkPositions(['c4', 'c5', 'Nf3']);
  const chessB = walkPositions(['Nf3', 'c5', 'c4']);
  assert.equal(chessA[chessA.length - 1].posKey, chessB[chessB.length - 1].posKey);
  assert.equal(chessA[chessA.length - 1].epd, chessB[chessB.length - 1].epd);
});

test('walkPositions: returns one node per position including the start, edges carry uci+san', () => {
  const nodes = walkPositions(['e4', 'e5', 'Nf3'], { maxPlies: 16 });
  assert.equal(nodes.length, 4);
  assert.equal(nodes[0].move, null);
  assert.equal(nodes[0].ply, 0);
  assert.equal(nodes[1].move.uci, 'e2e4');
  assert.equal(nodes[1].move.san, 'e4');
  assert.equal(nodes[1].ply, 1);
  assert.equal(nodes[3].move.san, 'Nf3');
});

test('walkPositions: truncates at maxPlies', () => {
  const nodes = walkPositions(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], { maxPlies: 2 });
  assert.equal(nodes.length, 3); // start + 2 plies
});

test('walkPositions: stops early (does not throw) on an illegal SAN token', () => {
  const nodes = walkPositions(['e4', 'e5', 'ThisIsNotAMove', 'Nc6'], { maxPlies: 16 });
  assert.equal(nodes.length, 3); // start + e4 + e5, stops before the bad token
});

test('walkPositions: handles castling and promotion without throwing', () => {
  const nodes = walkPositions(
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'],
    { maxPlies: 16 },
  );
  assert.equal(nodes[nodes.length - 1].move.san, 'O-O');
});
