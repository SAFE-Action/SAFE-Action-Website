# Firestore Legislation Database Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the legislation database from a 9.3MB static JSON file (`data/bills.json`) to Firebase Firestore, with server-side filtering, pagination, and sub-second load times.

**Architecture:** Bills are uploaded to Firestore as individual documents in a `bills` collection. The existing `LegislationAPI` object is modified to query Firestore directly instead of fetching the static file. Client-side `BillBrowser` gets pagination (50 bills per page) and Firestore-native filtering. The static `bills.json` is kept as a crawler export/backup but is no longer fetched by the browser. A one-time Node.js upload script imports the existing 10,455 bills into Firestore.

**Tech Stack:** Firebase Firestore (already configured), firebase-firestore-compat.js (already loaded on index.html), Node.js (for one-time import script)

---

## Task 1: Create Firestore Import Script

**Files:**
- Create: `scripts/import-bills-to-firestore.js`

**Step 1: Create the import script**

See implementation in Task code blocks below. The script:
- Reads `data/bills.json`
- Uploads bills in batches of 500 (Firestore limit)
- Uses `billId` as document ID for direct lookups
- Adds `_searchText` field (lowercase concatenation) for text search
- Writes a `_metadata` doc with import stats

**Step 2: Add service account key to .gitignore**

Ensure `scripts/service-account-key.json` is in `.gitignore`.

**Step 3: Run the import**

```bash
cd scripts
npm install firebase-admin
node import-bills-to-firestore.js
```

**Step 4: Create Firestore indexes**

Composite indexes needed on `bills` collection:

| Fields | Order |
|--------|-------|
| `state` ASC, `impact` ASC | state + sort by priority |
| `billType` ASC, `impact` ASC | stance filter + sort |
| `state` ASC, `billType` ASC, `impact` ASC | state + stance + sort |
| `category` ASC, `impact` ASC | category filter + sort |
| `isActive` ASC, `impact` ASC | active filter + sort |

**Step 5: Update Firestore security rules**

Add `bills` collection rule to `firestore.rules`:
```
match /bills/{docId} {
  allow read: if true;
  allow write: if request.auth != null &&
    exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
}
```

**Step 6: Commit**

```bash
git add scripts/import-bills-to-firestore.js firestore.rules .gitignore
git commit -m "feat: add Firestore bill import script and security rules"
```

---

## Task 2: Update LegislationAPI to Query Firestore

**Files:**
- Modify: `js/legislation-api.js`

**Step 1: Rewrite LegislationAPI**

Key changes:
- Add `_getDb()` helper for lazy Firestore init
- `getLegislation()`: Try Firestore first, fall back to static `bills.json`
- New `queryBills(filters, pageSize, startAfterDoc)` method for paginated queries
- `getBill(billId)`: Direct Firestore doc lookup by ID
- `_clientFilter()`: Helper for static fallback filtering
- Keep `_getStaticLegislation()` as renamed version of old `_getDemoLegislation()`
- Representatives, templates, victories, fillTemplate: unchanged

**Step 2: Commit**

```bash
git add js/legislation-api.js
git commit -m "feat: rewrite LegislationAPI to query Firestore with static fallback"
```

---

## Task 3: Update BillBrowser for Firestore Pagination

**Files:**
- Modify: `js/my-reps-page.js` (lines 1897-2165, the `BillBrowser` object)

**Step 1: Rewrite BillBrowser**

Key changes:
- Add `_lastDoc`, `_hasMore`, `_loading`, `_useFirestore` state
- `PAGE_SIZE: 50` constant
- `init()`: Detect Firestore availability, wire up "Load More" button
- Filter change listeners: Reset pagination cursor (`_lastDoc = null`) on filter change
- `loadBills(append)`: Use `LegislationAPI.queryBills()` for Firestore path with pagination; fall back to static path
- `render()`: Show/hide "Load More" button based on `_hasMore`; show count with `+` suffix when more exist
- `buildCard()`: Unchanged

**Step 2: Commit**

```bash
git add js/my-reps-page.js
git commit -m "feat: add Firestore pagination to BillBrowser (50 bills/page)"
```

---

## Task 4: Add Firebase Scripts to Tracker Page + Load More Button

**Files:**
- Modify: `tracker.html`
- Modify: `sw.js`

**Step 1: Add Firebase SDK scripts before config.js**

```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="js/config.js?v=76"></script>
<script>
if (typeof firebase !== 'undefined' && typeof SAFE_CONFIG !== 'undefined' && SAFE_CONFIG.FIREBASE_CONFIG) {
    firebase.initializeApp(SAFE_CONFIG.FIREBASE_CONFIG);
}
</script>
```

**Step 2: Add "Load More" button after the bill grid**

```html
<button id="bb-load-more" class="btn btn-outline" style="display:none;margin:2em auto;width:100%;max-width:300px;">Load More Bills</button>
```

**Step 3: Update version numbers and bump SW cache**

**Step 4: Commit**

```bash
git add tracker.html sw.js
git commit -m "feat: add Firebase to tracker page, add Load More pagination button"
```

---

## Task 5: Test and Deploy

**Step 1: Verify in browser**

- Open tracker.html, DevTools Network tab
- Confirm Firestore requests (small JSON) instead of 9.3MB bills.json
- First 50 bills load in under 1 second
- "Load More" button appears and loads next 50
- Filters trigger new Firestore queries
- If Firebase unreachable, falls back to static bills.json

**Step 2: Final commit and deploy**

```bash
git checkout main && git merge dev && git push origin main
git checkout dev && git push origin dev
```

---

## Performance Comparison

| Metric | Before (static) | After (Firestore) |
|--------|-----------------|-------------------|
| Initial payload | 9.3 MB | ~50 KB (50 bills) |
| Time to first bill | 3-8 seconds | < 500ms |
| Filter change | Client-side on 10K bills | New Firestore query |
| Memory usage | 10K objects in RAM | 50 objects per page |
| Offline support | Full (SW cached) | Graceful fallback to static |

## Rollback Plan

If Firestore has issues, the static fallback is always active. The `data/bills.json` file is never removed.
