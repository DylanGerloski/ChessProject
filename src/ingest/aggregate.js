'use strict';

/**
 * In-memory counter builder + shard finalizer for the position/move
 * aggregate dataset (see src/ingest/writeShards.js for the on-disk shape).
 *
 * A class with mutating methods, not a pure reducer over an immutable map --
 * disclosed deliberately (the rest of this project's process*.js modules are
 * pure). At dump scale (millions of games, each visiting up to 17 positions)
 * an immutable-update-per-game shape would mean millions of small
 * allocations for no benefit; nothing here is observable from outside a
 * single ingest run, and every method is still plain, synchronous, and I/O
 * free -- callers own reading the source and writing the output.
 *
 * Shard assignment (see src/ingest/familyLookup.js's header comment for how
 * a family slug is derived): a position goes to root.json if the
 * SHALLOWEST ply any game in this run reached it at is <= 6 (root.json's
 * own definition: "every position at ply <= 6"), else to whichever ECO
 * family contributed the most games reaching it (a plurality vote,
 * tie-broken by slug for determinism). Because transposition merging means
 * the same position can legitimately be reached at different plies by
 * different games, "shallowest ply observed in this run" is the only
 * well-defined single answer available -- it is a build-time bucketing
 * choice, not a statistical one: the counts stored are correct regardless
 * of which file they end up in.
 */

const RESULT_LETTERS = ['w', 'd', 'l'];
const UNCLASSIFIED_FAMILY_SLUG = 'unclassified';
const ROOT_MAX_PLY = 6;

function emptyPositionRecord() {
  return {
    w: 0, d: 0, l: 0, bw: 0, bd: 0, bl: 0,
    moves: new Map(),
  };
}

function emptyMoveRecord() {
  return {
    w: 0, d: 0, l: 0, bw: 0, bd: 0, bl: 0,
    ratingSum: 0, ratingCount: 0,
  };
}

class AggregateBuilder {
  constructor() {
    // Map<band, Map<pool, Map<posKey, record>>>
    this.counts = new Map();
    // Map<posKey, {minPly: number, epd: string, familyVotes: Map<slug, count>}>
    this.posMeta = new Map();
    // Map<path (comma-joined uci list), posKey> -- ply 1..ROOT_MAX_PLY only.
    this.pathIndex = new Map();
  }

  _bucket(band, pool) {
    if (!this.counts.has(band)) this.counts.set(band, new Map());
    const byPool = this.counts.get(band);
    if (!byPool.has(pool)) byPool.set(pool, new Map());
    return byPool.get(pool);
  }

  _record(bucket, posKey) {
    if (!bucket.has(posKey)) bucket.set(posKey, emptyPositionRecord());
    return bucket.get(posKey);
  }

  _touchMeta(posKey, ply, epd, familySlug) {
    if (!this.posMeta.has(posKey)) {
      this.posMeta.set(posKey, { minPly: ply, epd, familyVotes: new Map() });
    }
    const meta = this.posMeta.get(posKey);
    if (ply < meta.minPly) meta.minPly = ply;
    if (familySlug) {
      meta.familyVotes.set(familySlug, (meta.familyVotes.get(familySlug) || 0) + 1);
    }
  }

  /**
   * Records one game's full walked path: every position along the path gets
   * a "reached" count, and every edge between consecutive positions gets
   * its own move count.
   *
   * @param {{band: string, pool: string, balanced: boolean, avgElo: number,
   *   resultLetter: 'w'|'d'|'l', nodes: Array, familySlug: string|null}} args
   *   `nodes` is src/ingest/positionWalk.js's walkPositions() output.
   */
  addGame({ band, pool, balanced, avgElo, resultLetter, nodes, familySlug }) {
    if (!RESULT_LETTERS.includes(resultLetter)) {
      throw new Error(`AggregateBuilder.addGame: invalid resultLetter "${resultLetter}"`);
    }
    const bucket = this._bucket(band, pool);

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const record = this._record(bucket, node.posKey);
      record[resultLetter] += 1;
      if (balanced) record[`b${resultLetter}`] += 1;
      this._touchMeta(node.posKey, node.ply, node.epd, familySlug);

      if (i > 0) {
        const prev = nodes[i - 1];
        const prevRecord = this._record(bucket, prev.posKey);
        if (!prevRecord.moves.has(node.move.uci)) {
          prevRecord.moves.set(node.move.uci, emptyMoveRecord());
        }
        const moveRecord = prevRecord.moves.get(node.move.uci);
        moveRecord[resultLetter] += 1;
        if (balanced) moveRecord[`b${resultLetter}`] += 1;
        if (Number.isFinite(avgElo)) {
          moveRecord.ratingSum += avgElo;
          moveRecord.ratingCount += 1;
        }
      }

      if (node.ply >= 1 && node.ply <= ROOT_MAX_PLY) {
        const path = nodes.slice(1, i + 1).map((n) => n.move.uci).join(',');
        this.pathIndex.set(path, node.posKey);
      }
    }
  }

  /** Plurality-vote family slug for a posKey, tie-broken alphabetically. */
  _familyForPosKey(posKey) {
    const meta = this.posMeta.get(posKey);
    if (!meta || meta.familyVotes.size === 0) return UNCLASSIFIED_FAMILY_SLUG;
    let best = null;
    let bestCount = -1;
    for (const [slug, count] of [...meta.familyVotes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (count > bestCount) {
        best = slug;
        bestCount = count;
      }
    }
    return best;
  }

  _shardForPosKey(posKey) {
    const meta = this.posMeta.get(posKey);
    if (meta && meta.minPly <= ROOT_MAX_PLY) return { shard: 'root' };
    return { shard: 'family', slug: this._familyForPosKey(posKey) };
  }

  /**
   * Converts one in-memory position record into the JSON-shaped tuple
   * `[w, d, l, bw, bd, bl, movesObj]`. `movesObj` values extend the
   * 6-integer w/d/l/bw/bd/bl move tuple with two trailing integers
   * (`ratingSum`, `ratingCount`) -- a disclosed, necessary extension: the
   * adapter in src/aggregateSource.js needs to report `averageRating` on
   * every move (matching the live Opening Explorer API's own response
   * shape), which is only derivable if the raw sum and count are stored;
   * storing only the 6-integer tuple would make that unsatisfiable.
   * Position-level tuples are left at exactly 6 integers, since nothing
   * downstream needs a position-level average rating.
   */
  _toJsonRecord(record) {
    const moves = {};
    for (const [uci, m] of record.moves.entries()) {
      moves[uci] = [m.w, m.d, m.l, m.bw, m.bd, m.bl, m.ratingSum, m.ratingCount];
    }
    return [record.w, record.d, record.l, record.bw, record.bd, record.bl, moves];
  }

  /**
   * @param {{minGames?: number}} [opts]
   * @returns {{root: {positions: object, pathIndex: object},
   *   families: Map<string, {positions: object}>,
   *   positionCount: number, filteredCount: number}}
   */
  finalize({ minGames = 50 } = {}) {
    const root = { positions: {}, pathIndex: Object.fromEntries(this.pathIndex) };
    const families = new Map();
    let positionCount = 0;
    let filteredCount = 0;

    for (const [band, byPool] of this.counts.entries()) {
      for (const [pool, byPosKey] of byPool.entries()) {
        for (const [posKey, record] of byPosKey.entries()) {
          const total = record.w + record.d + record.l;
          if (total < minGames) {
            filteredCount += 1;
            continue;
          }
          positionCount += 1;

          const target = this._shardForPosKey(posKey);
          let destination;
          if (target.shard === 'root') {
            destination = root.positions;
          } else {
            if (!families.has(target.slug)) families.set(target.slug, { positions: {} });
            destination = families.get(target.slug).positions;
          }
          if (!destination[band]) destination[band] = {};
          if (!destination[band][pool]) destination[band][pool] = {};
          destination[band][pool][posKey] = this._toJsonRecord(record);
        }
      }
    }

    return { root, families, positionCount, filteredCount };
  }
}

module.exports = {
  AggregateBuilder,
  ROOT_MAX_PLY,
  UNCLASSIFIED_FAMILY_SLUG,
};
