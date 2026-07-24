const { google } = require('googleapis');
const { getDelegatedClient } = require('./delegated-auth');

/**
 * Get a Gmail client acting as the officer email via domain-wide delegation
 */
async function getGmailClient() {
    const authClient = await getDelegatedClient(['https://www.googleapis.com/auth/gmail.send']);
    return google.gmail({ version: 'v1', auth: authClient });
}

/**
 * Strip CR/LF so attacker-controlled values (e.g. a volunteer's name that
 * ends up in the subject line) cannot inject additional email headers.
 */
function headerSafe(value) {
    return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Send an email via Gmail API
 */
async function sendEmail({ to, subject, htmlBody }) {
    const gmail = await getGmailClient();
    const from = headerSafe(process.env.OFFICER_EMAIL || 'greg@scienceandfreedom.com');
    const raw = Buffer.from(
        `From: SAFE Action <${from}>\r\n` +
        `To: ${headerSafe(to)}\r\n` +
        `Subject: ${headerSafe(subject)}\r\n` +
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
