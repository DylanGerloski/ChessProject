'use strict';

/**
 * A standalone, dependency-free SHA-1 implementation (FIPS 180-4),
 * synchronous, Node + browser safe. Exists ONLY because
 * src/ingest/positionWalk.js's posKeyFromEpd() -- and therefore
 * src/bandShards.js's posKeyFor(), which src/browser/bandData.client.js
 * (the runtime read path every WS-1 client surface uses) calls -- needs a
 * SYNCHRONOUS hash. Node's own `crypto.createHash('sha1')` is not
 * available to a browser bundle (esbuild's `platform: 'browser'` does not
 * polyfill Node builtins), and the Web Crypto API's equivalent
 * (`crypto.subtle.digest`) is asynchronous, which would force posKeyFor()
 * to become async and ripple through every synchronous call site across
 * this codebase for no correctness gain. SHA-1 is a fully standardized,
 * deterministic algorithm -- ANY correct implementation produces the exact
 * same digest for the same input, so this is a safe drop-in: it does not
 * invalidate a single already-committed shard's posKey (test/sha1.test.js
 * asserts this module's output matches Node's `crypto.createHash('sha1')`
 * byte-for-byte across a range of inputs, including every real EPD string
 * in the checked-in fixture/crawled shard data).
 *
 * NOT for anything security-sensitive (SHA-1 is long broken as a
 * collision-resistant primitive for adversarial input) -- this project only
 * ever uses it as a stable, compact content-address for a chess position,
 * never to authenticate or sign anything. That's the same posture
 * src/ingest/positionWalk.js's own header comment already documents.
 */

function toHexPair(byte) {
  return byte.toString(16).padStart(2, '0');
}

/**
 * @param {string} message a UTF-8 string (this project only ever hashes
 *   ASCII EPD strings, but this implementation is correct for any string).
 * @returns {string} the 40-char lowercase hex SHA-1 digest.
 */
function sha1Hex(message) {
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(message)
    : Buffer.from(message, 'utf8');

  const bitLength = bytes.length * 8;
  // Padding: 0x80, then zeros, until length % 64 === 56, then the original
  // bit length as a big-endian 64-bit integer.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // bitLength fits comfortably in 32 bits for anything this project hashes
  // (EPD strings are well under 2^32 bits long) -- write the high 32 bits
  // as zero explicitly for correctness at any length, low 32 bits as the
  // real value.
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);

  let h0 = 0x67452301;
  let h1 = 0xEFCDAB89;
  let h2 = 0x98BADCFE;
  let h3 = 0x10325476;
  let h4 = 0xC3D2E1F0;

  const w = new Int32Array(80);

  for (let chunkStart = 0; chunkStart < paddedLength; chunkStart += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getInt32(chunkStart + i * 4, false);
    }
    for (let i = 16; i < 80; i += 1) {
      const val = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (val << 1) | (val >>> 31);
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
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setInt32(0, h0, false);
  outView.setInt32(4, h1, false);
  outView.setInt32(8, h2, false);
  outView.setInt32(12, h3, false);
  outView.setInt32(16, h4, false);

  let hex = '';
  for (let i = 0; i < out.length; i += 1) hex += toHexPair(out[i]);
  return hex;
}

module.exports = { sha1Hex };
