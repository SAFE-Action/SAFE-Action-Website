const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const { districts } = require("./districts");
const { volunteerApply } = require("./volunteer-apply");
const { adminVolunteers } = require("./admin-volunteers");
const { volunteerSignNda } = require("./volunteer-sign-nda");
const { trackAction } = require("./track-action");
const { createCheckout } = require("./create-checkout");

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
