'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_PGN_BYTES,
  MAX_PAREN_DEPTH,
  MAX_TAG_VALUE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_FEN_LENGTH,
  scanParenDepth,
  truncate,
  parsePgnSafe,
  parseFenSafe,
  splitPgnHeaderAndMovetext,
  findTopLevelParenSpans,
} = require('../src/pgnWrapper');

const VALID_PGN = '[Event "Test"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
const VALID_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// --- scanParenDepth (the DoS-prevention pre-scan) ---------------------------

test('scanParenDepth counts nested variation depth outside comments', () => {
  const { maxDepth, balanced } = scanParenDepth('1. e4 (1. d4 (1. c4) e5) e5');
  assert.equal(maxDepth, 2);
  assert.equal(balanced, true);
});

test('scanParenDepth ignores parentheses inside brace comments', () => {
  const { maxDepth, balanced } = scanParenDepth('1. e4 {a comment (with parens) inside} e5');
  assert.equal(maxDepth, 0);
  assert.equal(balanced, true);
});

test('scanParenDepth flags unbalanced parens (unmatched close)', () => {
  const { balanced } = scanParenDepth('1. e4 e5)');
  assert.equal(balanced, false);
});

test('scanParenDepth flags unbalanced parens (unmatched open)', () => {
  const { balanced } = scanParenDepth('1. e4 (e5');
  assert.equal(balanced, false);
});

test('scanParenDepth on a deeply nested malicious payload reports the true depth cheaply (no stack growth)', () => {
  const nested = '('.repeat(5000) + ')'.repeat(5000);
  const start = Date.now();
  const { maxDepth, balanced } = scanParenDepth(`1. e4 ${nested}`);
  const elapsedMs = Date.now() - start;
  assert.equal(maxDepth, 5000);
  assert.equal(balanced, true);
  assert.ok(elapsedMs < 500, `scanParenDepth took ${elapsedMs}ms on a 10,000-char input -- expected O(n), no backtracking`);
});

// --- truncate ----------------------------------------------------------------

test('truncate leaves a short string untouched', () => {
  assert.equal(truncate('hello', 10), 'hello');
});

test('truncate cuts an over-length string and appends an ellipsis marker', () => {
  const result = truncate('x'.repeat(20), 10);
  assert.equal(result.length, 11); // 10 chars + 1 ellipsis char
  assert.ok(result.startsWith('x'.repeat(10)));
});

test('truncate passes non-strings through unchanged', () => {
  assert.equal(truncate(null, 10), null);
  assert.equal(truncate(undefined, 10), undefined);
});

// --- parsePgnSafe: size cap ---------------------------------------------------

test('parsePgnSafe rejects an empty/whitespace-only string', () => {
  const result = parsePgnSafe('   ');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
});

test('parsePgnSafe rejects non-string input without throwing', () => {
  assert.equal(parsePgnSafe(null).ok, false);
  assert.equal(parsePgnSafe(undefined).ok, false);
  assert.equal(parsePgnSafe(12345).ok, false);
  assert.equal(parsePgnSafe({ evil: true }).ok, false);
});

test('parsePgnSafe rejects a PGN over the byte cap, without ever calling the real parser', () => {
  const oversized = `1. e4 e5 ${'x'.repeat(MAX_PGN_BYTES + 1)}`;
  const result = parsePgnSafe(oversized);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-large');
  assert.match(result.message, /too large/i);
});

test('parsePgnSafe accepts a PGN right at the byte cap boundary is not itself asserted (only over-cap is a defect); a normal small PGN succeeds', () => {
  const result = parsePgnSafe(VALID_PGN);
  assert.equal(result.ok, true);
});

// --- parsePgnSafe: nesting / DoS guard ---------------------------------------

test('parsePgnSafe rejects a PGN with variation nesting past MAX_PAREN_DEPTH before invoking chess.js', () => {
  const nested = '1. e4 ' + '('.repeat(MAX_PAREN_DEPTH + 1) + 'e5 '.repeat(MAX_PAREN_DEPTH + 1) + ')'.repeat(MAX_PAREN_DEPTH + 1);
  const start = Date.now();
  const result = parsePgnSafe(nested);
  const elapsedMs = Date.now() - start;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-nested');
  assert.ok(elapsedMs < 1000, `parsePgnSafe took ${elapsedMs}ms on a malicious deeply-nested PGN -- the depth guard must reject before the real parser runs`);
});

test('parsePgnSafe rejects unbalanced parentheses', () => {
  const result = parsePgnSafe('1. e4 (1. d4 e5 *');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unbalanced-parens');
});

test('parsePgnSafe accepts real (non-malicious) nested variations under the cap', () => {
  const result = parsePgnSafe('1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6) d6) 2. Nf3 Nc6 *');
  assert.equal(result.ok, true);
  assert.ok(result.moves.length >= 4);
});

// --- parsePgnSafe: illegal / malformed SAN ------------------------------------

test('parsePgnSafe rejects grammatically-plausible but illegal SAN (chess.js legality check still runs)', () => {
  // Ke9 is grammatically SAN-shaped but not a legal square/move.
  const result = parsePgnSafe('1. e4 e5 2. Ke9 *');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-pgn');
});

test('parsePgnSafe rejects a move sequence that is legal-shaped SAN but an illegal position (moving into check)', () => {
  const result = parsePgnSafe('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7 Kxf7 5. Ke2 *'.replace('4. Qxf7', '4. Qxg7'));
  // Qxg7 is not legal here; chess.js should reject the game.
  assert.equal(result.ok, false);
});

// --- parsePgnSafe: field caps + prototype-pollution guard ---------------------

test('parsePgnSafe truncates an over-length tag value rather than passing it through whole', () => {
  const longValue = 'A'.repeat(MAX_TAG_VALUE_LENGTH + 500);
  const pgn = `[Event "${longValue}"]\n\n1. e4 e5 *`;
  const result = parsePgnSafe(pgn);
  assert.equal(result.ok, true);
  assert.ok(result.headers.Event.length <= MAX_TAG_VALUE_LENGTH + 1); // +1 for the ellipsis char
});

test('parsePgnSafe truncates an over-length comment rather than passing it through whole', () => {
  const longComment = 'B'.repeat(MAX_COMMENT_LENGTH + 500);
  const pgn = `1. e4 {${longComment}} e5 *`;
  const result = parsePgnSafe(pgn);
  assert.equal(result.ok, true);
  const comments = Object.values(result.commentsByFen);
  assert.equal(comments.length, 1);
  assert.ok(comments[0].length <= MAX_COMMENT_LENGTH + 1);
});

test('parsePgnSafe handles a PGN tag literally named "constructor" without prototype pollution', () => {
  const pgn = '[Event "Test"]\n[constructor "evil"]\n\n1. e4 e5 *';
  const result = parsePgnSafe(pgn);
  assert.equal(result.ok, true);
  // headers is Object.create(null) -- no inherited prototype at all.
  assert.equal(Object.getPrototypeOf(result.headers), null);
  assert.equal(result.headers.constructor, 'evil');
  // Object.prototype itself must be untouched.
  assert.equal(Object.prototype.constructor, Object);
  assert.equal(({}).toString, Object.prototype.toString);
});

test('parsePgnSafe handles a PGN tag named "__proto__" without prototype pollution', () => {
  const pgn = '[Event "Test"]\n[proto "x"]\n\n1. e4 e5 *'; // chess.js tagName grammar is alphabetic only, "__proto__" itself is not a legal tag name
  const result = parsePgnSafe(pgn);
  assert.equal(result.ok, true);
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
});

// --- parsePgnSafe: returned data shape / textContent-safety --------------------

test('parsePgnSafe returns moves with san/uci/fen for a valid PGN', () => {
  const result = parsePgnSafe(VALID_PGN);
  assert.equal(result.ok, true);
  assert.equal(result.headers.Event, 'Test');
  assert.equal(result.headers.White, 'Alice');
  assert.equal(result.moves.length, 6);
  assert.equal(result.moves[0].san, 'e4');
  assert.equal(result.moves[0].uci, 'e2e4');
  assert.ok(typeof result.finalFen === 'string' && result.finalFen.length > 0);
});

test('parsePgnSafe never returns a value containing unescaped HTML tags for a plain-text tag value (defense in depth -- caller must still use textContent)', () => {
  const pgn = '[Event "<img src=x onerror=alert(1)>"]\n\n1. e4 e5 *';
  const result = parsePgnSafe(pgn);
  assert.equal(result.ok, true);
  // The wrapper does not sanitize -- it returns the raw string verbatim, by
  // design (callers use .textContent, never innerHTML). This test documents
  // that contract rather than asserting sanitization the module doesn't do.
  assert.equal(result.headers.Event, '<img src=x onerror=alert(1)>');
});

// --- parseFenSafe --------------------------------------------------------------

test('parseFenSafe accepts a valid starting-position FEN', () => {
  const result = parseFenSafe(VALID_FEN);
  assert.equal(result.ok, true);
  assert.equal(result.fen, VALID_FEN);
});

test('parseFenSafe rejects an empty string', () => {
  assert.equal(parseFenSafe('').ok, false);
  assert.equal(parseFenSafe('   ').ok, false);
});

test('parseFenSafe rejects non-string input without throwing', () => {
  assert.equal(parseFenSafe(null).ok, false);
  assert.equal(parseFenSafe(42).ok, false);
  assert.equal(parseFenSafe(['a']).ok, false);
});

test('parseFenSafe rejects a FEN over the length cap before the regex/parser ever run', () => {
  const oversized = `${'p'.repeat(MAX_FEN_LENGTH + 50)} w KQkq - 0 1`;
  const result = parseFenSafe(oversized);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-large');
});

test('parseFenSafe rejects free-text garbage via the flat prefilter regex', () => {
  const result = parseFenSafe('this is not a fen at all');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-format');
});

test('parseFenSafe rejects a prefilter-shaped-but-illegal FEN via chess.js\'s real legality check', () => {
  // Passes FEN_PREFILTER's character-class check (missing a king is not
  // something the flat regex can catch) but is a real chess-illegal
  // position -- must be caught by chess.js's own full validation.
  const result = parseFenSafe('rnbqbbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQBBNR w KQkq - 0 1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-fen');
});

test('parseFenSafe rejects a FEN with too many kings (structurally well-formed, chess-illegal)', () => {
  const result = parseFenSafe('kkkkkkkk/8/8/8/8/8/8/KKKKKKKK w - - 0 1');
  assert.equal(result.ok, false);
});

test('parseFenSafe on a catastrophic-backtracking-style crafted string does not hang (prefilter is a flat regex)', () => {
  const crafted = `${'p'.repeat(90)}${'!'.repeat(90)}`;
  const start = Date.now();
  const result = parseFenSafe(crafted);
  const elapsedMs = Date.now() - start;
  assert.equal(result.ok, false);
  assert.ok(elapsedMs < 200, `parseFenSafe took ${elapsedMs}ms -- FEN_PREFILTER must be a flat, backtracking-free regex`);
});

// --- injectable ChessImpl (for a future fake/mocked engine in other tests) ----

test('parsePgnSafe/parseFenSafe accept an injected ChessImpl and use it instead of the real chess.js', () => {
  const { Chess: RealChess } = require('chess.js');
  let constructed = 0;
  class CountingChess extends RealChess {
    constructor(...args) {
      super(...args);
      constructed += 1;
    }
  }
  parsePgnSafe(VALID_PGN, { ChessImpl: CountingChess });
  parseFenSafe(VALID_FEN, { ChessImpl: CountingChess });
  assert.equal(constructed, 2);
});

// --- splitPgnHeaderAndMovetext / findTopLevelParenSpans (repertoireModel.js's
// variation-tree importer -- see that module's fromPgn doc comment) ---------

test('splitPgnHeaderAndMovetext separates the leading tag block from the movetext', () => {
  const { headerBlock, movetext } = splitPgnHeaderAndMovetext(VALID_PGN);
  assert.match(headerBlock, /\[Event "Test"\]/);
  assert.match(headerBlock, /\[Black "Bob"\]/);
  assert.doesNotMatch(headerBlock, /1\. e4/);
  assert.match(movetext, /1\. e4 e5/);
});

test('splitPgnHeaderAndMovetext on movetext-only input (no header lines) returns an empty header block', () => {
  const { headerBlock, movetext } = splitPgnHeaderAndMovetext('1. e4 e5 *');
  assert.equal(headerBlock, '');
  assert.match(movetext, /1\. e4 e5/);
});

test('splitPgnHeaderAndMovetext does not mistake a "(" inside a tag VALUE for the movetext starting', () => {
  const pgn = '[Event "Foo (Rd 3)"]\n[Site "?"]\n\n1. e4 e5 *';
  const { headerBlock, movetext } = splitPgnHeaderAndMovetext(pgn);
  assert.match(headerBlock, /Foo \(Rd 3\)/);
  assert.doesNotMatch(movetext, /Foo/);
});

test('findTopLevelParenSpans finds one span for a single variation', () => {
  const text = '1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6';
  const spans = findTopLevelParenSpans(text);
  assert.equal(spans.length, 1);
  const [start, end] = spans[0];
  assert.equal(text[start], '(');
  assert.equal(text[end], ')');
  assert.equal(text.slice(start + 1, end), '1... c5 2. Nf3');
});

test('findTopLevelParenSpans finds only TOP-LEVEL spans, not spans nested inside another variation', () => {
  const text = '1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5 (3. d4 cxd4) g6) 3. d4';
  const spans = findTopLevelParenSpans(text);
  assert.equal(spans.length, 1); // the nested (3. d4 cxd4) is NOT reported at this level
  const [start, end] = spans[0];
  assert.equal(text.slice(start + 1, end), '2... Nc6 3. Bb5 (3. d4 cxd4) g6');
});

test('findTopLevelParenSpans finds multiple sibling top-level spans in document order', () => {
  const text = '1. e4 e5 (1... c5) (1... e6) (1... c6) 2. Nf3';
  const spans = findTopLevelParenSpans(text);
  assert.equal(spans.length, 3);
  assert.deepEqual(spans.map(([s, e]) => text.slice(s + 1, e)), ['1... c5', '1... e6', '1... c6']);
});

test('findTopLevelParenSpans ignores parentheses inside brace comments (same discipline as scanParenDepth)', () => {
  const text = '1. e4 {a comment (not a variation)} e5 (1... c5)';
  const spans = findTopLevelParenSpans(text);
  assert.equal(spans.length, 1);
  assert.equal(text.slice(spans[0][0] + 1, spans[0][1]), '1... c5');
});
