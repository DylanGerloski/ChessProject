'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Writes an AggregateBuilder.finalize() result to disk as
 * `root.json` + `f/<slug>.json` shards + `manifest.json`. The only I/O in
 * the src/ingest/* module set -- everything else is pure, so this is where
 * the "fail loudly if a shard exceeds 5 MB" gate and the manifest shape
 * actually live.
 */

const MAX_SHARD_BYTES = 5 * 1024 * 1024; // 5 MB -- GitHub blocks any single pushed file over 100 MB, and this keeps every shard far below that with headroom to spare

class ShardTooLargeError extends Error {
  constructor(file, bytes) {
    super(`writeShards: shard "${file}" is ${bytes} bytes, over the ${MAX_SHARD_BYTES}-byte budget -- reduce maxPlies before reducing minGames (position-tree depth costs more bytes than breadth)`);
    this.name = 'ShardTooLargeError';
    this.file = file;
    this.bytes = bytes;
  }
}

function writeJsonFile(filePath, data) {
  const json = JSON.stringify(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, json, 'utf8');
  return Buffer.byteLength(json, 'utf8');
}

/**
 * @param {object} args
 * @param {string} args.outDir e.g. data/aggregates
 * @param {{root: object, families: Map<string, {positions: object}>}} args.finalized
 *   AggregateBuilder.finalize() output.
 * @param {Map<string,string>} [args.familyDisplayNames] slug -> human-readable
 *   family name, for the shard file's own `family` field.
 * @param {object} args.manifestFields fields merged into manifest.json on
 *   top of the computed `shards` array -- see scripts/ingestDump.js for the
 *   exact set (pipelineVersion, dumpMonths, retrievedAt, gamesScanned, ...).
 * @returns {{manifest: object, shardFiles: Array<{file:string, bytes:number, positions:number}>}}
 */
function writeShards({ outDir, finalized, familyDisplayNames = new Map(), manifestFields = {} }) {
  const shardFiles = [];

  const rootBytes = writeJsonFile(path.join(outDir, 'root.json'), finalized.root);
  if (rootBytes > MAX_SHARD_BYTES) throw new ShardTooLargeError('root.json', rootBytes);
  shardFiles.push({
    file: 'root.json',
    bytes: rootBytes,
    positions: countPositions(finalized.root.positions),
  });

  for (const [slug, familyData] of [...finalized.families.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const file = `f/${slug}.json`;
    const payload = {
      family: familyDisplayNames.get(slug) || slug,
      slug,
      positions: familyData.positions,
    };
    const bytes = writeJsonFile(path.join(outDir, file), payload);
    if (bytes > MAX_SHARD_BYTES) throw new ShardTooLargeError(file, bytes);
    shardFiles.push({ file, bytes, positions: countPositions(familyData.positions) });
  }

  const manifest = {
    ...manifestFields,
    shards: shardFiles.map((s) => ({ file: s.file, bytes: s.bytes, positions: s.positions })),
  };
  writeJsonFile(path.join(outDir, 'manifest.json'), manifest);

  return { manifest, shardFiles };
}

function countPositions(positionsByBand) {
  let n = 0;
  for (const byPool of Object.values(positionsByBand)) {
    for (const byPosKey of Object.values(byPool)) {
      n += Object.keys(byPosKey).length;
    }
  }
  return n;
}

module.exports = {
  MAX_SHARD_BYTES,
  ShardTooLargeError,
  writeShards,
  countPositions,
};
