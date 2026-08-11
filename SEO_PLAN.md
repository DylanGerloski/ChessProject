# SEO Plan: Lichess Opening Repertoire Explorer
**Created:** 2026-08-11  
**Status:** Ready for implementation coordination with task-msp052v4-bf1360 content-depth spec  
**Asset:** https://dylangerloski.github.io/ChessProject/

---

## Executive Summary

The Lichess opening-repertoire explorer is a functional tool that addresses a real user need (exploring what works at your rating level), but currently has no discoverable presence in organic search. This plan identifies keyword opportunities grounded in actual search behavior, recommends on-page SEO foundations, and maps content gaps that should be filled before distribution effort yields traffic.

**Key Finding:** Chess improvers actively search for "opening explorer," "opening repertoire by rating," and "what openings work at [rating]"—queries the tool directly answers, but with zero current content or metadata supporting discoverability.

---

## Keyword Targets & Search Evidence

### Primary Keyword Clusters (High Intent, Proven Search Volume)

| Search Query | Search Evidence | Target Page | Traffic Intent | Difficulty |
|---|---|---|---|---|
| `opening repertoire explorer` | Mentioned in chess.video tool review; featured on 365chess.com, ChessRef | `/index.html` or future single-page intro | High—users actively seeking this tool type | Medium |
| `chess openings by rating 1600` (and band variants: 1400, 1800, 2000) | ChessAtlas guide, FireChess blog, ChessKing blog all recommend rating-targeted opening study | Repertoire pages (1600-1800-white.html, etc.) | High—users buying into "different openings at different levels" principle | Medium |
| `what openings work at 1600 rating` (and 1400, 1800, 2000+ variants) | Direct search phrasing found in Chess.com forums, Reddit r/chess, r/chessbeginners | Repertoire pages + future opening guides | High—direct match to tool's value prop | Medium |
| `lichess opening explorer` (branded) | Existing Lichess API documentation; tool already powered by Lichess data | Any page; preferably `/index.html` or future /about | High—users already aware of Lichess brand | Low (branded) |
| `free chess opening database` | 365chess.com, Chess.com, ChessRef all mentioned as free options in comparison content | `/index.html` landing + future content hub | Medium—comparison-stage users | Medium |
| `chess opening analysis tool` | Mentioned in AiChessCoach, ChessTree, OpeningTree reviews | `/index.html` or future single tool page | High—users in analysis stage | Medium-High |

### Secondary Keyword Clusters (Intent Supporting, Content-Gap Play)

These are queries users type *after* finding the tool, seeking to deepen understanding—good for future content expansion per task-msp052v4-bf1360:

| Search Query | Type | Future Page/Content | Rationale |
|---|---|---|---|
| `Italian Game at 1600` (opening-specific + rating) | Long-tail opening guides | Future per-opening pages (coordinate with architect task) | Users want "what to play at my level in X opening" |
| `chess opening repertoire building guide` | Editorial/educational | Future How-To guide | Users want framework, not just data |
| `Sicilian Defense vs Italian Game which is better` (beginner-focused comparison) | Editorial comparison | Future opening comparison articles | Users deciding between options |
| `chess tactics vs opening study prioritization` | Educational/strategy | Future strategy guide | Users optimizing improvement paths |
| `common opening traps at 1600 rating` | Educational/cautionary | Future per-rating opening-trap guides | Users want to avoid losses, not just understand theory |

---

## Current On-Page SEO Audit

### Pages Live Now (8 Repertoire + 2 Utility)

#### Index (`/index.html`)
- **Current Title:** "Lichess stats (static build)"
- **Current Meta Description:** None visible
- **Issue:** Generic title does not signal opening-explorer value prop; no meta description
- **Recommendation:**
  - **New Title (60-65 chars):** "Opening Repertoire Explorer: Best Openings by Rating | Lichess Stats"
  - **New Meta Description (155-165 chars):** "Explore what openings work best at your rating level. Free opening repertoire explorer powered by millions of Lichess games. Compare 1400–2000+ ratings."

#### Player Lookup (`/player.html`)
- **Current Title:** Not examined in detail, likely generic
- **Status:** Out of scope for SEO plan (not an opening-repertoire feature); keep it focused on player lookup
- **Recommendation:** Update title to "Player Stats Lookup" to disambiguate from repertoire explorer if both appear in SERPs

#### Repertoire Pages (`/repertoire-[BAND]-[COLOR].html`) — 8 Pages
Example: `/repertoire-1600-1800-white.html`
- **Current Title:** "Opening repertoire explorer (1600–1800, white) - Lichess stats"
- **Current Meta Description:** None visible
- **Issue:** Title is specific but verbose; lacks business/context framing; no meta
- **Recommendation:**
  - **New Title Format (60-67 chars):** "[Band] Openings (White) | Rating-Specific Repertoire Explorer"
    - Examples:
      - "1600–1800 Openings (White) | Rating-Specific Repertoire"
      - "1400–1600 Openings (Black) | Best Moves at Your Level"
      - "2000+ Openings (White) | Expert-Level Repertoire"
  - **New Meta Description (155-165 chars per band/color):**
    - "Explore winning openings for [BAND] rating. See top moves, win/draw/loss rates, and what's played in real games. Free Lichess opening repertoire explorer."

---

## Internal Linking Plan

### Current Link Structure
- Index links to all 8 repertoire pages in a flat list + player.html
- Repertoire pages link back to index (implied in nav)
- **Gap:** No cross-linking between rating bands or between white/black variants; no thematic groupings

### Recommended Improvements (for architect/builder implementation)

#### From Index
- Add a **"Browse by Rating"** section grouping links by band:
  ```
  Beginner (1400–1600)
    - White opener repertoire
    - Black opener repertoire
  Intermediate (1600–1800)
    - White opener repertoire
    - Black opener repertoire
  Advanced (1800–2000)
    - White opener repertoire
    - Black opener repertoire
  Expert (2000+)
    - White opener repertoire
    - Black opener repertoire
  ```
- Add a **"What's in an opening repertoire?"** intro text (50–100 words) explaining the tool before the links
- Add an **"About this tool"** link to any future about/info page (task-msp052v4-bf1360)

#### From Each Repertoire Page
- Add **"Back to all ratings"** link to `/index.html`
- Add **"Sibling color"** link: if on white page, link to black page for same band (e.g., `/repertoire-1600-1800-black.html`)
- Add **"Adjacent rating band"** links: from 1600–1800, link to both 1400–1600 and 1800–2000 (helps users find their level)
- If future per-opening pages exist (e.g., `/opening/french-defense/`), link to them from relevant positions on repertoire pages

#### From Player Lookup Page
- Add a **"Want to explore openings?"** link to repertoire explorer (drives cross-feature engagement)

---

## Sitemap & Technical SEO Checklist

### Current State
- **Sitemap.xml:** Does not exist (verified via file listing)
- **Robots.txt:** Not found
- **Canonical tags:** Likely absent (need builder to verify in live HTML)
- **Structured data (Schema.org):** Not visible in headers (likely absent)

### Required for SEO Plan (Minimum)

| Item | Status | Action | Priority |
|---|---|---|---|
| `sitemap.xml` | Missing | Generate covering: `/index.html`, `/player.html`, all 8 repertoire pages; include `<lastmod>` (build date) | P0 |
| `robots.txt` | Missing | Create allowing all (`Allow: /`); add `Sitemap: https://dylangerloski.github.io/ChessProject/sitemap.xml` | P0 |
| Canonical tags | Assumed missing | Add to every page: `<link rel="canonical" href="https://dylangerloski.github.io/ChessProject/[page]">` | P1 |
| Structured data (JSON-LD) | Assumed missing | Add `WebPage` or `BreadcrumbList` schema to index; consider `Tool` schema for repertoire pages (optional but valuable for tool-specific queries) | P2 |
| Mobile-first indexing | Assumed OK | Verify viewport meta tag present (already in HTML); test on GSC if available | P1 |

### Build-Time Validation (for builder's static-build script)
- Add a **pre-deployment check** to `src/buildStatic.js` (or equivalent) that:
  1. Generates `sitemap.xml` at build time (all 10 pages)
  2. Generates `robots.txt` with Sitemap reference
  3. Validates all page titles are 50–70 characters (warn if outside range)
  4. Validates all meta descriptions are present and 150–165 characters (warn if absent)

---

## Content Gap Analysis: Expansion Opportunities

### Gap 1: "How Do I Use This Tool?" Educational Content
**Keyword:** "how to use opening repertoire explorer"  
**Current State:** Tool exists, but no instructional page or guide  
**Recommended Solution:** Future content page (~500 words, per architect task-msp052v4-bf1360)  
- Explain what win/draw/loss percentages mean for decision-making
- Explain rating bands (why 1600–1800 matters, not just "ratings")
- Example: "You're 1700—here's what the 1600–1800 repertoire tells you"
- Link from index and from each repertoire page  

**Search Intent:** Users landing on repertoire pages who don't immediately understand the data need guidance before leaving

---

### Gap 2: Per-Opening Guides (Architect Task Scope)
**Keyword Examples:** "French Defense at 1600," "Sicilian Defense for beginners," "Ruy Lopez variations"  
**Current State:** Raw move data on repertoire pages, no named-opening context  
**Recommended Solution:** Coordinate with task-msp052v4-bf1360; architect may add pages like:
- `/opening/french-defense/` (with subsections per rating band if desired)
- Reuse existing repertoire data to show "French Defense play rates at 1600"
- Cross-link from repertoire pages to opening guides ("Playing the French? Here's what works at 1600")

**Search Intent:** Users want to understand opening names and ideas, not just move sequences

---

### Gap 3: FAQ Page (Architect Task Scope)
**Keyword:** "opening repertoire FAQ," "should I memorize openings," "best openings for intermediate chess"  
**Current State:** No FAQ exists  
**Recommended Solution:** Future page (~800 words, per architect task) covering:
- "What rating band should I study?"
- "Should I memorize these openings or understand ideas?"
- "How do I build my own repertoire from this tool?"
- "Why do I see different moves than [Chess.com/Lichess online]?" (API time lag, game filtering)

**Search Intent:** Users seeking validation and guidance on *how to apply* the tool's data

---

### Gap 4: Editorial/Strategy Articles (Architect Task Scope)
**Keyword Examples:** "opening repertoire vs tactics practice," "how much opening study for 1600," "common opening mistakes at 1600"  
**Current State:** Tool provides data, no editorial interpretation  
**Recommended Solution:** 5–10 short articles (~600–800 words each, per architect guidelines in task-msp052v4-bf1360):
- "5 Opening Mistakes Players Make at 1600 Rating (and How to Fix Them)"
- "Repertoire Building 101: Data-Driven Openings vs. Classical Study"
- "Why Opening Explorers Matter More at 1600 Than at 2200"

**Search Intent:** Users want to feel confident they're studying the *right* openings; editorial content builds trust and authority

---

## Distribution & Visibility Strategy (Separate from This Plan)

Per task-msp05e9i-929971's split delivery: **SEO plan (this document) is complete and ready for implementation.** A separate **distribution packet** (targeting r/chess, r/chessbeginners, Discord communities, and potential Hacker News outreach) will be prepared by the growth agent as a decision brief, with ready-to-post drafts tagged by venue and self-promotion rules cited.

---

## Implementation Priority & Sequencing

### Phase 1 (P0: Pre-Distribution)
- [ ] Update all page titles and meta descriptions (builder task)
- [ ] Generate `sitemap.xml` and `robots.txt` (builder task)
- [ ] Add canonical tags (builder task)
- [ ] Deploy updated site (publish)
- [ ] Submit sitemap to Google Search Console (human task, if account available)

### Phase 2 (P1: Content Foundation)
- [ ] Implement architect's content-depth spec (task-msp052v4-bf1360): per-opening guides, FAQ, first 3–5 editorial articles
- [ ] Add internal linking improvements from this plan (builder task)
- [ ] Verify structured data (JSON-LD) added if included in architect spec
- [ ] Deploy updated site

### Phase 3 (P2: Distribution & Growth)
- [ ] Execute distribution packet: post to r/chess, r/chessbeginners, Discord communities (human, per distribution packet drafts)
- [ ] Monitor r/chess and r/chessbeginners for organic discussion mentions (not agented)
- [ ] If organic mentions occur and rules allow a clarifying comment, respond helpfully without sales pitch

### Phase 4 (P3: Analytics & Iteration)
- [ ] Set up Google Analytics or Plausible (no PII, respects privacy policy)
- [ ] Track: CTR from search → site, pages landing search traffic, bounce rates per page
- [ ] After 4–6 weeks: identify which keywords are getting impressions but low CTR (title/meta tuning opportunity)
- [ ] Iterate titles/descriptions and internal linking based on data

---

## Coordination Note

The architect task **task-msp052v4-bf1360** is currently `in_progress` and will produce a content-depth spec including per-opening pages, FAQ, and editorial articles. This SEO plan assumes that spec will be available within ~2 weeks. Once available:

1. Cross-check the architect's proposed page slugs/URLs against keyword targets above
2. Ensure architect's page titles follow the same format/character-count guidance in this plan
3. Verify internal linking recommendations in this plan are compatible with architect's page structure
4. If architect's spec diverges (e.g., different URL structure), revisit and re-baseline the keyword targeting and internal-linking plan against the actual URLs

---

## Success Metrics (Baseline → 8 Weeks)

Pending analytics setup:

| Metric | Baseline | Target (8 weeks) | Rationale |
|---|---|---|---|
| Search impressions (all keywords) | 0 | 50+ | Site has 0 current visibility; goal is indexation + initial SERP appearance |
| Organic search traffic (sessions) | 0 | 15–30 sessions | Modest baseline; repertoire pages are narrow queries with low absolute volume |
| Average position (target keywords) | N/A | 15–25 (p2–3) | Long-tail keywords typically appear p2–3 before content maturity builds authority |
| Pages indexed (Google) | 0 | 10 | All 10 main pages (index, player, 8 repertoires) should be indexed and crawlable |

**Reality check:** Chess-related organic SEO is competitive; significant traffic typically requires:
1. Months of indexing and authority building
2. Backlinks from established chess sites (Lichess.org itself, Chess.com, ChessBase, etc.)—distribution packets will seed this if community shares the link
3. Content depth (per architect task) that positions this tool as authoritative, not just a demo

This plan focuses on the technical foundation and keyword positioning; distribution (task-msp05e9i-929971 part b) is where real authority-building happens.

---

## Files to Update or Create (Builder Tasks)

1. **Update:** All `.html` pages in `/dist/`
   - Page titles (all 10)
   - Meta descriptions (all 10)
   - Canonical tags (all 10)
   - Internal linking structure (see plan section)

2. **Create:** `/dist/sitemap.xml`
   - Schema: XML sitemap with all 10 URLs + lastmod date

3. **Create:** `/dist/robots.txt`
   - Allow all; reference sitemap

4. **Optional (P2):** Add JSON-LD schema to `/dist/` pages (if architect includes structured data in spec)

5. **Build Script Enhancement:** Modify `src/buildStatic.js` to:
   - Generate sitemap.xml at build time
   - Generate robots.txt at build time
   - Validate page titles/meta descriptions (warn if out of range)

---

## References

### Research Sources (Self-Promotion Rules & Community Context)

For distribution packet venue research and community guidelines, see the dedicated distribution packet document (decision brief, separate from this plan).

### Keyword & Content Research Sources

- [Chess Opening Explorer Comparisons - Chess.com Forums](https://www.chess.com/forum/view/general/tools-for-chess-opening-repertoire)
- [Improvement for Intermediate Players (1200–1600 Elo) - ChessKing Blog](https://blog.chessking.com/guide/1200-1600-elo/)
- [How to Study Chess Openings: 2026 Guide by Rating - ChessAtlas](https://chessatlas.net/blog/opening-repertoire-building/how-to-study-chess-openings-the-complete-2026-guide-for-every-rating-level)
- [Free Chess Opening Explorer - chess.video](https://chess.video/tools/opening-explorer)
- [r/chessbeginners Stats - Subreddit Analysis](https://gummysearch.com/r/chessbeginners/)
- [Best Chess Subreddits 2025 - The Bishops Bounty](https://bishopsbounty.blogspot.com/2025/02/best-chess-subreddits-ultimate-guide-to.html)

---

**End of SEO Plan**

*This document is input for builder and architect implementation. No publishing implication—technical SEO foundation only. Distribution strategy in separate decision brief.*
