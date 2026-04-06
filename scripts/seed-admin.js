/**
 * Seed the Firestore admins collection.
 * Run via: node scripts/seed-admin.js
 * Requires GOOGLE_APPLICATION_CREDENTIALS or firebase-admin default credentials.
 */
const admin = require('firebase-admin');

admin.initializeApp({
    projectId: 'safe-action-website',
});

const db = admin.firestore();

async function seedAdmins() {
    const admins = [
        {
            email: 'greg@scienceandfreedom.com',
            name: 'Dr. Greg Newkirk',
            role: 'officer',
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
    ];

    for (const a of admins) {
        const docRef = db.collection('admins').doc(a.email);
        const existing = await docRef.get();
        if (existing.exists) {
            console.log(`Admin ${a.email} already exists, skipping.`);
        } else {
            await docRef.set(a);
            console.log(`Added admin: ${a.email}`);
        }
    }

    console.log('Done seeding admins.');
}

seedAdmins().catch(console.error);
