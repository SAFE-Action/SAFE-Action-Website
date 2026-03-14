const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

/**
 * Get authenticated Gmail client via Application Default Credentials
 * with domain-wide delegation to impersonate the officer email
 */
async function getGmailClient() {
    const subject = process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com';
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
        clientOptions: { subject }
    });
    const authClient = await auth.getClient();
    return google.gmail({ version: 'v1', auth: authClient });
}

/**
 * Send an email via Gmail API
 */
async function sendEmail({ to, subject, htmlBody }) {
    const gmail = await getGmailClient();
    const from = process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com';
    const raw = Buffer.from(
        `From: SAFE Action <${from}>\r\n` +
        `To: ${to}\r\n` +
        `Subject: ${subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
        htmlBody
    ).toString('base64url');

    await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw }
    });
}

module.exports = { sendEmail };
