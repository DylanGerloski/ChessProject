'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sha1Hex } = require('../src/sha1');

function nodeSha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

test('sha1Hex matches node:crypto for known test vectors (RFC 3174)', () => {
  assert.equal(sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(
    sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '84983e441c3bd26ebaae4aa1f95129e5e54670f1'
  );
});

test('sha1Hex matches node:crypto across padding-boundary lengths (55-65 bytes)', () => {
  for (let len = 0; len <= 130; len += 1) {
    const input = 'x'.repeat(len);
    assert.equal(sha1Hex(input), nodeSha1(input), `mismatch at length ${len}`);
  }
});

test('sha1Hex matches node:crypto for real EPD-shaped strings', () => {
  const epds = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6',
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -',
  ];
  for (const epd of epds) {
    assert.equal(sha1Hex(epd), nodeSha1(epd));
  }
});

test('sha1Hex matches node:crypto for multi-byte UTF-8 input', () => {
  const s = 'café 日本語 emoji 🎉';
  assert.equal(sha1Hex(s), nodeSha1(s));
});

test('sha1Hex is deterministic and always returns a 40-char lowercase hex string', () => {
  const out = sha1Hex('some input');
  assert.equal(out.length, 40);
  assert.match(out, /^[0-9a-f]{40}$/);
  assert.equal(out, sha1Hex('some input'));
});
