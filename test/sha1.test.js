'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { sha1Hex } = require('../src/sha1');

function nodeSha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

test('sha1Hex matches Node\'s crypto.createHash("sha1") for known test vectors', () => {
  const vectors = [
    '',
    'a',
    'abc',
    'The quick brown fox jumps over the lazy dog',
  ];
  for (const v of vectors) {
    assert.equal(sha1Hex(v), nodeSha1(v), `mismatch for ${JSON.stringify(v)}`);
  }
});

test('sha1Hex matches Node\'s crypto for real EPD-shaped strings (posKeyFromEpd\'s actual input shape)', () => {
  const epds = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -',
  ];
  for (const epd of epds) {
    assert.equal(sha1Hex(epd), nodeSha1(epd));
  }
});

test('sha1Hex matches Node\'s crypto across every message-length boundary the padding scheme has to handle correctly (55/56/57/63/64/65 bytes, and longer)', () => {
  for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000]) {
    const s = 'x'.repeat(len);
    assert.equal(sha1Hex(s), nodeSha1(s), `mismatch at length ${len}`);
  }
});

test('sha1Hex matches Node\'s crypto for 300 random strings (fuzz)', () => {
  for (let i = 0; i < 300; i += 1) {
    const len = Math.floor(Math.random() * 300);
    const s = crypto.randomBytes(len).toString('hex').slice(0, len);
    assert.equal(sha1Hex(s), nodeSha1(s), `mismatch for random string of length ${len}: ${JSON.stringify(s)}`);
  }
});

test('sha1Hex returns a 40-char lowercase hex string', () => {
  const out = sha1Hex('anything');
  assert.equal(out.length, 40);
  assert.match(out, /^[0-9a-f]{40}$/);
});
