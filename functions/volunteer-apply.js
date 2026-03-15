const admin = require('firebase-admin');
const { sendEmail } = require('./email-service');

exports.volunteerApply = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, skills, interests, availability } = req.body;

    // Validate required fields
    if (!name || !email || !skills || !skills.length || !availability) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
        // Check for duplicate
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

        // Send notification to officer
        try {
            const siteUrl = process.env.SITE_URL || 'https://scienceandfreedom.com';
            await sendEmail({
                to: process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com',
                subject: `New Volunteer Application: ${name.trim()}`,
                htmlBody: `
                    <h2>New Volunteer Application</h2>
                    <p><strong>Name:</strong> ${name.trim()}</p>
                    <p><strong>Email:</strong> ${email.trim()}</p>
                    <p><strong>Skills:</strong> ${skills.join(', ')}</p>
                    <p><strong>Interests:</strong> ${(interests || []).join(', ')}</p>
                    <p><strong>Availability:</strong> ${availability}</p>
                    <hr>
                    <p><a href="${siteUrl}/admin">Review in Admin Panel</a></p>
                `
            });
        } catch (emailErr) {
            console.warn('Failed to send notification email (non-fatal):', emailErr.message);
        }

        return res.status(200).json({ success: true, id: docRef.id });
    } catch (e) {
        console.error('Volunteer apply error:', e);
        return res.status(500).json({ error: 'Failed to submit application' });
    }
};
