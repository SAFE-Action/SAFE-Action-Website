# My Representatives Hub - Design Document

**Date:** 2026-03-06
**Status:** Approved

## Problem

The site has powerful data (6,718 election seats, 3,342 candidates, 501 incumbents with photos, AI persuadability intelligence on 15 legislators, 100 tracked bills) but the user journey connecting them is fragmented across 5+ pages. Users don't care about browsing all 6,718 seats — they want to know: "Who represents ME, and what should I do right now to defend science?"

## Solution: Constituency-First "My Representatives" Hub

A single hub page that:
1. Identifies the user's exact representatives via address lookup
2. Uses AI intelligence to prioritize which rep to contact and about what
3. Provides ready-made email templates and phone scripts for one-click action

## Entry Point

- **Address input**: Single text field + "Look Up" button
- **API**: Google Civic Information API (free tier, 25k req/day) — `representativeInfoByAddress` endpoint
- **Persistence**: Address + matched reps stored in localStorage. Returning users skip lookup.
- **Change address**: Small link to re-enter address

### After Lookup

Page transforms into the rep hub:
- **Stats bar**: "X active bills in your state | Y of your reps haven't signed the pledge | Z actions taken"
- **Rep cards**: Sorted by AI-recommended action priority

## Rep Card Design

### Card Header
- Photo (from Congress.gov or Civic API)
- Name, party badge, office (e.g. "US Senate - TX")
- Persuadability score (color-coded 0-10) + category label
- Pledge status: "Pledge Signed" (green) or "No Pledge" (amber)

### Primary Action (Dynamically Chosen)
Priority order:
1. **Active high-impact anti-science bill in their committee** → "Urge [Name] to oppose [Bill]"
2. **Active bill in their chamber** → same format
3. **No pledge + fence-sitter or likely-win** → "Ask [Name] to take the SAFE Action pledge"
4. **Champion/already pledged** → "Thank [Name] for supporting science"

Each primary action has a one-click "Send Email" / "Call" button.

### Expandable Detail Section
- Full intelligence profile (reasoning, key factors, committees)
- All active bills in their jurisdiction
- Full contact info (phone, email, office)
- Email template + phone script for primary action
- Secondary actions list

## Data Flow

```
User address → Google Civic API → list of officials with names, party, photos, contacts
                                     ↓
              Match to seats.json by state + chamber + district → incumbent data
                                     ↓
              Match to legislators.json by name + state → persuadability intelligence
                                     ↓
              Match to bills.json by state → active bills in their jurisdiction
                                     ↓
              Prioritization algorithm → sorted rep cards with recommended actions
```

### Fallback
Reps without intelligence data show cards without persuadability scores and default to the pledge-ask action.

### API Key
Google Cloud API key with Civic Information API enabled. Free tier. Embedded in client-side JS with HTTP referer restrictions.

## Navigation Changes

### Before
Home | Take Action | 2026 Elections | Intelligence | Pledges

### After
Home | Take Action | Intelligence | Pledges

### Sub-tabs under "Take Action"
- **My Representatives** (default) — the new hub
- **Browse Bills** — existing tracker
- **Media & Press** — existing link

### Page disposition
- `outreach.html` → Replaced by the new hub (or repurposed as the hub)
- `elections.html` → Stays, linked from hub footer. Removed from main nav.
- `action.html` → Stays, linked from hub rep cards for bill-specific action
- `tracker.html` → Stays as sub-tab under Take Action
- `intelligence.html` → Stays in main nav for power users
- `directory.html` → Stays in main nav

## Files to Create/Modify

### New
- `js/my-reps.js` — Hub page logic: Civic API call, data matching, card rendering, action prioritization

### Modify
- `outreach.html` → Repurpose as the My Reps hub (or create new page)
- `js/config.js` → Add `GOOGLE_CIVIC_API_KEY` config
- All HTML files → Update nav (remove Elections from top nav)
- `sw.js` → Bump cache version, add new assets
- `tracker.html` → Add sub-nav tabs (My Representatives, Browse Bills, Media & Press)

### No changes needed
- `js/intelligence.js` — Already provides the persuadability API
- `js/legislation-api.js` — Already provides bill data API
- `data/seats.json`, `data/legislators.json`, `data/bills.json` — Already populated

## Key Design Principles

1. **User doesn't need to understand the intelligence system** — it surfaces as "contact this person about this thing"
2. **One clear action per rep** — the AI picks the most impactful thing to do
3. **Depth on demand** — expand cards for full intelligence, all bills, secondary actions
4. **No backend** — everything is client-side against static JSON + one Civic API call
5. **Progressive enhancement** — works with just state selection if Civic API is unavailable
