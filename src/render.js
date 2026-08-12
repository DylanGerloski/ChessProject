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
 * Render-time formatter for a win/draw/loss (or any other) percentage
 * value. The data layer (src/process.js, src/processOpenings.js,
 * src/processRepertoire.js) stores Number(x.toFixed(1)) so values stay
 * numeric for sorting/comparison -- but that Number() wrapper silently
 * drops a trailing zero (the number 4 prints as "4", not "4.0"), which is
 * why percentages were dropping trailing zeros site-wide. Re-applying
 * toFixed(1) here, once, at the point every percentage is actually printed,
 * is what keeps one consistent decimal precision everywhere without
 * touching how the data layer stores or sorts these values.
 */
function formatPct(n) {
  return typeof n === 'number' ? n.toFixed(1) : '-';
}

/**
 * Single source of truth for every color, size, and spacing value on the
 * site. Nothing below this block may introduce a new hex or raw px value.
 * Kept as a plain JS object (not a CSS string) so it stays independently
 * greppable/inspectable, then interpolated into SITE_CSS's :root block below
 * via designTokensCss(). This can't live in its own module -- render.js is
 * concatenated verbatim into the browser bundle (see this file's header
 * comment) and has no CommonJS loader in that context -- so it stays a
 * same-file constant, same reasoning as SITE_CSS/FAVICON_DATA_URI already
 * being defined directly here rather than required() from elsewhere.
 */
const DESIGN_TOKENS = {
  '--font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  // Self-hosted OFL variable display face (see the @font-face block in
  // SITE_CSS below and assets/fonts/), headings only -- Georgia stays as the
  // fallback stack for the brief render before the woff2 loads and for any
  // browser that can't use the webfont at all. Only h1/h2/h3 and the site
  // wordmark (.brand) use this token; body copy, UI chips, table numerals,
  // and stat numbers are pinned to --font-sans directly (not through this
  // token) so reading/data legibility can't regress.
  '--font-serif': '"Fraunces Variable", Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',

  '--color-bg': '#f5f1e6',
  '--color-surface': '#ffffff',
  '--color-surface-alt': '#ece3cd',
  '--color-text': '#23271f',
  '--color-muted': '#5e5c4b',
  '--color-accent': '#3c6e52',
  '--color-accent-dark': '#2a4d3a',
  '--color-accent-contrast': '#f8f5ea',
  '--color-hover': 'rgba(60, 110, 82, 0.08)',
  '--color-focus': '#a35110',
  '--color-border': '#ddd0ac',
  '--color-border-strong': '#8a7b54',

  '--color-win': '#2f7d43',
  '--color-win-text': '#256034',
  '--color-win-bg': '#e3f2e6',
  '--color-draw': '#93731c',
  '--color-draw-text': '#6f5714',
  '--color-draw-bg': '#f4ecd2',
  '--color-loss': '#b23b30',
  '--color-loss-text': '#96302a',
  '--color-loss-bg': '#fbe4e0',

  '--color-board-light': '#ece3cd',
  '--color-board-dark': '#c2ad82',

  // A very light row tint for tbody, replacing the old --color-surface-alt
  // zebra stripe (which read as a 2010s admin template and, worse, was the
  // exact same hex as --color-board-light). Kept deliberately faint -- see
  // the zoom-tracking risk note on the tbody tr:nth-child(even) rule below.
  '--color-row-tint': 'rgba(35, 39, 31, 0.035)',

  '--text-xs': '0.75rem',
  '--text-sm': '0.875rem',
  '--text-base': '1rem',
  '--text-md': '1.125rem',
  '--text-lg': '1.375rem',
  '--text-xl': '1.75rem',
  '--text-2xl': 'clamp(2rem, 1.55rem + 1.9vw, 2.75rem)',

  '--leading-tight': '1.15',
  '--leading-snug': '1.3',
  '--leading-normal': '1.6',
  '--leading-relaxed': '1.75',

  '--weight-regular': '400',
  '--weight-medium': '600',
  '--weight-bold': '700',

  '--measure': '68ch',
  '--width-page': '880px',
  '--width-wide': '1120px',

  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-5': '1.5rem',
  '--space-6': '2rem',
  '--space-7': '3rem',
  '--space-8': '4rem',

  '--radius-sm': '6px',
  '--radius-md': '10px',
  '--radius-lg': '16px',
  '--radius-pill': '999px',

  '--shadow-sm': '0 1px 2px rgba(35, 39, 31, 0.08)',
  '--shadow-md': '0 8px 24px rgba(35, 39, 31, 0.10)',
  '--shadow-focus': '0 0 0 3px rgba(60, 110, 82, 0.25)',

  '--border-hairline': '1px',
  '--border-control': '2px',
};

/**
 * @param {Record<string,string>} tokens
 * @returns {string} one `    --name: value;` line per token, for
 *   interpolation into a `:root { ... }` block.
 */
function designTokensCss(tokens) {
  return Object.entries(tokens)
    .map(([name, value]) => `    ${name}: ${value};`)
    .join('\n');
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
${designTokensCss(DESIGN_TOKENS)}
  }

  /* Self-hosted display face for headings only (--font-serif above). One
     variable woff2, wght+opsz axes, latin subset, ~66KB -- served from this
     same origin (never Google Fonts directly, so there's no third-party
     render-blocking stylesheet and no visitor IP sent off-site), preloaded
     in renderDocumentHead() with crossorigin. font-display: swap means
     headings render in the Georgia fallback immediately and swap in once
     the woff2 arrives, so there's no invisible-text flash. License: SIL OFL
     1.1, assets/fonts/FRAUNCES-OFL-LICENSE.txt. */
  @font-face {
    font-family: 'Fraunces Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 100 900;
    src: url('/fonts/fraunces-variable.woff2') format('woff2-variations');
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
    max-width: var(--width-page);
    margin: 0 auto;
    padding: var(--space-5) var(--space-4) var(--space-7);
    line-height: var(--leading-normal);
    font-size: var(--text-base);
  }

  /* Opt-in wide container for the three data-dense page types (repertoire
     band pages, the drill, player lookup) — added at those specific call
     sites only, never as the default. See design-standards.md 4.5. */
  body.layout--wide { max-width: var(--width-wide); }

  main { display: block; }

  /* Prose measure (design-standards.md 4.5 / P3): caps reading-line length
     to var(--measure) for running text inside main. Tables, boards, and
     .table-scroll are exempt by not matching this selector at all. The
     repertoire tree's <li> rows are data rows (move chips, WDL bars), not
     prose sentences, so they're excluded explicitly below — constraining
     them would fight the wide layout those pages just opted into. */
  main p, main li, main .subtitle, main blockquote {
    max-width: var(--measure);
  }
  main .repertoire-tree li { max-width: none; }

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
    font-weight: var(--weight-bold);
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
    padding: var(--space-3) var(--space-3);
    border-radius: var(--radius-sm);
    transition: background-color 120ms ease, color 120ms ease;
  }

  .site-nav a:hover { background: var(--color-hover); color: var(--color-accent-dark); }
  .site-nav a[aria-current="page"] { background: var(--color-accent-dark); color: var(--color-accent-contrast); }

  h1, h2, h3 { font-family: var(--font-serif); color: var(--color-accent-dark); line-height: var(--leading-snug); text-wrap: balance; }
  h1.page-title { font-size: var(--text-2xl); line-height: var(--leading-tight); margin: 0; }
  h2 { font-size: var(--text-lg); margin: var(--space-6) 0 var(--space-3); }
  h3 { font-size: var(--text-md); margin: var(--space-5) 0 var(--space-2); }

  /* Vertical rhythm (design-standards.md 4.5): section spacing opens up at
     tablet width and above; stays tighter on mobile (the --space-6 default
     set on h2 just above). */
  @media (min-width: 768px) {
    h2 { margin-top: var(--space-8); }
  }

  /* Progressive enhancement, zero cost where unsupported: avoids
     single-word orphan lines in body copy. */
  p { text-wrap: pretty; }

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

  /* Table header style: a transparent thead with a tracked label over a
     2px accent bottom rule, replacing the old inverted solid
     --color-accent-dark bar, which read as a dated admin-template look. */
  thead th {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    background: transparent;
    color: var(--color-muted);
    font-weight: var(--weight-bold);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    border-bottom: 2px solid var(--color-accent);
  }

  tbody td {
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-hairline) solid var(--color-border);
  }

  tbody tr:last-child td { border-bottom: none; }
  /* Zebra striping replaced with the hairline row rule above; a very light
     tint (var(--color-row-tint), not full removal) keeps wide tables
     trackable at 200% zoom, verified manually against a repertoire table. */
  tbody tr:nth-child(even) td { background: var(--color-row-tint); }
  tbody tr:hover td { background: var(--color-hover); }

  /* Right-aligned numeric columns: tabular-nums keeps digits stacked
     instead of jittering column width row to row. Opt-in via class (not
     nth-child) since column layouts differ per table. */
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }

  tr.result-win td:first-child { box-shadow: inset 3px 0 0 var(--color-win); }
  tr.result-loss td:first-child { box-shadow: inset 3px 0 0 var(--color-loss); }
  tr.result-draw td:first-child { box-shadow: inset 3px 0 0 var(--color-draw); }

  .delta { font-weight: var(--weight-bold); }
  .delta--pos { color: var(--color-win-text); }
  .delta--neg { color: var(--color-loss-text); }
  .delta--zero { color: var(--color-muted); }

  .badge {
    display: inline-block;
    padding: 0.15em 0.6em;
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.02em;
  }
  .badge--win { background: var(--color-win-bg); color: var(--color-win-text); }
  .badge--loss { background: var(--color-loss-bg); color: var(--color-loss-text); }
  .badge--draw { background: var(--color-draw-bg); color: var(--color-draw-text); }

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
    min-height: 44px;
    font: inherit;
    font-size: var(--text-base);
    padding: var(--space-3) var(--space-4);
    border: var(--border-control) solid var(--color-border-strong);
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
    box-shadow: var(--shadow-focus);
    outline: none;
  }

  .lookup-form button {
    min-height: 44px;
    font: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
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
    border: var(--border-control) solid var(--color-border);
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
    font-family: var(--font-sans);
    font-weight: var(--weight-bold);
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
  .wdl-seg--draw { background: var(--color-draw); height: 100%; border-left: var(--border-hairline) solid var(--color-surface); }
  .wdl-seg--loss { background: var(--color-loss); height: 100%; border-left: var(--border-hairline) solid var(--color-surface); }

  /* Widened WDL bar for the one hero table per opening page
     (renderBandsTable's "How it scores at your rating"). Percentages stay
     visible alongside it (.wdl-label below), so color is never the sole
     encoding. */
  .wdl-bar--lg { width: 100%; min-width: 160px; height: 12px; }

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

  .prose { max-width: var(--measure); }
  .prose p { margin: 0 0 var(--space-4); line-height: var(--leading-relaxed); }
  .prose h2 { margin-top: var(--space-6); }
  .prose ul, .prose ol { padding-left: var(--space-5); line-height: var(--leading-relaxed); }
  .prose blockquote {
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-4);
    color: var(--color-muted);
    font-family: var(--font-sans);
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

  /* One primary action per view (design-standards.md hierarchy rule): the
     repertoire-band selector is the homepage's single
     accent-filled primary action. Every other homepage CTA (the drill card,
     the openings cards) is demoted to an outline card — same link targets,
     lower visual weight. Modifier classes only; markup/link targets
     unchanged. */
  .card--primary {
    background: var(--color-accent-dark);
    border-color: var(--color-accent-dark);
  }
  .card--primary h3, .card--primary h3 a { color: var(--color-accent-contrast); }
  .card--primary p, .card--primary p a { color: var(--color-accent-contrast); }
  .card--primary p a:hover { color: var(--color-accent-contrast); text-decoration: underline; }

  .card--outline {
    background: transparent;
    box-shadow: none;
  }
  .card--outline:hover { box-shadow: none; transform: none; border-color: var(--color-accent); }

  /* The single overloaded .card rule split by content shape (orthogonal to
     the primary/outline visual-weight axis above). card--nav is a pure
     navigational link (drill CTA, related openings, guides hub; no data
     carried); card--stat additionally carries inline WDL data on opening
     entry-page cards, so a visitor never has to click through to see
     whether an opening is worth their time. */
  .card--nav p { margin: 0; }

  .card--stat .card-wdl-row { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
  .card--stat .card-score { margin: 0; font-size: var(--text-sm); font-weight: var(--weight-bold); color: var(--color-accent-dark); }
  .card--stat.card--primary .card-score,
  .card--stat.card--outline .card-score { color: inherit; }

  /* The four rating-band pickers as one role=group control with 44px
     pill links, replacing four floating cards that carried the same visual
     weight as unrelated nav cards elsewhere on the page. */
  .band-picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-6);
  }
  .band-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 44px;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-pill);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    text-decoration: none;
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
    transition: background-color 120ms ease, transform 120ms ease;
  }
  .band-pill:hover { background: var(--color-accent); color: var(--color-accent-contrast); transform: translateY(-1px); }
  .band-pill-color { font-weight: var(--weight-regular); opacity: 0.85; }

  /* Eyebrow label above an h1, shared by renderPageHead(). */
  .page-eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-accent);
    margin: 0 0 var(--space-2);
  }

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
  .stat-value { font-family: var(--font-sans); font-size: var(--text-xl); color: var(--color-accent-dark); line-height: 1.1; }
  .stat-label { font-size: var(--text-xs); color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .source-list { font-size: var(--text-sm); color: var(--color-muted); }

  .board {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    width: min(100%, 352px);
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
  .board-pc--w { color: var(--color-surface); text-shadow: 0 0 1px var(--color-text), 0 0 1px var(--color-text), 0 0 2px var(--color-text); }
  .board-pc--b { color: var(--color-text); }
  figure.board-figure { margin: var(--space-4) 0 var(--space-6); }
  figcaption { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-2); }

  @media (max-width: 640px) {
    body { padding: var(--space-4) var(--space-3) var(--space-6); }
    h1.page-title { font-size: var(--text-xl); }
    .table-hint { display: block; }
    .wdl-bar { width: 72px; }
    /* Keep the hero table's widened bar filling its cell even on mobile,
       rather than shrinking to the compact 72px default above; same
       specificity, so declaration order (this rule after .wdl-bar) decides. */
    .wdl-bar--lg { width: 100%; min-width: 0; }
    .rep-node-row { padding: var(--space-2) var(--space-3); }
    .lookup-form { flex-direction: column; align-items: stretch; }
    .lookup-form input, .lookup-form select { flex: 1 1 auto; width: 100%; }
    .lookup-form label { width: 100%; }
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
 *
 * Geometry: head, a narrow straight-sided neck, a collar ring bar, a flared
 * skirt, and a base -- the narrow neck + collar ring is what reads as a
 * turned chess piece rather than a person silhouette (a wide neckless
 * shoulder flare straight off the head reads as account-icon geometry
 * instead).
 */
const FAVICON_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%232a4d3a'/%3E%3Ccircle cx='32' cy='19' r='7' fill='%23f8f5ea'/%3E%3Crect x='26' y='24' width='12' height='10' fill='%23f8f5ea'/%3E%3Crect x='19' y='33' width='26' height='4' rx='2' fill='%23f8f5ea'/%3E%3Cpath d='M20 37L44 37L48 50L16 50Z' fill='%23f8f5ea'/%3E%3Crect x='15' y='50' width='34' height='8' rx='3' fill='%23f8f5ea'/%3E%3C/svg%3E";

// Default social-share image (1200x630, per Open Graph's recommended size).
// Generated locally by scripts/build-og-image.js and committed to
// assets/og-default.png / copied into dist/ -- a separate build step, not
// this file's job. Hardcoded as an absolute URL here rather than built from
// site.js's SITE_ORIGIN because render.js has no CommonJS module loading
// available to it at all (see this file's header comment); same reasoning as
// FAVICON_DATA_URI and the KOFI_URL/BMC_URL constants below already being
// hardcoded absolute URLs.
const OG_DEFAULT_IMAGE = 'https://repertoire-builder.com/og-default.png';

/**
 * @param {string|{title:string, description?:string, canonical?:string,
 *   ogType?:'website'|'article', jsonLd?:string, noindex?:boolean,
 *   extraCss?:string}} arg
 *   Back-compat: a plain string is treated exactly as before (just a
 *   <title>). An object form additionally emits a meta description and a
 *   canonical link when given. OpenGraph/Twitter tags are ALWAYS emitted
 *   (title/type/site_name/image unconditionally; description/url only when
 *   given) -- every page gets a usable social-share card, even ones with no
 *   canonical or description yet. `jsonLd` (a pre-serialized <script type=
 *   "application/ld+json"> block or blocks) is phase-3 scope; content pages
 *   in this build pass no jsonLd, so nothing changes for them yet. `extraCss`
 *   emits a second <style> block after the shared SITE_CSS one -- only the
 *   drill page (src/renderDrill.js) passes it, so every other page's output
 *   is byte-identical to before.
 * @returns {string} a full <head>...</head> block shared by every page.
 */
function renderDocumentHead(arg) {
  const opts = typeof arg === 'string' ? { title: arg } : (arg || {});
  const { title, description, canonical, ogType = 'website', jsonLd, noindex, extraCss } = opts;

  const metaDescription = description
    ? `\n  <meta name="description" content="${escapeHtml(description)}">`
    : '';
  const canonicalLink = canonical
    ? `\n  <link rel="canonical" href="${escapeHtml(canonical)}">`
    : '';
  const robotsMeta = noindex ? '\n  <meta name="robots" content="noindex">' : '';
  const og = `\n  <meta property="og:title" content="${escapeHtml(title)}">` +
    (description ? `\n  <meta property="og:description" content="${escapeHtml(description)}">` : '') +
    (canonical ? `\n  <meta property="og:url" content="${escapeHtml(canonical)}">` : '') +
    `\n  <meta property="og:type" content="${escapeHtml(ogType)}">` +
    `\n  <meta property="og:site_name" content="Repertoire Builder">` +
    `\n  <meta property="og:image" content="${escapeHtml(OG_DEFAULT_IMAGE)}">` +
    `\n  <meta property="og:image:width" content="1200">` +
    `\n  <meta property="og:image:height" content="630">` +
    `\n  <meta name="twitter:card" content="summary_large_image">`;
  const jsonLdBlock = jsonLd ? `\n  ${jsonLd}` : '';
  const extraStyleBlock = extraCss ? `\n  <style>${extraCss}</style>` : '';

  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${metaDescription}${canonicalLink}${robotsMeta}${og}
  <link rel="icon" href="${FAVICON_DATA_URI}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/fonts/fraunces-variable.woff2" as="font" type="font/woff2" crossorigin>
  <style>${SITE_CSS}</style>${extraStyleBlock}${jsonLdBlock}
  <script data-goatcounter="https://dylangerrrr.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9767914878112531" crossorigin="anonymous"></script>
</head>`;
}

// Fixed nav order for every page that has more than the original two links.
// renderHeader() below renders only the keys actually PRESENT in the `nav`
// object it's given, in this order -- so server.js's existing 2-key nav
// (player/repertoire) renders identically to before, while the static build
// can pass additional keys as those pages come online (openings in this
// phase; guides/faq in later phases; drill added for the opening-drill
// pilot) without editing server.js at all.
const NAV_ORDER = ['repertoire', 'openings', 'drill', 'guides', 'faq', 'player'];
const NAV_LABELS = {
  repertoire: 'Repertoire explorer',
  openings: 'Openings',
  drill: 'Opening drill',
  guides: 'Guides',
  faq: 'FAQ',
  player: 'Player lookup',
};

/**
 * @param {{player?: string, repertoire?: string, openings?: string,
 *   drill?: string, guides?: string, faq?: string}} nav link targets for
 *   whichever pages currently exist -- either the dynamic dev-server routes
 *   (server.js's default, 2 keys) or flat static filenames (buildStatic.js,
 *   up to 6 keys). Only keys present in this object are rendered.
 * @param {'player'|'repertoire'|'openings'|'drill'|'guides'|'faq'|null} [active]
 *   which nav link, if any, represents the current page.
 * @returns {string} the shared header/nav markup used on every page.
 */
function renderHeader(nav, active = null) {
  const links = NAV_ORDER.filter((key) => nav[key] != null)
    .map((key) => `<a href="${escapeHtml(nav[key])}"${active === key ? ' aria-current="page"' : ''}>${escapeHtml(NAV_LABELS[key])}</a>`)
    .join('\n      ');

  return `<header class="site-header">
    <a class="brand" href="${escapeHtml(nav.home || nav.repertoire || '/')}"><span class="brand-mark" aria-hidden="true">&#9822;</span>Repertoire Builder</a>
    <nav class="site-nav" aria-label="Main">
      ${links}
    </nav>
  </header>`;
}

// Support-link URLs, added once here so every page picks them up from this
// single shared footer instead of being pasted into each render*.js call
// site. Real accounts created by the human -- do not modify these strings.
// The disclosure copy required alongside these links lives in
// renderDisclosure() below; this constant is just the links/buttons
// themselves.
const KOFI_URL = 'https://ko-fi.com/dylangerloski';
const BMC_URL = 'https://buymeacoffee.com/dylanger254';

/**
 * Affiliate/support-link disclosure. Exported as its own function -- not
 * just inlined into renderFooter() below -- so it's a genuine standalone
 * snippet/component, reusable on any future page that carries affiliate or
 * support links even outside the shared footer (e.g. a future dedicated
 * review/comparison page). renderFooter() also calls this unconditionally
 * (see below) because every page's footer already renders the Ko-fi/Buy Me
 * a Coffee support links (KOFI_URL/BMC_URL above) -- the disclosure that
 * covers them has to appear everywhere those do.
 */
function renderDisclosure() {
  return `<p class="disclosure-note">Disclosure: this site includes voluntary support links (Ko-fi, Buy Me a Coffee) and may in the future include affiliate links that earn a small commission on qualifying purchases at no extra cost to you. Support and affiliate links never influence the win-rate data, rankings, or analysis shown on this site &mdash; all of that comes directly from Lichess&rsquo;s public API and Opening Explorer, unaffected by any link on this page.</p>`;
}

/**
 * @param {string} innerHtml page-specific footer copy (data-source credit,
 *   etc). Callers should NOT claim the site is only local/unpublished --
 *   this app is deployed to GitHub Pages.
 * @param {{privacy?: string, about?: string, contact?: string}} [legalLinks]
 *   Optional footer link targets for the compliance pages implemented in
 *   src/renderCompliance.js. Only callers that know those pages actually
 *   exist at those paths should pass this -- the
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
 * One shared page-head component used by every template that has a
 * breadcrumb/eyebrow/h1/subtitle -- so the four page types (homepage,
 * opening guide, drill, repertoire) all open the same way instead of each
 * hand-rolling its own markup order. Deliberately dumb: `breadcrumb` is
 * passed through UNCHANGED (built by renderContent.js's renderBreadcrumb()
 * from the same `items` array a caller also feeds to structuredData.js's
 * breadcrumbJsonLd()), so the visible trail and the BreadcrumbList JSON-LD
 * can never drift out of sync just because this function exists.
 * `eyebrow`/`title`/`subtitle`/`meta` are pre-built HTML/text fragments the
 * caller is responsible for escaping, same convention every other
 * render*.js function already uses for h1/subtitle content -- this
 * function does not call escapeHtml() itself. `eyebrow` is on-page text
 * ONLY: it is never concatenated into a caller's <title>, since callers set
 * that separately via renderDocumentHead's own `title` option (the value
 * buildContent.js's assertPageMetadata length-checks) -- this function
 * never touches <head> at all. Fixed eyebrow vocabulary across the site:
 * "Opening guide" / "Repertoire" / "Drill" / "Guide" / "FAQ" /
 * "Player lookup" / "Not found".
 * @param {{breadcrumb?: string, eyebrow?: string, title: string,
 *   subtitle?: string, meta?: string}} opts
 * @returns {string}
 */
function renderPageHead({ breadcrumb = '', eyebrow = '', title, subtitle = '', meta = '' }) {
  return `${breadcrumb}
    ${eyebrow ? `<p class="page-eyebrow">${eyebrow}</p>` : ''}
    <h1 class="page-title">${title}</h1>
    ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
    ${meta}`;
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
        <td class="num">${row.current ?? '-'}</td>
        <td class="num">${row.peak ?? '-'}</td>
        <td class="num">${row.low ?? '-'}</td>
        <td class="delta num ${deltaClassFor(row.change)}">${deltaText}</td>
        <td class="num">${row.gamesRecorded}</td>
      </tr>`;
    })
    .join('');

  return wrapTable(`
    <table>
      <thead>
        <tr><th>Variant</th><th class="num">Current</th><th class="num">Peak</th><th class="num">Low</th><th class="num">Change</th><th class="num">Data points</th></tr>
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
        <td class="num">${r.opponentRating ?? '-'}</td>
        <td>${escapeHtml(r.color)}</td>
        <td>${escapeHtml(r.variant)} / ${escapeHtml(r.speed)}</td>
        <td>${resultBadge(r.result)}</td>
      </tr>`
    )
    .join('');

  return `
    <p class="summary-line">${gameSummary.wins}W / ${gameSummary.losses}L / ${gameSummary.draws}D
       out of ${gameSummary.totalGames} games (win rate ${formatPct(gameSummary.winRate)}%,
       avg opponent rating ${gameSummary.avgOpponentRating ?? 'n/a'})</p>` +
    wrapTable(`
    <table>
      <thead>
        <tr><th>Date</th><th>Opponent</th><th class="num">Opp. rating</th><th>Color</th><th>Variant/Speed</th><th>Result</th></tr>
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
${renderDocumentHead(`${username} | Repertoire Builder`)}
<body class="layout--wide">
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
  const wdlTitle = `${node.mover} win/draw/loss: ${formatPct(winPct)}% / ${formatPct(drawPct)}% / ${formatPct(lossPct)}%`;
  const wdlBar = winPct == null
    ? ''
    : `<span class="wdl-bar" title="${escapeHtml(wdlTitle)}">
        <span class="wdl-seg--win" style="width:${winPct}%"></span>
        <span class="wdl-seg--draw" style="width:${drawPct}%"></span>
        <span class="wdl-seg--loss" style="width:${lossPct}%"></span>
      </span>
      <span class="wdl-label">${formatPct(winPct)}% / ${formatPct(drawPct)}% / ${formatPct(lossPct)}%</span>`;

  return `
    <li>
      <div class="rep-node-row">
        <span class="move-chip move-chip--${escapeHtml(node.mover)}">${escapeHtml(node.san)}</span>
        <span class="rep-games">${node.games.toLocaleString()} games <span class="rep-pct">(${formatPct(node.playedPct)}% of this position)</span></span>
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
 *   legalLinks?: {privacy?: string, about?: string, contact?: string},
 *   canonical?: string, description?: string}} data
 *   `nav` lets callers point the top-of-page links at either the dynamic
 *   dev-server routes (the default, used by server.js) or flat static
 *   filenames (used by the static build, e.g. {player: 'player.html',
 *   repertoire: '/'}). `legalLinks` is forwarded to renderFooter()
 *   -- see that function's own doc comment; only the static build passes it.
 *   `canonical`/`description` are optional and forwarded to
 *   renderDocumentHead -- only the static build (src/buildStatic.js) passes
 *   them, since only its output is a real, indexable URL; the dev server's
 *   per-request page has no stable canonical URL to declare.
 * @returns {string} a full standalone HTML document
 */
function renderRepertoirePage({ ratingBand, color, opening, totals, tree, nav = { player: '/', repertoire: '/repertoire' }, legalLinks, canonical, description }) {
  const totalGames = totals ? totals.white + totals.draws + totals.black : null;
  const openingNote = opening ? ` &mdash; starting from ${escapeHtml(opening.name)} (${escapeHtml(opening.eco)})` : '';
  const totalsNote = totals
    ? `<p class="summary-line">${totalGames.toLocaleString()} games played from the starting position in this rating band
        (${totals.white.toLocaleString()}W / ${totals.draws.toLocaleString()}D / ${totals.black.toLocaleString()}L).</p>`
    : '';
  const title = `Opening repertoire explorer (${ratingBand}, ${color}) | Repertoire Builder`;

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body class="layout--wide">
  ${renderHeader(nav, 'repertoire')}
  <main>
    ${renderPageHead({
      eyebrow: 'Repertoire',
      title: 'Opening repertoire explorer',
      subtitle: `Rating band ${escapeHtml(ratingBand)}, playing as ${escapeHtml(color)}${openingNote}`,
      meta: totalsNote,
    })}
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
  formatPct,
  SITE_CSS,
  FAVICON_DATA_URI,
  DESIGN_TOKENS,
  renderDocumentHead,
  renderHeader,
  renderFooter,
  renderDisclosure,
  renderPageHead,
  wrapTable,
  NAV_ORDER,
  NAV_LABELS,
};
