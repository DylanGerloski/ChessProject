'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCHEMA_VERSION,
  posKeyFor,
  shardKeyFor,
  positionRecordFrom,
  decodePositionRecord,
  buildShard,
  isValidShard,
} = require('../src/bandShards');
const { posKeyFromEpd } = require('../src/ingest/positionWalk');

test('posKeyFor: the starting position matches positionWalk.js\'s own key for the identical EPD (same canonical id scheme)', () => {
  const { epd, posKey } = posKeyFor([]);
  assert.equal(epd, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  assert.equal(posKey, posKeyFromEpd(epd));
  assert.match(posKey, /^[0-9a-f]{24}$/);
});

test('posKeyFor: transposition -- two different move orders reaching the identical position produce the identical posKey', () => {
  const a = posKeyFor(['g1f3', 'd7d5', 'c2c4']);
  const b = posKeyFor(['c2c4', 'd7d5', 'g1f3']);
  assert.equal(a.posKey, b.posKey);
  assert.equal(a.epd, b.epd);
});

test('posKeyFor: handles the Explorer castling quirk (king-captures-own-rook UCI) via buildPack.js\'s applyExplorerUci', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O, played two ways: the Explorer's own
  // UCI encoding (e1h1, king "captures" its own rook) and ordinary SAN --
  // both must reach the identical resulting position.
  const prefix = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'];
  const { fen: explorerFen } = posKeyFor([...prefix, 'e1h1']);

  const { Chess } = require('chess.js');
  const reference = new Chess();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']) {
    reference.move(san);
  }
  assert.equal(explorerFen, reference.fen());
});

test('posKeyFor: throws on a genuinely illegal move (a caller bug, not untrusted input)', () => {
  assert.throws(() => posKeyFor(['e2e5']));
});

test('shardKeyFor: "root" for ply 0-2, "<uci1>-<uci2>" beyond that, computable from the path alone', () => {
  assert.equal(shardKeyFor([]), 'root');
  assert.equal(shardKeyFor(['e2e4']), 'root');
  assert.equal(shardKeyFor(['e2e4', 'e7e5']), 'root');
  assert.equal(shardKeyFor(['e2e4', 'e7e5', 'g1f3']), 'e2e4-e7e5');
  assert.equal(shardKeyFor(['e2e4', 'e7e5', 'g1f3', 'b8c6']), 'e2e4-e7e5');
});

test('positionRecordFrom / decodePositionRecord: round-trips a fetchMoves()-shaped response through the compact wire format', () => {
  const response = {
    white: 5000,
    draws: 2000,
    black: 3000,
    moves: [
      { uci: 'g1f3', san: 'Nf3', white: 3000, draws: 1200, black: 1800, averageRating: 1650 },
      { uci: 'b1c3', san: 'Nc3', white: 2000, draws: 800, black: 1200, averageRating: 1640 },
    ],
  };
  const record = positionRecordFrom(response);
  assert.deepEqual(record, [5000, 2000, 3000, [
    ['g1f3', 3000, 1200, 1800, 1650],
    ['b1c3', 2000, 800, 1200, 1640],
  ]]);

  const decoded = decodePositionRecord(record);
  assert.equal(decoded.w, 5000);
  assert.equal(decoded.d, 2000);
  assert.equal(decoded.b, 3000);
  assert.equal(decoded.moves.length, 2);
  assert.equal(decoded.moves[0].uci, 'g1f3');
  assert.equal(decoded.moves[0].avgRating, 1650);
});

test('positionRecordFrom: no SAN stored (derivable client-side, not worth doubling shard size for)', () => {
  const record = positionRecordFrom({ white: 1, draws: 0, black: 0, moves: [{ uci: 'e2e4', san: 'e4', white: 1, draws: 0, black: 0 }] });
  assert.equal(record[3][0].length, 5); // [uci, mw, md, mb, avgRating] -- no san slot
});

test('positionRecordFrom: missing averageRating defaults to 0, not NaN/undefined', () => {
  const record = positionRecordFrom({ white: 1, draws: 0, black: 0, moves: [{ uci: 'e2e4', white: 1, draws: 0, black: 0 }] });
  assert.equal(record[3][0][4], 0);
});

test('buildShard / isValidShard: builds the exact spec 2.1 shape and validates it', () => {
  const shard = buildShard({
    band: '1600-1800',
    pool: 'blitz',
    retrieved: '2026-08-15',
    minGames: 300,
    positions: { aaaaaaaaaaaaaaaaaaaaaaaa: [1, 0, 0, []] },
  });
  assert.equal(shard.v, SCHEMA_VERSION);
  assert.equal(shard.source, 'lichess-opening-explorer');
  assert.ok(isValidShard(shard));
});

test('isValidShard: rejects a wrong/missing schema version, a non-object, and a shape missing required fields', () => {
  assert.equal(isValidShard(null), false);
  assert.equal(isValidShard('not an object'), false);
  assert.equal(isValidShard({ v: 2, band: '1600-1800', pool: 'blitz', positions: {} }), false);
  assert.equal(isValidShard({ v: 1, band: '1600-1800', positions: {} }), false); // missing pool
  assert.equal(isValidShard({ v: 1, band: '1600-1800', pool: 'blitz' }), false); // missing positions
});
