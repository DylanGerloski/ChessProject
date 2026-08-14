'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AggregateBuilder, UNCLASSIFIED_FAMILY_SLUG } = require('../src/ingest/aggregate');
const { walkPositions } = require('../src/ingest/positionWalk');

function game(sanMoves, { band = 'blitz-band', pool = 'blitz', balanced = false, avgElo = 1500, resultLetter = 'w', familySlug = 'italian-game', maxPlies = 16 } = {}) {
  return {
    band, pool, balanced, avgElo, resultLetter, familySlug,
    nodes: walkPositions(sanMoves, { maxPlies }),
  };
}

test('addGame + finalize: every position along the path gets a reached count; every edge its own move count', () => {
  const builder = new AggregateBuilder();
  builder.addGame(game(['e4', 'e5', 'Nf3'], { resultLetter: 'w' }));
  const { root, families } = builder.finalize({ minGames: 1 });

  // ply 0 (start), 1 (after e4), 2 (after e5) are all <= 6 -> root.
  const startNodes = walkPositions(['e4', 'e5', 'Nf3']);
  const startKey = startNodes[0].posKey;
  const afterE4Key = startNodes[1].posKey;

  const rec = root.positions['blitz-band'].blitz[startKey];
  assert.deepEqual([rec[0], rec[1], rec[2]], [1, 0, 0]); // w,d,l
  assert.deepEqual(rec[6]['e2e4'].slice(0, 6), [1, 0, 0, 0, 0, 0]);

  const afterE4Rec = root.positions['blitz-band'].blitz[afterE4Key];
  assert.deepEqual([afterE4Rec[0], afterE4Rec[1], afterE4Rec[2]], [1, 0, 0]);

  assert.equal(families.size, 0); // whole 3-ply path is within ply<=6 -> all root
});

test('finalize: MIN_GAMES filters out positions below the threshold', () => {
  const builder = new AggregateBuilder();
  builder.addGame(game(['e4'], { resultLetter: 'w' }));
  const { root, filteredCount } = builder.finalize({ minGames: 2 });
  assert.equal(Object.keys(root.positions).length, 0);
  assert.ok(filteredCount > 0);
});

test('finalize: balanced counts only increment for balanced games', () => {
  const builder = new AggregateBuilder();
  builder.addGame(game(['e4'], { resultLetter: 'w', balanced: true }));
  builder.addGame(game(['e4'], { resultLetter: 'l', balanced: false }));
  const { root } = builder.finalize({ minGames: 1 });
  const startKey = walkPositions(['e4'])[0].posKey;
  const rec = root.positions['blitz-band'].blitz[startKey];
  assert.deepEqual(rec.slice(0, 6), [1, 0, 1, 1, 0, 0]); // w=1,d=0,l=1, bw=1,bd=0,bl=0
});

test('finalize: averageRating is derivable from the stored ratingSum/ratingCount on a move', () => {
  const builder = new AggregateBuilder();
  builder.addGame(game(['e4'], { resultLetter: 'w', avgElo: 1600 }));
  builder.addGame(game(['e4'], { resultLetter: 'l', avgElo: 1400 }));
  const { root } = builder.finalize({ minGames: 1 });
  const startKey = walkPositions(['e4'])[0].posKey;
  const moveRec = root.positions['blitz-band'].blitz[startKey][6]['e2e4'];
  const [, , , , , , ratingSum, ratingCount] = moveRec;
  assert.equal(ratingSum, 3000);
  assert.equal(ratingCount, 2);
  assert.equal(ratingSum / ratingCount, 1500);
});

test('finalize: a deep position (ply > 6) shards under its family, not root', () => {
  const builder = new AggregateBuilder();
  // 8 plies deep -> the final position is ply 8, beyond ROOT_MAX_PLY (6).
  const nodes = walkPositions(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
  builder.addGame({ band: 'b', pool: 'blitz', balanced: false, avgElo: 1500, resultLetter: 'w', nodes, familySlug: 'ruy-lopez' });
  const { root, families } = builder.finalize({ minGames: 1 });

  const deepKey = nodes[8].posKey;
  assert.equal(root.positions.b?.blitz?.[deepKey], undefined);
  assert.ok(families.has('ruy-lopez'));
  assert.ok(families.get('ruy-lopez').positions.b.blitz[deepKey]);
});

test('finalize: a deep position with no family vote lands in the unclassified bucket, not silently dropped', () => {
  const builder = new AggregateBuilder();
  const nodes = walkPositions(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
  builder.addGame({ band: 'b', pool: 'blitz', balanced: false, avgElo: 1500, resultLetter: 'w', nodes, familySlug: null });
  const { families } = builder.finalize({ minGames: 1 });
  assert.ok(families.has(UNCLASSIFIED_FAMILY_SLUG));
});

test('finalize: pathIndex maps a ply<=6 uci path to its posKey', () => {
  const builder = new AggregateBuilder();
  builder.addGame(game(['e4', 'e5', 'Nf3']));
  const { root } = builder.finalize({ minGames: 1 });
  const nodes = walkPositions(['e4', 'e5', 'Nf3']);
  assert.equal(root.pathIndex['e2e4'], nodes[1].posKey);
  assert.equal(root.pathIndex['e2e4,e7e5'], nodes[2].posKey);
  assert.equal(root.pathIndex['e2e4,e7e5,g1f3'], nodes[3].posKey);
});

test('addGame: throws on an invalid resultLetter rather than silently miscounting', () => {
  const builder = new AggregateBuilder();
  assert.throws(() => builder.addGame(game(['e4'], { resultLetter: 'x' })), /invalid resultLetter/);
});
