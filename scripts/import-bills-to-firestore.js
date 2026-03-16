#!/usr/bin/env node
// ============================================
// Import bills.json and legislators.json into Firestore
// ============================================
//
// Uses Firebase CLI stored credentials (no service account key needed).
//
// Usage:
//   1. Make sure you're logged in: firebase login
//   2. Run: node scripts/import-bills-to-firestore.js
//
// This script uploads all bills and legislators to Firestore via REST API.
// It is safe to re-run (uses upsert/set semantics).

var fs = require('fs');
var path = require('path');
var https = require('https');
var os = require('os');

// --- Config ---
var PROJECT_ID = 'safe-action-website';
var BILLS_JSON_PATH = path.join(__dirname, '..', 'data', 'bills.json');
var LEGISLATORS_JSON_PATH = path.join(__dirname, '..', 'data', 'legislators.json');
var BATCH_SIZE = 20; // REST API batch = individual requests, keep manageable

// Firebase CLI client ID (public, used by firebase-tools)
var FIREBASE_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
var FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// --- Get access token from Firebase CLI credentials ---

function getRefreshToken() {
    var configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    if (!fs.existsSync(configPath)) {
        console.error('ERROR: Firebase CLI config not found. Run: firebase login');
        process.exit(1);
    }
    var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    var tokens = config.tokens;
    if (!tokens || !tokens.refresh_token) {
        console.error('ERROR: No refresh token in Firebase config. Run: firebase login');
        process.exit(1);
    }
    return tokens.refresh_token;
}

function refreshAccessToken(refreshToken) {
    return new Promise(function(resolve, reject) {
        var postData = [
            'grant_type=refresh_token',
            'refresh_token=' + encodeURIComponent(refreshToken),
            'client_id=' + encodeURIComponent(FIREBASE_CLIENT_ID),
            'client_secret=' + encodeURIComponent(FIREBASE_CLIENT_SECRET)
        ].join('&');

        var options = {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                try {
                    var data = JSON.parse(body);
                    if (data.access_token) {
                        resolve(data.access_token);
                    } else {
                        reject(new Error('No access_token in response: ' + body));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse token response: ' + body));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// --- Firestore REST API helpers ---

function firestoreRequest(method, urlPath, body, accessToken) {
    return new Promise(function(resolve, reject) {
        var options = {
            hostname: 'firestore.googleapis.com',
            path: '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents' + urlPath,
            method: method,
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            }
        };

        var req = https.request(options, function(res) {
            var chunks = [];
            res.on('data', function(chunk) { chunks.push(chunk); });
            res.on('end', function() {
                var responseBody = Buffer.concat(chunks).toString();
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(responseBody)); }
                    catch (e) { resolve(responseBody); }
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + responseBody.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return { integerValue: String(val) };
        return { doubleValue: val };
    }
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) {
        return { arrayValue: { values: val.map(toFirestoreValue) } };
    }
    if (typeof val === 'object') {
        var fields = {};
        Object.keys(val).forEach(function(k) {
            fields[k] = toFirestoreValue(val[k]);
        });
        return { mapValue: { fields: fields } };
    }
    return { stringValue: String(val) };
}

function toFirestoreDoc(obj, collectionPath, docId) {
    var fields = {};
    Object.keys(obj).forEach(function(k) {
        fields[k] = toFirestoreValue(obj[k]);
    });
    return {
        name: 'projects/' + PROJECT_ID + '/databases/(default)/documents/' + collectionPath + '/' + docId,
        fields: fields
    };
}

// Batch commit via Firestore REST API
async function commitBatch(writes, accessToken) {
    var body = { writes: writes };
    return firestoreRequest('POST', ':commit', body, accessToken);
}

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
    var state = (legislator.state || 'XX').toUpperCase();
    var name = (legislator.name || 'unknown')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 60);
    return state + '-' + name;
}

// Sanitize doc ID for Firestore (no slashes, not too long)
function sanitizeDocId(id) {
    return String(id)
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .substring(0, 1500);
}

// --- Import function ---

async function importCollection(collectionName, docs, idFn, transformFn, accessToken) {
    var total = docs.length;
    console.log('  Uploading ' + total + ' docs...');

    var WRITE_BATCH_SIZE = 500; // Firestore commit limit
    var imported = 0;

    for (var i = 0; i < total; i += WRITE_BATCH_SIZE) {
        var slice = docs.slice(i, i + WRITE_BATCH_SIZE);
        var writes = slice.map(function(doc) {
            var docId = sanitizeDocId(idFn(doc));
            var data = transformFn ? transformFn(doc) : doc;
            var firestoreDoc = toFirestoreDoc(data, collectionName, docId);
            return {
                update: firestoreDoc
            };
        });

        await commitBatch(writes, accessToken);
        imported += slice.length;
        var batchNum = Math.floor(i / WRITE_BATCH_SIZE) + 1;
        var totalBatches = Math.ceil(total / WRITE_BATCH_SIZE);
        console.log('  Batch ' + batchNum + '/' + totalBatches + ' committed (' + imported + '/' + total + ')');
    }
}

// --- Main ---

async function main() {
    console.log('SAFE Action - Firestore Data Import');
    console.log('====================================\n');

    // Get access token
    console.log('Authenticating with Firebase CLI credentials...');
    var refreshToken = getRefreshToken();
    var accessToken = await refreshAccessToken(refreshToken);
    console.log('Authenticated successfully.\n');

    // --- Import Bills ---
    console.log('=== Importing Bills ===');
    if (fs.existsSync(BILLS_JSON_PATH)) {
        var billsRaw = fs.readFileSync(BILLS_JSON_PATH, 'utf8');
        var billsData = JSON.parse(billsRaw);
        var bills = billsData.bills || [];
        console.log('  Found ' + bills.length + ' bills in bills.json');

        if (bills.length > 0) {
            await importCollection(
                'bills',
                bills,
                function(bill) { return bill.billId || ('unknown-' + Math.random().toString(36).substr(2, 9)); },
                function(bill) {
                    var doc = Object.assign({}, bill);
                    doc.sponsor = flattenSponsors(bill.sponsors);
                    doc._searchText = buildSearchText(doc);
                    return doc;
                },
                accessToken
            );

            // Write metadata
            var metaDoc = toFirestoreDoc({
                totalCount: bills.length,
                source: billsData.source || 'bills.json',
                generatedAt: billsData.generated_at || '',
                importedAt: new Date().toISOString()
            }, 'bills', '_metadata');
            await commitBatch([{ update: metaDoc }], accessToken);
            console.log('  _metadata doc written (totalCount: ' + bills.length + ')');
        }
    } else {
        console.error('  bills.json not found at:', BILLS_JSON_PATH);
    }
    console.log('=== Bills import complete ===\n');

    // --- Import Legislators ---
    console.log('=== Importing Legislators ===');
    if (fs.existsSync(LEGISLATORS_JSON_PATH)) {
        var legRaw = fs.readFileSync(LEGISLATORS_JSON_PATH, 'utf8');
        var legData = JSON.parse(legRaw);
        var legislators = legData.legislators || [];
        console.log('  Found ' + legislators.length + ' legislators in legislators.json');

        if (legislators.length > 0) {
            await importCollection(
                'legislators',
                legislators,
                function(leg) { return leg.legislator_id || makeLegislatorDocId(leg); },
                function(leg) { return Object.assign({}, leg); },
                accessToken
            );

            // Write metadata
            var legMetaDoc = toFirestoreDoc({
                totalCount: legislators.length,
                generatedAt: legData.generated_at || '',
                importedAt: new Date().toISOString()
            }, 'legislators', '_metadata');
            await commitBatch([{ update: legMetaDoc }], accessToken);
            console.log('  _metadata doc written (totalCount: ' + legislators.length + ')');
        }
    } else {
        console.error('  legislators.json not found at:', LEGISLATORS_JSON_PATH);
    }
    console.log('=== Legislators import complete ===\n');

    console.log('All imports complete!');
}

main().catch(function(err) {
    console.error('Import failed:', err);
    process.exit(1);
});
