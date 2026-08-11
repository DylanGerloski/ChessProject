'use strict';

/**
 * Compliance pages: privacy policy, about, contact, and an ads.txt stub
 * (task-msp18k2w-9f147e). Written per docs/DIRECTIVE Revenue Acceleration
 * Plan.md Section 1 items 2 and 5 and scout's monetization-verification
 * findings (task-msp04yhl-b57b60), which found Google AdSense review
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
 * The privacy policy currently describes GoatCounter analytics (the only
 * analytics live as of this task) and explicitly does NOT claim any
 * advertising currently runs, because none does. If/when a future AdSense
 * (or other ad-network) decision brief is approved, PRIVACY_ADS_SECTION
 * below needs a one-line update to name the actual provider -- flagged here
 * and in this task's --result so it isn't missed.
 */

const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME, BUILD_DATE, absoluteUrl } = require('./site');

/**
 * @param {{nav: object, legalLinks: {privacy:string, about:string, contact:string}}} opts
 * @returns {string} a full standalone HTML document
 */
function renderPrivacyPage({ nav, legalLinks }) {
  const title = `Privacy Policy | ${SITE_NAME}`;
  const description = `What ${SITE_NAME} collects, why, and what it does not: analytics, third-party links, and advertising (currently none).`;
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
    <p>This site does not currently run any advertising. If that changes in the future (for
      example, by joining Google AdSense), this policy will be updated first to name the
      specific ad provider, describe what data it collects (which for most ad networks
      includes cookies or similar identifiers used for personalization), and link to that
      provider's own privacy and opt-out information -- including, for Google specifically,
      <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">how Google uses information from sites that use its services</a>.</p>

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
      (described above) is cookieless. If advertising is added in the future, that will
      typically introduce cookies or similar identifiers from the ad provider, and this
      policy will be updated to say so at that time.</p>

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
 *
 * IMPORTANT: the contact "address" below is a deliberate, clearly-marked
 * placeholder -- per this task's explicit instruction, no real contact
 * address is invented here. A human must replace it with a real,
 * human-controlled email address before this page is relied on (e.g. before
 * submitting the site for AdSense review, which expects a working contact
 * mechanism).
 */
function renderContactPage({ nav, legalLinks }) {
  const title = `Contact | ${SITE_NAME}`;
  const description = `How to reach ${SITE_NAME} with questions, corrections, or privacy requests.`;
  const canonical = absoluteUrl('contact.html');
  const PLACEHOLDER_EMAIL = '[PLACEHOLDER -- replace with a real contact email you control before relying on this page]';

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
      <strong>Placeholder -- not a real address yet.</strong>
      ${escapeHtml(PLACEHOLDER_EMAIL)}
      This text must be replaced with a real, human-controlled email address (or a working
      contact form) before this page is used for anything that depends on it actually
      working -- including AdSense review, which expects a working contact mechanism. No
      email address has been invented here; this is intentionally left for a human to fill
      in.
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
 * ads.txt stub (IAB/Google spec: https://iabtechlab.com/ads-txt/). Not
 * required for AdSense approval (scout's findings, task-msp04yhl-b57b60),
 * but cheap to add now as a comment-only placeholder. Comment lines (`#`)
 * are valid ads.txt content and make no seller claims -- this file
 * authorizes no ad-tech sellers until a real AdSense (or other network)
 * publisher ID is added.
 */
function adsTxtContent() {
  return `# ads.txt for ${SITE_NAME}
# No authorized digital sellers are configured yet -- this is a placeholder.
# ads.txt is not required for Google AdSense approval, but is recommended
# once an ad account exists, to declare authorized sellers of this site's
# ad inventory. See https://iabtechlab.com/ads-txt/ for the spec.
#
# Once an AdSense account is approved, add a line here in the form:
# google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
# (replace pub-XXXXXXXXXXXXXXXX with this site's real AdSense publisher ID)
`;
}

module.exports = {
  renderPrivacyPage,
  renderAboutPage,
  renderContactPage,
  adsTxtContent,
};
