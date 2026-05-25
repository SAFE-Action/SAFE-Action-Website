const admin = require('firebase-admin');

const PROJECT_ID = 'safe-action-website';
const API_KEY = 'AIzaSyDQul9vsl7oEj43VSlzLi_S4SXrm3liZWc';
const SITE_URL = 'https://scienceandfreedom.com';

const volunteerId = process.env.VOLUNTEER_ID;
const adminEmail = process.env.ADMIN_EMAIL || 'greg@scienceandfreedom.com';
const shouldSignNda = process.env.SIGN_NDA === 'true';

if (!volunteerId) {
    throw new Error('VOLUNTEER_ID is required');
}

admin.initializeApp({ projectId: PROJECT_ID });

async function exchangeCustomToken(customToken) {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true })
    });
    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(`Failed to exchange custom token: ${JSON.stringify(data)}`);
    }
    return data.idToken;
}

async function callJson(url, options) {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        data = { raw: text };
    }
    return { ok: resp.ok, status: resp.status, data };
}

function summarizeSteps(steps) {
    const out = {};
    Object.entries(steps || {}).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
            out[key] = {
                success: value.success === true,
                error: value.error || null,
                hasDriveFolder: Boolean(value.driveFolder),
                hasContactId: Boolean(value.contactId)
            };
        } else {
            out[key] = value === true;
        }
    });
    return out;
}

async function main() {
    const db = admin.firestore();
    const volRef = db.collection('volunteers').doc(volunteerId);
    const beforeDoc = await volRef.get();
    if (!beforeDoc.exists) {
        throw new Error(`Volunteer ${volunteerId} not found`);
    }

    const before = beforeDoc.data();
    console.log('Before approval:', JSON.stringify({
        id: volunteerId,
        name: before.name,
        email: before.email,
        status: before.status,
        ndaSigned: before.ndaSigned === true
    }));

    const adminDoc = await db.collection('admins').doc(adminEmail).get();
    if (!adminDoc.exists) {
        throw new Error(`Admin doc ${adminEmail} is missing`);
    }

    const customToken = await admin.auth().createCustomToken(`firetest-${Date.now()}`, { email: adminEmail });
    const idToken = await exchangeCustomToken(customToken);

    const approve = await callJson(`${SITE_URL}/api/admin/volunteers/approve`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ volunteerId })
    });

    console.log('Approve response:', JSON.stringify({
        status: approve.status,
        ok: approve.ok,
        errors: approve.data.errors || approve.data.error || []
    }));

    const afterApprovalDoc = await volRef.get();
    const afterApproval = afterApprovalDoc.data();
    console.log('After approval:', JSON.stringify({
        status: afterApproval.status,
        approvedBy: afterApproval.approvedBy,
        ndaTokenPresent: Boolean(afterApproval.ndaToken),
        driveFolderPresent: Boolean(afterApproval.driveFolder),
        onboardingSteps: summarizeSteps(afterApproval.onboardingSteps)
    }));

    if (!approve.ok) {
        throw new Error('Approval endpoint failed');
    }

    if (shouldSignNda) {
        if (!afterApproval.ndaToken) {
            throw new Error('No NDA token generated; cannot sign NDA');
        }

        const lookup = await callJson(`${SITE_URL}/api/volunteer/nda/lookup?token=${encodeURIComponent(afterApproval.ndaToken)}`, {
            method: 'GET'
        });
        console.log('NDA lookup response:', JSON.stringify({
            status: lookup.status,
            ok: lookup.ok,
            id: lookup.data.id,
            name: lookup.data.name,
            ndaSigned: lookup.data.ndaSigned
        }));
        if (!lookup.ok) {
            throw new Error('NDA lookup failed');
        }

        const sign = await callJson(`${SITE_URL}/api/volunteer/${volunteerId}/nda/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'SAFE Firetest Volunteer Signature',
                token: afterApproval.ndaToken
            })
        });
        console.log('NDA sign response:', JSON.stringify({
            status: sign.status,
            ok: sign.ok,
            error: sign.data.error || null
        }));
        if (!sign.ok) {
            throw new Error('NDA sign failed');
        }
    }

    const finalDoc = await volRef.get();
    const finalData = finalDoc.data();
    console.log('Final volunteer state:', JSON.stringify({
        status: finalData.status,
        ndaSigned: finalData.ndaSigned === true,
        ndaTokenPresent: Boolean(finalData.ndaToken),
        onboardingSteps: summarizeSteps(finalData.onboardingSteps)
    }));
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
