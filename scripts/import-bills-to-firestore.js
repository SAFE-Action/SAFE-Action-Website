#!/usr/bin/env node
// ============================================
// Import bills.json and legislators.json into Firestore
// ============================================
//
// Usage:
//   1. Download your Firebase service account key from:
//      Firebase Console > Project Settings > Service Accounts > Generate New Private Key
//   2. Save it as: scripts/service-account-key.json
//   3. Run: node scripts/import-bills-to-firestore.js
//
// This script uploads all bills and legislators to Firestore in batches of 500.
// It is safe to re-run (uses upsert/set semantics).

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- Config ---
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account-key.json');
const BILLS_JSON_PATH = path.join(__dirname, '..', 'data', 'bills.json');
const LEGISLATORS_JSON_PATH = path.join(__dirname, '..', 'data', 'legislators.json');
const BATCH_SIZE = 500;

// --- Init Firebase Admin ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('ERROR: Service account key not found at:', SERVICE_ACCOUNT_PATH);
    console.error('Download it from Firebase Console > Project Settings > Service Accounts');
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Helpers ---

function buildSearchText(bill) {
    return [
        bill.billNumber || '',
        bill.title || '',
        bill.summary || '',
        bill.sponsor || '',
        bill.state || ''
    ].join(' ').toLowerCase();
}

function flattenSponsors(sponsors) {
    if (!sponsors || !Array.isArray(sponsors) || sponsors.length === 0) return '';
    return sponsors.map(function(s) {
        return (typeof s === 'string') ? s : (s.name || '');
    }).filter(Boolean).join('; ');
}

function makeLegislatorDocId(legislator) {
    // Compound key: STATE-sanitized_name
    var state = (legislator.state || 'XX').toUpperCase();
    var name = (legislator.name || 'unknown')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 60);
    return state + '-' + name;
}

async function commitBatches(collectionName, docs, idFn, transformFn) {
    var total = docs.length;
    var batchCount = Math.ceil(total / BATCH_SIZE);
    console.log('  Uploading ' + total + ' docs in ' + batchCount + ' batches...');

    for (var i = 0; i < total; i += BATCH_SIZE) {
        var batch = db.batch();
        var slice = docs.slice(i, i + BATCH_SIZE);

        slice.forEach(function(doc) {
            var docId = idFn(doc);
            var data = transformFn ? transformFn(doc) : doc;
            var ref = db.collection(collectionName).doc(docId);
            batch.set(ref, data);
        });

        await batch.commit();
        var batchNum = Math.floor(i / BATCH_SIZE) + 1;
        console.log('  Batch ' + batchNum + '/' + batchCount + ' committed (' + slice.length + ' docs)');
    }
}

// --- Import Bills ---

async function importBills() {
    console.log('\n=== Importing Bills ===');

    if (!fs.existsSync(BILLS_JSON_PATH)) {
        console.error('ERROR: bills.json not found at:', BILLS_JSON_PATH);
        return;
    }

    var raw = fs.readFileSync(BILLS_JSON_PATH, 'utf8');
    var data = JSON.parse(raw);
    var bills = data.bills || [];
    console.log('  Found ' + bills.length + ' bills in bills.json');

    if (bills.length === 0) {
        console.warn('  No bills to import.');
        return;
    }

    // Transform and upload
    await commitBatches(
        'bills',
        bills,
        function(bill) { return bill.billId || ('unknown-' + Math.random().toString(36).substr(2, 9)); },
        function(bill) {
            var doc = Object.assign({}, bill);
            // Flatten sponsors array to a string
            doc.sponsor = flattenSponsors(bill.sponsors);
            // Add search text field
            doc._searchText = buildSearchText(doc);
            return doc;
        }
    );

    // Write _metadata doc
    var metaRef = db.collection('bills').doc('_metadata');
    await metaRef.set({
        totalCount: bills.length,
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: data.source || 'bills.json',
        generatedAt: data.generated_at || null
    });
    console.log('  _metadata doc written (totalCount: ' + bills.length + ')');

    console.log('=== Bills import complete ===\n');
}

// --- Import Legislators ---

async function importLegislators() {
    console.log('\n=== Importing Legislators ===');

    if (!fs.existsSync(LEGISLATORS_JSON_PATH)) {
        console.error('ERROR: legislators.json not found at:', LEGISLATORS_JSON_PATH);
        return;
    }

    var raw = fs.readFileSync(LEGISLATORS_JSON_PATH, 'utf8');
    var data = JSON.parse(raw);
    var legislators = data.legislators || [];
    console.log('  Found ' + legislators.length + ' legislators in legislators.json');

    if (legislators.length === 0) {
        console.warn('  No legislators to import.');
        return;
    }

    // Use legislator_id if available, otherwise build compound key
    await commitBatches(
        'legislators',
        legislators,
        function(leg) { return leg.legislator_id || makeLegislatorDocId(leg); },
        function(leg) { return Object.assign({}, leg); }
    );

    // Write _metadata doc
    var metaRef = db.collection('legislators').doc('_metadata');
    await metaRef.set({
        totalCount: legislators.length,
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        generatedAt: data.generated_at || null
    });
    console.log('  _metadata doc written (totalCount: ' + legislators.length + ')');

    console.log('=== Legislators import complete ===\n');
}

// --- Main ---

async function main() {
    console.log('SAFE Action - Firestore Data Import');
    console.log('====================================');

    try {
        await importBills();
        await importLegislators();
        console.log('All imports complete!');
    } catch (err) {
        console.error('Import failed:', err);
        process.exit(1);
    }

    process.exit(0);
}

main();
