'use strict';

/**
 * The drill deck model (WS-1 spec section 3.3, "DECK MODEL"): the card
 * shape, persistence-shape parsing, session-queue selection, grading, and
 * the four seeding sources. Pure, Node + browser safe (no DOM, no
 * localStorage read/write -- that's src/browser/drill.client.js's job, same
 * division of labor as src/repertoireModel.js is expected to keep for W1a).
 * Async only where a seeding source genuinely needs a network-shaped
 * lookup (band-meta walks live/shard band data); every async function here
 * takes that lookup as an injected `lookupFn`, same convention as
 * `fetchImpl` elsewhere in this codebase, so it's fully testable with a
 * fake.
 *
 * CARD SHAPE -- the spec's own Card = { id, play, answerUci, side,
 * openingSlug, openingName, eco, source, sm2 } plus disclosed extensions
 * this module actually needs and the spec's own prose doesn't forbid:
 *   - `band`, `pool`: needed at reveal time to know which band shard to
 *     query (the spec's `id` ENCODES band as its first `|`-separated
 *     segment, but re-parsing an opaque id string back into a field on
 *     every read is more fragile than just storing it).
 *   - `answerSan`: the answer's SAN, known at seed time from every source
 *     (leak report, band data, repertoire, pack) -- storing it avoids a
 *     second lookup purely to print a move name.
 *   - `fen` (pack source ONLY, `play` is null when this is set): see
 *     seedFromPack()'s own comment below for why pack.json's shipped shape
 *     cannot carry a UCI path.
 *   - `packStats` (pack source ONLY): the band-comparison numbers
 *     pack.json already carries inline for that position, used at reveal
 *     time in place of a live bandData lookup (again, see seedFromPack()).
 *
 * SPOILER RULE (spec 3.3): this module never renders anything -- it only
 * ever hands a caller `answerUci`/`answerSan` inside a plain data object.
 * It is src/browser/drill.client.js's job to keep that value out of the
 * DOM until an attempt or explicit reveal; see that file's own header
 * comment for how it satisfies the binding version of the rule.
 *
 * Card ids use src/bandShards.js's posKeyFor() (play-based cards) / src/
 * ingest/positionWalk.js's fenToEpd+posKeyFromEpd (bare-FEN pack cards) --
 * the SAME position-id scheme the shard files themselves are keyed by,
 * matching the spec's literal `id: BAND|SIDE|POSKEY` format exactly. Both
 * of those modules are genuinely browser-safe as of the WS-1 Repertoire
 * Builder task's bundling fix (src/buildPackCore.js + src/sha1.js, a pure-
 * JS SHA1 replacing bandShards.js's/positionWalk.js's previous Node-only
 * `fs`/`crypto` transitive dependencies) -- see those two files' own
 * header comments. Before that fix landed, this module carried a local
 * non-cryptographic hash workaround for the same reason; removed once the
 * real fix made it unnecessary, so there is exactly one position-id scheme
 * in this codebase, not two.
 */

const { posKeyFor } = require('./bandShards');
const { fenToEpd, posKeyFromEpd } = require('./ingest/positionWalk');
const { newCardState, schedule } = require('./scheduler');
const { getOpening } = require('./openings');

const STORAGE_KEY = 'rb.drill.v2';
const LEGACY_KEY = 'lichess-stats.drill.italian-game.v1';
const MAX_DECK_CARDS = 500;

// Spec 3.2.3's global "at least 300 games" rule, reused here for band-meta
// seeding's own candidate-eligibility check (the same statistical floor
// the Personal Opening Report's leak ranking uses -- one rule sitewide,
// per spec 3.2.3's own "Non-Negotiable 1 protection" reasoning).
const MIN_BAND_GAMES = 300;

const VALID_SOURCES = new Set(['leak', 'band-meta', 'repertoire', 'pack']);

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {{band:string, side:string, posKey:string}} args
 * @returns {string} the spec's literal `id: BAND|SIDE|POSKEY` format.
 */
function makeCardId({ band, side, posKey }) {
  return `${band}|${side}|${posKey}`;
}

/** The canonical posKey for a card seeded from a UCI path. */
function posKeyForPlay(play) {
  return posKeyFor(play).posKey;
}

/** The canonical posKey for a card seeded from a bare FEN (pack source -- no path known). */
function posKeyForFen(fen) {
  return posKeyFromEpd(fenToEpd(fen));
}

/**
 * @returns {{v:2, cards: object[], migratedV1: boolean}} an empty deck.
 */
function newDeck() {
  return { v: 2, cards: [], migratedV1: false };
}

/**
 * Defensively parses a deck read from localStorage -- untrusted on read,
 * same rule bandState.client.js and leakModel.js already follow: JSON.parse
 * inside try/catch, then shape-validated card by card. Any single
 * malformed card is dropped rather than failing the whole deck (a partial
 * write or a future-schema field is a real, non-adversarial failure mode
 * worth degrading from gracefully); an unparseable or non-object document
 * degrades to a fresh empty deck rather than throwing.
 *
 * @param {string|null} raw
 * @returns {{v:2, cards: object[], migratedV1: boolean}}
 */
function parseDeck(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return newDeck();
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return newDeck();
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.cards)) return newDeck();

  const cards = doc.cards.filter((c) => isValidCardShape(c));
  return { v: 2, cards, migratedV1: doc.migratedV1 === true };
}

/**
 * @param {*} c
 * @returns {boolean}
 */
function isValidCardShape(c) {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.id !== 'string' || c.id.length === 0 || c.id.length > 100) return false;
  if (typeof c.band !== 'string' || typeof c.pool !== 'string') return false;
  if (c.side !== 'white' && c.side !== 'black') return false;
  if (!VALID_SOURCES.has(c.source)) return false;
  const hasPlay = Array.isArray(c.play);
  const hasFen = typeof c.fen === 'string' && c.fen.length > 0;
  if (!hasPlay && !hasFen) return false;
  if (hasPlay && c.play.length > 24) return false;
  if (typeof c.answerUci !== 'string' || c.answerUci.length === 0 || c.answerUci.length > 5) return false;
  if (!c.sm2 || typeof c.sm2 !== 'object') return false;
  if (!Number.isInteger(c.sm2.rep) || !isFiniteNumber(c.sm2.ef) || !isFiniteNumber(c.sm2.intervalDays)) return false;
  return true;
}

/**
 * @param {{v:2, cards:object[], migratedV1:boolean}} deck
 * @returns {string}
 */
function serializeDeck(deck) {
  return JSON.stringify(deck);
}

/**
 * Merges `cards` into `deck`, deduping by id (an existing card's sm2
 * progress is NEVER overwritten by a re-seed -- only genuinely new ids are
 * added), capped at MAX_DECK_CARDS.
 *
 * @param {object} deck
 * @param {object[]} cards
 * @returns {{deck:object, addedCount:number, duplicateCount:number, capped:boolean}}
 */
function addCards(deck, cards) {
  const existingIds = new Set(deck.cards.map((c) => c.id));
  const nextCards = deck.cards.slice();
  let addedCount = 0;
  let duplicateCount = 0;
  let capped = false;

  for (const card of cards) {
    if (existingIds.has(card.id)) {
      duplicateCount += 1;
      continue;
    }
    if (nextCards.length >= MAX_DECK_CARDS) {
      capped = true;
      break;
    }
    nextCards.push(card);
    existingIds.add(card.id);
    addedCount += 1;
  }

  return { deck: { ...deck, cards: nextCards }, addedCount, duplicateCount, capped };
}

/**
 * @param {object} deck
 * @param {Date} now
 * @returns {{due:object[], fresh:object[]}} `due` = attempted-before cards
 *   whose dueAt has arrived, sorted earliest-due first. `fresh` = never
 *   attempted (sm2.dueAt is null), in deck order.
 */
function cardsDue(deck, now) {
  const nowMs = now.getTime();
  const due = [];
  const fresh = [];
  for (const card of deck.cards) {
    if (card.sm2.dueAt == null) {
      fresh.push(card);
    } else if (new Date(card.sm2.dueAt).getTime() <= nowMs) {
      due.push(card);
    }
  }
  due.sort((a, b) => new Date(a.sm2.dueAt).getTime() - new Date(b.sm2.dueAt).getTime());
  return { due, fresh };
}

/**
 * Builds one session's card queue: due cards in due-date order, then new
 * cards, capped at `limit` -- spec 3.3's "cards due ... in due-date order,
 * then new cards, capped at a session length the user picks (10 / 25 /
 * all)". `limit: 'all-due'` means only the due cards (no new cards mixed
 * in), matching the hub's "all due" session-length option.
 *
 * @param {object} deck
 * @param {Date} now
 * @param {number|'all-due'} limit
 * @returns {object[]}
 */
function buildSessionQueue(deck, now, limit) {
  const { due, fresh } = cardsDue(deck, now);
  if (limit === 'all-due') return due;
  const queue = due.concat(fresh);
  return typeof limit === 'number' ? queue.slice(0, limit) : queue;
}

/**
 * @param {object} deck
 * @param {string} cardId
 * @param {number} grade 0-5, see scheduler.gradeFromAttempt()
 * @param {Date} now
 * @returns {object} the next deck, with that one card's sm2 state updated.
 */
function applyGrade(deck, cardId, grade, now) {
  const idx = deck.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`applyGrade: no card with id "${cardId}"`);
  }
  const card = deck.cards[idx];
  const sm2 = schedule(card.sm2, grade, now);
  const nextCards = deck.cards.slice();
  nextCards[idx] = { ...card, sm2 };
  return { ...deck, cards: nextCards };
}

/**
 * @param {object} deck
 * @returns {object[]} cards flagged stuck (scheduler.js's ease-hell
 *   mitigation -- spec 2.3(ii)).
 */
function stuckCards(deck) {
  return deck.cards.filter((c) => c.sm2.stuck === true);
}

/**
 * @param {object} deck
 * @param {Date} now
 * @returns {Array<{openingSlug:string|null, openingName:string, total:number, due:number}>}
 *   sorted by due count descending, then total descending -- the hub's
 *   "decks by opening with due counts" list (spec 3.3).
 */
function decksByOpening(deck, now) {
  const { due } = cardsDue(deck, now);
  const dueIds = new Set(due.map((c) => c.id));
  const groups = new Map();
  for (const card of deck.cards) {
    const key = card.openingSlug || card.openingName || 'unknown';
    if (!groups.has(key)) {
      groups.set(key, { openingSlug: card.openingSlug || null, openingName: card.openingName, total: 0, due: 0 });
    }
    const g = groups.get(key);
    g.total += 1;
    if (dueIds.has(card.id)) g.due += 1;
  }
  return Array.from(groups.values()).sort((a, b) => b.due - a.due || b.total - a.total);
}

// ---------------------------------------------------------------------
// SEEDING SOURCE 1: from a leak report (src/leakModel.js's leak-report/1,
// already validated by the caller via leakModel.parse() -- this function
// never re-validates it, same "the caller owns validation" convention
// leakModel.buildLeakReport() itself follows).
// ---------------------------------------------------------------------

/**
 * @param {object} report a leakModel.parse()'d leak-report/1 document.
 * @returns {object[]} one card per leak, answer = that leak's band-best
 *   move (spec 3.3 seeding source 1).
 */
function seedFromLeakReport(report) {
  return report.leaks.map((leak) => {
    const posKey = leak.posKey;
    return {
      id: makeCardId({ band: report.band, side: leak.color, posKey }),
      play: leak.play,
      fen: null,
      answerUci: leak.bandMove.uci,
      answerSan: leak.bandMove.san,
      side: leak.color,
      band: report.band,
      pool: report.pool,
      openingSlug: leak.opening.slug || null,
      openingName: leak.opening.name,
      eco: leak.opening.eco || null,
      source: 'leak',
      sm2: newCardState(),
    };
  });
}

// ---------------------------------------------------------------------
// SEEDING SOURCE 2: from band meta -- walk the shards to the N
// highest-reach positions where the opening's side is to move, answer =
// the band-best move by the SAME rule src/buildPack.js already publishes
// (spec 3.2.3: highest confidence-interval lower bound among candidates
// with bandGames >= 300).
// ---------------------------------------------------------------------

function bandBestMove(moves) {
  const eligible = moves.filter((m) => m.games >= MIN_BAND_GAMES);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, m) => (m.scoreLo > best.scoreLo ? m : best));
}

/**
 * @param {{band:string, pool:string, openingSlug:string, count?:number,
 *   lookupFn: Function, maxDepth?:number, maxIterations?:number}} args
 *   `lookupFn` is src/browser/bandData.client.js's lookup()-shaped
 *   function: ({play, band, pool}) => Promise<{coverage, moves, games}>.
 * @returns {Promise<object[]>} up to `count` cards, deepest-reach-first.
 */
async function seedFromBandMeta({ band, pool, openingSlug, count = 8, lookupFn, maxDepth = 10, maxIterations = 60 }) {
  const opening = getOpening(openingSlug);
  if (!opening) {
    throw new Error(`seedFromBandMeta: unknown opening slug "${openingSlug}"`);
  }
  const side = opening.side;
  const startPlay = opening.line.map((p) => p.uci);

  const cards = [];
  const seenPosKeys = new Set();
  // Best-first frontier ordered by the position's own game count (a reach
  // proxy -- higher n means more real games pass through this node).
  let frontier = [{ play: startPlay, games: Infinity }];
  let iterations = 0;

  while (frontier.length > 0 && cards.length < count && iterations < maxIterations) {
    iterations += 1;
    frontier.sort((a, b) => b.games - a.games);
    const { play } = frontier.shift();
    if (play.length - startPlay.length > maxDepth) continue;

    const sideToMove = play.length % 2 === 0 ? 'white' : 'black';
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential,
    // same "one fetch at a time, best-first" shape as the crawler this
    // walk mirrors (spec 2.1's own reach-weighted best-first expansion).
    const result = await lookupFn({ play, band, pool });
    if (result.coverage !== 'in' || result.moves.length === 0) continue;

    const best = bandBestMove(result.moves);
    if (!best) continue;

    if (sideToMove === side) {
      const posKey = posKeyForPlay(play);
      if (!seenPosKeys.has(posKey)) {
        seenPosKeys.add(posKey);
        cards.push({
          id: makeCardId({ band, side, posKey }),
          play: play.slice(),
          fen: null,
          answerUci: best.uci,
          answerSan: best.san,
          side,
          band,
          pool,
          openingSlug: opening.slug,
          openingName: opening.name,
          eco: opening.ecoHint,
          source: 'band-meta',
          sm2: newCardState(),
        });
      }
      // Continue deeper along the band-best line to find the next
      // own-turn position further into this opening.
      frontier.push({ play: [...play, best.uci], games: result.games });
    } else {
      // Opponent to move: branch into the top 2 replies by games, so the
      // walk covers more than one line rather than a single deepest path.
      const top = result.moves
        .filter((m) => m.games >= MIN_BAND_GAMES)
        .sort((a, b) => b.games - a.games)
        .slice(0, 2);
      for (const mv of top) {
        frontier.push({ play: [...play, mv.uci], games: mv.games });
      }
    }
  }

  return cards;
}

// ---------------------------------------------------------------------
// SEEDING SOURCE 3: from a saved repertoire -- the user's own choices are
// the answers (spec 3.3). Defensive by necessity: src/repertoireModel.js
// (W1a, a parallel task) is this shape's real owner, and may not exist in
// every checkout that builds this module (worktree isolation -- see this
// project's WS-1 spec section 6.2). This function depends only on the
// documented Repertoire/Node shape (spec 3.1: Repertoire = {v:1, id, name,
// side, band, pool, ..., root: Node}, Node = {uci|null, children:[Node],
// note?}), never on repertoireModel.js's actual module -- if that module's
// real shape ever drifts from the spec, W5's integration pass (spec 6.1)
// is where that gets caught, not here.
// ---------------------------------------------------------------------

/**
 * @param {{v:1, side:'white'|'black', band:string, pool:string, root:object}} repertoire
 * @param {{count?:number, maxNodes?:number}} [opts]
 * @returns {object[]} up to `count` cards, shallowest-ply-first.
 */
function seedFromRepertoire(repertoire, { count = 20, maxNodes = 2000 } = {}) {
  if (!repertoire || !repertoire.root || (repertoire.side !== 'white' && repertoire.side !== 'black')) {
    return [];
  }
  const cards = [];
  // BFS (shallowest ply first) rather than DFS, so a capped result covers
  // the repertoire's earliest, highest-value decision points first.
  let queue = [{ node: repertoire.root, play: [] }];
  let visited = 0;

  while (queue.length > 0 && visited < maxNodes) {
    const next = [];
    for (const { node, play } of queue) {
      visited += 1;
      const sideToMove = play.length % 2 === 0 ? 'white' : 'black';
      for (const child of node.children || []) {
        if (typeof child.uci === 'string' && sideToMove === repertoire.side) {
          const posKey = posKeyForPlay(play);
          cards.push({
            id: makeCardId({ band: repertoire.band, side: repertoire.side, posKey }),
            play: play.slice(),
            fen: null,
            answerUci: child.uci,
            answerSan: null,
            side: repertoire.side,
            band: repertoire.band,
            pool: repertoire.pool,
            openingSlug: null,
            openingName: repertoire.name || 'My repertoire',
            eco: null,
            source: 'repertoire',
            sm2: newCardState(),
          });
        }
        next.push({ node: child, play: typeof child.uci === 'string' ? [...play, child.uci] : play });
      }
    }
    queue = next;
    if (cards.length >= count) break;
  }

  return cards.slice(0, count);
}

// ---------------------------------------------------------------------
// SEEDING SOURCE 4 (optional, spec section 8 / absorbed cancelled-task
// scope): from an imported repertoire-pack/1 manifest
// (src/buildPack.js's packJsonFromResult() output -- what a Repertoire
// Pack buyer's pack.json actually contains).
//
// SHAPE GAP, disclosed rather than worked around: pack.json's `positions`
// array (src/buildPack.js's flattenPositions()) carries each node's
// resulting `fen` and the `uci` played INTO it, but NOT the UCI path from
// the start position that reached it -- that path only exists in the
// in-memory tree buildPackTree() builds, never in the serialized file a
// buyer actually downloads. A real drill importer therefore cannot
// reconstruct `play` for a pack-seeded card. This function seeds from
// `fen` directly instead (src/chessPosition.js's boardFromFen(), added
// for exactly this) and uses the pack's own already-published band
// comparison numbers (`n`/`w`/`d`/`l`/`score`/`wilson`) as `packStats` at
// reveal time, rather than a live bandData shard lookup (which would need
// the same missing path to pick a shard). This is a genuine, disclosed
// limitation of pack.json's current schema, not a shortcut -- fixing it
// properly means adding a `play` field to packJsonFromResult(), which
// belongs to whichever task next touches src/buildPack.js, not to W3
// (outside this task's file footprint).
// ---------------------------------------------------------------------

/**
 * @param {{format:string, id:string, title:string, color:'white'|'black',
 *   band:string, positions:object[]}} pack a parsed repertoire-pack/1 doc.
 * @param {{count?:number, pool?:string}} [opts]
 * @returns {object[]} up to `count` cards, in the pack's own (pre-order,
 *   shallowest-branch-first) position order.
 */
function seedFromPack(pack, { count = 20, pool = 'blitz' } = {}) {
  if (!pack || pack.format !== 'repertoire-pack/1' || !Array.isArray(pack.positions)) {
    return [];
  }
  const ourMoves = pack.positions.filter((p) => p.isOurMove === true && typeof p.fen === 'string' && typeof p.uci === 'string');
  const cards = [];
  for (const p of ourMoves) {
    if (cards.length >= count) break;
    const posKey = posKeyForFen(p.fen);
    cards.push({
      id: makeCardId({ band: pack.band, side: pack.color, posKey }),
      play: null,
      fen: p.fen,
      answerUci: p.uci,
      answerSan: p.san,
      side: pack.color,
      band: pack.band,
      pool,
      openingSlug: null,
      openingName: pack.title || 'Imported pack',
      eco: null,
      source: 'pack',
      sm2: newCardState(),
      packStats: {
        n: p.n,
        w: p.w,
        d: p.d,
        l: p.l,
        score: p.score,
        wilson: p.wilson,
      },
    });
  }
  return cards;
}

// ---------------------------------------------------------------------
// LEGACY MIGRATION (spec 3.3: "The old lichess-stats.drill.italian-game.v1
// key is READ ONCE for a one-way migration of level and streak into a
// starter deck, then left alone. Do not delete it.") The old key carries
// only {level, cleanStreak, band} -- no position-level data -- so this is
// an approximate translation (level -> starter-deck size), not a literal
// SM2-state conversion, which the old shape has no data to support. Pure:
// returns a seeding REQUEST, not cards -- the caller (drill.client.js)
// turns that into real cards via seedFromBandMeta() (itself async) and is
// what actually marks migration done.
// ---------------------------------------------------------------------

/**
 * @param {string|null} legacyRaw the raw localStorage value at LEGACY_KEY.
 * @returns {{band:string, count:number}|null} null if there's nothing
 *   (or nothing parseable) to migrate.
 */
function migrationSeedRequest(legacyRaw) {
  if (typeof legacyRaw !== 'string' || legacyRaw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed.level !== 'number' || typeof parsed.band !== 'string') return null;
  const count = Math.max(2, Math.min(8, Math.round(parsed.level * 2)));
  return { band: parsed.band, count };
}

module.exports = {
  STORAGE_KEY,
  LEGACY_KEY,
  MAX_DECK_CARDS,
  MIN_BAND_GAMES,
  newDeck,
  parseDeck,
  serializeDeck,
  isValidCardShape,
  makeCardId,
  addCards,
  cardsDue,
  buildSessionQueue,
  applyGrade,
  stuckCards,
  decksByOpening,
  seedFromLeakReport,
  seedFromBandMeta,
  seedFromRepertoire,
  seedFromPack,
  migrationSeedRequest,
};
