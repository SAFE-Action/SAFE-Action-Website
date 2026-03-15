const admin = require('firebase-admin');
const crypto = require('crypto');
const { sendEmail } = require('./email-service');
const { createDriveFolder, createContact, addToCalendarEvent, addToChatSpace } = require('./google-workspace');

exports.adminVolunteers = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth check
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let adminEmail;
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        adminEmail = decoded.email;
        const adminDoc = await admin.firestore().collection('admins').doc(adminEmail).get();
        if (!adminDoc.exists) {
            return res.status(403).json({ error: 'Not authorized as admin' });
        }
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    // Route based on URL path
    const path = req.path || req.url;

    if (path.endsWith('/approve')) {
        return handleApprove(req, res, adminEmail);
    } else if (path.endsWith('/reject')) {
        return handleReject(req, res, adminEmail);
    } else {
        return res.status(404).json({ error: 'Not found' });
    }
};

async function handleApprove(req, res, adminEmail) {
    const { volunteerId } = req.body;
    if (!volunteerId) {
        return res.status(400).json({ error: 'volunteerId is required' });
    }

    const db = admin.firestore();
    const volRef = db.collection('volunteers').doc(volunteerId);
    const volDoc = await volRef.get();

    if (!volDoc.exists) {
        return res.status(404).json({ error: 'Volunteer not found' });
    }

    const volunteer = volDoc.data();
    if (volunteer.status !== 'pending') {
        return res.status(400).json({ error: `Volunteer status is "${volunteer.status}", expected "pending"` });
    }

    // Generate NDA token
    const ndaToken = crypto.randomUUID();

    // Update volunteer doc to approved
    await volRef.update({
        status: 'approved',
        approvedBy: adminEmail,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        ndaToken,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Run onboarding steps sequentially
    const onboardingSteps = {};
    const errors = [];
    const volunteerName = volunteer.name;
    const volunteerEmail = volunteer.email;

    // Step a: Create Drive folder
    try {
        const result = await createDriveFolder({ volunteerName, volunteerEmail });
        onboardingSteps.createDriveFolder = { success: true, driveFolder: result.folderUrl };
        // Save driveFolder URL to volunteer doc
        await volRef.update({
            'onboardingSteps.createDriveFolder': { success: true, driveFolder: result.folderUrl }
        });
    } catch (e) {
        console.error('Onboarding step createDriveFolder failed:', e.message);
        onboardingSteps.createDriveFolder = { success: false, error: e.message };
        errors.push({ step: 'createDriveFolder', error: e.message });
        await volRef.update({
            'onboardingSteps.createDriveFolder': { success: false, error: e.message }
        });
    }

    // Step b: Create contact
    try {
        const result = await createContact({
            name: volunteerName,
            email: volunteerEmail,
            skills: volunteer.skills || [],
            interests: volunteer.interests || []
        });
        onboardingSteps.createContact = { success: true, contactId: result.contactId };
        await volRef.update({
            'onboardingSteps.createContact': { success: true, contactId: result.contactId }
        });
    } catch (e) {
        console.error('Onboarding step createContact failed:', e.message);
        onboardingSteps.createContact = { success: false, error: e.message };
        errors.push({ step: 'createContact', error: e.message });
        await volRef.update({
            'onboardingSteps.createContact': { success: false, error: e.message }
        });
    }

    // Step c: Add to calendar event
    try {
        const result = await addToCalendarEvent({ email: volunteerEmail });
        onboardingSteps.addToCalendarEvent = { success: true };
        await volRef.update({
            'onboardingSteps.addToCalendarEvent': { success: true }
        });
    } catch (e) {
        console.error('Onboarding step addToCalendarEvent failed:', e.message);
        onboardingSteps.addToCalendarEvent = { success: false, error: e.message };
        errors.push({ step: 'addToCalendarEvent', error: e.message });
        await volRef.update({
            'onboardingSteps.addToCalendarEvent': { success: false, error: e.message }
        });
    }

    // Step d: Add to chat space
    try {
        const result = await addToChatSpace({ email: volunteerEmail });
        onboardingSteps.addToChatSpace = { success: true };
        await volRef.update({
            'onboardingSteps.addToChatSpace': { success: true }
        });
    } catch (e) {
        console.error('Onboarding step addToChatSpace failed:', e.message);
        onboardingSteps.addToChatSpace = { success: false, error: e.message };
        errors.push({ step: 'addToChatSpace', error: e.message });
        await volRef.update({
            'onboardingSteps.addToChatSpace': { success: false, error: e.message }
        });
    }

    // Step e: Send welcome email with NDA link
    try {
        const siteUrl = process.env.SITE_URL || 'https://scienceandfreedom.com';
        const htmlBody = `<h2>Welcome to SAFE Action, ${volunteerName}!</h2>
<p>Your volunteer application has been approved. We're excited to have you on the team!</p>
<h3>Next Steps:</h3>
<ol>
    <li><strong>Sign the NDA:</strong> <a href="${siteUrl}/volunteer/nda?token=${ndaToken}">Click here to sign</a></li>
    <li><strong>Check your Google Drive:</strong> A shared folder has been created for you</li>
    <li><strong>Join the team chat:</strong> You've been added to our Google Chat space</li>
    <li><strong>Weekly meeting:</strong> You've been added to our recurring calendar event</li>
</ol>
<p>Questions? Reply to this email or reach out in the team chat.</p>
<p>— The SAFE Action Team</p>`;

        await sendEmail({
            to: volunteerEmail,
            subject: 'Welcome to SAFE Action!',
            htmlBody
        });
        onboardingSteps.sendWelcomeEmail = { success: true };
        await volRef.update({
            'onboardingSteps.sendWelcomeEmail': { success: true }
        });
    } catch (e) {
        console.error('Onboarding step sendWelcomeEmail failed:', e.message);
        onboardingSteps.sendWelcomeEmail = { success: false, error: e.message };
        errors.push({ step: 'sendWelcomeEmail', error: e.message });
        await volRef.update({
            'onboardingSteps.sendWelcomeEmail': { success: false, error: e.message }
        });
    }

    return res.status(200).json({ success: true, onboardingSteps, errors });
}

async function handleReject(req, res, adminEmail) {
    const { volunteerId, reason } = req.body;
    if (!volunteerId) {
        return res.status(400).json({ error: 'volunteerId is required' });
    }

    const db = admin.firestore();
    const volRef = db.collection('volunteers').doc(volunteerId);
    const volDoc = await volRef.get();

    if (!volDoc.exists) {
        return res.status(404).json({ error: 'Volunteer not found' });
    }

    await volRef.update({
        status: 'rejected',
        rejectionReason: reason || '',
        approvedBy: adminEmail,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true });
}
