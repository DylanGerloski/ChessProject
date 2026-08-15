'use strict';

/**
 * Pure-JS SHA-1 (RFC 3174), zero dependencies, byte-identical output to
 * Node's `crypto.createHash('sha1').update(str).digest('hex')` for the same
 * UTF-8 input -- verified directly (see test/sha1.test.js) rather than
 * assumed, the same "verified today" discipline this codebase's other
 * hand-rolled/wrapped algorithms document for themselves.
 *
 * Exists because src/ingest/positionWalk.js's posKeyFromEpd() (sha1 of a
 * position's EPD, truncated to 24 hex chars -- this project's canonical
 * position id, WS-1 spec section 4.2) used Node's `node:crypto` directly,
 * which cannot be resolved by esbuild for a browser bundle (there is no
 * browser equivalent of Node's synchronous `crypto.createHash` API --
 * WebCrypto's `crypto.subtle.digest` is a different, async API). Since
 * WS-1's src/browser/bandData.client.js needs to compute the SAME posKey
 * client-side (to look up a position inside an already-fetched shard),
 * posKeyFromEpd must be callable from the browser too. Swapping in this
 * module keeps every already-computed/committed posKey (data/rep/*.json,
 * data/aggregates/*) byte-identical -- same algorithm, just not tied to a
 * Node-only binding -- rather than requiring a re-key or a re-crawl.
 *
 * SHA-1 is used here purely as a fast, well-distributed, non-adversarial
 * content-addressing hash (a position id), never for anything security-
 * sensitive (no signatures, no password storage, no integrity-against-a-
 * malicious-actor guarantee) -- its known cryptographic weaknesses are
 * irrelevant to this use.
 */

function toHexByte(n) {
  return (n < 16 ? '0' : '') + n.toString(16);
}

/**
 * @param {string} str a JS string (UTF-8 encoded before hashing, same as
 *   Node's `crypto` module's own default encoding for `.update(str)`).
 * @returns {string} 40-char lowercase hex SHA-1 digest.
 */
function sha1Hex(str) {
  const bytes = typeof TextEncoder !== 'undefined'
    ? Array.from(new TextEncoder().encode(str))
    : Array.from(Buffer.from(str, 'utf8'));

  // Pre-processing: append 0x80, then zero-pad, then the original bit
  // length as a 64-bit big-endian integer, to a total length that's a
  // multiple of 64 bytes (512 bits) -- RFC 3174 section 4.
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // bitLen fits comfortably in 32 bits for every input this project ever
  // hashes (an EPD string is well under 200 bytes) -- the high 32 bits of
  // the 64-bit length field are always zero here.
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push(0);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((bitLen >>> shift) & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Array(80);
  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    for (let i = 0; i < 16; i += 1) {
      const o = chunkStart + i * 4;
      w[i] = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = ((v << 1) | (v >>> 31)) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((h) => toHexByte((h >>> 24) & 0xff) + toHexByte((h >>> 16) & 0xff) + toHexByte((h >>> 8) & 0xff) + toHexByte(h & 0xff))
    .join('');
}

module.exports = { sha1Hex };
