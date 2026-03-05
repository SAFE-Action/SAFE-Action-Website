# Firebase Setup Guide for SAFE Action Website

## Overview
This guide walks you through setting up Firebase Firestore as your backend database for the SAFE Action legislation tracker. Firebase replaces the Google Sheets backend with a faster, more scalable solution.

---

## Step 1: Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Create a project"** (or "Add project")
3. Name it `safe-action` (or whatever you prefer)
4. Disable Google Analytics (optional for this use case) or enable if you want tracking
5. Click **Create Project**

---

## Step 2: Enable Firestore Database

1. In the Firebase console, click **"Build"** in the left sidebar
2. Click **"Firestore Database"**
3. Click **"Create database"**
4. Choose **"Start in production mode"** (we'll set rules next)
5. Select a region close to your users (e.g., `us-central1`)
6. Click **Enable**

---

## Step 3: Set Firestore Security Rules

Go to **Firestore Database > Rules** tab and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Legislation - anyone can read, only admin can write
    match /legislation/{billId} {
      allow read: true;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }

    // Representatives - anyone can read, only admin can write
    match /representatives/{repId} {
      allow read: true;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }

    // Templates - anyone can read, only admin can write
    match /templates/{templateId} {
      allow read: true;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }

    // Email signups - anyone can create, only admin can read/update
    match /email_signups/{signupId} {
      allow create: true;
      allow read, update, delete: if request.auth != null && request.auth.token.admin == true;
    }

    // Candidate pledges - anyone can create, anyone can read
    match /pledges/{pledgeId} {
      allow read: true;
      allow create: true;
      allow update, delete: if request.auth != null && request.auth.token.admin == true;
    }
  }
}
```

Click **Publish**.

---

## Step 4: Get Your Firebase Config

1. In the Firebase console, click the **gear icon** (Project Settings)
2. Scroll down to **"Your apps"**
3. Click the **web icon** (`</>`) to add a web app
4. Name it `safe-action-web`
5. **Do NOT** check "Also set up Firebase Hosting" (unless you want to host there)
6. Click **Register app**
7. You'll see a config object like this - **copy it**:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "safe-action.firebaseapp.com",
  projectId: "safe-action",
  storageBucket: "safe-action.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

---

## Step 5: Add Firebase to Your Website

Replace the contents of `js/config.js` with your Firebase config:

```javascript
const SAFE_CONFIG = {
    // Set to true once Firebase is configured
    IS_CONFIGURED: true,

    // Firebase configuration - paste YOUR values here
    FIREBASE_CONFIG: {
        apiKey: "YOUR_API_KEY_HERE",
        authDomain: "YOUR_PROJECT.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT.appspot.com",
        messagingSenderId: "YOUR_SENDER_ID",
        appId: "YOUR_APP_ID"
    },

    // Cache duration (5 minutes)
    CACHE_DURATION: 5 * 60 * 1000,

    // All 50 states + DC
    STATES: {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
        'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
        'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
        'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
        'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
        'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
        'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
        'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
        'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
    },

    STATUS_ORDER: [
        'Pre-filed', 'Introduced', 'In Committee', 'Passed Committee',
        'Floor Vote Scheduled', 'Passed One Chamber', 'In Conference',
        'Passed Both Chambers', 'Sent to Governor', 'Signed into Law'
    ],

    DEAD_STATUSES: ['Vetoed', 'Died in Committee', 'Tabled', 'Withdrawn']
};
```

---

## Step 6: Add Firebase SDK Scripts

Add these script tags to ALL your HTML files, **before** your other scripts:

```html
<!-- Firebase SDK (add before </body>, before your own scripts) -->
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
```

So your script section in each HTML file should look like:

```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="js/config.js"></script>
<script src="js/legislation-api.js"></script>
<script src="js/tracker.js"></script>
```

---

## Step 7: Update legislation-api.js for Firebase

Replace the fetch-based API calls in `js/legislation-api.js`. The key changes are in the `getLegislation`, `getRepresentatives`, `getTemplates`, and `submitEmailSignup` methods. Here's what the Firebase-powered versions look like:

```javascript
// Add this at the top of legislation-api.js, after the opening:
let _db = null;
function getDB() {
    if (!_db && SAFE_CONFIG.IS_CONFIGURED) {
        if (!firebase.apps.length) {
            firebase.initializeApp(SAFE_CONFIG.FIREBASE_CONFIG);
        }
        _db = firebase.firestore();
    }
    return _db;
}
```

Then update each method:

### getLegislation:
```javascript
async getLegislation(state, forceRefresh = false) {
    const cacheKey = state || 'all';
    if (!forceRefresh && this._billCache && this._billCache[cacheKey] &&
        (Date.now() - this._billCacheTime < SAFE_CONFIG.CACHE_DURATION)) {
        return this._billCache[cacheKey];
    }

    if (!SAFE_CONFIG.IS_CONFIGURED) {
        return this._getDemoLegislation(state);
    }

    try {
        const db = getDB();
        let query = db.collection('legislation');
        if (state) {
            // Get state-specific + federal bills
            const stateSnap = await query.where('state', '==', state).get();
            const fedSnap = await query.where('state', '==', 'US').get();
            const bills = [];
            stateSnap.forEach(doc => bills.push({ ...doc.data(), billId: doc.id }));
            fedSnap.forEach(doc => {
                if (!bills.find(b => b.billId === doc.id)) {
                    bills.push({ ...doc.data(), billId: doc.id });
                }
            });
            if (!this._billCache) this._billCache = {};
            this._billCache[cacheKey] = bills;
            this._billCacheTime = Date.now();
            return bills;
        } else {
            const snap = await query.get();
            const bills = [];
            snap.forEach(doc => bills.push({ ...doc.data(), billId: doc.id }));
            if (!this._billCache) this._billCache = {};
            this._billCache[cacheKey] = bills;
            this._billCacheTime = Date.now();
            return bills;
        }
    } catch (error) {
        console.error('Error fetching legislation:', error);
        return (this._billCache && this._billCache[cacheKey]) || [];
    }
},
```

### submitEmailSignup:
```javascript
async submitEmailSignup(email, state, source) {
    if (!SAFE_CONFIG.IS_CONFIGURED) {
        return new Promise(resolve => {
            setTimeout(() => resolve({ success: true }), 800);
        });
    }

    try {
        const db = getDB();
        await db.collection('email_signups').add({
            email: email,
            state: state,
            source: source,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    } catch (error) {
        console.error('Error submitting email signup:', error);
        throw error;
    }
},
```

---

## Step 8: Insert Data into Firestore

### Option A: Use the Firebase Console (Easiest)

1. Go to **Firebase Console > Firestore Database**
2. Click **"Start collection"**
3. Collection ID: `legislation`
4. Click **"Auto-ID"** for the document ID (or use your bill ID like `TX-HB1547`)
5. Add fields matching this structure:

| Field | Type | Example |
|-------|------|---------|
| billId | string | TX-HB1547 |
| state | string | TX |
| level | string | State |
| billNumber | string | HB 1547 |
| title | string | Vaccine Exemption Expansion Act |
| summary | string | Expands religious and philosophical exemptions... |
| status | string | In Committee |
| isActive | string | Yes |
| chamber | string | House |
| committee | string | Public Health Committee |
| stance | string | Oppose |
| impact | string | High |
| billType | string | anti |
| category | string | Vaccines & Immunization |
| lastActionDate | string | 2026-02-28 |
| lastAction | string | Referred to Public Health Committee... |
| fullTextUrl | string | https://... |
| dateAdded | string | 2026-02-01 |

### Option B: Use a Script to Bulk Import (Recommended)

Create a file called `firebase-import.js` and run it with Node.js:

```javascript
// firebase-import.js
// Run: npm install firebase-admin && node firebase-import.js

const admin = require('firebase-admin');

// Download your service account key from:
// Firebase Console > Project Settings > Service Accounts > Generate New Private Key
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const bills = [
    {
        billId: 'TX-HB1547', state: 'TX', level: 'State', billNumber: 'HB 1547',
        title: 'Vaccine Exemption Expansion Act',
        summary: 'Expands religious and philosophical exemptions for childhood vaccine requirements...',
        status: 'In Committee', isActive: 'Yes', chamber: 'House',
        committee: 'Public Health Committee', stance: 'Oppose', impact: 'High',
        billType: 'anti', category: 'Vaccines & Immunization',
        lastActionDate: '2026-02-28', lastAction: 'Referred to Public Health Committee',
        fullTextUrl: '', dateAdded: '2026-02-01'
    },
    // ... add more bills here
];

async function importBills() {
    const batch = db.batch();

    for (const bill of bills) {
        const ref = db.collection('legislation').doc(bill.billId);
        batch.set(ref, bill);
    }

    await batch.commit();
    console.log(`Imported ${bills.length} bills successfully!`);
}

importBills().catch(console.error);
```

Run it:
```bash
npm install firebase-admin
node firebase-import.js
```

### Option C: Use the Firebase REST API

```bash
# Example: Add a bill via curl
curl -X POST \
  "https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default)/documents/legislation?documentId=TX-HB1547" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "billId": {"stringValue": "TX-HB1547"},
      "state": {"stringValue": "TX"},
      "level": {"stringValue": "State"},
      "billNumber": {"stringValue": "HB 1547"},
      "title": {"stringValue": "Vaccine Exemption Expansion Act"},
      "billType": {"stringValue": "anti"},
      "category": {"stringValue": "Vaccines & Immunization"},
      "status": {"stringValue": "In Committee"},
      "isActive": {"stringValue": "Yes"},
      "impact": {"stringValue": "High"},
      "stance": {"stringValue": "Oppose"}
    }
  }'
```

---

## Step 9: Create Collections for Representatives and Templates

Repeat the same process for:

### `representatives` collection:
| Field | Type | Example |
|-------|------|---------|
| state | string | TX |
| level | string | State |
| chamber | string | House |
| district | string | District 45 |
| name | string | Rep. Sarah Johnson |
| party | string | Republican |
| phone | string | (512) 463-0574 |
| email | string | sarah.johnson@house.texas.gov |
| committees | string | Public Health, Education |
| notes | string | Chair of Public Health Committee |

### `templates` collection:
| Field | Type | Example |
|-------|------|---------|
| templateId | string | oppose-email-general |
| type | string | Email |
| stance | string | Oppose |
| subject | string | Please OPPOSE {BILL_NUMBER}... |
| body | string | Dear {REP_TITLE} {REP_NAME}... |
| category | string | general |

---

## Step 10: Set Up Admin Access (Optional)

To manage data, you can set up Firebase Authentication:

1. Go to **Firebase Console > Authentication > Sign-in method**
2. Enable **Email/Password**
3. Create an admin user
4. Use the Firebase Admin SDK to set the `admin` custom claim:

```javascript
// Run this once with Node.js to make a user admin
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

admin.auth().setCustomUserClaims('USER_UID_HERE', { admin: true })
  .then(() => console.log('Admin claim set!'));
```

---

## Summary

| Component | Firebase Service |
|-----------|-----------------|
| Legislation data | Firestore > `legislation` collection |
| Representatives | Firestore > `representatives` collection |
| Email templates | Firestore > `templates` collection |
| Email signups | Firestore > `email_signups` collection |
| Candidate pledges | Firestore > `pledges` collection |
| Admin access | Firebase Authentication |
| Hosting (optional) | Firebase Hosting |

---

## Costs

Firebase has a generous free tier (Spark plan):
- **Firestore**: 1 GiB storage, 50K reads/day, 20K writes/day, 20K deletes/day
- **Authentication**: Unlimited for email/password
- **Hosting**: 10 GB storage, 360 MB/day transfer

This is more than enough for a legislation tracker. You'd only need to upgrade if you get millions of page views.
