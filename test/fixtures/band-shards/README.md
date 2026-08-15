# Band-shard test fixtures

Small, hand-checked shard files in the exact shape `scripts/buildBandShards.js`
produces (`src/bandShards.js`'s `buildShard()`), covering four positions along
`1.e4 e5 2.Nf3 Nc6` for the `1600-1800` band / `blitz` pool:

- the starting position (`root.json`)
- after `1.e4` (`root.json`)
- after `1.e4 e5` (`e2e4-e7e5.json`)
- after `1.e4 e5 2.Nf3` (`e2e4-e7e5.json`)

Every `posKey` was computed with `src/bandShards.js`'s own `posKeyFor()`
(verified 2026-08-15 -- see `test/bandShards.test.js`), so a test or a
manual check against a real page can trust these keys resolve to the
positions their comments claim. The win/draw/loss counts are small, round,
made-up numbers chosen for readability -- **this is not real Lichess
Opening Explorer data**, and nothing should ever present it as such.

## Why this exists (WS-1 spec risk R1)

`scripts/buildBandShards.js`'s real crawl runs for 1.5-2 hours against a
live, donation-funded, rate-limited API and can legitimately stop partway
through (a sustained 429 outage is a documented real occurrence upstream --
see that script's own header comment). W1a/W2/W3 need something to build
and test against regardless of whether that crawl has finished, is
partial, or hasn't been re-run since a schema change -- this fixture
directory is that "regardless of crawl outcome" fallback, not a substitute
for the real dataset a shipped page must actually use.

## Regenerating

If `src/bandShards.js`'s wire format changes, regenerate the `posKey`
values with:

```
node -e "const {posKeyFor}=require('./src/bandShards'); console.log(posKeyFor(['e2e4']))"
```

and update the win/draw/loss numbers by hand -- they are deliberately not
derived from any script, so a bug in the crawler can never silently produce
a fixture that would validate against the same buggy code.
