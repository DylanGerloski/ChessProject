'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderPrivacyPage,
  renderAboutPage,
  renderContactPage,
  adsTxtContent,
} = require('../src/renderCompliance');
const { renderFooter, renderDisclosure } = require('../src/render');

const NAV = { player: 'player.html', repertoire: 'index.html', openings: 'openings.html' };
const LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html' };

test('renderPrivacyPage produces a full document mentioning GoatCounter, no current advertising, and links to the contact page', () => {
  const html = renderPrivacyPage({ nav: NAV, legalLinks: LEGAL_LINKS });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>Privacy Policy \| Lichess Stats<\/title>/);
  assert.match(html, /GoatCounter/);
  assert.match(html, /does not currently run any advertising/);
  assert.match(html, /href="contact\.html"/);
  assert.match(html, /<link rel="canonical" href="[^"]*privacy\.html">/);
});

test('renderAboutPage produces a full document and does not invent a personal author name', () => {
  const html = renderAboutPage({ nav: NAV, legalLinks: LEGAL_LINKS });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>About \| Lichess Stats<\/title>/);
  assert.match(html, /No individually-attributed author byline/);
  assert.match(html, /href="contact\.html"/);
});

test('renderContactPage produces a full document with a clearly-marked placeholder, not a real address', () => {
  const html = renderContactPage({ nav: NAV, legalLinks: LEGAL_LINKS });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>Contact \| Lichess Stats<\/title>/);
  assert.match(html, /Placeholder -- not a real address yet/);
  assert.match(html, /PLACEHOLDER/);
  // Sanity check: no plausible real-looking email address (word@word.tld) appears
  // anywhere outside the placeholder bracket text itself.
  assert.doesNotMatch(html, /[a-zA-Z0-9._%+-]+@(?!example\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
});

test('adsTxtContent is a comment-only stub that authorizes no real seller yet', () => {
  const txt = adsTxtContent();
  assert.match(txt, /^# ads\.txt for/);
  for (const line of txt.split('\n').filter((l) => l.trim().length > 0)) {
    assert.ok(line.trim().startsWith('#'), `expected every non-blank ads.txt stub line to be a comment, got: ${line}`);
  }
  assert.doesNotMatch(txt, /^google\.com, pub-\d/m);
});

test('renderFooter always includes the affiliate/support-link disclosure, with or without legalLinks', () => {
  const withoutLegal = renderFooter('footer copy');
  assert.match(withoutLegal, /Disclosure:/);
  assert.doesNotMatch(withoutLegal, /legal-links/);

  const withLegal = renderFooter('footer copy', LEGAL_LINKS);
  assert.match(withLegal, /Disclosure:/);
  assert.match(withLegal, /class="legal-links"/);
  assert.match(withLegal, /href="privacy\.html">Privacy policy<\/a>/);
  assert.match(withLegal, /href="about\.html">About<\/a>/);
  assert.match(withLegal, /href="contact\.html">Contact<\/a>/);
});

test('renderDisclosure is a standalone snippet that mentions both current support links and possible future affiliate links', () => {
  const html = renderDisclosure();
  assert.match(html, /Ko-fi/);
  assert.match(html, /Buy Me a Coffee/);
  assert.match(html, /affiliate links/);
  assert.match(html, /class="disclosure-note"/);
});
