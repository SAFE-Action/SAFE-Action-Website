# Volunteer Onboarding System + Google Cloud Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate SAFE Action from Vercel to Firebase Hosting + Google Cloud Functions, and build a complete volunteer onboarding system with Google Workspace automation.

**Architecture:** Static site on Firebase Hosting. Google Cloud Functions (2nd gen, Node.js) for API endpoints. Firestore for volunteer data. Google Workspace APIs (Gmail, Drive, Calendar, Contacts, Chat) via service account with domain-wide delegation for onboarding automation.

**Tech Stack:** Firebase Hosting, Google Cloud Functions (2nd gen), Firebase Firestore, Firebase Auth, Google Workspace APIs, Node.js, PDFKit (for NDA PDF generation), vanilla HTML/CSS/JS frontend.

---

## Phase 1: Firebase Hosting Migration

### Task 1: Initialize Firebase Hosting config

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Remove reference: `vercel.json` (keep file until end for rollback safety)

**Step 1: Create firebase.json**

```json
{
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      ".firebaserc",
      "**/node_modules/**",
      "functions/**",
      "crawler/**",
      "docs/**",
      ".git/**",
      "*.py",
      "*.log",
      "*.md"
    ],
    "cleanUrls": true,
    "trailingSlash": false,
    "rewrites": [
      { "source": "/candidates/:slug", "destination": "/candidate.html" },
      { "source": "/admin", "destination": "/admin.html" },
      { "source": "/feed", "destination": "/feed.html" },
      { "source": "/volunteer", "destination": "/volunteer.html" },
      { "source": "/volunteer/nda", "destination": "/nda.html" },
      { "source": "/api/districts", "function": "districts" },
      { "source": "/api/volunteer/apply", "function": "volunteerApply" },
      { "source": "/api/admin/volunteers/**", "function": "adminVolunteers" },
      { "source": "/api/volunteer/*/nda/sign", "function": "volunteerSignNda" }
    ],
    "headers": [
      {
        "source": "/data/**",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600" }]
      }
    ]
  }
}
```

Note: Firebase Hosting rewrites with `"function"` route to Cloud Functions. The `/candidates/:slug` rewrite uses `destination` because it's a static page that parses the URL client-side.

**Step 2: Create .firebaserc**

```json
{
  "projects": {
    "default": "safe-action-840f0"
  }
}
```

**Step 3: Update candidate.js slug parsing for Firebase Hosting**

Firebase Hosting rewrites work differently from Vercel — the rewrite serves the destination file but the browser URL stays as `/candidates/:slug`. The existing code in `js/candidate.js` already handles this via `window.location.pathname.match(/\/candidates\/([^/]+)/)`. No changes needed.

**Step 4: Install Firebase CLI and test locally**

```bash
npm install -g firebase-tools
firebase login
firebase use safe-action-840f0
firebase serve --only hosting
```

Verify: visit http://localhost:5000, check clean URLs work, check `/candidates/test-slug` serves candidate.html.

**Step 5: Commit**

```bash
git add firebase.json .firebaserc
git commit -m "feat: add Firebase Hosting config for migration from Vercel"
```

---

### Task 2: Initialize Cloud Functions directory

**Files:**
- Create: `functions/package.json`
- Create: `functions/index.js` (entry point, exports all functions)
- Create: `functions/.env.example`
- Update: `firebase.json` (add functions config)
- Update: `.gitignore` (add functions/node_modules)

**Step 1: Create functions/package.json**

```json
{
  "name": "safe-action-functions",
  "description": "SAFE Action Cloud Functions",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0",
    "googleapis": "^130.0.0",
    "pdfkit": "^0.15.0",
    "cors": "^2.8.5"
  }
}
```

**Step 2: Create functions/index.js (stub)**

```js
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

// Import individual function handlers
const { districts } = require("./districts");
const { volunteerApply } = require("./volunteer-apply");
const { adminVolunteers } = require("./admin-volunteers");
const { volunteerSignNda } = require("./volunteer-sign-nda");

exports.districts = onRequest({ cors: true }, districts);
exports.volunteerApply = onRequest({ cors: true }, volunteerApply);
exports.adminVolunteers = onRequest({ cors: true }, adminVolunteers);
exports.volunteerSignNda = onRequest({ cors: true }, volunteerSignNda);
```

**Step 3: Create functions/.env.example**

```
# Google Workspace service account key (JSON, base64-encoded)
GOOGLE_SERVICE_ACCOUNT_KEY=

# Google Chat space resource name (spaces/XXXXXXX)
GOOGLE_CHAT_SPACE=

# Google Calendar event ID for weekly meeting
GOOGLE_CALENDAR_EVENT_ID=

# Google Drive parent folder ID for volunteer folders
GOOGLE_DRIVE_PARENT_FOLDER_ID=

# Officer email for notifications
OFFICER_EMAIL=officer@scienceandfreedom.com

# Domain for NDA signing links
SITE_URL=https://scienceandfreedom.com
```

**Step 4: Update firebase.json — add functions config**

Add to the top level of firebase.json:

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs20"
  },
  "hosting": { ... }
}
```

**Step 5: Update .gitignore**

Add: `functions/node_modules/`

**Step 6: Install dependencies and commit**

```bash
cd functions && npm install && cd ..
git add functions/package.json functions/index.js functions/.env.example firebase.json .gitignore
git commit -m "feat: initialize Cloud Functions directory with stubs"
```

---

### Task 3: Migrate districts function from Vercel to Cloud Functions

**Files:**
- Create: `functions/districts.js`
- Modify: `js/my-reps.js:136,165` (update API URL if needed — should stay as `/api/districts`)

**Step 1: Create functions/districts.js**

Port the existing `/api/districts.js` (Vercel format: `module.exports = async function handler(req, res)`) to Cloud Functions format. The handler signature is the same (req, res) so minimal changes needed:

```js
// Census Geocoder proxy for state legislative districts
// Migrated from Vercel serverless /api/districts.js

exports.districts = async (req, res) => {
    const street = req.query.street;
    const city = req.query.city;
    const state = req.query.state;
    const zip = req.query.zip;
    const lat = req.query.lat;
    const lng = req.query.lng;

    if (!lat && (!street || !state)) {
        return res.status(400).json({ error: 'Provide street+state or lat+lng' });
    }

    try {
        let match = null;

        // Strategy 1: Address-based lookup
        if (street && state) {
            const addrParams = new URLSearchParams({
                street, city: city || '', state, zip: zip || '',
                benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json',
            });
            const addrResp = await fetch('https://geocoding.geo.census.gov/geocoder/geographies/address?' + addrParams.toString());
            if (addrResp.ok) {
                const addrData = await addrResp.json();
                match = addrData?.result?.addressMatches?.[0];
            }
        }

        // Strategy 2: Coordinate-based lookup (fallback or direct)
        if (!match && lat && lng) {
            const coordParams = new URLSearchParams({
                x: lng, y: lat,
                benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json',
            });
            const coordResp = await fetch('https://geocoding.geo.census.gov/geocoder/geographies/coordinates?' + coordParams.toString());
            if (coordResp.ok) {
                const coordData = await coordResp.json();
                const coordGeos = coordData?.result?.geographies;
                if (coordGeos) {
                    match = { geographies: coordGeos, matchedAddress: 'coordinates:' + lat + ',' + lng, coordinates: { x: parseFloat(lng), y: parseFloat(lat) } };
                }
            }
        }

        if (!match) {
            return res.status(200).json({ found: false, districts: [] });
        }

        const geos = match.geographies || {};
        const geoKeys = Object.keys(geos);
        const districts = [];

        const slduKey = geoKeys.find(k => k.includes('State Legislative Districts - Upper'));
        const sldlKey = geoKeys.find(k => k.includes('State Legislative Districts - Lower'));
        const cdKey = geoKeys.find(k => k.includes('Congressional Districts'));

        if (slduKey && geos[slduKey]?.[0]) {
            const d = geos[slduKey][0];
            districts.push({ type: 'state-senate', number: d.DISTRICT || d.BASENAME || '', name: d.NAMELSAD || d.NAME || '' });
        }
        if (sldlKey && geos[sldlKey]?.[0]) {
            const d = geos[sldlKey][0];
            districts.push({ type: 'state-house', number: d.DISTRICT || d.BASENAME || '', name: d.NAMELSAD || d.NAME || '' });
        }
        if (cdKey && geos[cdKey]?.[0]) {
            const d = geos[cdKey][0];
            districts.push({ type: 'cd', number: d.DISTRICT || d.BASENAME || d.CD || '', name: d.NAMELSAD || d.NAME || '' });
        }

        res.set('Cache-Control', 'public, max-age=86400');
        return res.status(200).json({
            found: true,
            matchedAddress: match.matchedAddress,
            coordinates: match.coordinates,
            districts,
        });
    } catch (e) {
        console.error('Census geocoder error:', e);
        return res.status(500).json({ error: 'Census lookup failed', details: e.message });
    }
};
```

**Step 2: Verify frontend API calls**

`js/my-reps.js:136` calls `fetch('/api/districts?...')`. Firebase Hosting rewrite routes `/api/districts` → Cloud Function `districts`. No frontend changes needed.

**Step 3: Test locally**

```bash
firebase emulators:start --only hosting,functions
```

Visit http://localhost:5000, test address lookup on outreach page.

**Step 4: Commit**

```bash
git add functions/districts.js
git commit -m "feat: migrate districts function from Vercel to Cloud Functions"
```

---

### Task 4: Deploy to Firebase Hosting + update DNS

**Step 1: Deploy**

```bash
firebase deploy --only hosting,functions
```

**Step 2: Add custom domain in Firebase Console**

- Go to Firebase Console → Hosting → Add custom domain
- Enter `scienceandfreedom.com`
- Update DNS records as instructed (A records or CNAME)
- Wait for SSL provisioning

**Step 3: Verify site works on Firebase Hosting**

- Check all pages load
- Check clean URLs work
- Check `/candidates/:slug` rewrite works
- Check `/api/districts` calls work

**Step 4: Remove Vercel**

Once Firebase is confirmed working:
- Delete `vercel.json`
- Remove Vercel project connection (optional, via Vercel dashboard)

```bash
git rm vercel.json
git commit -m "chore: remove Vercel config, fully migrated to Firebase Hosting"
```

---

## Phase 2: Volunteer Application Form

### Task 5: Create volunteer.html page

**Files:**
- Create: `volunteer.html`

**Step 1: Create the page**

Build `volunteer.html` with:
- Same header/footer as other pages (copy from index.html pattern)
- Application form with fields:
  - Full Name (text, required)
  - Email (email, required)
  - Skills (checkboxes): Web Development, Backend, Design, Product, Marketing, Operations, Other
  - Monthly Availability (select): 5 hours, 10 hours, 20 hours, 40+ hours
  - Interests (checkboxes): Developing Web Apps, Developing New Tools, Curating Pipeline, Research, Community Building
- Submit button
- Success/error state display
- Footer link to "Report Invalid Email" (matches other pages)

Style using existing CSS classes (`.container`, `.btn-primary`, form styles). Add volunteer-specific CSS to `css/styles.css`.

**Step 2: Create js/volunteer.js**

Client-side form handler:
- Validate required fields (name, email, at least one skill, availability)
- Collect checked skills[] and interests[]
- POST to `/api/volunteer/apply` with JSON body
- Show success message on 200, error message on failure
- Disable submit button during submission

**Step 3: Add footer link across all pages**

Add "Volunteer" link to footer nav in all HTML files (index.html, outreach.html, directory.html, action.html, quiz.html, candidate.html, media.html, tracker.html, feed.html).

**Step 4: Update service worker cache**

In `sw.js`:
- Add `/volunteer.html` and `/js/volunteer.js` to ASSETS array
- Bump cache version: `safe-action-v67`

**Step 5: Commit**

```bash
git add volunteer.html js/volunteer.js css/styles.css sw.js index.html outreach.html directory.html action.html quiz.html candidate.html media.html tracker.html feed.html
git commit -m "feat: add volunteer application page with form"
```

---

### Task 6: Build volunteerApply Cloud Function

**Files:**
- Create: `functions/volunteer-apply.js`
- Create: `functions/email-service.js` (shared Gmail sending utility)

**Step 1: Create functions/email-service.js**

Gmail sending utility using Google Workspace service account with domain-wide delegation:

```js
const { google } = require('googleapis');

async function getGmailClient(serviceAccountKey) {
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(Buffer.from(serviceAccountKey, 'base64').toString()),
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
        clientOptions: { subject: 'officer@scienceandfreedom.com' }
    });
    return google.gmail({ version: 'v1', auth });
}

function buildRawEmail({ to, subject, htmlBody, from = 'officer@scienceandfreedom.com' }) {
    const boundary = 'boundary_' + Date.now();
    const lines = [
        `From: SAFE Action <${from}>`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=UTF-8`,
        '',
        htmlBody
    ];
    return Buffer.from(lines.join('\r\n')).toString('base64url');
}

async function sendEmail(serviceAccountKey, { to, subject, htmlBody }) {
    const gmail = await getGmailClient(serviceAccountKey);
    const raw = buildRawEmail({ to, subject, htmlBody });
    await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw }
    });
}

module.exports = { sendEmail };
```

**Step 2: Create functions/volunteer-apply.js**

```js
const admin = require('firebase-admin');
const { sendEmail } = require('./email-service');

exports.volunteerApply = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, skills, interests, availability } = req.body;

    // Validate
    if (!name || !email || !skills?.length || !availability) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
        // Check for duplicate application
        const existing = await admin.firestore().collection('volunteers')
            .where('email', '==', email.toLowerCase()).limit(1).get();
        if (!existing.empty) {
            return res.status(409).json({ error: 'An application with this email already exists' });
        }

        // Save to Firestore
        const docRef = await admin.firestore().collection('volunteers').add({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            skills,
            interests: interests || [],
            availability,
            status: 'pending',
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            onboardingSteps: {
                welcomeEmail: false,
                driveFolder: false,
                googleContact: false,
                chatInvite: false,
                calendarInvite: false
            },
            ndaSigned: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send notification email to officer
        const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (serviceAccountKey) {
            await sendEmail(serviceAccountKey, {
                to: process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com',
                subject: `New Volunteer Application: ${name.trim()}`,
                htmlBody: `
                    <h2>New Volunteer Application</h2>
                    <p><strong>Name:</strong> ${name.trim()}</p>
                    <p><strong>Email:</strong> ${email.trim()}</p>
                    <p><strong>Skills:</strong> ${skills.join(', ')}</p>
                    <p><strong>Interests:</strong> ${(interests || []).join(', ')}</p>
                    <p><strong>Availability:</strong> ${availability}</p>
                    <p><a href="${process.env.SITE_URL || 'https://scienceandfreedom.com'}/admin">Review in Admin Panel</a></p>
                `
            });
        }

        return res.status(200).json({ success: true, id: docRef.id });
    } catch (e) {
        console.error('Volunteer apply error:', e);
        return res.status(500).json({ error: 'Failed to submit application' });
    }
};
```

**Step 3: Commit**

```bash
git add functions/volunteer-apply.js functions/email-service.js
git commit -m "feat: add volunteerApply Cloud Function with Gmail notification"
```

---

## Phase 3: Admin Dashboard — Volunteers Tab

### Task 7: Add Volunteers section to admin panel

**Files:**
- Modify: `admin.html` (add volunteer management section toggle)
- Modify: `js/admin.js` (add volunteer queue logic)
- Modify: `css/styles.css` (volunteer admin styles)

**Step 1: Update admin.html**

Add a top-level section switcher above the existing tabs:

```html
<!-- Section Switcher (above tabs) -->
<div class="admin-section-switcher">
    <button class="admin-section-btn active" data-section="bills">Bills Queue</button>
    <button class="admin-section-btn" data-section="volunteers">Volunteers</button>
</div>
```

Add a volunteers section (hidden by default) with its own tabs (Pending/Approved/Rejected) and a detail panel that shows volunteer info + Approve/Reject buttons.

**Step 2: Update js/admin.js**

Add volunteer management functions:
- `loadVolunteers()` — Firestore listener on `volunteers` collection
- `renderVolunteerQueue()` — shows volunteer cards in pending/approved/rejected tabs
- `renderVolunteerDetail(id)` — shows full application detail
- `approveVolunteer(id)` — calls `/api/admin/volunteers/approve` endpoint
- `rejectVolunteer(id, reason)` — calls `/api/admin/volunteers/reject` endpoint
- Section switcher event handlers to toggle between bills and volunteers views

**Step 3: Add CSS for volunteer admin components**

Reuse existing `.admin-queue`, `.admin-detail` patterns. Add volunteer-specific card styles showing skills/interests as tags.

**Step 4: Commit**

```bash
git add admin.html js/admin.js css/styles.css
git commit -m "feat: add volunteer management section to admin dashboard"
```

---

## Phase 4: Onboarding Automation Cloud Functions

### Task 8: Build Google Workspace service module

**Files:**
- Create: `functions/google-workspace.js`

**Step 1: Create shared Google Workspace service**

Module that provides authenticated clients for each Google API:

```js
const { google } = require('googleapis');

function getAuth(serviceAccountKey, scopes, subject) {
    const credentials = JSON.parse(Buffer.from(serviceAccountKey, 'base64').toString());
    return new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes,
        subject // impersonate this user (domain-wide delegation)
    });
}

// Create Google Drive folder, share with volunteer
async function createDriveFolder(serviceAccountKey, { volunteerName, volunteerEmail, parentFolderId }) { ... }

// Add to Google Contacts with skills/interests in notes
async function createContact(serviceAccountKey, { name, email, skills, interests }) { ... }

// Add attendee to existing Calendar event
async function addToCalendarEvent(serviceAccountKey, { email, calendarEventId }) { ... }

// Add member to Google Chat space
async function addToChatSpace(serviceAccountKey, { email, spaceName }) { ... }

module.exports = { createDriveFolder, createContact, addToCalendarEvent, addToChatSpace };
```

Each function:
- Gets authenticated client via service account + domain-wide delegation
- Makes the API call
- Returns success/failure + relevant data (folder URL, contact ID, etc.)

**Step 2: Commit**

```bash
git add functions/google-workspace.js
git commit -m "feat: add Google Workspace integration module (Drive, Contacts, Calendar, Chat)"
```

---

### Task 9: Build adminVolunteers Cloud Function (approve/reject)

**Files:**
- Create: `functions/admin-volunteers.js`

**Step 1: Create the function**

Handles routing for:
- `GET /api/admin/volunteers/pending` — list pending volunteers (admin-authenticated)
- `POST /api/admin/volunteers/approve` — approve + trigger onboarding
- `POST /api/admin/volunteers/reject` — reject with optional reason

Authentication: verify Firebase ID token from request header (`Authorization: Bearer <token>`), then check `admins` collection.

**Approve flow:**
1. Update volunteer status to "approved"
2. Generate NDA token (crypto.randomUUID()), save to volunteer doc
3. Run onboarding steps in sequence, updating `onboardingSteps` field after each:
   - `createDriveFolder()` → save folder URL
   - `createContact()` → save contact ID
   - `addToCalendarEvent()` → mark done
   - `addToChatSpace()` → mark done
   - `sendEmail()` → welcome email with NDA link
4. Return status of all steps

**Step 2: Commit**

```bash
git add functions/admin-volunteers.js
git commit -m "feat: add admin volunteer approve/reject Cloud Functions with onboarding automation"
```

---

## Phase 5: NDA Signing Flow

### Task 10: Create NDA page and signing function

**Files:**
- Create: `nda.html` (NDA display + signing form)
- Create: `js/nda.js` (client-side NDA logic)
- Create: `functions/volunteer-sign-nda.js` (signing handler + PDF generation)
- Create: `functions/nda-template.js` (NDA text content)

**Step 1: Create functions/nda-template.js**

NDA text as a module export — covers:
- Definition of Confidential Information
- Non-disclosure obligations
- Non-compete during volunteer engagement
- Return of materials on termination
- Ongoing obligations (survives termination)
- Governing law
- Signature block with name, date, IP address

**Step 2: Create nda.html**

Page at `/volunteer/nda?token=xxx`:
- Loads NDA text and displays it
- Validates token via Firestore query
- Shows signing form: typed full name, "I have read and agree to the terms" checkbox
- Submit button
- Success state: "NDA signed successfully, a PDF copy has been saved to your Google Drive folder"

**Step 3: Create js/nda.js**

- Parse token from URL
- Validate token exists (fetch volunteer data by token)
- Display NDA with volunteer's name pre-filled in agreement header
- On submit: POST to `/api/volunteer/:id/nda/sign` with { name, token }
- Show success/error state

**Step 4: Create functions/volunteer-sign-nda.js**

Handler:
- Validate token matches a pending-NDA volunteer
- Record: typed name, timestamp, IP (`req.ip`), set ndaSigned=true
- Generate PDF using PDFKit:
  - NDA text from nda-template.js
  - Signature block: "Signed by: {name}", "Date: {timestamp}", "IP: {ip}"
  - SAFE Action header/branding
- Upload PDF to volunteer's Drive folder
- Invalidate token (set to null)
- Return success

**Step 5: Update service worker**

Add `/nda.html` and `/js/nda.js` to ASSETS, bump to `safe-action-v68`.

**Step 6: Commit**

```bash
git add nda.html js/nda.js functions/volunteer-sign-nda.js functions/nda-template.js sw.js
git commit -m "feat: add NDA signing page with PDF generation and Drive upload"
```

---

## Phase 6: Final Integration + Deployment

### Task 11: Configure environment and deploy

**Step 1: Set up Google Cloud service account**

In Google Cloud Console (project safe-action-840f0):
1. Create service account: `safe-action-automation@safe-action-840f0.iam.gserviceaccount.com`
2. Enable domain-wide delegation in Google Workspace Admin Console
3. Grant scopes: Gmail send, Drive, Contacts, Calendar, Chat
4. Download JSON key, base64-encode it

**Step 2: Set Cloud Functions environment variables**

```bash
firebase functions:config:set \
  google.service_account_key="BASE64_ENCODED_KEY" \
  google.chat_space="spaces/XXXXXXX" \
  google.calendar_event_id="EVENT_ID" \
  google.drive_parent_folder_id="FOLDER_ID" \
  google.officer_email="officer@scienceandfreedom.com" \
  google.site_url="https://scienceandfreedom.com"
```

Or for 2nd gen functions, use `.env` file in `functions/` directory (not committed — in .gitignore).

**Step 3: Deploy everything**

```bash
firebase deploy
```

**Step 4: Test end-to-end**

1. Visit /volunteer, fill out form, submit
2. Check Firestore for new volunteer doc
3. Check officer@scienceandfreedom.com received notification email
4. Go to /admin, switch to Volunteers section
5. See pending application, click Approve
6. Verify: welcome email sent, Drive folder created, Calendar invite sent, Chat space invite sent, Contact created
7. Open NDA link from welcome email
8. Sign NDA, verify PDF in Drive folder, Firestore updated

**Step 5: Remove old Vercel artifacts**

```bash
git rm vercel.json
git rm api/districts.js
git commit -m "chore: remove Vercel artifacts, migration complete"
```

**Step 6: Update .gitignore**

Add:
```
functions/node_modules/
functions/.env
```

**Step 7: Final commit and push**

```bash
git add -A
git commit -m "feat: complete volunteer onboarding system + Firebase Hosting migration"
git push origin main
```

---

## Summary of all new/modified files

### New files:
- `firebase.json` — Firebase Hosting + Functions config
- `.firebaserc` — Firebase project link
- `volunteer.html` — Volunteer application page
- `nda.html` — NDA signing page
- `js/volunteer.js` — Volunteer form client-side logic
- `js/nda.js` — NDA signing client-side logic
- `functions/package.json` — Cloud Functions dependencies
- `functions/index.js` — Cloud Functions entry point
- `functions/districts.js` — Migrated Census geocoder
- `functions/volunteer-apply.js` — Application submission
- `functions/admin-volunteers.js` — Admin approve/reject + onboarding
- `functions/volunteer-sign-nda.js` — NDA signing + PDF generation
- `functions/nda-template.js` — NDA agreement text
- `functions/email-service.js` — Gmail sending utility
- `functions/google-workspace.js` — Drive/Contacts/Calendar/Chat utility
- `functions/.env.example` — Environment variable template

### Modified files:
- `admin.html` — Add volunteers section switcher + UI
- `js/admin.js` — Add volunteer queue management
- `css/styles.css` — Volunteer form + admin volunteer styles
- `sw.js` — Add new pages to cache, bump version
- `index.html` — Add "Volunteer" footer link
- `outreach.html` — Add "Volunteer" footer link
- `directory.html` — Add "Volunteer" footer link
- `action.html` — Add "Volunteer" footer link
- `quiz.html` — Add "Volunteer" footer link
- `candidate.html` — Add "Volunteer" footer link
- `media.html` — Add "Volunteer" footer link
- `tracker.html` — Add "Volunteer" footer link
- `feed.html` — Add "Volunteer" footer link
- `.gitignore` — Add functions/node_modules, functions/.env

### Removed files:
- `vercel.json` — Replaced by firebase.json
- `api/districts.js` — Moved to functions/districts.js
