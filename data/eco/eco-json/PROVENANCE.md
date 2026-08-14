# Source: hayatbiralem/eco.json

- **URL:** https://github.com/hayatbiralem/eco.json
- **License:** MIT — see `LICENSE` in this directory, vendored verbatim from the pinned
  commit.
- **Status: archived upstream** (`archived: true`, last push 2026-03-05). Vendor a pinned
  copy and never track it live — no upstream fixes should be expected.
- **Pinned commit:** `e397a1fa91ea6a281bff437f96a25a353051b2ce`.
- **Vendored files:** `ecoA.json`, `ecoB.json`, `ecoC.json`, `ecoD.json`, `ecoE.json` —
  unmodified byte-for-byte copies fetched directly from
  `raw.githubusercontent.com/hayatbiralem/eco.json/e397a1fa91ea6a281bff437f96a25a353051b2ce/`.
  The repo's other files (`fromTo.json`, `fromToPositionIndexed.json`, `scores.json`,
  `eco_interpolated.json`) are NOT vendored — nothing in this project's build needs them;
  vendoring unused multi-megabyte files would just be dead weight.
- **Shape:** each file is a JSON object keyed by full FEN (including halfmove/fullmove
  counters) -> `{src, eco, moves, name}`. Verified at vendor time: 12,379 total entries
  across the five files, spanning 506 distinct `eco` values.
- **Its job:** reverse lookup. Source A (`../lichess-chess-openings/`) answers "what moves
  define this opening?"; this source answers "given this arbitrary FEN, which opening (if
  any) is it?" — needed the moment a visitor leaves the known book line.
- **Known discrepancy, resolved by measurement, not assumption:** 506 distinct `eco`
  values here vs. a real universe of 500 in Source A. `src/ecoData.js`'s
  `reconcileEcoCodes()` computes the exact set difference at build time and quarantines
  the residue. **Verified against the real vendored data:** all 6 extra codes
  (`"C89 "`, `"C90 "`, `"C95 "`, `"C98 "`, `"E12 "`, `"E80 "`) are trailing-whitespace
  typos of an existing Source A code, not a genuine 6th-code mystery -- `code.trim()` for
  every one of them matches a real Source A ECO code exactly. This is an upstream data
  quality defect in this archived (read-only) source, reported here rather than silently
  auto-corrected: `reconcileEcoCodes()` still quarantines the exact (untrimmed) string, and
  flags each quarantined entry with `trimmedMatchesA: true` rather than merging it into the
  500 automatically.
