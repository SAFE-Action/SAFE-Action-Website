# Live Action Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full-screen livestream dashboard at `/dashboard` showing real-time political actions on a US map with ESPN SportsCenter energy.

**Architecture:** Firestore `actionEvents` collection stores individual action events written by the `trackAction` Cloud Function. Dashboard page uses `onSnapshot` listeners for real-time updates, renders an inline SVG US map with animated dots, a scrolling activity feed, and pledge takeover moments. Top of page shows "scienceandfreedom.com live tracker" so livestream viewers know where to go.

**Tech Stack:** Firebase/Firestore, vanilla JS, inline SVG map, Web Audio API, CSS animations

---

### Task 1: Update Cloud Function to Store Individual Action Events

**Files:**
- Modify: `functions/track-action.js`

Accept optional metadata fields (city, state, lat, lng, repName, repTitle, billId, billTitle) in request body. After incrementing aggregate counters, also write an individual event doc to `actionEvents` collection with all metadata plus serverTimestamp.

### Task 2: Update Outreach Page trackAction to Send Metadata

**Files:**
- Modify: `js/my-reps-page.js` (trackAction function at line ~1807)
- Modify: `js/action.js` (trackAction function at line ~381)

Both trackAction functions currently send `{ type }` to the Cloud Function. Update to also send: city, state from localStorage `safe_my_address` (normalizedAddress.city/state), current rep name/title from DOM context, current bill info from `window._bill`.

### Task 3: Update Firestore Rules

**Files:**
- Modify: `firestore.rules`

Add public read rule for `actionEvents` collection (write only via Cloud Functions).

### Task 4: Create Dashboard HTML

**Files:**
- Create: `dashboard.html`

Full-screen dark page with:
- Top bar: "scienceandfreedom.com live tracker" with red live dot, real-time counters
- Center left: inline SVG US map (all 50 states as path elements)
- Center right: scrolling activity feed
- Bottom: daily goal progress bar
- Firebase SDK scripts, dashboard.js, dashboard.css

### Task 5: Create Dashboard CSS

**Files:**
- Create: `css/dashboard.css`

ESPN dark theme: dark background (#0a0a1a), bright accent colors, glow effects, smooth animations for feed entries, ripple keyframes for map pings, progress bar styling, responsive layout.

### Task 6: Create Dashboard JavaScript

**Files:**
- Create: `js/dashboard.js`

Core functionality:
- Firestore `onSnapshot` on `actionEvents` (ordered by timestamp desc, limit 100)
- Firestore `onSnapshot` on `actionStats/counters` for aggregate counts
- Plot dots on SVG map using state centroid coordinates (lookup table built-in)
- Ripple animation on new actions (blue for email, gold for call)
- Scrolling activity feed with slide-in animation
- Daily goal progress bar with dynamic scaling
- Sound effects via Web Audio API (ping for email, ring for call, fanfare for pledge)
- Mute toggle button
- Pledge takeover: listener on pledge data, full-screen dramatic reveal

### Task 7: Update firebase.json

**Files:**
- Modify: `firebase.json`

Add rewrite: `{ "source": "/dashboard", "destination": "/dashboard.html" }`

### Task 8: Deploy and Test

Deploy Cloud Functions and hosting. Test by sending test action events via curl and verifying they appear on dashboard in real-time.
