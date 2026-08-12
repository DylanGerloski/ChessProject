'use strict';

/**
 * schema.org JSON-LD builders. A SEPARATE module from render.js for the
 * same reason renderContent.js and renderCompliance.js are (see those
 * files' own header comments): none of this is ever concatenated into the
 * browser bundle, so it may safely require() site.js. Every function here
 * returns a ready-to-embed `<script type="application/ld+json">...</script>`
 * string (or `''`), built with jsonLdScript() below so escaping is handled
 * in exactly one place.
 *
 * Only four types are implemented: BreadcrumbList, Article, FAQPage, and
 * WebSite/Organization on the home page. FAQ rich results were removed by
 * Google on 2026-05-07 and HowTo/the sitelinks searchbox were deprecated
 * earlier -- FAQPage is still emitted once (parsing value for search/LLM
 * crawlers, not a rich-result bet), and HowTo/SoftwareApplication are
 * deliberately NOT used anywhere, since without offers or ratings a
 * SoftwareApplication block would produce no rich result and this site has
 * no legitimate ratings to attach. Every block here describes only what is
 * actually visible on the page it's attached to -- no fabricated ratings,
 * offers, or byline.
 */

const { absoluteUrl, SITE_NAME } = require('./site');

/**
 * Serializes `obj` as JSON-LD and wraps it in a <script> tag. Escapes every
 * `<` as its unicode escape so a `</script` sequence occurring inside a
 * title/description string (however unlikely given this site's own
 * generated content) can never prematurely close the tag or otherwise
 * confuse an HTML parser -- a standard, simple technique for embedding JSON
 * inside a <script> block.
 */
function jsonLdScript(obj) {
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * Plain-text version of a small HTML snippet, for schema.org fields (like
 * FAQPage's Answer.text) that expect text rather than markup. Strips tags
 * and decodes the small, fixed set of named entities this codebase actually
 * emits in prose (see src/buildContent.js / src/renderContent.js) --
 * NOT a general-purpose HTML entity decoder.
 */
function stripHtmlToText(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&rarr;/g, '->')
    .replace(/&mdash;/g, '-')
    .replace(/&middot;/g, '-')
    // Curly quotes/apostrophes (design-standards.md 4.1) are for visible
    // prose only -- a curly quote inside a structured-data string is a
    // correctness bug, so these decode to their plain ASCII equivalent here
    // rather than to the actual Unicode curly character.
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * BreadcrumbList JSON-LD, mirroring exactly what renderContent.js's
 * renderBreadcrumb() already renders visibly on the same page -- same
 * `items` array (each `{label, href}`; `href` is a flat filename like
 * 'openings.html', resolved to an absolute URL here). Pass `href` on every
 * item, including the current (last) page -- renderBreadcrumb() already
 * treats the last item as non-linked regardless of whether `href` is
 * present, so supplying it here does not change the rendered breadcrumb,
 * it only lets the structured data include a `item` URL for every step,
 * which is what Google's own BreadcrumbList guidance recommends.
 *
 * @param {Array<{label:string, href?:string}>} items
 */
function breadcrumbJsonLd(items) {
  const itemListElement = items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.label,
    ...(item.href ? { item: absoluteUrl(item.href) } : {}),
  }));
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  });
}

/**
 * Article JSON-LD for one editorial guide page. `authorName`/`publisherName`
 * are expected to be src/site.js's SITE_AUTHOR/SITE_NAME (an Organization,
 * not an invented person -- see that file's own comment; nobody involved in
 * producing this site's articles is a named, reviewed human author, so
 * attributing them to one would be a false claim, not just an omission).
 *
 * @param {object} opts
 * @param {string} opts.headline recommended <=110 chars for Google's own display limit
 * @param {string} opts.description
 * @param {string} opts.datePublished ISO date (YYYY-MM-DD)
 * @param {string} opts.dateModified ISO date (YYYY-MM-DD)
 * @param {string} opts.url absolute canonical URL of this article
 * @param {string} [opts.authorName]
 * @param {string} [opts.publisherName]
 */
function articleJsonLd({ headline, description, datePublished, dateModified, url, authorName = SITE_NAME, publisherName = SITE_NAME }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    datePublished,
    dateModified,
    author: { '@type': 'Organization', name: authorName },
    publisher: { '@type': 'Organization', name: publisherName },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  });
}

/**
 * FAQPage JSON-LD. Only ever attach this to the single FAQ page -- Google
 * restricted FAQ rich results to government/health sites in August 2023 and
 * removed them entirely on 2026-05-07, so this is included once for
 * search/LLM crawler parsing value, not as a rich-result bet, and spreading
 * it across other pages chasing a SERP feature that no longer exists would
 * be exactly the kind of markup abuse search engines penalize.
 *
 * @param {Array<{question:string, answerHtml:string}>} faqs same shape as
 *   src/buildContent.js's buildFaqEntries() output.
 */
function faqPageJsonLd(faqs) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: stripHtmlToText(f.answerHtml) },
    })),
  });
}

/**
 * WebSite + Organization JSON-LD for the home page only. Deliberately NO
 * sitelinks SearchBox `potentialAction` -- Google retired that feature, and
 * this site has no on-site search to back it anyway.
 *
 * @param {object} opts
 * @param {string} opts.url absolute site root URL
 * @param {string} [opts.name]
 * @param {string} [opts.description]
 */
function homeJsonLd({ url, name = SITE_NAME, description }) {
  const website = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url,
    ...(description ? { description } : {}),
  });
  const organization = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
  });
  return `${website}\n  ${organization}`;
}

module.exports = {
  jsonLdScript,
  stripHtmlToText,
  breadcrumbJsonLd,
  articleJsonLd,
  faqPageJsonLd,
  homeJsonLd,
};
