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

test('renderPrivacyPage produces a full document mentioning GoatCounter, Google AdSense, and links to the contact page', () => {
  const html = renderPrivacyPage({ nav: NAV, legalLinks: LEGAL_LINKS });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>Privacy Policy \| Lichess Stats<\/title>/);
  assert.match(html, /GoatCounter/);
  assert.match(html, /Google AdSense/);
  assert.match(html, /adssettings\.google\.com/);
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

test('renderContactPage produces a full document with a real, working mailto contact address', () => {
  const html = renderContactPage({ nav: NAV, legalLinks: LEGAL_LINKS });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>Contact \| Lichess Stats<\/title>/);
  assert.match(html, /href="mailto:dylanger2525@gmail\.com"/);
  assert.match(html, /dylanger2525@gmail\.com/);
});

test('adsTxtContent declares the approved AdSense publisher as an authorized DIRECT seller', () => {
  const txt = adsTxtContent();
  assert.match(txt, /^# ads\.txt for/);
  assert.match(txt, /^google\.com, pub-9767914878112531, DIRECT, f08c47fec0942fa0$/m);
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
