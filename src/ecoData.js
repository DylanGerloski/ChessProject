'use strict';

const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

/**
 * Build-time ECO opening data pipeline.
 *
 * Two vendored, license-pinned sources under data/eco/ (see each subdirectory's own
 * PROVENANCE.md for exact URLs/commits/licenses):
 *
 * - Source A, `data/eco/lichess-chess-openings/{a,b,c,d,e}.tsv` (lichess-org/chess-openings,
 *   CC0-1.0): 3,810 rows of `eco<TAB>name<TAB>pgn`, the SAN-notation defining line for each
 *   named opening. The upstream repo generates `uci`/`epd` columns via a Python script this
 *   project deliberately does not depend on -- `deriveLine()` below derives the equivalent
 *   UCI-per-ply and FEN-per-ply data itself, in Node, using chess.js.
 * - Source B, `data/eco/eco-json/eco{A..E}.json` (hayatbiralem/eco.json, MIT, archived):
 *   12,379 entries keyed by full FEN -> {eco, name, ...}, used for reverse lookup ("given
 *   this position, which opening is it").
 *
 * The derivation step doubles as a legality-validation pass: every SAN token in every row
 * is replayed through chess.js's real move-legality checker (not a hand-rolled one). A
 * malformed or transposition-broken row throws EcoDataError immediately, with enough
 * context (source file, row number, eco, name, the exact SAN token) to find it -- this
 * pipeline must fail loudly, never silently emit a partial or wrong line.
 *
 * Pure functions only below the file-reading boundary (buildEcoDataset takes an options
 * bag with an injectable `dataDir` and `readFileImpl`, same "no hidden I/O" shape as the
 * rest of this project's build.js/processOpenings.js) -- this keeps parsing/derivation/
 * reconciliation independently unit-testable without touching disk.
 */

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'eco');
const SOURCE_A_FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];
const SOURCE_B_FILES = ['ecoA.json', 'ecoB.json', 'ecoC.json', 'ecoD.json', 'ecoE.json'];

class EcoDataError extends Error {
  constructor(message, context) {
    super(context ? `${message} (${JSON.stringify(context)})` : message);
    this.name = 'EcoDataError';
    this.context = context || null;
  }
}

/**
 * Parses one Source A TSV file's raw text into rows of { eco, name, pgn }. Skips the
 * header. Throws EcoDataError on a row that doesn't have exactly the 3 expected columns,
 * rather than silently misaligning fields.
 */
function parseSourceATsv(tsvText, fileLabel) {
  const lines = tsvText.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new EcoDataError('empty TSV source file', { file: fileLabel });
  }
  const [header, ...dataLines] = lines;
  if (header.trim() !== 'eco\tname\tpgn') {
    throw new EcoDataError('unexpected TSV header -- upstream format may have changed', {
      file: fileLabel,
      header,
    });
  }
  return dataLines.map((line, i) => {
    const parts = line.split('\t');
    if (parts.length !== 3) {
      throw new EcoDataError('malformed TSV row: expected 3 tab-separated columns', {
        file: fileLabel,
        row: i + 2, // +1 for 0-index, +1 for the header line
        raw: line,
      });
    }
    const [eco, name, pgn] = parts;
    return { eco, name, pgn, file: fileLabel, row: i + 2 };
  });
}

/**
 * Tokenizes a PGN movetext string ("1. Nh3 d5 2. g3 e5") into an ordered array of SAN
 * tokens ("Nh3", "d5", "g3", "e5"), stripping move-number markers. Every one of the 3,810
 * vendored rows uses this exact "N. " (digits, one dot, one space) convention -- verified
 * directly against the vendored files at build time (no ellipsis/no-space-after-dot forms
 * exist in this dataset) -- so a stricter-than-generic-PGN regex is deliberate: a movetext
 * string that doesn't match it is exactly the kind of upstream-format-changed case that
 * should fail loudly rather than silently tokenize wrong.
 */
function tokenizeSan(pgnText, context) {
  const tokens = pgnText.trim().split(/\s+/).filter(Boolean);
  const san = [];
  for (const token of tokens) {
    if (/^\d+\.$/.test(token)) continue; // "1.", "23." -- move-number marker, discard
    if (/^\d+\.[^\s]/.test(token) || /\.\.\./.test(token)) {
      throw new EcoDataError(
        'unrecognized move-number format in PGN movetext (expected "N. " with a space)',
        { ...context, token, pgnText },
      );
    }
    san.push(token);
  }
  return san;
}

/**
 * Replays a SAN token list from the start position using chess.js, producing one entry
 * per ply: { ply, color, san, uci, fen }. `uci` and `fen` come straight from chess.js's own
 * move result (`.lan` / `.after`) -- not recomputed by hand -- so this is exactly what
 * chess.js considers the position to be, not an independent (and possibly divergent)
 * reimplementation. Throws EcoDataError with full context (source file/row/eco/name/ply
 * index/token) the moment any SAN token is illegal or unparseable, which is what makes
 * this a real validation pass over the vendored dataset rather than a best-effort parse.
 */
function deriveLine(sanTokens, context) {
  const chess = new Chess();
  const plies = [];
  sanTokens.forEach((san, i) => {
    let move;
    try {
      move = chess.move(san, { strict: true });
    } catch (err) {
      throw new EcoDataError(`illegal or malformed SAN move at ply ${i + 1}: "${san}"`, {
        ...context,
        ply: i + 1,
        san,
        fenBefore: chess.fen(),
        chessJsError: err.message,
      });
    }
    plies.push({
      ply: i + 1,
      color: move.color === 'w' ? 'white' : 'black',
      san: move.san,
      uci: move.lan,
      fen: move.after,
    });
  });
  return {
    plies,
    finalFen: plies.length > 0 ? plies[plies.length - 1].fen : chess.fen(),
  };
}

/**
 * Parses an ECO name into its family/variation/subvariation hierarchy, per the upstream
 * convention "Opening family: Variation, Subvariation, ...". `family` is the text before
 * the first colon (or the whole name if there is no colon -- 228 of 3,810 vendored rows
 * are family-root rows with no variation). `segments` is every comma-separated piece after
 * the colon, in order, so callers needing depth > 2 (up to 5 segments exist in this
 * dataset) aren't limited to a fixed variation/subvariation pair.
 */
function parseFamilyVariation(name) {
  const colonIndex = name.indexOf(':');
  if (colonIndex === -1) {
    return { family: name.trim(), variation: null, subvariation: null, segments: [] };
  }
  const family = name.slice(0, colonIndex).trim();
  const rest = name.slice(colonIndex + 1).trim();
  const segments = rest.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    family,
    variation: segments[0] || null,
    subvariation: segments.length > 1 ? segments.slice(1).join(', ') : null,
    segments,
  };
}

/**
 * Computes the exact set difference between Source A's ECO codes and Source B's, per
 * PROVENANCE.md's documented 506-vs-500 discrepancy. Never assumes what the extra codes
 * mean -- returns them as `quarantinedFromB` (in B, not in A, exact-string match) for the
 * caller to report, alongside `onlyInA` (in A, with zero reverse-lookup coverage in B) for
 * completeness.
 *
 * Each quarantined entry also carries `trimmedMatchesA`: true iff `code.trim()` is a real
 * Source A code. Verified at build time against the real vendored data: every one of the
 * 6 quarantined codes is a whitespace-corrupted duplicate of an existing
 * Source A code (e.g. `"C89 "` vs `"C89"`), not a genuine 6th-code mystery. This function
 * still quarantines the exact string rather than silently trimming Source B's own data --
 * "explained" is not the same as "safe to merge automatically".
 */
function reconcileEcoCodes(codesA, codesB) {
  const setA = new Set(codesA);
  const setB = new Set(codesB);
  const quarantinedFromB = [...setB]
    .filter((c) => !setA.has(c))
    .sort()
    .map((code) => ({ code, trimmedMatchesA: setA.has(code.trim()) }));
  const onlyInA = [...setA].filter((c) => !setB.has(c)).sort();
  return { quarantinedFromB, onlyInA };
}

/**
 * Reads and parses all 5 Source B eco{A..E}.json files into a single Map from FEN -> the
 * vendored {src, eco, moves, name} entry (last-write-wins on a duplicate FEN key across
 * files, which does not occur in the vendored data but is not asserted against here since
 * it isn't this function's job to validate Source B's internal consistency).
 */
function loadSourceB(readFileImpl, dataDir) {
  const byFen = new Map();
  const ecoCodes = new Set();
  let totalEntries = 0;
  for (const file of SOURCE_B_FILES) {
    const text = readFileImpl(path.join(dataDir, 'eco-json', file));
    const obj = JSON.parse(text);
    for (const [fen, entry] of Object.entries(obj)) {
      byFen.set(fen, entry);
      ecoCodes.add(entry.eco);
      totalEntries++;
    }
  }
  return { byFen, ecoCodes: [...ecoCodes], totalEntries };
}

/**
 * The full pipeline: vendor -> parse -> derive+validate -> parse family/variation ->
 * reconcile against Source B. Returns { lines, stats, quarantinedFromB, onlyInA }.
 *
 * `lines` is one entry per Source A row: { eco, name, family, variation, subvariation,
 * segments, sourceFile, sourceRow, plies, finalFen, inSourceB } -- `inSourceB` is true iff
 * Source B has a reverse-lookup entry for this line's exact final FEN, a coverage signal
 * for downstream consumers (e.g. the interactive explorer in a later task) without making
 * a mismatch a hard failure, since Source B is not a strict superset of Source A by
 * position (different move-order/transposition choices are expected).
 *
 * Options: `dataDir` (default data/eco/ next to this file), `readFileImpl` (injectable for
 * tests -- defaults to fs.readFileSync with 'utf8').
 */
function buildEcoDataset(options = {}) {
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const readFileImpl = options.readFileImpl || ((p) => fs.readFileSync(p, 'utf8'));

  const rawRows = [];
  for (const file of SOURCE_A_FILES) {
    const text = readFileImpl(path.join(dataDir, 'lichess-chess-openings', file));
    rawRows.push(...parseSourceATsv(text, file));
  }

  const sourceB = loadSourceB(readFileImpl, dataDir);

  const lines = rawRows.map((row) => {
    const context = { file: row.file, row: row.row, eco: row.eco, name: row.name };
    const sanTokens = tokenizeSan(row.pgn, context);
    if (sanTokens.length === 0) {
      throw new EcoDataError('row has an empty move list', context);
    }
    const { plies, finalFen } = deriveLine(sanTokens, context);
    const { family, variation, subvariation, segments } = parseFamilyVariation(row.name);
    return {
      eco: row.eco,
      name: row.name,
      family,
      variation,
      subvariation,
      segments,
      sourceFile: row.file,
      sourceRow: row.row,
      plies,
      finalFen,
      inSourceB: sourceB.byFen.has(finalFen),
    };
  });

  const ecoCodesA = [...new Set(lines.map((l) => l.eco))];
  const { quarantinedFromB, onlyInA } = reconcileEcoCodes(ecoCodesA, sourceB.ecoCodes);

  const familySet = new Set(lines.map((l) => l.family));
  const coveredBySourceB = lines.filter((l) => l.inSourceB).length;

  const stats = {
    totalLines: lines.length,
    distinctEcoCodesA: ecoCodesA.length,
    distinctEcoCodesB: sourceB.ecoCodes.length,
    distinctFamilies: familySet.size,
    sourceBTotalEntries: sourceB.totalEntries,
    linesCoveredBySourceB: coveredBySourceB,
    quarantinedFromBCount: quarantinedFromB.length,
    onlyInACount: onlyInA.length,
  };

  return { lines, stats, quarantinedFromB, onlyInA };
}

module.exports = {
  EcoDataError,
  DEFAULT_DATA_DIR,
  SOURCE_A_FILES,
  SOURCE_B_FILES,
  parseSourceATsv,
  tokenizeSan,
  deriveLine,
  parseFamilyVariation,
  reconcileEcoCodes,
  loadSourceB,
  buildEcoDataset,
};
