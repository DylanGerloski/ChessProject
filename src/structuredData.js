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

/**
 * DefinedTermSet/DefinedTerm JSON-LD for the ECO-code tiers (T2 volume
 * indexes) -- the semantically correct schema.org type for a classification
 * code, emitted for correctness rather than a rich-result bet -- DefinedTerm
 * is not in Google's rich-results gallery as of this build, and nothing
 * here promises a SERP feature.
 *
 * @param {object} opts
 * @param {string} opts.name this DefinedTermSet's own name (e.g. "ECO
 *   Volume B: Semi-Open Games")
 * @param {string} opts.url this DefinedTermSet's own canonical URL
 * @param {Array<{termCode:string, name:string, url?:string}>} opts.terms
 *   one DefinedTerm per ECO code this set covers. `url`, when given, points
 *   at that code's own family hub page (T1) -- omitted for a code with no
 *   T1 page, never a dangling link to a page that doesn't exist.
 */
function definedTermSetJsonLd({ name, url, terms }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name,
    url,
    hasDefinedTerm: terms.map((t) => ({
      '@type': 'DefinedTerm',
      termCode: t.termCode,
      name: t.name,
      inDefinedTermSet: url,
      ...(t.url ? { url: t.url } : {}),
    })),
  });
}

/**
 * ItemList JSON-LD for a family hub's variation list (T1) or a paginated
 * browse index (T2) -- mirrors exactly what the same page already renders
 * visibly as a list/table, same "structured data mirrors the visible page"
 * rule every other function in this file follows.
 *
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {Array<{name:string, url?:string}>} opts.items in display order.
 *   `url` omitted for an item with no page of its own (rendered as plain
 *   text on the page, never a dangling link) -- schema.org's ListItem does
 *   not require `item` to be present.
 */
function itemListJsonLd({ name, items }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(name ? { name } : {}),
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      ...(it.url ? { item: it.url } : {}),
    })),
  });
}

/**
 * Dataset JSON-LD for the /methodology page (spec WS-3.3 section 3.5) --
 * describes the aggregate corpus every displayed rate on this site is
 * computed from. Genuinely applicable here (unlike FAQPage's removed rich
 * result, see this file's own header comment): a real, described dataset
 * with a real license and a real creator, not a rich-result bet.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.description
 * @param {string} opts.url methodology page's own canonical URL
 * @param {string} [opts.creatorName] defaults to SITE_NAME
 * @param {string} [opts.license] a license URL, e.g. CC0's
 * @param {string[]} [opts.temporalCoverage] `[start, end]` ISO dates (the
 *   manifest's observedGameDateRange) -- schema.org's Dataset.temporalCoverage
 *   expects a single string; this function formats a 2-element array as
 *   "start/end" (the ISO 8601 interval form) and passes a single date
 *   through unchanged.
 */
function datasetJsonLd({ name, description, url, creatorName = SITE_NAME, license, temporalCoverage }) {
  const temporal = Array.isArray(temporalCoverage) && temporalCoverage.length === 2
    ? `${temporalCoverage[0]}/${temporalCoverage[1]}`
    : temporalCoverage || undefined;
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description,
    url,
    creator: { '@type': 'Organization', name: creatorName },
    ...(license ? { license } : {}),
    ...(temporal ? { temporalCoverage: temporal } : {}),
  });
}

/**
 * Product + Offer JSON-LD for one Repertoire Pack sales page (monetization-
 * layer spec 1.9). Only the fields Google's own merchant-listing docs
 * (developers.google.com) mark required or recommended -- REQUIRED name,
 * image, offers; within offers, price/priceCurrency; recommended
 * description/brand/sku/category/availability/url. Deliberately NEVER emits
 * aggregateRating or review -- this site has neither, and inventing either
 * would violate Google's own policy, Non-Negotiable 1 (no monetization
 * decision touches a ranking/recommendation), and the no-dark-patterns rule.
 * A later task must not "helpfully" add them.
 *
 * @param {object} opts
 * @param {string} opts.name pack title, e.g. "White at 1400-1600"
 * @param {string} opts.description
 * @param {string} opts.image absolute URL of the pack's own OG image
 * @param {string} opts.url this pack page's own canonical URL
 * @param {string} opts.offerUrl the STORE link this offer resolves to --
 *   the real merchant URL once live, never emitted while it's still the
 *   PLACEHOLDER sentinel (callers must check isPlaceholderStoreUrl() first
 *   and omit productJsonLd entirely for a not-yet-listed pack, same as the
 *   visible CTA does -- see renderPackPages.js).
 * @param {number} opts.price plain number, e.g. 9
 * @param {string} [opts.sku]
 */
function productJsonLd({ name, description, image, url, offerUrl, price, sku }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    brand: { '@type': 'Brand', name: SITE_NAME },
    category: 'Chess opening repertoire',
    ...(sku ? { sku } : {}),
    offers: {
      '@type': 'Offer',
      url: offerUrl,
      price: String(price),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  });
}

module.exports = {
  jsonLdScript,
  stripHtmlToText,
  breadcrumbJsonLd,
  articleJsonLd,
  faqPageJsonLd,
  homeJsonLd,
  definedTermSetJsonLd,
  itemListJsonLd,
  datasetJsonLd,
  productJsonLd,
};
