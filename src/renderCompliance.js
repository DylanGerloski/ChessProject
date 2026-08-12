'use strict';

/**
 * Compliance pages: privacy policy, about, contact, and an ads.txt stub.
 * Google AdSense review
 * requires a privacy policy, an about page, and a contact page (ads.txt is
 * recommended, not required). A SEPARATE module from render.js for the same
 * reason renderContent.js is (see that file's own header comment): these
 * pages are never bundled into the browser-side player-lookup script, so
 * this file may safely require() render.js/site.js.
 *
 * Static-only, like renderContent.js: every page here is fully pre-rendered
 * HTML built by src/buildStatic.js. The local dev server (src/server.js) has
 * no routes for these pages and none are added here -- they only matter for
 * the GitHub Pages static build, which is what AdSense review (or a human
 * visitor) would actually see.
 *
 * The privacy policy describes GoatCounter analytics and Google AdSense,
 * the two data collectors actually live on this site. AdSense was approved
 * 2026-08-12 (publisher ID ca-pub-9767914878112531) -- the ad script lives in
 * renderDocumentHead (src/render.js) so it loads on every page, and the
 * matching ads.txt line lives in adsTxtContent below.
 */

const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME, BUILD_DATE, absoluteUrl } = require('./site');

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderPrivacyPage({ nav, legalLinks }) {
  const title = `Privacy Policy | ${SITE_NAME}`;
  const description = `What ${SITE_NAME} collects, why, and what it does not: analytics, third-party links, and advertising (Google AdSense).`;
  const canonical = absoluteUrl('privacy.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
  ${renderHeader(nav)}
  <main class="prose">
    <h1 class="page-title">Privacy Policy</h1>
    <p class="subtitle">Effective ${escapeHtml(BUILD_DATE)}</p>

    <h2>What this site is</h2>
    <p>${escapeHtml(SITE_NAME)} is a set of static pages showing chess opening and rating
      statistics computed from Lichess's public API and Opening Explorer. There are no user
      accounts, no logins, and no forms that collect personal information anywhere on this
      site (the player-lookup page sends only the Lichess username you type directly to
      Lichess's own public API, from your browser -- this site's own servers never see or
      store it).</p>

    <h2>Analytics</h2>
    <p>This site uses <a href="https://www.goatcounter.com/" target="_blank" rel="noopener noreferrer">GoatCounter</a>,
      a privacy-focused analytics tool, to count page views. GoatCounter's default
      configuration does not use tracking cookies and does not collect personally
      identifying information; it records aggregate counts of visits, pages viewed, and
      referring sites. See
      <a href="https://www.goatcounter.com/privacy" target="_blank" rel="noopener noreferrer">GoatCounter's own privacy policy</a>
      for exactly what it collects and retains.</p>

    <h2>Advertising</h2>
    <p>This site runs <a href="https://www.google.com/adsense/" target="_blank" rel="noopener noreferrer">Google AdSense</a>.
      Google and its advertising partners may use cookies or similar identifiers to show ads
      based on your visits to this and other sites. You can see and control what Google knows
      for ad personalization at
      <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google's Ad Settings</a>,
      and read more about how this works at
      <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">how Google uses information from sites that use its services</a>
      and <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">how Google uses data in advertising</a>.
      This site's own code does not read, set, or have access to any AdSense cookie or
      identifier -- that data goes directly between your browser and Google.</p>

    <h2>Third-party links</h2>
    <p>Pages on this site link out to <a href="https://lichess.org" target="_blank" rel="noopener noreferrer">lichess.org</a>
      for game analysis and data, and to voluntary support links
      (<a href="https://ko-fi.com/dylangerloski" target="_blank" rel="noopener noreferrer">Ko-fi</a>,
      <a href="https://buymeacoffee.com/dylanger254" target="_blank" rel="noopener noreferrer">Buy Me a Coffee</a>).
      Each of those is operated by its own company under its own privacy policy -- review
      theirs before using them. See the disclosure note in this site's footer for more on
      those links.</p>

    <h2>Cookies</h2>
    <p>This site's own code does not set any cookies. GoatCounter's default configuration
      (described above) is cookieless. Google AdSense (described above under Advertising)
      does use cookies or similar identifiers, set directly by Google, not by this site --
      see the Advertising section above for how to control that.</p>

    <h2>Children's privacy</h2>
    <p>This site is not directed at children and does not knowingly collect information from
      anyone under 13.</p>

    <h2>Changes to this policy</h2>
    <p>This policy may be updated as the site changes (for example, if advertising or new
      analytics are added). The effective date above reflects the most recent update.</p>

    <h2>Contact</h2>
    <p>Questions about this policy? See the <a href="${escapeHtml(legalLinks.contact)}">Contact page</a>.</p>
  </main>
  ${renderFooter('This is the privacy policy for the whole site.', legalLinks)}
</body>
</html>
`;
}

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderAboutPage({ nav, legalLinks }) {
  const title = `About | ${SITE_NAME}`;
  const description = `${SITE_NAME} shows chess opening and rating statistics computed directly from Lichess's public data -- what this site is and how it works.`;
  const canonical = absoluteUrl('about.html');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
  ${renderHeader(nav)}
  <main class="prose">
    <h1 class="page-title">About ${escapeHtml(SITE_NAME)}</h1>

    <h2>What this is</h2>
    <p>${escapeHtml(SITE_NAME)} shows chess opening win rates, common replies, and rating-band
      repertoire trees, all computed directly from real games via Lichess's public API and
      Opening Explorer. Nothing here is opinion or an engine evaluation dressed up as
      statistics -- every percentage, table, and "common mistake" callout on this site traces
      back to an actual count of games played at that rating.</p>

    <h2>Why it exists</h2>
    <p>Most opening guides describe a line in the abstract, without saying how it actually
      performs for players at your own rating. This site pairs each opening with the data:
      how it scores at 1400-1600 versus 2000+, what opponents actually play in reply (not
      just the "book" line), and where real games at your rating band tend to go wrong.</p>

    <h2>How it's built</h2>
    <p>Every page is generated from Lichess's public, keyless Opening Explorer API and the
      general Lichess API -- no proprietary or private data source is used. Pages are
      pre-rendered as plain static HTML; the player-lookup page is the one exception, calling
      Lichess's API directly from your browser so it can look up any username on demand.</p>

    <h2>Who runs this</h2>
    <p>This site is independently run. No individually-attributed author byline is published
      on these pages at this time -- where authorship needs to be named (for example, in
      structured data on article pages), it is attributed to ${escapeHtml(SITE_NAME)} as a
      publisher rather than to an invented person.</p>

    <h2>Support</h2>
    <p>This site is free to use. If you find it useful, voluntary support links appear in the
      footer of every page (Ko-fi, Buy Me a Coffee) -- see the disclosure note there for what
      that does and doesn't mean.</p>

    <h2>Questions</h2>
    <p>See the <a href="${escapeHtml(legalLinks.contact)}">Contact page</a>.</p>
  </main>
  ${renderFooter('Data source for every page on this site: <a href="https://lichess.org/api">lichess.org/api</a>.', legalLinks)}
</body>
</html>
`;
}

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderContactPage({ nav, legalLinks }) {
  const title = `Contact | ${SITE_NAME}`;
  const description = `How to reach ${SITE_NAME} with questions, corrections, or privacy requests.`;
  const canonical = absoluteUrl('contact.html');
  const CONTACT_EMAIL = 'dylanger2525@gmail.com';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
  ${renderHeader(nav)}
  <main class="prose">
    <h1 class="page-title">Contact</h1>

    <p>Questions, corrections (for example, a wrong move order or a stat that looks off), or
      privacy requests? Reach out using the contact method below.</p>

    <p class="callout">
      <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>
    </p>

    <p>See also the <a href="${escapeHtml(legalLinks.privacy)}">Privacy policy</a> and
      <a href="${escapeHtml(legalLinks.about)}">About page</a>.</p>
  </main>
  ${renderFooter('This is the contact page for the whole site.', legalLinks)}
</body>
</html>
`;
}

/**
 * ads.txt (IAB/Google spec: https://iabtechlab.com/ads-txt/), declaring
 * Google AdSense as an authorized seller of this site's ad inventory, per
 * the approved account (publisher ID ca-pub-9767914878112531).
 */
function adsTxtContent() {
  return `# ads.txt for ${SITE_NAME}
# Declares authorized sellers of this site's ad inventory.
# See https://iabtechlab.com/ads-txt/ for the spec.
google.com, pub-9767914878112531, DIRECT, f08c47fec0942fa0
`;
}

module.exports = {
  renderPrivacyPage,
  renderAboutPage,
  renderContactPage,
  adsTxtContent,
};
