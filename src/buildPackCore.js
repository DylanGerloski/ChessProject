'use strict';

/**
 * Genuinely pure, zero-dependency helpers split out of src/buildPack.js
 * (this repo's Repertoire Pack build module) so they can be required from
 * ANY context -- a Node build script, a unit test, or a browser bundle --
 * with no risk of pulling in fs/path/network code that only makes sense
 * at build time. Both functions require() nothing: applyExplorerUci takes
 * an already-constructed chess.js instance and mutates it via .move();
 * pgnFromTree and its private helpers below operate purely on the plain-
 * object tree shape they are handed. Neither touches the filesystem,
 * the network, or any other module in this project.
 *
 * Why this split exists (WS-1 spec sections 3.7/4.7): src/buildPack.js
 * itself requires ./explorerSource at module load, which requires
 * fs/path -- fine for buildPack.js own Node-only callers (the
 * Repertoire Pack build scripts), but fatal for esbuild trying to bundle
 * ANY browser entry point that needs one of these two functions
 * (src/browser/bandData.client.js, and WS-1 src/repertoireModel.js) --
 * esbuild resolves every require() in the static import graph
 * regardless of whether it executes lazily, so a top-level
 * require of ./explorerSource anywhere upstream of a browser entry point
 * breaks npm run build:static outright with an unresolvable fs/path
 * import, not a runtime error. src/buildPack.js re-exports both
 * functions unchanged (same names, same behavior) so every one of its
 * existing Node-only callers is unaffected by this split.
 */

/**
 * Applies one Explorer-sourced UCI move to a live chess.js instance,
 * returning chess.js's own move-result object (throws on illegal input,
 * same as chess.js's own `.move()` -- see fenAfter()'s doc comment).
 *
 * Handles ONE real quirk, found by running this module against live data
 * (not assumed from documentation, same "verified today" discipline
 * src/pgnWrapper.js's header comment uses for this library): the Lichess
 * Opening Explorer API encodes castling as "king captures its own rook"
 * (e1h1/e1a1/e8h8/e8a8 -- the UCI_Chess960 convention) even for an
 * ordinary, non-Chess960 game. Every position this module walks up to
 * MAX_PLY=12 is well within range of a castling move, and chess.js's
 * object-form `.move()` on a normal (non-960) instance does not
 * understand that encoding -- it expects the king's actual landing square
 * (e1g1/e1c1/...). Detected structurally (king's square -> a same-color
 * rook's square), not by string-matching specific squares, so it also
 * covers a hypothetical future Chess960 pack without change.
 */
function applyExplorerUci(chess, uci) {
  const from = uci.slice(0, 2);
  let to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const mover = chess.get(from);
  const target = chess.get(to);
  if (mover && mover.type === 'k' && target && target.type === 'r' && target.color === mover.color) {
    to = `${to[0] === 'h' ? 'g' : 'c'}${from[1]}`;
  }
  return chess.move({ from, to, promotion });
}

function escapePgnHeaderValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The `{n=... score=...% CI low-high}` annotation, our-moves only (spec 1.2 item 1). */
function commentFor(node) {
  if (!node.isOurMove || node.n == null || node.score == null || !node.wilson) return '';
  const scorePct = (node.score * 100).toFixed(1);
  const lowPct = (node.wilson[0] * 100).toFixed(1);
  const highPct = (node.wilson[1] * 100).toFixed(1);
  return ` {n=${node.n} score=${scorePct}% CI ${lowPct}-${highPct}}`;
}

/** "12. " for a white move, "" or "12... " for a black move depending on forceEllipsis. */
function movePrefix(ply, forceEllipsis) {
  const moveNumber = Math.floor(ply / 2) + 1;
  const isWhite = ply % 2 === 0;
  if (isWhite) return `${moveNumber}. `;
  return forceEllipsis ? `${moveNumber}... ` : '';
}

/**
 * Renders one full alternative branch (used only for the inside of a `(...)`
 * variation, where `node` has no siblings of its own to consider -- it IS
 * the alternative). `forceEllipsis` is always true for the variation's own
 * first move (spec/PGN convention: "(3...Nf6 ...)" when the branch point is
 * black's move).
 */
function renderSingleLine(node, forceEllipsis) {
  const token = `${movePrefix(node.ply, forceEllipsis)}${node.san}${commentFor(node)}`;
  const rest = renderLine(node.children, false);
  return [token, rest].filter(Boolean).join(' ');
}

/**
 * Renders `nodes` -- an array of SIBLING alternatives at one ply (what one
 * `.children` array holds) -- as PGN movetext: the first sibling (highest
 * frequency, since candidatesFor()/includedOpponentReplies() already sort
 * that way) continues as the main line; every other sibling becomes a
 * parenthesized variation inserted immediately after the main move's own
 * token, BEFORE the main line's subsequent moves continue -- standard PGN
 * style (e.g. "1. e4 c5 (1...e5) (1...e6) 2. c3 ..."), not the flatter
 * "move THEN all variations THEN rest" order it's easy to mis-derive from a
 * naive single-node recursion (see this function's sibling
 * renderSingleLine() for why a two-function split is what makes the
 * insertion point correct). Redundant move numbers are only ever a
 * readability nicety here, never a correctness requirement: PGN parsers
 * (chess.js included) read the SAN token sequence and parenthesis nesting,
 * not the move-number digits -- see the round-trip test.
 */
function renderLine(nodes, forceEllipsis) {
  if (!nodes || nodes.length === 0) return '';
  const [main, ...alts] = nodes;
  const token = `${movePrefix(main.ply, forceEllipsis)}${main.san}${commentFor(main)}`;
  const variationParts = alts.map((alt) => `(${renderSingleLine(alt, true)})`);
  const rest = renderLine(main.children, alts.length > 0);
  return [token, ...variationParts, rest].filter(Boolean).join(' ');
}

/**
 * Serializes a pack tree as a single standard PGN game with variations
 * (spec 1.2 item 1). `headers` are the PGN tag pairs -- callers should
 * supply at least Event/Site/Date/White/Black/Result for a well-formed
 * Seven Tag Roster; chess.js's loadPgn (strict:false, this project's own
 * parsing convention -- see src/pgnWrapper.js) doesn't require all seven,
 * but a real product artifact should still carry them.
 *
 * @param {object} root tree root from buildPackTree()'s `.tree`.
 * @param {Record<string,string>} [headers]
 * @returns {string} a complete PGN document, trailing newline included.
 */
function pgnFromTree(root, headers = {}) {
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `[${k} "${escapePgnHeaderValue(v)}"]`)
    .join('\n');
  const movetext = `${renderLine([root], false)} *`;
  return `${headerLines}\n\n${movetext}\n`;
}


module.exports = {
  applyExplorerUci,
  escapePgnHeaderValue,
  commentFor,
  movePrefix,
  renderSingleLine,
  renderLine,
  pgnFromTree,
};
