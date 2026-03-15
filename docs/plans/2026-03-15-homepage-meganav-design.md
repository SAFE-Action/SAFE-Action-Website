# Design: Homepage Redesign + Dropdown Mega-Nav

**Date:** 2026-03-15
**Status:** Approved

## Summary

Redesign the homepage to have a single, focused CTA (contact your reps) with a separate pledge showcase section, and implement a dropdown mega-nav across all pages.

## Decisions

- **Nav style:** Option 2 — Dropdown Mega-Nav with hover-reveal sub-pages
- **Hero CTA:** Hybrid — inline address field + "Find My Reps" button + fallback "Learn how it works" link
- **Pledge section:** Latest Pledges social-proof feed (5-8 recent candidates from Firestore)
- **Homepage structure:** Hero CTA → Pledge Showcase → Impact Stats → Footer (3 focused sections)
- **Removed from homepage:** Database Stats, Candidate Pledge CTA, Volunteer CTA (all reachable via mega-nav)

## 1. Dropdown Mega-Nav (all pages)

**Header bar:** Logo (clickable → home) | **Take Action** | **Vaccine Pledges** | **About**

No "Home" text link. Logo serves as home link.

Each nav item reveals a dropdown on hover:

| Take Action | Vaccine Pledges | About |
|---|---|---|
| Email Your Reps (outreach.html) | Pledge Directory (directory.html) | Our Mission (about.html) |
| Call/Text Reps (outreach.html) | Candidate Quiz (quiz.html) | Volunteer (about.html#volunteer) |
| Action Tracker (action.html) | Elections (elections.html) | Donate (about.html#donate) |
| Live Dashboard (dashboard.html) | | Media Kit (media.html) |

- Dropdowns: subtle slide-down animation, semi-transparent background
- Active page gets underline accent
- Mobile (< 768px): hamburger icon → full-screen overlay menu with accordion sections
- Applied to all HTML pages except dashboard.html (which has its own header)

## 2. Homepage Structure (index.html)

### Section 1 — Hero CTA (full viewport height)
- Gradient background (existing style)
- Headline: "Defend Science. Take Action."
- Subline: "Tell your representatives to support evidence-based policy"
- Inline address input field + "Find My Reps" button
- Below input: "Learn how it works →" text link
- Pledge ticker remains below hero

### Section 2 — Latest Pledges Showcase
- Section header: "Leaders Taking the Pledge" with total count badge
- Horizontal scrollable row of 5-8 candidate cards from Firestore
- Card contents: photo/avatar, name, party badge, office, state
- Each card links to candidate.html detail page
- "View All Pledges →" button → directory.html
- Real-time updates via existing Firestore listeners

### Section 3 — Impact Stats
- Keep existing 6 impact counter cards
- Animated count-up on scroll (already implemented)
- Remove: Database Stats, Candidate Pledge CTA, Volunteer CTA

### Footer — unchanged

## 3. Files to Modify

| File | Change |
|---|---|
| `css/styles.css` | Mega-nav dropdown styles, hero redesign, pledge showcase styles, mobile menu |
| `index.html` | Restructure: new hero with address field, pledge showcase section, remove redundant sections |
| ~18 HTML files | Replace nav markup with mega-nav (all except dashboard.html) |
| `js/homepage.js` (new or inline) | Firestore query for latest pledges, address field → outreach redirect |
| `nav-demo.html` | Delete after implementation |
| `sw.js` | Bump cache version |
