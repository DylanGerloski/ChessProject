# Source: lichess-org/chess-openings

- **URL:** https://github.com/lichess-org/chess-openings
- **License:** CC0-1.0 (public domain dedication). Quoting the upstream `README.md`
  verbatim: *"As a collection of facts, this data set is in the public domain.
  Considerable effort was spent curating and cleaning the data. Insofar as that qualifies
  for copyright, the work is released under the CC0 Public Domain Dedication."*
- **Pinned commit:** `4b8622759e7ae6f93f011cc6c83a3823401ab45e` (upstream `pushed_at`
  2026-08-04). Vendored, not tracked live — refreshing to a later commit is a deliberate,
  separate decision, not an automatic update.
- **Vendored files:** `a.tsv`, `b.tsv`, `c.tsv`, `d.tsv`, `e.tsv` — unmodified byte-for-byte
  copies of the same files at the pinned commit, fetched directly from
  `raw.githubusercontent.com/lichess-org/chess-openings/4b8622759e7ae6f93f011cc6c83a3823401ab45e/`.
- **Shape:** tab-separated, header row `eco<TAB>name<TAB>pgn`. 3,810 data rows total
  (a=817, b=772, c=1250, d=614, e=357), verified by direct count at vendor time. 500
  distinct ECO codes.
- **What is NOT vendored:** the `dist/` variant (which adds `uci`/`epd` columns) does not
  exist in the repo and is not fetched — it is generated upstream by `python3 bin/gen.py`
  (requires `pip3 install chess`). This project deliberately does not depend on Python;
  `src/ecoData.js` derives the equivalent `uci`/FEN data itself at build time using
  `chess.js` in Node, which doubles as a legality-validation pass over every row (see that
  file's header comment).
- **Naming convention** (upstream README, relied on by `src/ecoData.js`'s family/variation
  parser): names are structured `Opening family: Variation, Subvariation, ...`; title case;
  each name has a unique *shortest* line; multiple rows may share a name prefix to resolve
  common transpositions.
