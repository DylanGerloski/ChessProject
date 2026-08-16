'use strict';

/**
 * Security wrapper around chess.js's PGN/FEN parsing for VISITOR-SUPPLIED
 * input (Phase 7e, T3's "paste a PGN / paste a FEN" affordance -- the only
 * place on this entire site untrusted input reaches a chess engine; every
 * other page's move data comes from this project's own build-time pipeline
 * -- see src/ecoData.js's header comment). Untrusted input is handled per
 * this project's own security standard for anything a visitor supplies:
 * explicit size caps, no unbounded-quantifier parsing, grammar-validated
 * input, and callers are required to render every returned string via
 * `.textContent` (this module returns plain strings/objects only -- it
 * never produces HTML).
 *
 * Two exported entry points, `parsePgnSafe` and `parseFenSafe`. Both are
 * pure/synchronous and safe to call from Node (tests) or the browser (this
 * file has zero DOM dependency; chess.js is its only import, already a
 * screened devDependency -- BSD-2-Clause, 0 vulns, see docs/PORTFOLIO.md).
 *
 * Why a wrapper is needed at all, not just `new Chess(input)` /
 * `chess.loadPgn(input)` directly -- read before changing anything below:
 *
 * chess.js 1.x parses PGN with a real PEG grammar (src/pgn.peggy in the
 * chess.js package, not a hand-rolled regex), which means classic regex
 * ReDoS (catastrophic backtracking) does NOT apply here -- a PEG parser is
 * ordered-choice recursive descent with no nested quantifier of the
 * `(a+)+` shape. The real denial-of-service vector is different: the
 * grammar's variation rule (`variation = '(' line ')'`) is unboundedly
 * MUTUALLY RECURSIVE, so a PGN containing thousands of nested `(` produces
 * thousands of stack frames -- a `RangeError: Maximum call stack size
 * exceeded` (or a very slow parse) before chess.js's own grammar ever
 * rejects it. There is also no length bound anywhere in the grammar: a tag
 * value or a `{...}` comment will happily absorb megabytes. Neither of
 * those is chess.js's job to guard against -- they are this wrapper's job,
 * enforced BEFORE a single byte reaches the real parser:
 *
 *   1. Byte cap first (MAX_PGN_BYTES) -- the cheapest possible gate.
 *   2. A single O(n), no-regex pre-scan (scanParenDepth) counting `(`/`)`
 *      nesting outside brace comments, rejecting anything past
 *      MAX_PAREN_DEPTH -- this is what actually prevents the stack
 *      exhaustion, and it runs before the parser sees a byte.
 *   3. Field caps AFTER a successful parse (tag values, comments), applied
 *      here rather than trusting a render-time truncation to happen later.
 *   4. `try/catch` around the parse regardless (belt and braces) -- a
 *      stack-exhaustion RangeError is a catchable Error subtype in V8, and
 *      this treats it exactly like any other "not a valid PGN" outcome.
 *
 * Point 5 of the spec ("yield to the UI... never freeze the tab") is a
 * caller concern, not this module's -- see src/browser/ecoExplorer.client.js,
 * which runs parsePgnSafe/parseFenSafe behind a working-state UI update
 * rather than calling them synchronously on every keystroke.
 *
 * Prototype-pollution note (verified directly against this project's own
 * pinned chess.js 1.4.0, not assumed from the grammar alone): a PGN tag can
 * legally be named `constructor` -- `chess.header()` returns a genuine
 * `Object.prototype`-linked plain object, and a `[constructor "evil"]` tag
 * becomes an ordinary OWN property on it (`Object.hasOwn(header,
 * 'constructor')` is true), shadowing rather than polluting the prototype.
 * This wrapper still copies headers into a `Object.create(null)` map via
 * `Object.hasOwn` (never a bare object spread) as a second, independent
 * guard against a future chess.js version behaving differently -- "verified
 * safe today" is not "safe to stop checking".
 */

const { Chess } = require('chess.js');

const MAX_PGN_BYTES = 256 * 1024; // 256 KB -- a real opening line or game is a few KB; this is generous by two orders of magnitude
const MAX_PAREN_DEPTH = 64; // variation nesting depth; no realistic annotated PGN nests this deep
const MAX_TAG_VALUE_LENGTH = 512;
const MAX_COMMENT_LENGTH = 2048;
const MAX_FEN_LENGTH = 100; // a real FEN is ~60-90 chars; well over 2x headroom

// Cheap, flat, nested-quantifier-free pre-filter -- rejects obviously
// malformed input before it ever reaches chess.js's real FEN validator
// (`new Chess(fen)` / `validateFen`), which remains the primary gate (full
// legality: side to move, castling rights, en-passant square, ranks summing
// to 8 files). This regex is a fast-reject, not a substitute for it.
const FEN_PREFILTER = /^[1-8pnbrqkPNBRQK/]+ [wb] [KQkq-]{1,4} (-|[a-h][36]) \d{1,3} \d{1,4}$/;

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return Buffer.byteLength(str, 'utf8'); // Node test environment fallback
}

/**
 * Truncates a string to `max` characters, appending a single ellipsis
 * character when it does. Never throws, never returns anything but a
 * string for a string input.
 */
function truncate(str, max) {
  if (typeof str !== 'string') return str;
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * O(n) single pass, no regex, no recursion -- counts `(`/`)` nesting depth
 * while skipping the contents of `{...}` brace comments (PGN's own
 * single-level, non-nesting comment syntax: a `(` inside `{ }` is literal
 * text, not a variation opener). Returns the deepest nesting level reached
 * and whether every `(` was eventually closed. This is the control that
 * actually prevents the stack-exhaustion DoS described in this file's
 * header comment -- it must run, and reject, BEFORE chess.js's own
 * recursive-descent parser ever sees the text.
 */
function scanParenDepth(text) {
  let depth = 0;
  let maxDepth = 0;
  let wentNegative = false;
  let inComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inComment) {
      if (ch === '}') inComment = false;
      continue;
    }
    if (ch === '{') {
      inComment = true;
    } else if (ch === '(') {
      depth += 1;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === ')') {
      depth -= 1;
      if (depth < 0) wentNegative = true;
    }
  }
  return { maxDepth, balanced: depth === 0 && !wentNegative };
}

/**
 * Parses visitor-supplied PGN text into a plain, render-safe result.
 * Never throws -- every failure mode is a `{ ok: false, reason, message }`
 * return value, `message` being pre-written, plain-language copy safe to
 * assign directly via `.textContent` (never HTML; it contains no markup).
 *
 * @param {string} pgnText
 * @param {{ChessImpl?: typeof Chess}} [opts] `ChessImpl` is injectable for
 *   tests; defaults to the real chess.js `Chess` class.
 * @returns {{ok:true, headers:Record<string,string>, moves:Array<{san:string,uci:string,fen:string}>,
 *   finalFen:string, commentsByFen:Record<string,string>} | {ok:false, reason:string, message:string}}
 */
function parsePgnSafe(pgnText, { ChessImpl = Chess } = {}) {
  if (typeof pgnText !== 'string' || pgnText.trim().length === 0) {
    return { ok: false, reason: 'empty', message: 'Paste a PGN to identify the opening.' };
  }

  const bytes = byteLength(pgnText);
  if (bytes > MAX_PGN_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: `That PGN is too large (${Math.ceil(bytes / 1024)} KB). The limit is ${MAX_PGN_BYTES / 1024} KB -- a normal game or opening line is only a few KB.`,
    };
  }

  const { maxDepth, balanced } = scanParenDepth(pgnText);
  if (!balanced) {
    return { ok: false, reason: 'unbalanced-parens', message: 'This PGN has unbalanced parentheses around a variation and cannot be read.' };
  }
  if (maxDepth > MAX_PAREN_DEPTH) {
    return { ok: false, reason: 'too-nested', message: 'This PGN nests variations too deeply to parse safely.' };
  }

  let chess;
  try {
    chess = new ChessImpl();
    chess.loadPgn(pgnText, { strict: false });
  } catch (err) {
    // Both a normal grammar/legality Error and a (theoretical, now
    // pre-empted by the depth scan above) stack-exhaustion RangeError land
    // here -- both mean the same thing to a visitor: "not a valid PGN".
    return { ok: false, reason: 'invalid-pgn', message: 'That does not look like a valid PGN. Check the move text and try again.' };
  }

  const rawHeaders = chess.header();
  const headers = Object.create(null);
  for (const key of Object.keys(rawHeaders)) {
    if (!Object.hasOwn(rawHeaders, key)) continue; // second, independent guard -- see this file's header comment
    const value = rawHeaders[key];
    if (value === null || value === undefined) continue;
    headers[key] = truncate(String(value), MAX_TAG_VALUE_LENGTH);
  }

  const moves = chess.history({ verbose: true }).map((m) => ({ san: m.san, uci: m.lan, fen: m.after }));

  const commentsByFen = Object.create(null);
  for (const entry of chess.getComments()) {
    if (!entry || typeof entry.fen !== 'string') continue;
    commentsByFen[entry.fen] = truncate(String(entry.comment || ''), MAX_COMMENT_LENGTH);
  }

  return { ok: true, headers, moves, finalFen: chess.fen(), commentsByFen };
}

/**
 * Parses a visitor-supplied FEN string into a plain, render-safe result.
 * Length cap + flat regex pre-filter first (cheap rejection of obvious
 * garbage), then chess.js's own full FEN legality check (side to move,
 * castling rights, en-passant square, eight-files-per-rank) via
 * `new Chess(fen)` -- this wrapper does not re-implement that check by
 * hand, since chess.js's is already complete and this wrapper re-deriving
 * a second, possibly-divergent one would be worse, not safer.
 *
 * @param {string} fenText
 * @param {{ChessImpl?: typeof Chess}} [opts]
 * @returns {{ok:true, fen:string} | {ok:false, reason:string, message:string}}
 */
function parseFenSafe(fenText, { ChessImpl = Chess } = {}) {
  if (typeof fenText !== 'string' || fenText.trim().length === 0) {
    return { ok: false, reason: 'empty', message: 'Paste a FEN to identify the position.' };
  }
  const trimmed = fenText.trim();
  if (trimmed.length > MAX_FEN_LENGTH) {
    return {
      ok: false,
      reason: 'too-large',
      message: `That FEN is too long (${trimmed.length} characters, limit ${MAX_FEN_LENGTH}) to be a real position.`,
    };
  }
  if (!FEN_PREFILTER.test(trimmed)) {
    return { ok: false, reason: 'invalid-format', message: 'That does not look like a valid FEN (expected six space-separated fields).' };
  }
  try {
    const chess = new ChessImpl(trimmed);
    return { ok: true, fen: chess.fen() };
  } catch (err) {
    return { ok: false, reason: 'invalid-fen', message: `That FEN is not a legal position (${err.message}).` };
  }
}

/**
 * Splits `pgnText` into its header block (the leading run of `[Key "Value"]`
 * lines) and everything after it (the movetext). Line-anchored, no regex
 * with a nested quantifier -- this is a structural split, not a second PGN
 * grammar: it never decides whether a move is legal or a tag value is
 * well-formed, it only finds where the tag section ends. Used by
 * src/repertoireModel.js's variation-tree importer (see that module's
 * import doc comment for why the split is needed) to isolate the movetext
 * before hunting for top-level `(...)` variation spans in it, so a `(`
 * inside a tag VALUE (a legal, if unusual, PGN tag like `[Event "Foo (Rd
 * 3)"]`) is never mistaken for a variation opener.
 *
 * @param {string} pgnText
 * @returns {{headerBlock: string, movetext: string}}
 */
function splitPgnHeaderAndMovetext(pgnText) {
  const lines = pgnText.split('\n');
  let i = 0;
  while (i < lines.length && /^\s*\[.*\]\s*$/.test(lines[i])) i += 1;
  return { headerBlock: lines.slice(0, i).join('\n'), movetext: lines.slice(i).join('\n') };
}

/**
 * Finds every TOP-LEVEL (depth-1, i.e. not nested inside another
 * variation) `(...)` span in `text`, skipping the contents of `{...}` brace
 * comments -- the exact same single-pass, no-regex, no-recursion technique
 * as `scanParenDepth` above (this file's header comment explains why that
 * shape is what avoids the stack-exhaustion DoS a naive recursive-descent
 * variation parser would reintroduce), extended to also record span
 * boundaries rather than only a depth count. This is still purely
 * STRUCTURAL -- it has no idea what a legal chess move is and never will;
 * every actual move/legality decision made from a span's contents still
 * goes back through `parsePgnSafe` (see src/repertoireModel.js's
 * `importPgnTree`), so this function never becomes a second PGN grammar.
 *
 * Only ever called on text that has already passed `parsePgnSafe`'s own
 * `scanParenDepth` balance/depth check on the FULL original document, so
 * callers can assume `text` (or any substring of it this function itself
 * hands back) is already known-balanced and within `MAX_PAREN_DEPTH`.
 *
 * @param {string} text movetext (or a substring of it -- called
 *   recursively on one variation's own inner content to find nested
 *   variations within it).
 * @returns {Array<[number, number]>} `[startIndex, endIndex]` pairs, `text[start]`
 *   is `(` and `text[end]` is its matching `)`, in document order.
 */
function findTopLevelParenSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inComment) {
      if (ch === '}') inComment = false;
      continue;
    }
    if (ch === '{') {
      inComment = true;
    } else if (ch === '(') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        spans.push([start, i]);
        start = -1;
      }
    }
  }
  return spans;
}

module.exports = {
  MAX_PGN_BYTES,
  MAX_PAREN_DEPTH,
  MAX_TAG_VALUE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_FEN_LENGTH,
  FEN_PREFILTER,
  byteLength,
  truncate,
  scanParenDepth,
  splitPgnHeaderAndMovetext,
  findTopLevelParenSpans,
  parsePgnSafe,
  parseFenSafe,
};
