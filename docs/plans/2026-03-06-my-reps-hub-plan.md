# My Representatives Hub - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current outreach page with a constituency-first "My Representatives" hub that uses address lookup + AI intelligence to prioritize actions for each user's specific representatives.

**Architecture:** Single-page hub at outreach.html. Google Civic API call from browser → match results against seats.json + legislators.json + bills.json client-side → render prioritized rep cards with one-click contact tools. All state stored in localStorage.

**Tech Stack:** Vanilla JS (no framework), Google Civic Information API, existing IntelligenceAPI/LegislationAPI modules, static JSON data files.

---

### Task 1: Add Google Civic API Key to Config

**Files:**
- Modify: `js/config.js`

**Step 1: Add the API key placeholder to SAFE_CONFIG**

In `js/config.js`, add after the `IS_CONFIGURED` line (line 29):

```javascript
    // Google Civic Information API key (free tier, 25k req/day)
    // Get one at: https://console.cloud.google.com/apis/credentials
    GOOGLE_CIVIC_API_KEY: '',
```

**Step 2: Commit**

```bash
git add js/config.js
git commit -m "feat: add Google Civic API key placeholder to config"
```

> **Note:** User will provide the actual API key after enabling Civic Information API in Google Cloud Console. Until then, the hub falls back to state-only selection.

---

### Task 2: Create the My Reps Hub JS Module

**Files:**
- Create: `js/my-reps.js`

This is the core module. It handles: address lookup, data matching, action prioritization, and card rendering.

**Step 1: Write js/my-reps.js with the full module**

```javascript
// ============================================
// SAFE Action - My Representatives Hub
// ============================================

const MyRepsHub = {
    _civicCache: null,
    _reps: [],
    _bills: [],
    STORAGE_KEY: 'safe_my_address',

    // ── Address Lookup ────────────────────────────

    async lookupAddress(address) {
        const apiKey = SAFE_CONFIG.GOOGLE_CIVIC_API_KEY;
        if (!apiKey) {
            console.warn('No Civic API key configured. Use state fallback.');
            return null;
        }

        const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${apiKey}`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || resp.statusText);
            }
            const data = await resp.json();
            this._civicCache = data;

            // Persist address
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                address: address,
                timestamp: Date.now(),
                officials: data.officials,
                offices: data.offices,
            }));

            return this._parseCivicResponse(data);
        } catch (e) {
            console.error('Civic API error:', e);
            return null;
        }
    },

    getSavedAddress() {
        try {
            const stored = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
            if (stored && stored.address) {
                // Cache for 24 hours
                if (Date.now() - stored.timestamp < 24 * 60 * 60 * 1000) {
                    return stored;
                }
            }
        } catch (e) {}
        return null;
    },

    clearSavedAddress() {
        localStorage.removeItem(this.STORAGE_KEY);
    },

    _parseCivicResponse(data) {
        const officials = data.officials || [];
        const offices = data.offices || [];
        const reps = [];

        offices.forEach(office => {
            const level = this._classifyOfficeLevel(office);
            const body = this._classifyOfficeBody(office);
            const indices = office.officialIndices || [];

            indices.forEach(idx => {
                const official = officials[idx];
                if (!official) return;

                const party = (official.party || '').charAt(0);
                const partyFull = official.party || '';
                const phone = (official.phones || [])[0] || '';
                const email = (official.emails || [])[0] || '';
                const photoUrl = official.photoUrl || '';
                const urls = official.urls || [];
                const channels = official.channels || [];

                reps.push({
                    name: official.name,
                    party: party === 'R' ? 'R' : party === 'D' ? 'D' : party === 'I' ? 'I' : party,
                    partyFull: partyFull,
                    office: office.name,
                    level: level,
                    body: body,
                    phone: phone,
                    email: email,
                    photoUrl: photoUrl,
                    urls: urls,
                    channels: channels,
                    divisionId: office.divisionId || '',
                    state: this._extractState(office.divisionId || ''),
                });
            });
        });

        return reps;
    },

    _classifyOfficeLevel(office) {
        const levels = office.levels || [];
        if (levels.includes('country')) return 'Federal';
        if (levels.includes('administrativeArea1')) return 'State';
        if (levels.includes('locality') || levels.includes('administrativeArea2')) return 'Local';
        // Fallback: check division ID
        const div = office.divisionId || '';
        if (div.includes('state') && !div.includes('place') && !div.includes('county')) {
            return div.includes('cd:') ? 'Federal' : 'State';
        }
        return 'Other';
    },

    _classifyOfficeBody(office) {
        const name = (office.name || '').toLowerCase();
        if (name.includes('u.s. senate') || name.includes('united states senate')) return 'US Senate';
        if (name.includes('u.s. house') || name.includes('united states house')) return 'US House';
        if (name.includes('governor')) return 'Governor';
        if (name.includes('state senate') || name.includes('state upper')) return 'State Senate';
        if (name.includes('state house') || name.includes('state lower') || name.includes('state representative') || name.includes('assembly')) return 'State House';
        return office.name || '';
    },

    _extractState(divisionId) {
        // e.g. "ocd-division/country:us/state:tx/cd:10"
        const match = divisionId.match(/state:(\w{2})/i);
        return match ? match[1].toUpperCase() : '';
    },

    // ── Data Matching ─────────────────────────────

    async enrichReps(civicReps) {
        // Load all data sources in parallel
        const [seatsData, legislators, bills] = await Promise.all([
            fetch('data/seats.json').then(r => r.ok ? r.json() : { seats: [] }).catch(() => ({ seats: [] })),
            typeof IntelligenceAPI !== 'undefined' ? IntelligenceAPI.getLegislators().catch(() => []) : [],
            typeof LegislationAPI !== 'undefined' ? LegislationAPI.getLegislation(null).catch(() => []) : [],
        ]);

        const seats = seatsData.seats || [];
        this._bills = bills;

        return civicReps.map(rep => {
            // Match to seats.json
            const seatMatch = this._matchSeat(rep, seats);

            // Match to legislators.json intelligence
            const intelMatch = this._matchIntelligence(rep, legislators);

            // Find relevant bills
            const repBills = this._findRepBills(rep, bills);

            // Determine primary action
            const primaryAction = this._determinePrimaryAction(rep, intelMatch, repBills);

            return {
                ...rep,
                photoUrl: rep.photoUrl || (seatMatch?.incumbent?.photoUrl) || '',
                seat: seatMatch,
                intel: intelMatch,
                bills: repBills,
                primaryAction: primaryAction,
                candidates: seatMatch?.candidates || [],
            };
        });
    },

    _matchSeat(rep, seats) {
        const state = rep.state;
        if (!state) return null;

        // Try exact body match
        for (const seat of seats) {
            if (seat.state !== state) continue;

            if (rep.body === 'US Senate' && seat.body === 'US Senate') {
                // Match by incumbent name
                if (seat.incumbent && this._nameMatch(rep.name, seat.incumbent.name)) {
                    return seat;
                }
            }
            if (rep.body === 'US House' && seat.body === 'US House') {
                if (seat.incumbent && this._nameMatch(rep.name, seat.incumbent.name)) {
                    return seat;
                }
            }
            if (rep.body === 'Governor' && seat.body === 'Governor') {
                return seat;
            }
        }
        return null;
    },

    _matchIntelligence(rep, legislators) {
        if (!legislators || legislators.length === 0) return null;

        const repName = rep.name.toLowerCase().replace(/^(rep\.|sen\.|dr\.|hon\.)\s*/i, '');

        for (const leg of legislators) {
            const legName = leg.name.toLowerCase().replace(/^(rep\.|sen\.|dr\.|hon\.)\s*/i, '');
            if (this._nameMatch(repName, legName)) {
                return leg;
            }
        }
        return null;
    },

    _nameMatch(a, b) {
        if (!a || !b) return false;
        const normalize = s => s.toLowerCase().replace(/[^a-z\s]/g, '').trim();
        const na = normalize(a);
        const nb = normalize(b);
        if (na === nb) return true;
        // Check if last names match + first initial
        const partsA = na.split(/\s+/);
        const partsB = nb.split(/\s+/);
        const lastA = partsA[partsA.length - 1];
        const lastB = partsB[partsB.length - 1];
        if (lastA === lastB && partsA[0][0] === partsB[0][0]) return true;
        return false;
    },

    _findRepBills(rep, bills) {
        if (!bills || bills.length === 0) return [];
        const state = rep.state;

        return bills.filter(bill => {
            if (bill.isActive !== 'Yes') return false;
            // Federal rep → federal bills + their state bills
            if (rep.level === 'Federal') {
                return bill.level === 'Federal' || bill.state === state;
            }
            // State rep → their state bills
            return bill.state === state;
        }).sort((a, b) => {
            // High impact first
            const impactOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
            return (impactOrder[a.impact] || 2) - (impactOrder[b.impact] || 2);
        });
    },

    _determinePrimaryAction(rep, intel, bills) {
        const persuadability = intel?.persuadability;
        const score = persuadability?.score ?? 5;
        const category = persuadability?.category || 'unknown';

        // Priority 1: High-impact anti-science bill in committee
        const urgentBill = bills.find(b =>
            b.billType === 'anti' && b.impact === 'High' &&
            (b.status === 'In Committee' || b.status === 'Introduced')
        );
        if (urgentBill) {
            return {
                type: 'oppose-bill',
                priority: 1,
                label: `Urge to oppose ${urgentBill.billNumber}`,
                description: urgentBill.title,
                bill: urgentBill,
            };
        }

        // Priority 2: Any active anti-science bill
        const activeBill = bills.find(b => b.billType === 'anti' && b.isActive === 'Yes');
        if (activeBill) {
            return {
                type: 'oppose-bill',
                priority: 2,
                label: `Urge to oppose ${activeBill.billNumber}`,
                description: activeBill.title,
                bill: activeBill,
            };
        }

        // Priority 3: No pledge + fence-sitter or likely-win
        if (category === 'fence-sitter' || category === 'likely-win' || score >= 4) {
            return {
                type: 'ask-pledge',
                priority: 3,
                label: 'Ask to take the SAFE Action pledge',
                description: intel ? `${category} — ${persuadability?.reasoning?.substring(0, 100) || 'Persuadable target'}` : 'Help hold this official accountable on science policy',
            };
        }

        // Priority 4: Default pledge ask
        return {
            type: 'ask-pledge',
            priority: 4,
            label: 'Ask to take the SAFE Action pledge',
            description: 'Help hold this official accountable on science policy',
        };
    },

    // ── State Fallback ────────────────────────────

    async getRepsByState(stateCode) {
        const [seatsData, legislators, bills] = await Promise.all([
            fetch('data/seats.json').then(r => r.ok ? r.json() : { seats: [] }).catch(() => ({ seats: [] })),
            typeof IntelligenceAPI !== 'undefined' ? IntelligenceAPI.getLegislators(stateCode).catch(() => []) : [],
            typeof LegislationAPI !== 'undefined' ? LegislationAPI.getLegislation(stateCode).catch(() => []) : [],
        ]);

        const seats = (seatsData.seats || []).filter(s =>
            s.state === stateCode &&
            s.upIn2026 &&
            (s.body === 'US Senate' || s.body === 'US House' || s.body === 'Governor')
        );

        this._bills = bills;

        return seats.map(seat => {
            const inc = seat.incumbent || {};
            const rep = {
                name: inc.name || `${seat.body} ${seat.district || ''}`.trim(),
                party: inc.party || '?',
                partyFull: inc.party === 'R' ? 'Republican' : inc.party === 'D' ? 'Democrat' : inc.party || '',
                office: `${seat.body}${seat.district ? ' District ' + seat.district : ''}`,
                level: seat.level || 'Federal',
                body: seat.body,
                phone: '',
                email: '',
                photoUrl: inc.photoUrl || '',
                state: stateCode,
            };

            const intelMatch = this._matchIntelligence(rep, legislators);
            const repBills = this._findRepBills(rep, bills);
            const primaryAction = this._determinePrimaryAction(rep, intelMatch, repBills);

            return {
                ...rep,
                seat: seat,
                intel: intelMatch,
                bills: repBills,
                primaryAction: primaryAction,
                candidates: seat.candidates || [],
            };
        });
    },
};
```

**Step 2: Commit**

```bash
git add js/my-reps.js
git commit -m "feat: create MyRepsHub module with Civic API lookup and data matching"
```

---

### Task 3: Rewrite outreach.html as the My Reps Hub

**Files:**
- Modify: `outreach.html` (full rewrite of body content)

**Step 1: Rewrite outreach.html**

Replace the full body content of `outreach.html`. Keep the same `<head>` but update `<title>` to "My Representatives - SAFE Action". The page structure:

1. Header with updated nav (remove "2026 Elections" from nav, keep Home | Take Action | Intelligence | Pledges)
2. Hero: "Find Your Representatives"
3. Address lookup section (input + button + saved address display)
4. State fallback selector (shown when no Civic API key)
5. Stats bar (hidden until lookup)
6. Rep card grid (hidden until lookup)
7. Footer

Script tags at bottom: `config.js`, `legislation-api.js`, `intelligence.js`, `my-reps.js`, `my-reps-page.js`, `pwa.js`

**Step 2: Commit**

```bash
git add outreach.html
git commit -m "feat: rewrite outreach.html as My Representatives hub"
```

---

### Task 4: Create the Hub Page Controller

**Files:**
- Create: `js/my-reps-page.js`

This handles the DOM interactions — address form submission, rendering rep cards, expand/collapse, email/phone templates, and action tracking.

Key behaviors:
- On page load: check `MyRepsHub.getSavedAddress()`. If found, auto-populate and show reps.
- Address form submit: call `MyRepsHub.lookupAddress()` → `MyRepsHub.enrichReps()` → render cards
- State fallback: if no Civic API key, show state dropdown → call `MyRepsHub.getRepsByState()`
- Rep card rendering: photo, name, party, office, persuadability badge, primary action button
- Expand card: show all bills, full intel, all contact options, email/phone templates
- Action buttons: "Send Email" opens mailto or copies template, "Call" shows phone script
- Track actions in localStorage

**Step 1: Write js/my-reps-page.js**

The page controller should be ~300 lines covering:
- `init()` — check saved address, set up event listeners
- `handleAddressLookup()` — call Civic API, enrich, render
- `handleStateFallback(stateCode)` — load reps by state, render
- `renderStats(reps)` — update stats bar counters
- `renderRepCards(reps)` — generate card HTML sorted by `primaryAction.priority`
- `renderRepCard(rep)` — single card with: photo, name, party, persuadability, primary action
- `expandCard(rep)` — show full intel, all bills, contact tools, email template
- `generateEmailTemplate(rep, action)` — bill-specific or pledge-ask template
- `generatePhoneScript(rep, action)` — phone talking points
- `trackAction(type)` — localStorage tracking

**Step 2: Commit**

```bash
git add js/my-reps-page.js
git commit -m "feat: add hub page controller with card rendering and action templates"
```

---

### Task 5: Add Hub-Specific CSS

**Files:**
- Modify: `css/styles.css` (append new section)

**Step 1: Add CSS at end of styles.css**

New styles needed:
- `.address-lookup` — the address input section (centered, prominent)
- `.address-lookup input` — wide text input
- `.address-saved` — shows "Showing reps for: [address]" with change link
- `.rep-hub-grid` — grid of rep cards (1 column mobile, 2 desktop)
- `.rep-hub-card` — card with photo, info, action button
- `.rep-hub-card-header` — flex row: photo + name/office + persuadability badge
- `.rep-hub-photo` — 64px circular photo
- `.rep-hub-persuadability` — color-coded score badge
- `.rep-hub-action` — prominent CTA button (red for oppose-bill, blue for ask-pledge)
- `.rep-hub-expand` — expandable detail section
- `.rep-hub-bills` — list of relevant bills
- `.rep-hub-contact` — contact tools section
- `.rep-hub-template` — email/phone template area

**Step 2: Commit**

```bash
git add css/styles.css
git commit -m "feat: add My Reps hub CSS styles"
```

---

### Task 6: Update Navigation Across All Pages

**Files:**
- Modify: all HTML files (index.html, tracker.html, elections.html, intelligence.html, directory.html, quiz.html, candidate.html, action.html, press.html, outreach.html)
- Modify: `sw.js`

**Step 1: Update nav in all HTML files**

New header nav (remove "2026 Elections", keep 4 items):
```html
<a href="index.html" class="nav-link">Home</a>
<a href="tracker.html" class="nav-link">Take Action</a>
<a href="intelligence.html" class="nav-link">Intelligence</a>
<a href="directory.html" class="nav-link">Pledges</a>
```

Update footer nav: replace "Contact Candidates" with "2026 Elections" link, remove the elections link from header nav.

**Step 2: Update tracker.html sub-nav**

Change the sub-nav tabs from:
```html
<a href="tracker.html" class="sub-nav-link active">Browse Bills</a>
<a href="press.html" class="sub-nav-link">Media &amp; Press</a>
```

To:
```html
<a href="outreach.html" class="sub-nav-link">My Representatives</a>
<a href="tracker.html" class="sub-nav-link active">Browse Bills</a>
<a href="press.html" class="sub-nav-link">Media &amp; Press</a>
```

**Step 3: Update outreach.html sub-nav** (same tabs, "My Representatives" active)

**Step 4: Bump SW to v13, add js/my-reps.js and js/my-reps-page.js to ASSETS**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: update nav to remove Elections from header, add My Reps sub-tab"
```

---

### Task 7: Update Homepage CTAs

**Files:**
- Modify: `index.html`

**Step 1: Update hero CTA buttons**

Change the first CTA from linking to `tracker.html` to linking to `outreach.html` (the My Reps hub):
```html
<a href="outreach.html" class="btn btn-primary btn-lg">
    <span class="btn-star">&#9733;</span>
    Find Your Representatives
</a>
```

Keep the second CTA as-is (Pledge Directory).

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat: update homepage CTA to point to My Representatives hub"
```

---

### Task 8: Integration Testing & Polish

**Step 1: Start dev server and verify**

```bash
# Start server
python -m http.server 3000
```

Test the full flow:
1. Navigate to outreach.html
2. If no Civic API key: state dropdown fallback works, shows seats with incumbents
3. If Civic API key: enter address, verify reps load with photos and intel
4. Click primary action button → email template generates correctly
5. Expand card → full intel, bills, contact info all display
6. Check localStorage persistence (reload page, reps still shown)
7. Check tracker.html sub-nav → "My Representatives" tab links correctly
8. Check all nav links across pages

**Step 2: Fix any issues found**

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: polish My Reps hub integration"
```

---

### Task 9: Push and Deploy

**Step 1: Push to remote**

```bash
git push
```

**Step 2: Verify Firebase deployment picks up changes**

The GitHub Actions workflow should auto-deploy on push to main.
