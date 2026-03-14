const { google } = require('googleapis');

function getAuth(scopes, subject) {
    const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString());
    return new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes,
        subject
    });
}

/**
 * Create a Google Drive folder for the volunteer, shared with their email
 */
async function createDriveFolder({ volunteerName, volunteerEmail }) {
    const adminEmail = process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com';
    const auth = getAuth(['https://www.googleapis.com/auth/drive'], adminEmail);
    const drive = google.drive({ version: 'v3', auth });

    // Create folder
    const folder = await drive.files.create({
        requestBody: {
            name: `Volunteer - ${volunteerName}`,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID]
        },
        fields: 'id, webViewLink'
    });

    // Share with volunteer
    await drive.permissions.create({
        fileId: folder.data.id,
        requestBody: {
            role: 'writer',
            type: 'user',
            emailAddress: volunteerEmail
        }
    });

    return { folderId: folder.data.id, folderUrl: folder.data.webViewLink };
}

/**
 * Add volunteer to Google Contacts (People API) with skills/interests in notes
 */
async function createContact({ name, email, skills, interests }) {
    const adminEmail = process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com';
    const auth = getAuth(['https://www.googleapis.com/auth/contacts'], adminEmail);
    const people = google.people({ version: 'v1', auth });

    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    const contact = await people.people.createContact({
        requestBody: {
            names: [{ givenName: firstName, familyName: lastName }],
            emailAddresses: [{ value: email, type: 'work' }],
            organizations: [{ name: 'SAFE Action', title: 'Volunteer' }],
            biographies: [{
                value: `Skills: ${skills.join(', ')}\nInterests: ${(interests || []).join(', ')}`,
                contentType: 'TEXT_PLAIN'
            }]
        }
    });

    return { contactId: contact.data.resourceName };
}

/**
 * Add volunteer to weekly Google Calendar event
 */
async function addToCalendarEvent({ email }) {
    const adminEmail = process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com';
    const auth = getAuth(['https://www.googleapis.com/auth/calendar'], adminEmail);
    const calendar = google.calendar({ version: 'v3', auth });

    const eventId = process.env.GOOGLE_CALENDAR_EVENT_ID;

    // Get current event to read existing attendees
    const event = await calendar.events.get({
        calendarId: 'primary',
        eventId
    });

    const attendees = event.data.attendees || [];
    attendees.push({ email, responseStatus: 'needsAction' });

    await calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody: { attendees },
        sendUpdates: 'all'
    });

    return { added: true };
}

/**
 * Add volunteer to Google Chat space
 */
async function addToChatSpace({ email }) {
    const adminEmail = process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com';
    const auth = getAuth(['https://www.googleapis.com/auth/chat.memberships'], adminEmail);
    const chat = google.chat({ version: 'v1', auth });

    const spaceName = process.env.GOOGLE_CHAT_SPACE;

    const membership = await chat.spaces.members.create({
        parent: spaceName,
        requestBody: {
            member: {
                name: `users/${email}`,
                type: 'HUMAN'
            }
        }
    });

    return { membershipId: membership.data.name };
}

module.exports = { createDriveFolder, createContact, addToCalendarEvent, addToChatSpace };
