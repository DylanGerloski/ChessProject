'use strict';

const readline = require('node:readline');

/**
 * Bounded-prefix PGN record reader for the position/move ingest pipeline.
 *
 * Reads a PGN stream (a local file, or in production a curl|zstd pipe -- see
 * scripts/ingestDump.js) one line at a time via Node's `readline`, which
 * buffers only the current line plus a small internal lookahead, never the
 * whole file. Each game's own header block + movetext is accumulated in a
 * small per-game array (a few hundred bytes to a few KB), discarded the
 * instant that game is emitted -- so memory use is bounded by one game at a
 * time, not by file size, which is the property that actually matters when
 * a real monthly database dump is on the order of hundreds of GB
 * decompressed. `readline` rather than a hand-rolled byte-buffer scanner is
 * a deliberate, disclosed choice: it gets the same "never materialize the
 * whole file" property with far less code and no new dependency, at the
 * cost of assuming PGN records are newline-delimited -- Lichess's own
 * documented PGN export convention, though NOT yet verified against a live
 * download by this codebase (see this module's tolerant header parsing
 * below, and scripts/dev/generateSyntheticIngestFixture.js's header
 * comment for the full disclosure of that gap).
 *
 * Each emitted game only carries `movetextPrefix`, the first `maxPlies` SAN
 * tokens (move-number markers, NAGs, comments and the trailing result token
 * stripped) -- the rest of a long game's movetext is never tokenized at
 * all, so a game with hundreds of plies past the prefix is scanned no
 * further than necessary.
 */

const DEFAULT_MAX_PLIES = 16;

// Tokenizer for one game's movetext string. Recognizes, in order: a move
// number marker ("12." or "12..."), a brace comment, a NAG ($3), a result
// token, or (falling through the alternation) a bare token -- which for
// well-formed movetext is always a SAN move. Stops consuming input the
// moment `maxPlies` SAN tokens have been collected (the caller's `while`
// loop below breaks out of `regex.exec` early), so a game with hundreds of
// plies past the prefix is never scanned past ply `maxPlies`.
const MOVETEXT_TOKEN_RE = /(\d+\.(?:\.\.)?)|(\{[^}]*\})|(\$\d+)|(1-0|0-1|1\/2-1\/2|\*)|(\S+)/g;

/**
 * @param {string} movetext raw movetext for one game (all lines joined with
 *   a single space -- a real dump's movetext is one line per game, so this
 *   is normally a no-op join).
 * @param {number} maxPlies
 * @returns {string[]} up to `maxPlies` SAN tokens, in order.
 */
function extractPlyPrefix(movetext, maxPlies) {
  const tokens = [];
  MOVETEXT_TOKEN_RE.lastIndex = 0;
  let match = MOVETEXT_TOKEN_RE.exec(movetext);
  while (match !== null && tokens.length < maxPlies) {
    const san = match[5];
    if (san) tokens.push(san);
    match = MOVETEXT_TOKEN_RE.exec(movetext);
  }
  return tokens;
}

const HEADER_LINE_RE = /^\[(\S+)\s+"([\s\S]*)"\]\s*$/;

/**
 * Parses one `[Tag "value"]` header line. Returns null for anything that
 * doesn't match the expected shape (rather than throwing) -- a single
 * malformed header line should not abort the whole game, since the real
 * dump's exact header set/ordering has not been verified against a live
 * download by this codebase; being tolerant of an unexpected line here is
 * what keeps a format surprise from being a hard crash instead of a data
 * point.
 */
function parseHeaderLine(line) {
  const m = HEADER_LINE_RE.exec(line);
  if (!m) return null;
  return { tag: m[1], value: m[2] };
}

/**
 * Streams `{ headers, movetextPrefix }` records out of a readable PGN
 * stream. `headers` is a plain, null-prototype object (defensive against
 * prototype pollution via a tag literally named "constructor" or
 * "__proto__" -- same posture as src/pgnWrapper.js's header handling, and
 * this module handles data from a much larger and less-trusted-by-volume
 * source than that one). Async generator so the caller (aggregate-building
 * code) can `for await` it and apply backpressure naturally.
 *
 * @param {NodeJS.ReadableStream} readableStream
 * @param {{maxPlies?: number}} [opts]
 * @returns {AsyncGenerator<{headers: Record<string,string>, movetextPrefix: string[]}>}
 */
async function* iterateGames(readableStream, { maxPlies = DEFAULT_MAX_PLIES } = {}) {
  const rl = readline.createInterface({ input: readableStream, crlfDelay: Infinity });
  let headers = null;
  let inMovetext = false;
  let movetextLines = [];

  function finalize() {
    if (!headers) return null;
    const movetextPrefix = extractPlyPrefix(movetextLines.join(' '), maxPlies);
    return { headers, movetextPrefix };
  }

  for await (const line of rl) {
    if (line.startsWith('[')) {
      if (inMovetext) {
        // A new header block started without a blank-line separator from
        // the previous game's movetext -- tolerate it (finalize what we
        // had) rather than losing or corrupting either game.
        const game = finalize();
        if (game) yield game;
        headers = null;
        inMovetext = false;
        movetextLines = [];
      }
      const parsed = parseHeaderLine(line);
      if (parsed) {
        if (!headers) headers = Object.create(null);
        headers[parsed.tag] = parsed.value;
      }
      continue;
    }
    if (line.trim() === '') {
      if (inMovetext) {
        const game = finalize();
        if (game) yield game;
        headers = null;
        inMovetext = false;
        movetextLines = [];
      }
      continue;
    }
    inMovetext = true;
    movetextLines.push(line);
  }
  if (inMovetext) {
    const game = finalize();
    if (game) yield game;
  }
}

module.exports = {
  DEFAULT_MAX_PLIES,
  MOVETEXT_TOKEN_RE,
  HEADER_LINE_RE,
  extractPlyPrefix,
  parseHeaderLine,
  iterateGames,
};
