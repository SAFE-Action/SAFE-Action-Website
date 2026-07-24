const { google } = require('googleapis');
const { GoogleAuth, OAuth2Client } = require('google-auth-library');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let cachedSaEmail = null;

async function getServiceAccountEmail() {
    if (!cachedSaEmail) {
        const credentials = await auth.getCredentials();
        cachedSaEmail = credentials.client_email;
    }
    return cachedSaEmail;
}

/**
 * Mint an access token for OFFICER_EMAIL via domain-wide delegation.
 * Metadata credentials cannot carry a sub claim, so the service account
 * signs the delegation JWT through the IAM Credentials API instead.
 * Requires roles/iam.serviceAccountTokenCreator on the SA itself.
 */
async function getDelegatedClient(scopes) {
    const subject = process.env.OFFICER_EMAIL || 'greg@scienceandfreedom.com';
    const saEmail = await getServiceAccountEmail();
    const iam = google.iamcredentials({ version: 'v1', auth });
    const now = Math.floor(Date.now() / 1000);
    const { data } = await iam.projects.serviceAccounts.signJwt({
        name: `projects/-/serviceAccounts/${saEmail}`,
        requestBody: {
            payload: JSON.stringify({
                iss: saEmail,
                sub: subject,
                scope: scopes.join(' '),
                aud: 'https://oauth2.googleapis.com/token',
                iat: now,
                exp: now + 3600
            })
        }
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: data.signedJwt
        })
    });
    const token = await res.json();
    if (!res.ok || !token.access_token) {
        throw new Error(`Delegated token exchange failed: ${token.error_description || token.error || res.status}`);
    }
    const client = new OAuth2Client();
    client.setCredentials({ access_token: token.access_token });
    return client;
}

module.exports = { getDelegatedClient };
