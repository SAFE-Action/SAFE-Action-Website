const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const { districts } = require("./districts");
const { volunteerApply } = require("./volunteer-apply");
const { adminVolunteers } = require("./admin-volunteers");
const { volunteerSignNda } = require("./volunteer-sign-nda");
const { trackAction } = require("./track-action");

exports.districts = onRequest({ cors: true }, districts);
exports.volunteerApply = onRequest({ cors: true }, volunteerApply);
exports.adminVolunteers = onRequest({ cors: true }, adminVolunteers);
exports.volunteerSignNda = onRequest({ cors: true }, volunteerSignNda);
exports.trackAction = onRequest({ cors: true }, trackAction);
