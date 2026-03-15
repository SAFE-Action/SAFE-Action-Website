# Homepage Redesign + Dropdown Mega-Nav Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat 4-link nav with a dropdown mega-nav across all pages, and redesign the homepage to have a unified "Contact Your Reps" CTA with a separate pledge showcase section.

**Architecture:** Two independent workstreams: (1) mega-nav component replaces the existing header in all pages, (2) homepage content restructure. The mega-nav is pure CSS hover dropdowns with a JS-driven mobile hamburger menu. The pledge showcase queries Firestore for recent candidates.

**Tech Stack:** HTML/CSS (no build tools), vanilla JS, Firebase/Firestore for pledge data, existing CSS custom properties from styles.css.

---

### Task 1: Add Mega-Nav CSS to styles.css

**Files:**
- Modify: `css/styles.css` (after line ~164, the current `.nav-link.active` block)

**Step 1: Add the dropdown mega-nav styles after existing nav styles**

Add the following CSS after the `.nav-link.active` rule block (around line 164) in `css/styles.css`:

```css
/* ============================================================
   DROPDOWN MEGA-NAV
   ============================================================ */
.nav2-item {
  position: relative;
}

.nav2-item > a {
  color: rgba(255,255,255,0.85);
  font-weight: 600;
  font-size: 0.95rem;
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  transition: all var(--transition);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.nav2-item > a:hover {
  color: var(--white);
  background: rgba(255,255,255,0.1);
}

.nav2-item > a.active {
  color: var(--white);
  background: var(--red);
}

.nav2-item > a .arrow {
  font-size: 0.55em;
  opacity: 0.6;
  transition: transform 0.2s ease;
}

.nav2-item:hover > a .arrow {
  transform: rotate(180deg);
}

.nav2-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  min-width: 220px;
  background: #ffffff;
  border-radius: 0 0 8px 8px;
  border-top: 3px solid var(--red);
  box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
  padding: 8px 0;
  z-index: 200;
  animation: dropdown-reveal 0.2s ease;
}

@keyframes dropdown-reveal {
  from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.nav2-item:hover .nav2-dropdown {
  display: block;
}

.nav2-dropdown a {
  display: block;
  padding: 10px 20px;
  color: #334155;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.15s ease;
  text-decoration: none;
}

.nav2-dropdown a:hover {
  background: #f1f5f9;
  color: var(--blue);
  padding-left: 24px;
}

.nav2-dropdown hr {
  margin: 6px 16px;
  border: none;
  border-top: 1px solid #e2e8f0;
}

/* Logo as home link */
.logo-link {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--white);
  text-decoration: none;
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: 0.5px;
}

.logo-link:hover { opacity: 0.9; }

.logo-link .logo-icon {
  font-size: 1.8rem;
  color: var(--gold);
  filter: drop-shadow(0 0 4px rgba(201,168,76,0.4));
}

/* Scrolled header adjustments for mega-nav */
.site-header.scrolled .logo-link { font-size: 1.3rem; }
.site-header.scrolled .logo-link .logo-icon { font-size: 1.5rem; }
.site-header.scrolled .nav2-item > a { padding: 7px 16px; font-size: 0.9rem; }

/* Mobile hamburger */
.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 8px;
}

/* Mobile Nav Overlay */
.mobile-nav-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 999;
  background: var(--blue);
  flex-direction: column;
  overflow-y: auto;
}

.mobile-nav-overlay.open { display: flex; }

.mobile-nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 3px solid var(--red);
}

.mobile-nav-close {
  background: none;
  border: none;
  color: white;
  font-size: 1.8rem;
  cursor: pointer;
}

.mobile-nav-section {
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.mobile-nav-section-title {
  display: block;
  padding: 16px 24px;
  color: rgba(255,255,255,0.6);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.mobile-nav-section a {
  display: block;
  padding: 14px 24px 14px 40px;
  color: white;
  font-size: 1rem;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s ease;
}

.mobile-nav-section a:hover { background: rgba(255,255,255,0.08); }
.mobile-nav-section a.active { background: var(--red); }

@media (max-width: 768px) {
  .main-nav { display: none !important; }
  .mobile-menu-btn { display: block; }
}
```

**Step 2: Commit**

```bash
git add css/styles.css
git commit -m "feat: add dropdown mega-nav CSS styles"
```

---

### Task 2: Add Homepage-Specific CSS (Hero + Pledge Showcase)

**Files:**
- Modify: `css/styles.css` (add after the mega-nav styles from Task 1)

**Step 1: Add hero redesign and pledge showcase styles**

Add CSS for `.hero-address-form` (flex row with input + button, max-width 600px, border-radius, shadow), `.hero-learn-link` (subtle link below form), `.pledge-showcase` section (light bg, centered header with h2 + count badge), `.pledge-showcase-scroll` (horizontal scrollable flex row), `.pledge-card-mini` (200px wide cards with avatar, name, party badge, office), party badge color variants (`.dem`, `.rep`, `.ind`), and `.pledge-showcase-footer` (centered "View All" link). Include mobile breakpoint for stacking the form vertically at 600px.

**Step 2: Commit**

```bash
git add css/styles.css
git commit -m "feat: add hero address form and pledge showcase CSS"
```

---

### Task 3: Replace Nav Markup in index.html + Restructure Homepage

**Files:**
- Modify: `index.html`

**Step 1: Replace the header with mega-nav markup**

Replace the current header block containing `.logo` div and `.main-nav` with 4 `nav-link` elements. New markup uses:
- `<a class="logo-link">` wrapping the logo icon + text (clickable to home)
- `.main-nav` containing 3 `.nav2-item` divs, each with a top-level link + `.nav2-dropdown`
- Take Action dropdown: Email Your Reps, Call/Text Reps, Action Tracker, Live Dashboard
- Vaccine Pledges dropdown: Pledge Directory, Candidate Quiz, Elections
- About dropdown: Our Mission, Volunteer, Donate, Media Kit, Updates
- A `.mobile-menu-btn` hamburger button
- A `.mobile-nav-overlay` div with the same links organized into `.mobile-nav-section` groups

**Step 2: Replace the hero section**

Replace the two CTA buttons with:
- Keep the hero title "Defend Science. Take Action."
- Change subtitle to "Tell your representatives to support evidence-based policy"
- Add `<form class="hero-address-form">` with text input (placeholder "Enter your address to find your reps...") and submit button "Find My Reps"
- Add `<a class="hero-learn-link">` below: "Learn how it works"

**Step 3: Add the pledge showcase section after the pledge ticker**

Insert a new `<section class="pledge-showcase">` containing:
- Header with h2 "Leaders Taking the Pledge" + `<span id="pledge-total-count">` badge
- Scrollable div `#pledge-showcase-cards` (populated by JS)
- Footer with "View All Pledges" link to directory.html

**Step 4: Remove sections now accessible via mega-nav**

Delete these sections from index.html:
- Database Stats section (class `database-section`)
- Pledge CTA section (class `pledge-cta-section`)
- Volunteer CTA section (class `volunteer-cta-section`)

Keep: pledge-ticker-section, momentum-banner (daily goal), impact-section.

**Step 5: Add homepage JS before closing body tag**

Add inline script that:
1. Listens for hero-address-form submit, redirects to `outreach.html?address=` + encoded value
2. Queries Firestore `candidateResponses` collection ordered by timestamp desc, limit 8
3. For each doc, creates a `.pledge-card-mini` link element using safe DOM methods (createElement, textContent) — no innerHTML with user data
4. Updates the pledge count badge with total collection size

**Step 6: Commit**

```bash
git add index.html
git commit -m "feat: redesign homepage with mega-nav, unified CTA, and pledge showcase"
```

---

### Task 4: Replace Nav Markup in All Other HTML Pages

**Files:**
- Modify: `outreach.html`, `directory.html`, `about.html`, `donate.html`, `candidate.html`, `action.html`, `quiz.html`, `media.html`, `volunteer.html`

For each file, replace the header block with the same mega-nav markup from Task 3 Step 1, but set the appropriate `active` class on the relevant nav2-item link.

**Active states per page:**
- `outreach.html`, `action.html` — Take Action link gets `active` class
- `directory.html`, `quiz.html`, `elections.html` — Vaccine Pledges link gets `active` class
- `about.html`, `donate.html`, `media.html`, `volunteer.html` — About link gets `active` class
- `candidate.html` — Vaccine Pledges link gets `active` class

Also add the mobile nav overlay div after the header in each file.

**Step 1: Update each file's header**

For each file, find the old nav pattern with `.logo` div + `.main-nav` with `nav-link` elements, and replace with the mega-nav markup.

**Step 2: Commit all pages**

```bash
git add outreach.html directory.html about.html donate.html candidate.html action.html quiz.html media.html volunteer.html
git commit -m "feat: apply dropdown mega-nav to all site pages"
```

---

### Task 5: Handle Address Parameter in outreach.html

**Files:**
- Modify: `outreach.html` or `js/my-reps-page.js`

**Step 1: Add URL parameter handling**

At the top of the outreach page's initialization JS, add code to:
1. Read `address` from URL query parameters
2. If present, set the address input field value
3. Trigger the address lookup/form submit programmatically

**Step 2: Commit**

```bash
git add outreach.html
git commit -m "feat: auto-fill address from homepage CTA redirect"
```

---

### Task 6: Bump Service Worker Cache + Clean Up

**Files:**
- Modify: `sw.js` (line 2, change `v68` to `v69`)
- Delete: `nav-demo.html`

**Step 1: Bump cache version in sw.js**
**Step 2: Delete nav-demo.html**

```bash
git add sw.js && git rm nav-demo.html
git commit -m "chore: bump SW cache to v69, remove nav-demo.html"
```

---

### Task 7: Preview and Verify

**Step 1: Start dev server and preview homepage**

Verify:
- Mega-nav dropdowns appear on hover over Take Action, Vaccine Pledges, About
- Logo clicks to home, no "Home" text link
- Hero shows address input + "Find My Reps" button
- Address form redirects to outreach.html with query param
- Pledge showcase shows recent candidate cards from Firestore
- Impact stats section present, database/volunteer/pledge CTAs removed
- Footer unchanged

**Step 2: Check other pages**

Spot-check 3-4 pages for correct mega-nav rendering and active states.

**Step 3: Mobile check**

Resize to mobile width, verify hamburger menu opens overlay with all links.
