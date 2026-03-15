# Live Action Dashboard Design

## Overview

A full-screen livestream dashboard at `/dashboard` showing real-time political actions on a US map with ESPN SportsCenter energy. Built for streaming behind the host during live advocacy events.

## Data Model

### New: `actionEvents` collection (Firestore)

Each action creates a document:

```json
{
  "type": "email | call",
  "city": "San Clemente",
  "state": "CA",
  "lat": 33.427,
  "lng": -117.611,
  "repName": "Brian Jones",
  "repTitle": "State Senator",
  "billId": "SB-1234",
  "billTitle": "Vaccine Exemption Bill",
  "timestamp": "<serverTimestamp>"
}
```

No user names or emails stored — only city/state from the address they entered + rep/bill info from the current action card.

### Modified: `trackAction` Cloud Function

In addition to incrementing aggregate counters, also writes an individual event doc to `actionEvents`.

### Modified: Outreach page `trackAction` call

Sends metadata along with type: city, state, lat, lng, rep name, rep title, bill ID, bill title. This data is already available in the DOM from the address lookup and current rep card.

## Dashboard Layout

Full-screen, dark background, ESPN SportsCenter style:

```
┌─────────────────────────────────────────────────┐
│  SAFE ACTION LIVE  🔴       15 emails · 0 calls │
├────────────────────────────────┬─────────────────┤
│                                │  ACTIVITY FEED  │
│                                │                 │
│         US MAP (SVG)           │  📧 San Clemente│
│    (pings + accumulated dots)  │     → Sen. Jones│
│                                │  📧 Austin, TX  │
│                                │     → Rep. Smith│
│                                │  📞 Portland    │
│                                │     → Sen. Wyden│
│                                │                 │
├────────────────────────────────┴─────────────────┤
│  ▓▓▓▓▓▓▓▓▓░░░░░░░  DAILY GOAL  15 / 25         │
└─────────────────────────────────────────────────-┘
```

### Top Bar
- "SAFE ACTION LIVE" with red live indicator dot
- Real-time counters: emails, calls, total actions

### Center Left: US Map
- SVG-based US map (no external API, instant load)
- Each state is a path element
- Actions plot dots at city lat/lng with ripple animation
- Dots accumulate over time
- States with more actions glow brighter
- Emails = blue dots, Calls = gold dots

### Center Right: Activity Feed
- Scrolling list, newest on top
- Each entry: type icon (📧/📞), city + state, "→ Rep Name", bill name
- Smooth slide-in animation for new entries
- Oldest entries fade out at bottom

### Bottom Bar
- Daily goal progress bar (same dynamic scaling as homepage)
- Scrolling stat ticker

## Key Moments

### Email Action
- Blue dot appears on map at city location
- Ripple animation radiates outward
- Entry slides into activity feed from top
- Subtle ping sound

### Phone Call Action
- Gold dot on map (calls are rarer, more special)
- Larger ripple animation
- Entry slides into feed with phone icon
- Phone ring sound effect

### Pledge Takeover (THE BIG MOMENT)
- Full screen flash/takeover
- Pledge card fills center screen
- Shows: elected official name, party, state, title
- "JUST TOOK THE SAFE ACTION PLEDGE!"
- Dramatic fanfare sound
- Holds for 5-8 seconds
- Fades back to map view
- Listener on existing pledge data source

## Technical Approach

- **Map:** Inline SVG US map, no dependencies
- **Real-time:** Firestore `onSnapshot` on `actionEvents` (ordered by timestamp desc, limit 100)
- **Pledge listener:** Separate `onSnapshot` on pledge data
- **Sound:** Web Audio API for ping/ring/fanfare, mute toggle in corner (default: on)
- **No auth required:** Public read on `actionEvents` collection
- **Not in nav:** Unlisted page at `/dashboard`, not linked from main site

## Firestore Rules Update

```
match /actionEvents/{docId} {
  allow read: if true;
  allow write: if false;  // Only Cloud Functions write
}
```

## Files

- `dashboard.html` — full page
- `js/dashboard.js` — map rendering, Firestore listeners, animations, sound
- `css/dashboard.css` — ESPN dark theme styles
- Modified: `functions/track-action.js` — store individual events
- Modified: `js/action.js` — send metadata with track call
- Modified: `firebase.json` — add `/dashboard` rewrite
- Modified: `firestore.rules` — add `actionEvents` read rule
