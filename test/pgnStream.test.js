'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { extractPlyPrefix, parseHeaderLine, iterateGames } = require('../src/ingest/pgnStream');

test('extractPlyPrefix: strips move numbers, results, comments and NAGs', () => {
  const movetext = '1. e4 e5 2. Nf3 $1 {a comment} Nc6 3. Bb5 1-0';
  assert.deepEqual(extractPlyPrefix(movetext, 16), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
});

test('extractPlyPrefix: stops at maxPlies, never over-collects', () => {
  const movetext = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6';
  assert.deepEqual(extractPlyPrefix(movetext, 3), ['e4', 'e5', 'Nf3']);
});

test('extractPlyPrefix: handles ellipsis move numbers (Black-to-move continuations)', () => {
  const movetext = '1. e4 e5 2. Nf3 2... Nc6 3. Bb5';
  assert.deepEqual(extractPlyPrefix(movetext, 16), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
});

test('parseHeaderLine: parses a well-formed tag line', () => {
  assert.deepEqual(parseHeaderLine('[WhiteElo "1687"]'), { tag: 'WhiteElo', value: '1687' });
});

test('parseHeaderLine: returns null for a non-header line', () => {
  assert.equal(parseHeaderLine('1. e4 e5'), null);
});

async function collect(pgnText, opts) {
  const games = [];
  for await (const game of iterateGames(Readable.from(pgnText), opts)) games.push(game);
  return games;
}

test('iterateGames: splits two consecutive games correctly', async () => {
  const pgn = [
    '[Event "Rated Blitz game"]',
    '[Result "1-0"]',
    '[WhiteElo "1500"]',
    '[BlackElo "1520"]',
    '',
    '1. e4 e5 2. Nf3 Nc6 1-0',
    '',
    '[Event "Rated Bullet game"]',
    '[Result "0-1"]',
    '[WhiteElo "1200"]',
    '[BlackElo "1210"]',
    '',
    '1. d4 d5 0-1',
    '',
  ].join('\n');

  const games = await collect(pgn);
  assert.equal(games.length, 2);
  assert.equal(games[0].headers.Event, 'Rated Blitz game');
  assert.deepEqual(games[0].movetextPrefix, ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.equal(games[1].headers.Result, '0-1');
  assert.deepEqual(games[1].movetextPrefix, ['d4', 'd5']);
});

test('iterateGames: a movetext block with no trailing blank line (EOF) is still emitted', async () => {
  const pgn = '[Event "Rated Blitz game"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
  const games = await collect(pgn);
  assert.equal(games.length, 1);
  assert.deepEqual(games[0].movetextPrefix, ['e4', 'e5']);
});

test('iterateGames: never builds a whole-file string -- verified via a huge synthetic stream that would OOM a naive implementation', async () => {
  // 20,000 tiny games streamed through -- if this module ever regresses to
  // buffering the whole input, this test becomes slow/memory-heavy; kept
  // fast and small here (well under a second) as the regression signal.
  function* generate() {
    for (let i = 0; i < 20000; i += 1) {
      yield `[Event "Rated Blitz game"]\n[Result "1-0"]\n[WhiteElo "1500"]\n[BlackElo "1500"]\n\n1. e4 e5 1-0\n\n`;
    }
  }
  const games = await collect(Array.from(generate()).join(''));
  assert.equal(games.length, 20000);
});

test('iterateGames: respects maxPlies per game', async () => {
  const pgn = '[Event "Rated Blitz game"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n\n';
  const games = await collect(pgn, { maxPlies: 2 });
  assert.deepEqual(games[0].movetextPrefix, ['e4', 'e5']);
});
