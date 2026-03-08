# Site Streamline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce the site from 10 pages to 3 focused pages, removing Intelligence tab and empty sections, merging elections data and bill browser into the Take Action hub.

**Architecture:** outreach.html becomes a 3-tab hub (My Reps / Browse Bills / Take Pledge). Retired pages get meta-refresh redirects. Nav simplified from 4+7 to 3+3. All JS for bills and pledge form migrated into the hub page.

**Tech Stack:** Vanilla JS, HTML5, CSS3, Google Sheets API (pledge form), LegislationAPI (bill data)

---

### Task 1: Update Navigation Across All Pages

**Files:**
- Modify: `index.html` (header lines 31-34, footer lines 240-248)
- Modify: `outreach.html` (header, footer)
- Modify: `directory.html` (header, footer)
- Modify: `action.html` (header, footer)
- Modify: `candidate.html` (header, footer)
- Modify: `pledge.html` (header, footer — if full nav exists)
- Modify: `quiz.html` (header, footer)

**Step 1: Update header nav in all files**

Change the 4-item header nav to 3 items. Remove Intelligence link. In every HTML file, find:
```html
<nav class="main-nav">
    <a href="index.html" class="nav-link ...">Home</a>
    <a href="outreach.html" class="nav-link ...">Take Action</a>
    <a href="intelligence.html" class="nav-link ...">Intelligence</a>
    <a href="directory.html" class="nav-link ...">Pledges</a>
</nav>
```

Replace with (preserving correct `active` class per page):
```html
<nav class="main-nav">
    <a href="index.html" class="nav-link ...">Home</a>
    <a href="outreach.html" class="nav-link ...">Take Action</a>
    <a href="directory.html" class="nav-link ...">Pledges</a>
</nav>
```

**Step 2: Update footer nav in all files**

Change the 7-item footer nav to 3 items. In every HTML file, find the `<nav class="footer-nav">` block with 7 links. Replace with:
```html
<nav class="footer-nav">
    <a href="index.html">Home</a>
    <a href="outreach.html">Take Action</a>
    <a href="directory.html">Pledges</a>
</nav>
```

Keep the social links and donate section unchanged.

**Step 3: Commit**
```bash
git add index.html outreach.html directory.html action.html candidate.html pledge.html quiz.html
git commit -m "chore: simplify nav to 3 items, remove Intelligence link"
```

---

### Task 2: Simplify index.html (Home Page)

**Files:**
- Modify: `index.html` (lines 142-199)

**Step 1: Remove the Tools Grid section**

Delete the entire `<!-- Take Action Tools Section -->` block (lines 142-175) — the 4-card tools grid with "Find Your Representatives", "Candidate Pledge Directory", "Legislative Intelligence", and "Bills We Stopped" cards.

**Step 2: Remove the Victory Board section**

Delete the entire `<!-- Victory Board Section -->` block (lines 182-199) — the "Bills We Stopped" grid with loading spinner and empty state.

**Step 3: Verify no JS references break**

Check `js/main.js` for references to `victory-grid` or `victory-empty` — if found, wrap in null checks so they don't error on the page without those elements.

**Step 4: Commit**
```bash
git add index.html js/main.js
git commit -m "chore: remove Victory Board and Tools grid from homepage"
```

---

### Task 3: Add Tab System to outreach.html

**Files:**
- Modify: `outreach.html` (sub-nav lines 53-60, main content)
- Modify: `js/my-reps-page.js` (add tab switching logic)

**Step 1: Convert sub-nav links to in-page tabs**

Replace the sub-nav section (lines 53-60) with tab buttons:
```html
<!-- Sub-Nav Tabs -->
<div class="tracker-sub-nav">
    <div class="container">
        <button class="sub-nav-link active" data-tab="my-reps">My Representatives</button>
        <button class="sub-nav-link" data-tab="browse-bills">Browse Bills</button>
        <button class="sub-nav-link" data-tab="take-pledge">Take the Pledge</button>
    </div>
</div>
```

**Step 2: Wrap existing My Reps content in a tab panel**

Wrap the existing `<section class="tracker-section">` content in a tab panel div:
```html
<div id="tab-my-reps" class="tab-panel active">
    <!-- existing address lookup, rep cards, etc. -->
</div>
```

**Step 3: Add empty tab panels for Browse Bills and Take Pledge**

After the My Reps tab panel, add:
```html
<div id="tab-browse-bills" class="tab-panel" style="display:none;">
    <!-- Will be populated in Task 4 -->
</div>

<div id="tab-take-pledge" class="tab-panel" style="display:none;">
    <!-- Will be populated in Task 5 -->
</div>
```

**Step 4: Add tab switching JS to my-reps-page.js**

At the top of the DOMContentLoaded listener, add tab switching logic:
```javascript
// Tab switching
document.querySelectorAll('.sub-nav-link[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var tabId = this.getAttribute('data-tab');
        document.querySelectorAll('.sub-nav-link[data-tab]').forEach(function(b) {
            b.classList.remove('active');
        });
        this.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });
        var target = document.getElementById('tab-' + tabId);
        if (target) {
            target.style.display = '';
            target.classList.add('active');
        }
    });
});
```

**Step 5: Add CSS for tab panels**

In `css/styles.css`, add:
```css
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.sub-nav-link[data-tab] {
    cursor: pointer;
    background: none;
    border: none;
    font-family: inherit;
    font-size: inherit;
}
```

**Step 6: Commit**
```bash
git add outreach.html js/my-reps-page.js css/styles.css
git commit -m "feat: add tab system to Take Action hub"
```

---

### Task 4: Add Browse Bills Tab Content

**Files:**
- Modify: `outreach.html` (Browse Bills tab panel)
- Modify: `js/my-reps-page.js` (bill browser rendering + filtering)
- Modify: `outreach.html` script tags (add tracker.js or inline its logic)

**Step 1: Add bill browser HTML to the Browse Bills tab panel**

Replace the empty `tab-browse-bills` div with the filter bar and bill grid from tracker.html. Use the exact filter HTML from tracker.html (state dropdown, type/level/category/status/impact/search filters) plus a bill grid container. Use unique IDs to avoid conflicts (prefix with `bb-`):

```html
<div id="tab-browse-bills" class="tab-panel" style="display:none;">
    <section class="tracker-section">
        <div class="container">
            <h2 style="text-align:center;margin-bottom:0.5em;">Browse Anti-Science Legislation</h2>
            <p style="text-align:center;color:#666;margin-bottom:2em;">Track bills across all 50 states that threaten public health and scientific freedom.</p>

            <div class="filter-bar">
                <div class="filter-group">
                    <label for="bb-state">State</label>
                    <select id="bb-state"><option value="">All States</option></select>
                </div>
                <div class="filter-group">
                    <label for="bb-stance">Type</label>
                    <select id="bb-stance">
                        <option value="">All Bills</option>
                        <option value="anti">Anti-Science</option>
                        <option value="pro">Pro-Science</option>
                        <option value="monitor">Monitoring</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="bb-status">Status</label>
                    <select id="bb-status">
                        <option value="">All Statuses</option>
                        <option value="active">Active Only</option>
                        <option value="Introduced">Introduced</option>
                        <option value="In Committee">In Committee</option>
                        <option value="Passed Committee">Passed Committee</option>
                        <option value="Passed One Chamber">Passed One Chamber</option>
                        <option value="Passed Both Chambers">Passed Both Chambers</option>
                        <option value="Signed into Law">Signed into Law</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="bb-impact">Priority</label>
                    <select id="bb-impact">
                        <option value="">All</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="bb-search">Search</label>
                    <input type="text" id="bb-search" placeholder="Search bills...">
                </div>
            </div>

            <div id="bb-count" style="text-align:center;color:#666;margin:1em 0;"></div>
            <div id="bb-grid" class="bill-grid"></div>
            <div id="bb-empty" class="empty-state" style="display:none;">
                <p>No bills match your filters.</p>
            </div>
        </div>
    </section>
</div>
```

**Step 2: Add bill browser JS to my-reps-page.js**

Add a self-contained bill browser module at the bottom of `my-reps-page.js`. It should:
- Populate the `bb-state` dropdown from `SAFE_CONFIG.STATES`
- Load bills via `LegislationAPI.getLegislation(null)` (all states)
- Filter by state, stance (billType), status, impact, and search text
- Render bill cards using safe DOM methods (createElement/textContent, no innerHTML)
- Each card shows: bill number, state badge, title, status, impact, sponsor, link to `action.html?bill=ID`
- Filter change listeners re-render the grid
- Lazy-initialize on first tab switch to Browse Bills (don't load data until tab is clicked)

**Step 3: Commit**
```bash
git add outreach.html js/my-reps-page.js
git commit -m "feat: add Browse Bills tab with filters and bill grid"
```

---

### Task 5: Add Take the Pledge Tab Content

**Files:**
- Modify: `outreach.html` (Take Pledge tab panel)
- Modify: `outreach.html` script tags (add sheets.js, quiz.js)
- Modify: `js/my-reps-page.js` (lazy-init pledge form)

**Step 1: Add pledge form HTML to the Take Pledge tab panel**

Replace the empty `tab-take-pledge` div with the pledge form from quiz.html. Copy the 3-step form HTML (candidate info, vaccine position, short answers) and submit button. Wrap in a section with intro text. Use the same element IDs as quiz.html since quiz.js will operate on them. Add a `pledge-form-wrap` container so we can scope styles.

```html
<div id="tab-take-pledge" class="tab-panel" style="display:none;">
    <section class="tracker-section">
        <div class="container">
            <div class="pledge-form-wrap">
                <h2 style="text-align:center;">Take the SAFE Action Pledge</h2>
                <p style="text-align:center;color:#666;margin-bottom:2em;">Are you an elected official or candidate? Share your positions on science and public health with voters.</p>

                <form id="pledge-form" class="pledge-form" novalidate>
                    <!-- Paste exact 3-step form HTML from quiz.html lines 58-216 -->
                    <!-- Step 1: Candidate Information -->
                    <!-- Step 2: Vaccine Position -->
                    <!-- Step 3: Short Answer Questions -->
                    <!-- Submit button -->
                </form>

                <div id="form-success" class="form-success" style="display:none;">
                    <h2>Thank You for Taking the Pledge!</h2>
                    <p>Your response has been recorded and will appear in our candidate directory.</p>
                    <a href="directory.html" class="btn btn-primary">View Pledge Directory</a>
                </div>

                <div id="form-error" class="form-error" style="display:none;">
                    <h2>Submission Error</h2>
                    <p id="form-error-message">Something went wrong. Please try again.</p>
                    <button class="btn btn-primary" onclick="document.getElementById('form-error').style.display='none';document.getElementById('pledge-form').style.display='';">Try Again</button>
                </div>
            </div>
        </div>
    </section>
</div>
```

**Step 2: Add quiz.js and sheets.js script tags to outreach.html**

Add before `pwa.js`:
```html
<script src="js/sheets.js"></script>
<script src="js/quiz.js"></script>
```

**Step 3: Lazy-init the pledge form**

In `my-reps-page.js`, when the Take Pledge tab is first activated, call `quiz.js` init if it has one, or ensure quiz.js self-initializes on DOMContentLoaded and gracefully handles its target elements not existing initially.

Check `quiz.js` — if it binds to `#pledge-form` on DOMContentLoaded, it should work since the form element exists in the DOM (just hidden). If it fails because the form is display:none, add a one-time init call when the tab is first shown.

**Step 4: Commit**
```bash
git add outreach.html js/my-reps-page.js
git commit -m "feat: add Take the Pledge tab with inline form"
```

---

### Task 6: Add Candidates Running Section to Rep Cards

**Files:**
- Modify: `js/my-reps-page.js` (buildRepCard function)
- Modify: `css/styles.css` (candidate chip styles)

**Step 1: Update buildRepCard to show candidates**

In `my-reps-page.js`, find the `buildRepCard()` function. Inside the expandable detail section, after the bills list, add a candidates section. Use safe DOM methods:

```javascript
// After bills section in the detail panel
if (rep.candidates && rep.candidates.length > 0) {
    var candSection = document.createElement('div');
    candSection.className = 'rep-hub-candidates';

    var candTitle = document.createElement('h4');
    candTitle.textContent = 'Candidates Running for This Seat';
    candSection.appendChild(candTitle);

    var candList = document.createElement('div');
    candList.className = 'candidate-chip-list';

    rep.candidates.forEach(function(c) {
        var chip = document.createElement('span');
        chip.className = 'candidate-chip';
        var partyLetter = (c.party || '?').charAt(0).toUpperCase();
        if (partyLetter === 'R') chip.classList.add('party-r');
        else if (partyLetter === 'D') chip.classList.add('party-d');
        else chip.classList.add('party-i');
        chip.textContent = c.name + ' (' + (c.party || '?') + ')';
        candList.appendChild(chip);
    });

    candSection.appendChild(candList);
    detailPanel.appendChild(candSection);
}
```

**Step 2: Add candidate chip CSS**

```css
.rep-hub-candidates { margin-top: 1.5em; padding-top: 1em; border-top: 1px solid #e5e7eb; }
.rep-hub-candidates h4 { font-size: 0.85rem; color: #374151; margin-bottom: 0.5em; }
.candidate-chip-list { display: flex; flex-wrap: wrap; gap: 0.4em; }
.candidate-chip { font-size: 0.75rem; padding: 0.25em 0.6em; border-radius: 999px; background: #f3f4f6; color: #374151; }
.candidate-chip.party-r { background: #fee2e2; color: #991b1b; }
.candidate-chip.party-d { background: #dbeafe; color: #1e40af; }
.candidate-chip.party-i { background: #fef3c7; color: #92400e; }
```

**Step 3: Commit**
```bash
git add js/my-reps-page.js css/styles.css
git commit -m "feat: show candidates running for each seat in rep cards"
```

---

### Task 7: Clean Up directory.html

**Files:**
- Modify: `directory.html` (lines 125-128)

**Step 1: Remove duplicate CTA**

Delete the second CTA block (lines 125-128):
```html
<div class="signup-section" style="margin-top:0;padding-top:0;">
    <p>Want to ask candidates to take the pledge?</p>
    <a href="outreach.html" class="btn btn-hero-outline btn-lg">Contact Candidates</a>
</div>
```

Keep the first CTA ("Are You an Elected Official or Candidate?") and update its link to point to the Take Pledge tab:
```html
<a href="outreach.html#take-pledge" class="btn btn-primary btn-lg">
```

**Step 2: Commit**
```bash
git add directory.html
git commit -m "chore: remove duplicate CTA from pledge directory"
```

---

### Task 8: Create Redirect Pages

**Files:**
- Modify: `intelligence.html` (replace entire content)
- Modify: `tracker.html` (replace entire content)
- Modify: `elections.html` (replace entire content)
- Modify: `press.html` (replace entire content)
- Modify: `updates.html` (update redirect target)

**Step 1: Replace each retired page with a meta-refresh redirect**

For intelligence.html, tracker.html, elections.html, press.html, use this template:
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0;url=outreach.html">
    <title>Redirecting to Take Action - SAFE Action</title>
</head>
<body>
    <p>Redirecting to <a href="outreach.html">Take Action</a>...</p>
</body>
</html>
```

For updates.html, change the existing redirect target from press.html to outreach.html.

**Step 2: Commit**
```bash
git add intelligence.html tracker.html elections.html press.html updates.html
git commit -m "chore: redirect retired pages to Take Action hub"
```

---

### Task 9: Update Service Worker

**Files:**
- Modify: `sw.js`

**Step 1: Bump cache version and update asset list**

Change `CACHE_NAME` to `safe-action-v16`.

Update the ASSETS array — remove references to retired page JS files that are no longer loaded:
- Remove: `/js/intelligence-page.js`, `/js/outreach.js`, `/js/updates.js`
- Keep: `/js/tracker.js` (if still used for bill rendering logic)
- Add: `/js/sheets.js`, `/js/quiz.js` (now loaded by outreach.html)
- Keep all HTML files in cache (including redirects, for offline)

**Step 2: Commit**
```bash
git add sw.js
git commit -m "chore: bump SW to v16, update cached assets"
```

---

### Task 10: Verify, Final Commit, and Deploy

**Step 1: Start preview server and test all 3 tabs**

Run preview server. Navigate to outreach.html:
- Tab 1 (My Reps): Enter address → verify rep cards load with candidates section
- Tab 2 (Browse Bills): Verify bill grid loads, filters work, bill cards link to action.html
- Tab 3 (Take Pledge): Verify pledge form renders, character counts work

**Step 2: Test navigation**

- Home page: hero CTA goes to outreach.html, pledge CTA goes to directory.html
- Header: 3 links work (Home, Take Action, Pledges)
- Footer: 3 links + social + donate work
- directory.html: single CTA links to outreach.html#take-pledge

**Step 3: Test redirects**

Navigate to intelligence.html, tracker.html, elections.html, press.html, updates.html — all should redirect to outreach.html.

**Step 4: Check console for errors**

Zero console errors expected on all pages.

**Step 5: Commit any fixes and push + deploy**

```bash
git add -A
git commit -m "feat: streamline site to 3 focused pages

Remove Intelligence tab, merge elections data into rep cards,
add Browse Bills and Take Pledge tabs to the Take Action hub.
Redirect retired pages."
git push
vercel --prod --yes
```
