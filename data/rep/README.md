# data/rep/ -- WS-1 band-meta shard dataset

Populated by `scripts/buildBandShards.js`, read at runtime by
`src/browser/bandData.client.js` (the Repertoire Builder's "What your band
plays here" table, `repertoire-builder.html`). Committed to git, unlike
`data/aggregates/` (see the repo root `.gitignore`'s own comment) -- shard
output here is small enough to check in directly, and the deploy build must
not depend on a live crawl (this directory's own generator script has the
full spec-level reasoning).

## Currently empty -- 2026-08-16 incident

This directory is empty as of 2026-08-16. It previously held real (if
wrongly-scoped) crawl output that was removed as part of fixing a
data-integrity bug: `repertoire.html` and `repertoire-builder.html` showed a
~6,900x-different games-count for the identical rating band and move. Both
numbers were genuinely real and correctly rating/pool-filtered -- the
mismatch was that they came from two INCOMPARABLE scopes:

- `repertoire.html` is built from `data/aggregates/`, this project's own
  one-month dump ingest (see that directory and `src/explorerSource.js`).
- The previously-committed `data/rep/` was crawled directly against the
  live Lichess Opening Explorer API, which reports Lichess's own **all-time
  cumulative** total for each rating bucket -- correct, but scoped over years
  of games rather than one month, and therefore not a number that can be
  compared position-for-position against the dump-derived pages.

`scripts/buildBandShards.js` now refuses to run against the live API by
default (see that script's own header, "DATA SOURCE, FIXED 2026-08-16") --
it requires `data/aggregates/` (or an explicit `--aggregates-dir`) to be
present, so this dataset and `repertoire.html`'s numbers are always drawn
from the same source.

## Regenerating this dataset

1. Get a real `data/aggregates/` on disk -- either run the ingest pipeline
   (`scripts/ingestDump.js`, needs a real Lichess database dump) or download
   and extract the current `data-<month>` GitHub Release asset the same way
   `.github/workflows/deploy-pages.yml`'s "Download aggregate data release"
   step does.
2. `node scripts/buildBandShards.js` (add `--band <band>` to crawl one band
   at a time, `--budget <n>` to change the per-band position cap).
3. `node scripts/verifyBandShards.js data/rep` to check the output.
4. Commit the resulting `data/rep/<band>/*.json` and `data/rep/manifest.json`.

Until step 1-4 run again, `repertoire-builder.html`'s band table degrades
gracefully to "Band data could not be loaded right now" (see
`src/browser/bandData.client.js`'s `coverage: 'unavailable'` path) rather
than showing a number from the wrong scope.
