const { google } = require('googleapis');

/**
 * Get authenticated Gmail client via service account impersonation
 */
async function getGmailClient() {
    const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString());
    const auth = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
        subject: process.env.OFFICER_EMAIL || 'officer@scienceandfreedom.com'
    });
    return google.gmail({ version: 'v1', auth });
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
