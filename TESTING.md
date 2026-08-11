# Testing this app yourself

This is a local-only proof of concept — nothing here is deployed or public. Everything
runs on your own machine and only your own machine can see it.

There are now two ways to try it: the original dev server (Sections 1-5 below), and a
**static build** — plain files with no server running at all, which is the version meant
for eventual GitHub Pages hosting (publishing itself is a separate, not-yet-taken step; see
Section 6).

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
