const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const { districts } = require("./districts");
const { volunteerApply } = require("./volunteer-apply");
const { adminVolunteers } = require("./admin-volunteers");
const { volunteerSignNda } = require("./volunteer-sign-nda");
const { trackAction } = require("./track-action");
const { createCheckout } = require("./create-checkout");
const { mailingList, runCampaign } = require("./mailing-list");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");

// Volunteer functions run as the SA that holds the Workspace
// domain-wide delegation grant (email/drive/calendar/chat/contacts).
const VOLUNTEER_SA = "safe-action-volunteers@safe-action-website.iam.gserviceaccount.com";

// Restrict CORS to production domains
var allowedOrigins = [
    "https://scienceandfreedom.com",
    "https://www.scienceandfreedom.com",
    "https://safe-action-website.web.app",
    "https://safe-action-website.firebaseapp.com",
];

exports.districts = onRequest({ cors: allowedOrigins }, districts);
exports.volunteerApply = onRequest({ cors: allowedOrigins, serviceAccount: VOLUNTEER_SA }, volunteerApply);
exports.adminVolunteers = onRequest({ cors: allowedOrigins, serviceAccount: VOLUNTEER_SA }, adminVolunteers);
exports.volunteerSignNda = onRequest({ cors: allowedOrigins, serviceAccount: VOLUNTEER_SA }, volunteerSignNda);
exports.trackAction = onRequest({ cors: allowedOrigins }, trackAction);
exports.createCheckout = onRequest({
    cors: allowedOrigins,
    secrets: ["STRIPE_SECRET_KEY"]
}, createCheckout);
// Mailing list HTTP API (subscribe/confirm/unsubscribe/queue-campaign).
// maxInstances caps flood throughput on the unauthenticated subscribe route.
exports.mailingList = onRequest({
    cors: allowedOrigins,
    serviceAccount: VOLUNTEER_SA,
    maxInstances: 5,
}, mailingList);

// Campaign worker: Firestore-triggered, so it is NOT subject to the Hosting
// rewrite's 60s HTTP cap. Idempotent via campaigns/{id}/sent markers.
// TEMPORARILY GATED: first event-driven function in this project; Eventarc
// needs a one-time IAM grant (eventarc.eventReceiver on the compute SA)
// that CI cannot self-grant. Set DEPLOY_CAMPAIGN_WORKER=1 (or just remove
// this gate) once the grant is in. Queued campaigns sit until then.
if (process.env.DEPLOY_CAMPAIGN_WORKER === "1") {
exports.mailingListWorker = onDocumentCreated({
    document: "campaigns/{id}",
    serviceAccount: VOLUNTEER_SA,
    timeoutSeconds: 540,
    retry: false,
}, async (event) => {
    await runCampaign(event.params.id);
});
}
