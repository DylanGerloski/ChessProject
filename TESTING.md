# Testing this app yourself

Everything here runs from your own machine's copy of the code. The **static build**
(Section 6) is also the version that gets published to GitHub Pages — that publishing step
itself is separate and human-approved, not something any of these commands do on their own.

There are now two ways to try it: the original dev server (Sections 1-5 below), and a
**static build** — plain files with no server running at all, which is the version used for
GitHub Pages hosting (see Section 6). See Section 7 for what to specifically check after the
August 2026 UI/UX redesign pass, and **Section 8 for the new opening-content pages added in
the August 2026 content-depth build (phase 1 of 3 — see the note at the top of Section 8 for
exactly what is and isn't included yet).**

## 1. One-time setup (you've already done this)

A Lichess personal access token needs to live in a file at the project root named exactly
`.lichess-token` (no `.txt` on the end — Notepad likes to add that silently; check
"File name" in the save dialog says `.lichess-token`, not `.lichess-token.txt`). The file
should contain nothing but the token itself.

## 2. Start the server

Open a terminal and run:

```
cd C:\Users\dylan\Dev\lichess-stats-poc
node src/server.js
```

You should see:

```
Listening on http://localhost:8787 (local only)
```

Leave this terminal window open — the server keeps running as long as it's open. Closing
the window (or pressing `Ctrl+C` in it) stops the server.

## 3. Try it in a browser

Open **http://localhost:8787** — you'll see two links:

### Feature A: Player lookup

- Type any real Lichess username (e.g. `DrNykterstein`) and click View, or go directly to
  `http://localhost:8787/player/DrNykterstein`.
- **Expect:** a page showing that player's rating history per game mode (Blitz, Bullet,
  etc.) and a table of their recent games, colored win/loss/draw.
- Try a username that doesn't exist, e.g. `http://localhost:8787/player/zzzznotarealuser` —
  **expect:** a clean "No such Lichess user" message, not a crash.

### Feature B: Rating-band opening-repertoire explorer

- Go to `http://localhost:8787/repertoire`, pick a rating band (e.g. 1600-1800) and a
  color, click Explore. Or go directly to
  `http://localhost:8787/repertoire?band=1600-1800&color=white`.
- **Expect:** a nested list — the most-played opening moves for players in that rating
  band, each with games played and win/draw/loss percentages, branching a few moves deep.
- Try a different band or the other color and confirm the moves/numbers actually change —
  that's the signal this is live data, not a fixed sample.

## 4. If something looks wrong

| What you see | What it means |
| --- | --- |
| "Opening Explorer API request failed... 401" | Your token file is missing, misnamed, or the token was revoked. Re-check step 1. |
| "Lichess API rate limit hit" / "Opening Explorer rate limit hit" | Lichess is temporarily throttling — wait a bit and retry. |
| Terminal shows `EADDRINUSE` when starting the server | Something's already using port 8787 — either an old copy of this server is still running (close that terminal), or run `node src/server.js 8788` and use that port instead. |

## 5. When you're done

Go back to the terminal running the server and press `Ctrl+C`. Nothing else needs cleaning
up — no accounts were created beyond the one Lichess token you already have, and nothing
was published anywhere.

## 6. Test the static build locally, without a server

This is the version intended for GitHub Pages later on. It's just plain files — nothing
listens on a port, and nothing needs to keep running in a terminal. You do **not** need to
be a programmer to do this section; it's copy-paste and clicking.

### 6a. Generate the static files

You still need the same `.lichess-token` file from Section 1 for this step (only for this
step — see the note below on why). In a terminal:

```
cd C:\Users\dylan\Dev\lichess-stats-poc
npm run build:static
```

This talks to Lichess for a minute or two (it's fetching real data for 8 rating-band/color
combinations, and politely slows down and retries if Lichess asks it to). When it finishes
you'll see a line like:

```
Wrote static site to C:\Users\dylan\Dev\lichess-stats-poc\dist
Verified: no Lichess API token string appears in any generated file.
Open dist/index.html directly in a browser (file:// URL) -- no server needed.
```

**About the token:** it's read only during this one command, to fetch the repertoire data
from Lichess. It is never written into any file in `dist/` — the build script checks this
itself every time it runs (that's the "Verified: no Lichess API token..." line above) and
will fail loudly instead of finishing if it ever found the token in an output file. You can
double-check this yourself with Windows' own search: open the `dist` folder in File
Explorer, use its search box to search file contents for your token string, and confirm
nothing turns up.

### 6b. Open it in a browser — no server needed

In File Explorer, go to `C:\Users\dylan\Dev\lichess-stats-poc\dist` and double-click
`index.html`. It opens directly in your browser with a `file://` address — there is no
`localhost`, nothing is "running," and if your Wi-Fi/network goes down after this point the
repertoire pages still work fine (only the player-lookup page needs live internet, since it
fetches live from your browser — see below).

**Expect:** a home page linking to Player lookup and to 8 pre-rendered repertoire pages
(one per rating band × color).

- Click through to a few of the repertoire pages (e.g. "1600-1800, white"). **Expect:** the
  same kind of nested move list as Section 3's Feature B, already filled in — no loading,
  no waiting, because this page was generated ahead of time.
- Click "Player lookup", type a username (e.g. `DrNykterstein`), click View. **Expect:**
  after a brief live fetch (watch for "Loading…"), the same rating table and recent-games
  table as Section 3's Feature A. This part *does* need your internet connection, because
  unlike the repertoire pages, it fetches live from Lichess right there in your browser
  tab — but it does **not** use or need your token; it only calls Lichess's ordinary public
  API, the same one anyone's browser can call.
- Try a username that doesn't exist, e.g. `zzzznotarealuser`. **Expect:** a plain "No such
  Lichess user" message in the page, not a browser error page or a blank screen.

### 6c. (Optional) serve it locally instead of opening the file directly

You don't need this — 6b already works with no server. It's here only if you want to
double-check the site behaves the same way GitHub Pages would serve it (some browsers are
slightly stricter about `file://` pages than about pages served over `http://`, even
locally). Either of these works from the `dist` folder:

```
cd C:\Users\dylan\Dev\lichess-stats-poc\dist
python -m http.server 8000
```

then open `http://localhost:8000` in a browser; or, if you have Node's `npx` available:

```
cd C:\Users\dylan\Dev\lichess-stats-poc\dist
npx serve
```

and open whatever local address it prints. Either way, press `Ctrl+C` in that terminal when
you're done — same as Section 5.

### 6d. If something looks wrong

| What you see | What it means |
| --- | --- |
| `npm run build:static` prints "Lichess Opening Explorer rate limit hit" and exits with an error | It retries automatically several times first; if it still fails, Lichess is throttling harder than usual — wait a few minutes and re-run the same command. |
| A repertoire page looks empty / "No repertoire data found" | That combination genuinely has little data at that rating band, or the build partially failed — re-run `npm run build:static` and check its console output for errors. |
| Player lookup shows "Could not reach the Lichess API from this page" | Check your internet connection; if it persists, your browser or network may be blocking the request. |
| The repertoire pages' "Player lookup" / "Repertoire explorer" links go to a 404 in your browser | Make sure you're opening `dist\index.html`, not the project root's old single-page `dist\index.html` from Option A in the README — re-run `npm run build:static` to regenerate the whole `dist` folder fresh. |

## 7. Preview the redesigned UI (design QA)

This section is specifically for checking the August 2026 visual/UX redesign pass — every
page now shares one design system (colors, fonts, spacing) instead of each page having its
own slightly-different inline styling. You do not need to be a programmer for this section.

### 7a. Fastest path: the dev server

```
cd C:\Users\dylan\Dev\lichess-stats-poc
npm run serve
```

Then open `http://localhost:8787` in a browser and click around:

- **Home page** (`/`): you should see a small green circular "brand" mark and "Lichess
  Stats" text top-left, with "Player lookup" / "Repertoire explorer" links top-right in a
  bordered header bar — not a plain black `<h1>` with no styling around it.
- **Player lookup** (search a username, e.g. `DrNykterstein`, or go straight to
  `/player/DrNykterstein`): the ratings and recent-games tables should have a dark-green
  header row, alternating light row stripes, and the "Change" column colored green for
  positive rating changes / red for negative. The Result column in the games table should
  show small rounded "Win"/"Loss"/"Draw" pill badges, not plain text.
- **Repertoire explorer** (`/repertoire`, pick a rating band + color, click Explore): each
  move should appear as a small bordered "chip" (light background for White's moves, solid
  dark-green filled for Black's moves), next to a small colored horizontal bar showing the
  win/draw/loss split (green/gold/red segments) instead of raw "63% / 12% / 25%" text.
- **Browser tab icon**: every page should show a small green circle with a pale chess-pawn
  silhouette as its favicon, not the browser's generic blank-page icon.
- **Footer**: every page's footer should read something like "Data source: lichess.org/api"
  — it should **not** say "Generated locally; not deployed or published" anywhere (that line
  was removed everywhere since the site is in fact live on GitHub Pages).

### 7b. Static build path

Same as Section 6: run `npm run build:static` (needs your `.lichess-token`, see Section 1),
then open `dist\index.html` directly by double-clicking it. Same visual checklist as 7a
applies — index.html, player.html, and all 8 `repertoire-*.html` files should look
identical in header/footer/colors/type to each other and to the dev-server pages above.

**If you don't have a `.lichess-token` file handy right now** and just want to see the new
design without live data, you can still confirm the templates render correctly using the
project's own test fixtures (this does not call Lichess or need any token):

```
cd C:\Users\dylan\Dev\lichess-stats-poc
node -e "const fs=require('fs'),path=require('path');const {buildStatic}=require('./src/buildStatic');const fx=JSON.parse(fs.readFileSync(path.join('test','fixtures','explorer-response.json'),'utf8'));buildStatic({fetchImpl: async()=>({ok:true,status:200,statusText:'OK',headers:{get:()=>null},json:async()=>fx})}).then(r=>console.log('wrote', r.outDir));"
```

Then open `dist\index.html` the same way. The numbers you'll see (e.g. round numbers like
"55,000 games") are sample fixture data, not real Lichess stats — this is purely for
checking the visual design, not the data pipeline.

### 7c. Check the mobile layout (375px) and desktop layout (1280px)

In Chrome, Edge, or Firefox: open any page from 7a or 7b, then open DevTools (F12), click
the "toggle device toolbar" icon (a small phone/tablet icon, top-left of the DevTools
panel), and pick a preset like "iPhone SE" (375px wide) from the dropdown at the top of the
page.

**Expect at 375px:**
- The header's brand and nav links wrap onto their own lines instead of overlapping or
  running off the edge of the screen.
- Above every data table, a small line of text reading "Scroll to see more →" appears, and
  the table itself scrolls sideways within its own bordered box instead of stretching the
  whole page wider than the screen (try swiping/dragging inside a table).
- Repertoire move chips and win/draw/loss bars still fit on screen without any horizontal
  page-wide scrollbar appearing.

Turn off device toolbar mode (or just make the browser window wide, ~1280px) to check
**desktop**: content should sit in a centered column with visible margins on both sides —
not stretched edge-to-edge — and the "Scroll to see more →" hint text should disappear
(the tables don't need it at this width).

**What "broken" looks like**, for comparison: if the shared stylesheet failed to load, every
page would fall back to unstyled black serif headings, default blue underlined links, plain
browser-default table borders with no color or striping, and a generic blank-page favicon —
i.e. exactly what the site looked like before this redesign pass. If you see that instead of
the above, something regressed; check the browser's DevTools "Console" tab for a red error
first.

## 8. Preview the new opening-content pages (August 2026 content-depth build, phase 1 of 3)

**Scope note, read this first:** this is phase 1 of a 3-phase build (see
task-msp056zp-0a26c3). What's live now: 10 individual opening pages plus an "Openings" hub
page, all backed by real Lichess data. **Not yet built:** the FAQ page, the 8 editorial
guide articles, or the "Guides" nav link (phase 2); and sitemap.xml, robots.txt, and
structured data / JSON-LD (phase 3). Don't be surprised that the nav bar only shows
"Repertoire explorer", "Openings", and "Player lookup" — "Guides" and "FAQ" show up once
those phases land. None of this is published to GitHub Pages yet; publishing is a separate,
human-approved step.

### 8a. Generate the pages

Same command as Section 6a — this now also fetches and builds the opening pages in the same
run (needs your `.lichess-token`, same as before):

```
cd C:\Users\dylan\Dev\lichess-stats-poc
npm run build:static
```

This talks to Lichess quite a bit more than before now — roughly 90 requests total across the
8 repertoire pages plus the 10 opening pages (each opening page needs data from 4 rating
bands, the masters database, and sometimes one extra "common mistake" lookup). **Expect this
to take a few minutes**, especially the first time. A build-time on-disk cache
(`.cache/explorer/`, gitignored, not shipped anywhere) means every *subsequent* run is much
faster, since it only re-fetches positions that aren't already cached. Force a full refresh
with:

```
node src/buildStatic.js --no-cache
```

When it finishes, you'll see a line for every file written, ending the same
"Verified: no Lichess API token..." line as before, plus a new
"Verified: no filename collisions..." line. If you instead see a line like
`buildContent: <opening> ecoHint is X but the API reports Y -- using the API's value on the
page`, that's not an error — it's the build telling you it double-checked itself against the
live API and used Lichess's own answer over this project's config, exactly as designed.

### 8b. Open the pages — no server needed

In File Explorer, open `C:\Users\dylan\Dev\lichess-stats-poc\dist\index.html` (same as
Section 6b). **Expect:** an "Openings by real win rate" section partway down the home page
with 6 opening cards and a link to "all openings →". Click that, or open `openings.html`
directly.

**On the Openings hub page, expect:**
- A comparison table of all 10 openings (name, ECO code, first moves, games played, and a
  score percentage), followed by a card for each opening.
- Every row's opening name and every card link to that opening's own page.

**On an individual opening page** (e.g. `italian-game.html`), expect, top to bottom:
- A breadcrumb reading "Home / Openings / Italian Game".
- A small chessboard diagram showing the actual position after that opening's defining
  moves (e.g. after 1.e4 e5 2.Nf3 Nc6 3.Bc4 for the Italian Game), plus a link to open that
  exact line on Lichess's own analysis board.
- A "How it scores at your rating" table with one row per rating band (1400-1600 through
  2000+), each with a win/draw/loss bar and a "score" percentage.
- A "What [color] actually plays next" table of the opponent's most common replies.
- A "Common mistakes" section — plain-language sentences like "*Nf6* is played in 8% of
  games here but scores only 41% for Black", grounded in real percentages, never an engine
  evaluation. Some pages may say "no move at this band is both common and clearly
  low-scoring" instead, which is also a correct, expected outcome — not every opening's
  most-common line is a strong candidate for this section.
- A "Model games" table with real titled/master player names (e.g. Carlsen, Caruana) and a
  "View game" link that opens the actual game on lichess.org.
- A "Recent club games in this line" table, clearly labeled as club-level (not model) games.
- A "Build a repertoire from here" link into the matching `repertoire-*.html` tool page.
- A "Related openings" section linking to 2-3 similar openings.
- **Black-side openings** (Sicilian Defense, French Defense, Caro-Kann Defense,
  Scandinavian Defense, King's Indian Defense) should show the board **flipped** (Black's
  pieces at the bottom), and their "common mistakes" section should be about **White's**
  replies, not Black's — that's intentional: since these lines are defined by Black's own
  moves, the position reached is always the opponent's (White's) turn to move next.

### 8c. Check the board diagrams render correctly

The board uses plain Unicode chess symbols (♔♞ etc.), not image files, styled via CSS so
white pieces appear white-on-dark-square-safe with a dark outline. **Expect:** 64 small
squares in an alternating light/dark checkerboard pattern, each showing either nothing or a
readable piece symbol. If you see empty boxes, tiny "missing character" placeholder glyphs,
or unstyled black-on-black symbols instead, your system font is missing chess symbol
coverage — try a different browser (this has been checked in a Windows/Segoe UI Symbol
environment; other platforms should also work via their own symbol fonts, but haven't all
been individually verified in this pass — note this if you see it, since spec section 5.4
already flags it as a known residual risk).

### 8d. If something looks wrong

| What you see | What it means |
| --- | --- |
| Build fails with `openings.js: <slug> ply <n> expects <move>, API says: ...` | The move-order safety check caught a real mismatch between this project's configured opening line and what Lichess's API actually returned for that position — this is the build correctly refusing to publish a wrong chess line rather than a bug to silently work around. Worth a closer look before re-running. |
| Build fails with `Lichess Opening Explorer rate limit hit` partway through | Same as Section 6d — it retries automatically; if it still fails, wait a few minutes and re-run. The on-disk cache means you won't lose progress on positions already fetched. |
| A page's "Model games" or "Recent club games" table says "No games available for this section yet" | That specific position genuinely has no games in that database at the requested depth — not every line has recent club games or master games recorded. |
| Duplicate output filename error | Would mean an opening's slug collided with an existing static filename — this is asserted at build time specifically so it can't ship silently; report it rather than working around it. |

### 8e. What's honestly NOT done yet (say so, don't guess)

- No FAQ page, no editorial guide articles, no "Guides" or "FAQ" nav links yet (phase 2).
- No sitemap.xml, no robots.txt, no structured data / JSON-LD (BreadcrumbList, Article,
  FAQPage, WebSite) anywhere yet (phase 3) — every page's SEO right now is titles, unique
  meta descriptions, and canonical/OpenGraph tags only.
- Privacy/About/Contact pages and an ads.txt stub now exist — see Section 10 below
  (task-msp18k2w-9f147e). They were NOT part of this content-depth build; they're covered
  separately since they landed later.
- This content has not been published to GitHub Pages. That remains a separate,
  human-approved `/ship` step, same as every prior static-build pass.

## 9. Support links, analytics script, and custom-domain CNAME (August 2026,
task-msp4dp6c-170d4e)

This section covers three small, independent wiring changes made after the human created
real Ko-fi/Buy Me a Coffee accounts and a GoatCounter analytics account, and bought the
`Repertoire-Builder.com` domain. **None of this was published, deployed, or pointed at DNS
by this task** — it only changed local files. Publishing to GitHub Pages and pointing DNS
at it both remain separate, human-approved steps.

### 9a. Support links (Ko-fi / Buy Me a Coffee)

Every page's footer (dev server, static build, and content pages all share the same
`renderFooter()` function in `src/render.js`) now shows two small buttons below the
page-specific footer text:

- "☕ Support on Ko-fi" — links to `https://ko-fi.com/dylangerloski`
- "☕ Buy Me a Coffee" — links to `https://buymeacoffee.com/dylanger254`

**How to check:** run `npm run serve` (Section 2) and open any page, or open any page in
`dist/` from a static build (Section 6). Scroll to the bottom. **Expect:** both buttons
appear in the footer, open in a new tab, and go to the two URLs above. **What's missing on
purpose:** no disclosure copy ("this is a donation link," etc.) is added yet — that's a
separate task (task-msp18k2w-9f147e) so it isn't built twice.

### 9b. GoatCounter analytics script

Every page's `<head>` (via `renderDocumentHead()` in `src/render.js`) now includes:

```html
<script data-goatcounter="https://dylangerrrr.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
```

**How to check without a programmer's tools:** open any page (dev server or `dist/`), right-click, "View page source" (or Ctrl+U), and search (Ctrl+F in that view) for `goatcounter`.
**Expect:** exactly one `<script data-goatcounter=...>` tag, once near the end of `<head>`
— not once per section of the page, and not missing from any page (home, player lookup,
repertoire pages, opening pages all use the same shared `<head>`).

**With DevTools (optional, confirms it actually loads):** open DevTools (F12) → Network tab,
reload the page, and look for a request to `gc.zgo.at/count.js`. Since this script isn't
actually live/published anywhere yet, GoatCounter's own dashboard won't show hits from your
local testing — that's expected, not a bug.

### 9c. Custom domain CNAME file

`npm run build:static` (Section 6a) now also writes a file `dist/CNAME` containing exactly:

```
Repertoire-Builder.com
```

(no `https://`, no trailing slash, no `www`, no trailing newline). This file was placed in
`dist/` — not written by hand once, but generated fresh by `src/buildStatic.js` on every
build — because `dist/` is git-ignored and gets fully regenerated each time
`npm run build:static` runs, and a comparison of `dist/`'s current file list against
`git ls-tree gh-pages` (the branch GitHub Pages actually serves for this repo) shows they're
the same flat set of files at the branch root — i.e. whatever ends up in `dist/` is what
would need to be pushed to `gh-pages` for this domain to take effect, so the CNAME has to
survive every rebuild, not just the first one.

**How to check:** run `npm run build:static` (Section 6a), then open
`dist/CNAME` in a plain text editor (Notepad is fine). **Expect:** the file contains only
`Repertoire-Builder.com`, nothing else.

**What this does NOT do:** it does not push anything to the `gh-pages` branch, does not
touch GitHub's Pages settings, and does not touch DNS at the domain registrar — GitHub
Pages requires *both* this file (once actually deployed) *and* a DNS record pointing the
domain at GitHub, and DNS is explicitly a human-only, registrar-side action per this
project's action policy. If you open `Repertoire-Builder.com` in a browser right now and it
doesn't load this site, that is expected — nothing has been deployed or pointed at it yet.

## 10. Privacy policy, About, Contact, ads.txt, and the affiliate-disclosure note (August 2026, task-msp18k2w-9f147e)

This closes the compliance gap chief-of-staff flagged before publishing: the Ko-fi/Buy Me a
Coffee support links (Section 9a) had no privacy policy, about page, contact page, or
disclosure note anywhere on the site. **None of this is published, deployed, or pointed at
DNS by this task** — same as every prior static-build task, this only writes local files
under `dist/`.

### 10a. Generate the pages

Same command as Section 6a/8a:

```
cd C:\Users\dylan\Dev\lichess-stats-poc
npm run build:static
```

### 10b. Open the new pages — no server needed

In File Explorer, open `C:\Users\dylan\Dev\lichess-stats-poc\dist\privacy.html`,
`about.html`, and `contact.html` directly (double-click, or drag into a browser window).
**Expect:**

- `privacy.html` — an effective date, and sections on what the site is, analytics
  (GoatCounter, named specifically), advertising (states plainly that none currently runs),
  third-party links, cookies, children's privacy, and how to contact the site.
- `about.html` — what the site is, why it exists, how it's built, and a line saying no
  individually-attributed author name is published (an organization name is used instead —
  this matches the same "don't invent a person" rule used elsewhere in this project, e.g.
  `src/site.js`'s `SITE_AUTHOR` comment).
- `contact.html` — a clearly-marked callout box that says, in effect, "this is a placeholder,
  not a real address yet." **This is intentional, not a bug** — the task this was built from
  explicitly says not to invent a real contact address. **Before this site is submitted for
  AdSense review or otherwise relied on publicly, a human needs to edit
  `src/renderCompliance.js`'s `PLACEHOLDER_EMAIL` constant (inside `renderContactPage`) to a
  real, human-controlled email address**, then re-run `npm run build:static`.

### 10c. Check the ads.txt stub

Open `C:\Users\dylan\Dev\lichess-stats-poc\dist\ads.txt` in a plain text editor. **Expect:**
only comment lines (starting with `#`) — a placeholder explaining that no ad-tech seller is
authorized yet, with instructions for what line to add once a real AdSense publisher ID
exists. This file does not itself do anything on its own — it only matters once actually
published and once there's a real publisher ID to put in it, neither of which has happened.

### 10d. Check the affiliate/support-link disclosure and footer legal links

Open **any** page in `dist/` — the home page, an opening page, a repertoire page, `player.html`
— and scroll to the very bottom of the footer, below the "☕ Support on Ko-fi" / "☕ Buy Me a
Coffee" buttons from Section 9a. **Expect:**

- A small paragraph of muted text starting "Disclosure: this site includes voluntary support
  links..." — explaining that the support links (and any future affiliate links) don't
  influence the data or rankings shown on the page.
- Below that, three small links: "Privacy policy", "About", "Contact" — going to the three
  pages from 10b.

**What's deliberately different between pages:** the disclosure paragraph appears on every
page (including if you separately run `npm run serve`, the local dev server — Section 2),
because it covers support links that already appear everywhere. The three legal-links
(Privacy/About/Contact), however, only appear on pages from the static build (`dist/`) — the
local dev server has no routes for those three pages, so its footer intentionally omits that
row rather than showing a broken link. This is expected, not a bug: the dev server is a local
testing tool, not the published site.

### 10e. If something looks wrong

| What you see | What it means |
| --- | --- |
| No disclosure paragraph in the footer | Check you're looking at freshly-generated `dist/` output (re-run 10a) or a freshly-restarted `npm run serve` — a stale browser tab or an old `dist/` from before this task wouldn't have it. |
| "Privacy policy / About / Contact" links missing from a `dist/` page's footer | Re-run `npm run build:static` (10a) — every static page should get these; if one is still missing after a fresh build, that's a real bug worth reporting with the exact filename. |
| Contact page still shows the placeholder text after a "real" submission to AdSense | Expected until a human manually edits `PLACEHOLDER_EMAIL` in `src/renderCompliance.js` and rebuilds — this project deliberately does not invent or guess a real contact address. |

### 10f. What's honestly NOT done yet (say so, don't guess)

- The contact page's email address is a placeholder, not a working contact channel yet (see
  10b) — a human must fill this in.
- The privacy policy's advertising section says no ads currently run, which is accurate as of
  this task. If/when Google AdSense (or another ad network) is approved, `src/renderCompliance.js`'s
  `renderPrivacyPage` needs a one-line-ish update naming the actual provider — flagged in that
  file's own header comment so it isn't missed.
- Privacy/About/Contact are not in the top navigation bar — they're reachable from every
  page's footer instead, which is a normal, common pattern for this kind of page (and keeps
  the top nav focused on the site's actual content).
- This has not been published to GitHub Pages. That remains a separate, human-approved `/ship`
  step, same as every prior static-build pass.
