# Site Streamline Design — March 8, 2026

## Goal

Reduce the site from 10 pages to 3 focused pages. Remove empty/redundant sections. Every page has real, populated content. The site's purpose: **contact your reps → oppose anti-science bills → ask them to take the pledge**.

## Site Structure

### 3 Main Pages

**1. index.html (Home)**
- Hero with CTA → Take Action
- Impact stats bar (actions taken, bills tracked, states covered, pledges)
- Pledge CTA → Pledges page
- Remove: Victory Board (empty when no stopped bills), Tools grid (redundant with simplified nav)

**2. outreach.html (Take Action) — the core hub**
Three tabs:
- **My Representatives** (default tab) — Address lookup → rep cards showing:
  - Photo, name, party, office
  - AI-prioritized action (oppose specific bill or ask for pledge)
  - Email template + phone script (one-click copy)
  - Expandable: all state + federal bills for user's state, candidates running for that seat (from seats.json)
  - Bill matching: state reps see state bills, federal reps see federal + state bills, all levels shown
- **Browse Bills** — State filter + category/status/impact filters + bill card grid (migrated from tracker.html logic)
  - Covers all 100+ state-level bills across 11+ states
  - Each bill card links to action.html for detail
- **Take the Pledge** — Inline pledge form (migrated from quiz.html)
  - 3-step form: candidate info → vaccine position → short answers
  - Submits to Google Sheets

**3. directory.html (Pledges)**
- Pledge directory grid (who's pledged, from Google Sheets)
- Filters: party, office, state, search
- CTA linking to Take Action → pledge tab
- Remove duplicate CTA blocks at bottom

### Utility Pages (no nav entry, deep-link only)
- **action.html** — Bill detail page (linked from rep cards / bill grid)
- **pledge.html** — Standalone embed form for external sites
- **candidate.html** — Pledge response detail (linked from directory)

### Redirected Pages (meta refresh → outreach.html)
- intelligence.html
- tracker.html
- elections.html
- press.html
- updates.html

### Navigation

**Header (3 items):** Home | Take Action | Pledges
**Footer (3 items + social):** Home | Take Action | Pledges + X/Facebook/Instagram/TikTok

## Key Changes to Existing Code

### outreach.html — Tab 2: Browse Bills
- Migrate filter/grid logic from tracker.html's `legislation-api.js` usage
- State dropdown, category filter, status filter, impact filter, search
- Bill cards render with: bill number, title, state badge, status, impact, sponsor
- Each card links to action.html?bill=ID

### outreach.html — Tab 3: Take the Pledge
- Migrate quiz.html's 3-step form HTML and quiz.js logic inline
- Form submits to Google Sheets via existing config

### Rep Cards — Candidates Running Section
- When expanded, show candidates filed for that seat from `seat.candidates[]`
- Display: name, party badge, filing status
- Data already exists in seats.json (currently displayed on elections.html)

### index.html — Cleanup
- Remove Victory Board section
- Remove 4-card Tools grid
- Keep: hero, impact stats, pledge CTA
- Simplify to a focused landing page

### Nav Updates (all pages)
- Header: 3 items (Home, Take Action, Pledges)
- Footer: 3 items + social links
- Update across: index.html, outreach.html, directory.html, action.html, candidate.html, pledge.html, quiz.html

### Service Worker
- Bump cache version
- Remove references to deleted page assets
- Add any new assets

## Files Modified
- outreach.html — add Browse Bills tab + Take Pledge tab
- index.html — remove Victory Board + Tools grid, simplify
- directory.html — remove duplicate CTAs
- css/styles.css — add bill browser styles, pledge form styles, candidate list styles
- js/my-reps-page.js — add tab switching, bill browser rendering, pledge form handling, candidates section
- sw.js — bump cache, update asset list
- All HTML files — nav updates (header 3-item, footer 3-item)

## Files Added
- None (all logic integrated into existing files)

## Files Redirected
- intelligence.html — meta refresh → outreach.html
- tracker.html — meta refresh → outreach.html
- elections.html — meta refresh → outreach.html
- press.html — meta refresh → outreach.html
- updates.html — meta refresh → outreach.html
