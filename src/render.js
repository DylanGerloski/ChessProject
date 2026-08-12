'use strict';

/**
 * Rendering layer: a pure function that turns already-processed data into an
 * HTML string. No framework, no templating engine -- just template
 * literals. Kept separate from build.js/server.js so it can be reused by
 * both the static generator and the local dev server.
 *
 * This file is also concatenated verbatim (see buildStatic.js's
 * bundleBrowserModule) into the client-side bundle that runs directly in a
 * visitor's browser for the static player-lookup page. That means it MUST
 * NOT use CommonJS module loading anywhere at the top level -- there is no
 * such loader in that context. The shared design system below (SITE_CSS
 * / FAVICON_DATA_URI) is therefore defined as plain constants right here,
 * not pulled in from a separate module, so render.js stays the single
 * source of truth for markup AND styling that both server.js and
 * buildStatic.js import from, with nothing to drift.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shared design tokens + component styles, used identically by every page
 * across both the local dev server (src/server.js) and the static build
 * (dist/*.html via src/buildStatic.js). One palette, deliberately: a
 * restrained, chess-appropriate ink-and-parchment scheme (no dark-mode
 * toggle -- see task scope).
 */
const SITE_CSS = `
  :root {
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-serif: Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif;

    --color-bg: #f5f1e6;
    --color-surface: #ffffff;
    --color-surface-alt: #ece3cd;
    --color-border: #ddd0ac;
    --color-text: #23271f;
    --color-muted: #6b6a5c;
    --color-accent: #3c6e52;
    --color-accent-dark: #2a4d3a;
    --color-accent-contrast: #f8f5ea;
    --color-hover: rgba(60, 110, 82, 0.08);
    --color-focus: #c97a2e;

    --color-win: #2f7d43;
    --color-win-bg: #e3f2e6;
    --color-draw: #93731c;
    --color-draw-bg: #f4ecd2;
    --color-loss: #b23b30;
    --color-loss-bg: #fbe4e0;

    --text-xs: 0.75rem;
    --text-sm: 0.875rem;
    --text-base: 1rem;
    --text-md: 1.125rem;
    --text-lg: 1.375rem;
    --text-xl: 1.875rem;
    --text-2xl: 2.25rem;

    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-5: 1.5rem;
    --space-6: 2rem;
    --space-7: 3rem;

    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 16px;
    --radius-pill: 999px;

    --shadow-sm: 0 1px 2px rgba(35, 39, 31, 0.08);
    --shadow-md: 0 8px 24px rgba(35, 39, 31, 0.10);

    --color-board-light: #ece3cd;
    --color-board-dark: #c2ad82;
  }

  * { box-sizing: border-box; }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  html { background: var(--color-bg); }

  body {
    font-family: var(--font-sans);
    background: var(--color-bg);
    color: var(--color-text);
    max-width: 880px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4) var(--space-7);
    line-height: 1.55;
    font-size: var(--text-base);
  }

  main { display: block; }

  a { color: var(--color-accent-dark); }
  a:hover { color: var(--color-accent); }

  :focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .site-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    margin-bottom: var(--space-5);
    border-bottom: 2px solid var(--color-border);
  }

  .brand {
    font-family: var(--font-serif);
    font-weight: 700;
    font-size: var(--text-md);
    color: var(--color-accent-dark);
    letter-spacing: 0.01em;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6em;
    height: 1.6em;
    border-radius: var(--radius-pill);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    font-size: 0.95em;
  }

  .site-nav { display: flex; gap: var(--space-2); flex-wrap: wrap; }

  .site-nav a {
    color: var(--color-text);
    text-decoration: none;
    font-size: var(--text-sm);
    font-weight: 600;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    transition: background-color 120ms ease, color 120ms ease;
  }

  .site-nav a:hover { background: var(--color-hover); color: var(--color-accent-dark); }
  .site-nav a[aria-current="page"] { background: var(--color-accent-dark); color: var(--color-accent-contrast); }

  h1, h2, h3 { font-family: var(--font-serif); color: var(--color-accent-dark); line-height: 1.2; }
  h1.page-title { font-size: var(--text-2xl); margin: 0; }
  h2 { font-size: var(--text-lg); margin: var(--space-6) 0 var(--space-3); }
  h3 { font-size: var(--text-md); margin: var(--space-5) 0 var(--space-2); }

  .subtitle { color: var(--color-muted); margin: var(--space-2) 0 0; font-size: var(--text-base); }

  .empty-note {
    color: var(--color-muted);
    background: var(--color-surface-alt);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }

  .table-hint {
    display: none;
    font-size: var(--text-xs);
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
  }

  .table-scroll {
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    margin: var(--space-3) 0 var(--space-6);
    background: var(--color-surface);
  }

  table {
    width: 100%;
    min-width: 480px;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  thead th {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    font-weight: 600;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  tbody td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: var(--color-surface-alt); }
  tbody tr:hover td { background: var(--color-hover); }

  tr.result-win td:first-child { box-shadow: inset 3px 0 0 var(--color-win); }
  tr.result-loss td:first-child { box-shadow: inset 3px 0 0 var(--color-loss); }
  tr.result-draw td:first-child { box-shadow: inset 3px 0 0 var(--color-draw); }

  .delta { font-weight: 700; }
  .delta--pos { color: var(--color-win); }
  .delta--neg { color: var(--color-loss); }
  .delta--zero { color: var(--color-muted); }

  .badge {
    display: inline-block;
    padding: 0.15em 0.6em;
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .badge--win { background: var(--color-win-bg); color: var(--color-win); }
  .badge--loss { background: var(--color-loss-bg); color: var(--color-loss); }
  .badge--draw { background: var(--color-draw-bg); color: var(--color-draw); }

  .summary-line {
    color: var(--color-muted);
    margin: var(--space-2) 0 var(--space-4);
  }

  .lookup-form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-6);
  }

  .lookup-form label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-muted);
  }

  .lookup-form input,
  .lookup-form select {
    flex: 1 1 240px;
    font: inherit;
    font-size: var(--text-base);
    padding: var(--space-3) var(--space-4);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .lookup-form input:hover,
  .lookup-form select:hover { border-color: var(--color-accent); }
  .lookup-form input:focus-visible,
  .lookup-form select:focus-visible {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-hover);
    outline: none;
  }

  .lookup-form button {
    font: inherit;
    font-size: var(--text-base);
    font-weight: 700;
    padding: var(--space-3) var(--space-5);
    border: none;
    border-radius: var(--radius-md);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    cursor: pointer;
    transition: background-color 120ms ease, transform 120ms ease;
  }

  .lookup-form button:hover { background: var(--color-accent); }
  .lookup-form button:active { transform: translateY(1px); }

  .status-message {
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: var(--space-3) 0 var(--space-6);
    font-size: var(--text-base);
  }

  .status-message--loading {
    background: var(--color-surface-alt);
    color: var(--color-muted);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .status-message--loading::before {
    content: "";
    width: 1.1em;
    height: 1.1em;
    border-radius: var(--radius-pill);
    border: 2.5px solid var(--color-border);
    border-top-color: var(--color-accent);
    animation: spin 800ms linear infinite;
  }

  .status-message--error {
    background: var(--color-loss-bg);
    color: var(--color-loss);
    border: 1px solid var(--color-loss);
    font-weight: 600;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .move-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.1em 0.6em;
    border-radius: var(--radius-sm);
    font-family: var(--font-serif);
    font-weight: 700;
    font-size: var(--text-sm);
  }

  .move-chip--white {
    background: var(--color-surface);
    border: 1.5px solid var(--color-accent-dark);
    color: var(--color-accent-dark);
  }

  .move-chip--black {
    background: var(--color-accent-dark);
    border: 1.5px solid var(--color-accent-dark);
    color: var(--color-accent-contrast);
  }

  .wdl-bar {
    display: inline-flex;
    width: 110px;
    height: 8px;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--color-border);
    vertical-align: middle;
  }

  .wdl-seg--win { background: var(--color-win); height: 100%; }
  .wdl-seg--draw { background: var(--color-draw); height: 100%; }
  .wdl-seg--loss { background: var(--color-loss); height: 100%; }

  .wdl-label { font-size: var(--text-xs); color: var(--color-muted); }

  .repertoire-intro { color: var(--color-muted); margin: 0 0 var(--space-5); }

  ul.repertoire-tree, ul.repertoire-tree ul {
    list-style: none;
    margin: 0;
    padding-left: var(--space-5);
    border-left: 2px solid var(--color-border);
  }
  ul.repertoire-tree { padding-left: 0; border-left: none; }

  .repertoire-tree li { margin: var(--space-3) 0; }

  .rep-node-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-4);
    box-shadow: var(--shadow-sm);
  }

  .rep-games { font-size: var(--text-sm); color: var(--color-text); }
  .rep-pct { color: var(--color-muted); }
  .rep-rating { color: var(--color-muted); font-size: var(--text-xs); }

  footer.site-footer {
    color: var(--color-muted);
    font-size: var(--text-xs);
    margin-top: var(--space-7);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .support-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .support-links a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-accent-dark);
    text-decoration: none;
    background: var(--color-surface);
  }
  .support-links a:hover {
    background: var(--color-hover);
    border-color: var(--color-accent);
  }

  .disclosure-note {
    color: var(--color-muted);
    font-size: var(--text-xs);
    margin: var(--space-3) 0 0;
    max-width: 60ch;
  }

  .legal-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
    font-size: var(--text-xs);
  }
  .legal-links a { color: var(--color-muted); }
  .legal-links a:hover { color: var(--color-accent-dark); }

  .prose { max-width: 68ch; }
  .prose p { margin: 0 0 var(--space-4); line-height: 1.7; }
  .prose h2 { margin-top: var(--space-6); }
  .prose ul, .prose ol { padding-left: var(--space-5); line-height: 1.7; }
  .prose blockquote {
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-4);
    color: var(--color-muted);
    font-family: var(--font-serif);
    margin: var(--space-5) 0;
  }

  .breadcrumb { font-size: var(--text-xs); color: var(--color-muted); margin-bottom: var(--space-3); }
  .breadcrumb a { color: var(--color-muted); }
  .breadcrumb ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .breadcrumb li { display: inline; }
  .breadcrumb .breadcrumb-sep { color: var(--color-border); }

  .article-meta {
    font-size: var(--text-xs);
    color: var(--color-muted);
    border-bottom: 1px solid var(--color-border);
    padding-bottom: var(--space-3);
    margin: var(--space-3) 0 var(--space-5);
  }

  .toc {
    background: var(--color-surface-alt);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: 0 0 var(--space-6);
    font-size: var(--text-sm);
  }

  .card-grid {
    display: grid;
    gap: var(--space-4);
    margin: var(--space-4) 0 var(--space-6);
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }

  .card {
    position: relative;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
    transition: box-shadow 120ms ease, transform 120ms ease;
  }
  .card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .card h3 { margin: 0 0 var(--space-2); font-size: var(--text-base); }
  .card p { margin: 0; font-size: var(--text-sm); color: var(--color-muted); }
  .card a { text-decoration: none; }
  .card a::after { content: ""; position: absolute; inset: 0; }

  .callout {
    background: var(--color-surface-alt);
    border-left: 4px solid var(--color-accent);
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-5);
    margin: var(--space-5) 0;
    font-size: var(--text-sm);
  }

  .stat-row { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: var(--space-4) 0 var(--space-6); }
  .stat {
    flex: 1 1 140px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .stat-value { font-family: var(--font-serif); font-size: var(--text-xl); color: var(--color-accent-dark); line-height: 1.1; }
  .stat-label { font-size: var(--text-xs); color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .source-list { font-size: var(--text-sm); color: var(--color-muted); }

  .board {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    width: min(320px, 100%);
    aspect-ratio: 1 / 1;
    border: 2px solid var(--color-accent-dark);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin: 0;
  }
  .board-sq {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(18px, 5.2vw, 30px);
    line-height: 1;
    font-family: "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif;
  }
  .board-sq--light { background: var(--color-board-light); }
  .board-sq--dark { background: var(--color-board-dark); }
  .board-pc--w { color: #ffffff; text-shadow: 0 0 1px #23271f, 0 0 1px #23271f, 0 0 2px #23271f; }
  .board-pc--b { color: #23271f; }
  figure.board-figure { margin: var(--space-4) 0 var(--space-6); }
  figcaption { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-2); }

  @media (max-width: 640px) {
    body { padding: var(--space-4) var(--space-3) var(--space-6); }
    h1.page-title { font-size: var(--text-xl); }
    .table-hint { display: block; }
    .wdl-bar { width: 72px; }
    .rep-node-row { padding: var(--space-2) var(--space-3); }
    .lookup-form { flex-direction: column; align-items: stretch; }
    .board { width: 100%; }
    .card-grid { grid-template-columns: 1fr; }
  }
`;

/**
 * A minimalist chess-pawn favicon as an inline SVG data URI -- no external
 * asset, no build step. Colors are hardcoded here (not pulled from the CSS
 * tokens above) because a favicon is loaded by the browser as its own
 * standalone resource and does not inherit the page's CSS custom
 * properties; they're kept visually in sync with --color-accent-dark /
 * --color-accent-contrast by hand.
 */
const FAVICON_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%232a4d3a'/%3E%3Ccircle cx='32' cy='23' r='9' fill='%23f8f5ea'/%3E%3Cpath d='M21 40c0-3 4-5 11-5s11 2 11 5l3 9H18z' fill='%23f8f5ea'/%3E%3Crect x='15' y='50' width='34' height='8' rx='3' fill='%23f8f5ea'/%3E%3C/svg%3E";

/**
 * @param {string|{title:string, description?:string, canonical?:string,
 *   ogType?:'website'|'article', jsonLd?:string, noindex?:boolean}} arg
 *   Back-compat: a plain string is treated exactly as before (just a
 *   <title>). An object form additionally emits a meta description, a
 *   canonical link, and OpenGraph/Twitter tags -- used by content pages
 *   (src/renderContent.js). `jsonLd` (a pre-serialized <script type=
 *   "application/ld+json"> block or blocks) is phase-3 scope; content pages
 *   in this build pass no jsonLd, so nothing changes for them yet.
 * @returns {string} a full <head>...</head> block shared by every page.
 */
function renderDocumentHead(arg) {
  const opts = typeof arg === 'string' ? { title: arg } : (arg || {});
  const { title, description, canonical, ogType = 'website', jsonLd, noindex } = opts;

  const metaDescription = description
    ? `\n  <meta name="description" content="${escapeHtml(description)}">`
    : '';
  const canonicalLink = canonical
    ? `\n  <link rel="canonical" href="${escapeHtml(canonical)}">`
    : '';
  const robotsMeta = noindex ? '\n  <meta name="robots" content="noindex">' : '';
  const og = canonical || description
    ? `\n  <meta property="og:title" content="${escapeHtml(title)}">` +
      (description ? `\n  <meta property="og:description" content="${escapeHtml(description)}">` : '') +
      (canonical ? `\n  <meta property="og:url" content="${escapeHtml(canonical)}">` : '') +
      `\n  <meta property="og:type" content="${escapeHtml(ogType)}">` +
      `\n  <meta property="og:site_name" content="Lichess Stats">` +
      `\n  <meta name="twitter:card" content="summary">`
    : '';
  const jsonLdBlock = jsonLd ? `\n  ${jsonLd}` : '';

  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${metaDescription}${canonicalLink}${robotsMeta}${og}
  <link rel="icon" href="${FAVICON_DATA_URI}">
  <style>${SITE_CSS}</style>${jsonLdBlock}
  <script data-goatcounter="https://dylangerrrr.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9767914878112531" crossorigin="anonymous"></script>
</head>`;
}

// Fixed nav order for every page that has more than the original two links.
// renderHeader() below renders only the keys actually PRESENT in the `nav`
// object it's given, in this order -- so server.js's existing 2-key nav
// (player/repertoire) renders identically to before, while the static build
// can pass additional keys as those pages come online (openings in this
// phase; guides/faq in later phases) without editing server.js at all.
const NAV_ORDER = ['repertoire', 'openings', 'guides', 'faq', 'player'];
const NAV_LABELS = {
  repertoire: 'Repertoire explorer',
  openings: 'Openings',
  guides: 'Guides',
  faq: 'FAQ',
  player: 'Player lookup',
};

/**
 * @param {{player?: string, repertoire?: string, openings?: string,
 *   guides?: string, faq?: string}} nav link targets for whichever pages
 *   currently exist -- either the dynamic dev-server routes (server.js's
 *   default, 2 keys) or flat static filenames (buildStatic.js, up to 5
 *   keys). Only keys present in this object are rendered.
 * @param {'player'|'repertoire'|'openings'|'guides'|'faq'|null} [active]
 *   which nav link, if any, represents the current page.
 * @returns {string} the shared header/nav markup used on every page.
 */
function renderHeader(nav, active = null) {
  const links = NAV_ORDER.filter((key) => nav[key] != null)
    .map((key) => `<a href="${escapeHtml(nav[key])}"${active === key ? ' aria-current="page"' : ''}>${escapeHtml(NAV_LABELS[key])}</a>`)
    .join('\n      ');

  return `<header class="site-header">
    <a class="brand" href="${escapeHtml(nav.home || nav.repertoire || '/')}"><span class="brand-mark" aria-hidden="true">&#9822;</span>Lichess Stats</a>
    <nav class="site-nav" aria-label="Main">
      ${links}
    </nav>
  </header>`;
}

// Support-link URLs, added once here so every page picks them up from this
// single shared footer instead of being pasted into each render*.js call
// site. Real accounts created by the human 2026-08-11 -- do not modify
// these strings. Disclosure copy for these links is a separate task
// (task-msp18k2w-9f147e); this is just the links/buttons themselves.
const KOFI_URL = 'https://ko-fi.com/dylangerloski';
const BMC_URL = 'https://buymeacoffee.com/dylanger254';

/**
 * Affiliate/support-link disclosure (task-msp18k2w-9f147e). Exported as its
 * own function -- not just inlined into renderFooter() below -- so it's a
 * genuine standalone snippet/component, reusable on any future page that
 * carries affiliate or support links even outside the shared footer (e.g. a
 * future dedicated review/comparison page). renderFooter() also calls this
 * unconditionally (see below) because every page's footer already renders
 * the Ko-fi/Buy Me a Coffee support links (KOFI_URL/BMC_URL above, wired in
 * task-msp4dp6c-170d4e) -- the disclosure that covers them has to appear
 * everywhere those do.
 */
function renderDisclosure() {
  return `<p class="disclosure-note">Disclosure: this site includes voluntary support links (Ko-fi, Buy Me a Coffee) and may in the future include affiliate links that earn a small commission on qualifying purchases at no extra cost to you. Support and affiliate links never influence the win-rate data, rankings, or analysis shown on this site -- all of that comes directly from Lichess's public API and Opening Explorer, unaffected by any link on this page.</p>`;
}

/**
 * @param {string} innerHtml page-specific footer copy (data-source credit,
 *   etc). Callers should NOT claim the site is only local/unpublished --
 *   this app is deployed to GitHub Pages.
 * @param {{privacy?: string, about?: string, contact?: string}} [legalLinks]
 *   Optional footer link targets for the compliance pages added in
 *   task-msp18k2w-9f147e (src/renderCompliance.js). Only callers that know
 *   those pages actually exist at those paths should pass this -- the
 *   local-only dev server (src/server.js) has no routes for them and
 *   deliberately omits it, so its footer renders with no legal-links row
 *   rather than a broken link. The disclosure paragraph above, by contrast,
 *   is unconditional (see renderDisclosure()'s own comment).
 */
function renderFooter(innerHtml, legalLinks) {
  const legalRow = legalLinks
    ? `
  <nav class="legal-links" aria-label="Legal">
    ${legalLinks.privacy ? `<a href="${escapeHtml(legalLinks.privacy)}">Privacy policy</a>` : ''}
    ${legalLinks.about ? `<a href="${escapeHtml(legalLinks.about)}">About</a>` : ''}
    ${legalLinks.contact ? `<a href="${escapeHtml(legalLinks.contact)}">Contact</a>` : ''}
  </nav>`
    : '';
  return `<footer class="site-footer">${innerHtml}
  <div class="support-links">
    <a href="${KOFI_URL}" target="_blank" rel="noopener noreferrer">&#9749; Support on Ko-fi</a>
    <a href="${BMC_URL}" target="_blank" rel="noopener noreferrer">&#9749; Buy Me a Coffee</a>
  </div>
  ${renderDisclosure()}${legalRow}</footer>`;
}

/**
 * Wraps a `<table>...</table>` string in a horizontally-scrollable
 * container with a visible "there's more, scroll" affordance on narrow
 * viewports, instead of letting the table silently overflow the page.
 */
function wrapTable(tableHtml) {
  return `
    <p class="table-hint">Scroll to see more &rarr;</p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable data table">${tableHtml}</div>`;
}

function deltaClassFor(change) {
  if (change == null) return 'delta--zero';
  if (change > 0) return 'delta--pos';
  if (change < 0) return 'delta--neg';
  return 'delta--zero';
}

function renderRatingTable(ratingRows) {
  if (ratingRows.length === 0) {
    return '<p class="empty-note">No rating history found.</p>';
  }
  const rows = ratingRows
    .map((row) => {
      const deltaText = row.change == null ? '-' : `${row.change >= 0 ? '+' : ''}${row.change}`;
      return `
      <tr>
        <td>${escapeHtml(row.variant)}</td>
        <td>${row.current ?? '-'}</td>
        <td>${row.peak ?? '-'}</td>
        <td>${row.low ?? '-'}</td>
        <td class="delta ${deltaClassFor(row.change)}">${deltaText}</td>
        <td>${row.gamesRecorded}</td>
      </tr>`;
    })
    .join('');

  return wrapTable(`
    <table>
      <thead>
        <tr><th>Variant</th><th>Current</th><th>Peak</th><th>Low</th><th>Change</th><th>Data points</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`);
}

function resultBadge(result) {
  const label = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw';
  return `<span class="badge badge--${escapeHtml(result)}">${label}</span>`;
}

function renderGamesTable(gameSummary) {
  if (gameSummary.totalGames === 0) {
    return '<p class="empty-note">No recent games found.</p>';
  }
  const rows = gameSummary.results
    .map(
      (r) => `
      <tr class="result-${r.result}">
        <td>${r.date || '-'}</td>
        <td>${escapeHtml(r.opponent)}</td>
        <td>${r.opponentRating ?? '-'}</td>
        <td>${escapeHtml(r.color)}</td>
        <td>${escapeHtml(r.variant)} / ${escapeHtml(r.speed)}</td>
        <td>${resultBadge(r.result)}</td>
      </tr>`
    )
    .join('');

  return `
    <p class="summary-line">${gameSummary.wins}W / ${gameSummary.losses}L / ${gameSummary.draws}D
       out of ${gameSummary.totalGames} games (win rate ${gameSummary.winRate}%,
       avg opponent rating ${gameSummary.avgOpponentRating ?? 'n/a'})</p>` +
    wrapTable(`
    <table>
      <thead>
        <tr><th>Date</th><th>Opponent</th><th>Opp. rating</th><th>Color</th><th>Variant/Speed</th><th>Result</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`);
}

/**
 * @param {{username: string, ratingRows: Array, gameSummary: object,
 *   nav?: {player: string, repertoire: string}}} data
 * @returns {string} a full standalone HTML document
 */
function renderPlayerPage({ username, ratingRows, gameSummary, nav = { player: '/', repertoire: '/repertoire' } }) {
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead(`${username} - Lichess stats`)}
<body>
  ${renderHeader(nav, 'player')}
  <main>
    <h1 class="page-title">${escapeHtml(username)}</h1>
    <p class="subtitle">Lichess rating history and recent games</p>

    <h2>Ratings by variant</h2>
    ${renderRatingTable(ratingRows)}

    <h2>Recent games</h2>
    ${renderGamesTable(gameSummary)}
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api">lichess.org/api</a>.')}
</body>
</html>
`;
}

function renderRepertoireNode(node) {
  const winPct = typeof node.winPct === 'number' ? node.winPct : null;
  const drawPct = typeof node.drawPct === 'number' ? node.drawPct : null;
  const lossPct = typeof node.lossPct === 'number' ? node.lossPct : null;
  const ratingNote = node.averageRating ? `<span class="rep-rating">avg rating ${node.averageRating}</span>` : '';
  const children = node.children && node.children.length > 0
    ? `<ul>${node.children.map(renderRepertoireNode).join('')}</ul>`
    : '';
  const wdlTitle = `${node.mover} win/draw/loss: ${winPct ?? '-'}% / ${drawPct ?? '-'}% / ${lossPct ?? '-'}%`;
  const wdlBar = winPct == null
    ? ''
    : `<span class="wdl-bar" title="${escapeHtml(wdlTitle)}">
        <span class="wdl-seg--win" style="width:${winPct}%"></span>
        <span class="wdl-seg--draw" style="width:${drawPct}%"></span>
        <span class="wdl-seg--loss" style="width:${lossPct}%"></span>
      </span>
      <span class="wdl-label">${winPct}% / ${drawPct}% / ${lossPct}%</span>`;

  return `
    <li>
      <div class="rep-node-row">
        <span class="move-chip move-chip--${escapeHtml(node.mover)}">${escapeHtml(node.san)}</span>
        <span class="rep-games">${node.games.toLocaleString()} games <span class="rep-pct">(${node.playedPct ?? '-'}% of this position)</span></span>
        ${wdlBar}
        ${ratingNote}
      </div>
      ${children}
    </li>`;
}

function renderRepertoireTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) {
    return '<p class="empty-note">No repertoire data found for this rating band and color.</p>';
  }
  return `<ul class="repertoire-tree">${tree.map(renderRepertoireNode).join('')}</ul>`;
}

/**
 * @param {{ratingBand: string, color: string, opening: {eco:string,name:string}|null,
 *   totals: {white:number,draws:number,black:number}|null, tree: Array,
 *   nav?: {player: string, repertoire: string},
 *   legalLinks?: {privacy?: string, about?: string, contact?: string}}} data
 *   `nav` lets callers point the top-of-page links at either the dynamic
 *   dev-server routes (the default, used by server.js) or flat static
 *   filenames (used by the static build, e.g. {player: 'player.html',
 *   repertoire: 'index.html'}). `legalLinks` is forwarded to renderFooter()
 *   -- see that function's own doc comment; only the static build passes it.
 * @returns {string} a full standalone HTML document
 */
function renderRepertoirePage({ ratingBand, color, opening, totals, tree, nav = { player: '/', repertoire: '/repertoire' }, legalLinks }) {
  const totalGames = totals ? totals.white + totals.draws + totals.black : null;
  const openingNote = opening ? ` &mdash; starting from ${escapeHtml(opening.name)} (${escapeHtml(opening.eco)})` : '';
  const totalsNote = totals
    ? `<p class="summary-line">${totalGames.toLocaleString()} games played from the starting position in this rating band
        (${totals.white.toLocaleString()}W / ${totals.draws.toLocaleString()}D / ${totals.black.toLocaleString()}L).</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead(`Opening repertoire explorer (${ratingBand}, ${color}) - Lichess stats`)}
<body>
  ${renderHeader(nav, 'repertoire')}
  <main>
    <h1 class="page-title">Opening repertoire explorer</h1>
    <p class="subtitle">Rating band ${escapeHtml(ratingBand)}, playing as ${escapeHtml(color)}${openingNote}</p>
    ${totalsNote}
    <p class="repertoire-intro">Most-played moves at each ply for players in this rating band, with win/draw/loss rates per move.
       Your color's plies show the top choices actually played at this rating; the opponent's replies show
       only their single most common response, to keep the tree readable.</p>
    ${renderRepertoireTree(tree)}
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api#tag/Opening-Explorer">Lichess Opening Explorer API</a> (explorer.lichess.ovh, keyless, no account required).', legalLinks)}
</body>
</html>
`;
}

module.exports = {
  renderPlayerPage,
  renderRepertoireTree,
  renderRepertoirePage,
  escapeHtml,
  SITE_CSS,
  FAVICON_DATA_URI,
  renderDocumentHead,
  renderHeader,
  renderFooter,
  renderDisclosure,
  wrapTable,
  NAV_ORDER,
  NAV_LABELS,
};
