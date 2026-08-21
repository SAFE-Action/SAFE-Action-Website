/**
 * Candidate pledge system (Firebase-native; replaces the never-deployed
 * Google Apps Script + Sheets backend).
 *
 * Routes (all through one function, see firebase.json rewrites):
 *   POST /api/pledges/submit          candidate submits the pledge form
 *   GET  /api/pledges/confirm?token=  email verification; makes pledge public
 *   GET  /api/pledges/list            public JSON of VERIFIED pledges only
 *
 * Data model:
 *   pledges/{sha256(email)}: firstName, lastName, email, phone, party,
 *     office, position, district, city, state, vaccineSupport,
 *     question1..3, status: pending|verified, verifyToken, createdAt,
 *     verifiedAt.
 *
 * Security mirrors functions/mailing-list.js: presence-required honeypot,
 * per-IP and global hourly budgets, transactional writes, token consumed on
 * confirm, no account enumeration. The public list never exposes email or
 * phone.
 */

const admin = require("firebase-admin");
const crypto = require("crypto");
const { sendEmail } = require("./email-service");

const SITE_URL = (process.env.SITE_URL || "https://scienceandfreedom.com").replace(/\/+$/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IP_MAX_PER_HOUR = 5;
const GLOBAL_MAX_PER_HOUR = 30;
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]);

function db() { return admin.firestore(); }
function emailId(email) { return crypto.createHash("sha256").update(email).digest("hex"); }
function token() { return crypto.randomBytes(24).toString("hex"); }
function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

const ipHits = new Map();
function ipLimited(ip) {
    const now = Date.now();
    const e = ipHits.get(ip);
    if (!e || now - e.windowStart > 3600000) {
        ipHits.set(ip, { windowStart: now, count: 1 });
        return false;
    }
    e.count++;
    return e.count > IP_MAX_PER_HOUR;
}

async function reserveGlobalSend() {
    const hour = new Date().toISOString().slice(0, 13);
    const ref = db().collection("pledgeQuota").doc(hour);
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? (snap.data().count || 0) : 0;
        if (count >= GLOBAL_MAX_PER_HOUR) return false;
        tx.set(ref, { count: count + 1, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
        return true;
    });
}

function verifyEmailHtml(firstName, confirmUrl) {
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#182238;">' +
        '<h2 style="color:#16264d;">Verify your SAFE Action pledge</h2>' +
        "<p>Hi " + escapeHtml(firstName) + ",</p>" +
        "<p>Thank you for taking the SAFE Action candidate pledge. One step left: " +
        "confirm your email address so your pledge can appear in the public directory.</p>" +
        '<p style="margin:28px 0;"><a href="' + confirmUrl + '" ' +
        'style="background:#16264d;color:#ffffff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:bold;">' +
        "Verify My Pledge</a></p>" +
        "<p>If the button does not work, paste this link into your browser:<br>" +
        '<a href="' + confirmUrl + '">' + confirmUrl + "</a></p>" +
        '<p style="font-size:12px;color:#66717f;">If you did not submit this pledge, you can ignore this email and nothing will be published.</p>' +
        "</div>"
    );
}

// ------------------------------------------------------------------ submit
const FIELD_LIMITS = {
    firstName: 60, lastName: 60, phone: 30, party: 40, office: 120,
    position: 120, district: 80, city: 80,
    question1: 2000, question2: 2000, question3: 2000,
};

async function submit(req, res) {
    const body = req.body || {};
    // Honeypot must be present and empty (our JS always sends it).
    if (typeof body.website !== "string") {
        res.status(400).json({ error: "Missing required fields." });
        return;
    }
    if (body.website) {
        res.status(200).json({ ok: true, message: "Check your email to verify your pledge." });
        return;
    }
    let ip = req.headers["x-forwarded-for"] || req.ip || "unknown";
    if (typeof ip === "string") ip = ip.split(",")[0].trim();
    if (ipLimited(ip)) {
        res.status(429).json({ error: "Too many requests. Please try again later." });
        return;
    }

    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
        res.status(400).json({ error: "Please enter a valid email address." });
        return;
    }
    const fields = {};
    for (const [k, max] of Object.entries(FIELD_LIMITS)) {
        fields[k] = String(body[k] || "").trim().slice(0, max);
    }
    const state = String(body.state || "").trim().toUpperCase().slice(0, 2);
    const vaccineSupport = String(body.vaccineSupport || "").trim().slice(0, 20);
    if (!fields.firstName || !fields.lastName || !fields.office || !US_STATES.has(state)) {
        res.status(400).json({ error: "Missing required fields." });
        return;
    }

    const ref = db().collection("pledges").doc(emailId(email));
    const now = admin.firestore.Timestamp.now();
    let verifyToken = null;
    await db().runTransaction(async (tx) => {
        verifyToken = null;
        const snap = await tx.get(ref);
        if (snap.exists) {
            const d = snap.data();
            if (d.status === "verified") return; // never overwrite a verified pledge
            const last = d.lastSentAt ? d.lastSentAt.toMillis() : 0;
            if (Date.now() - last < RESEND_COOLDOWN_MS) return;
            verifyToken = token();
            tx.update(ref, { ...fields, state, vaccineSupport, verifyToken, lastSentAt: now, updatedAt: now });
            return;
        }
        verifyToken = token();
        tx.set(ref, {
            ...fields, email, state, vaccineSupport,
            status: "pending", verifyToken,
            createdAt: now, lastSentAt: now,
        });
    });

    if (verifyToken) {
        if (!(await reserveGlobalSend())) {
            console.error("Pledge hourly send budget exhausted; refusing send.");
            res.status(429).json({ error: "Submissions are temporarily paused. Please try again shortly." });
            return;
        }
        const confirmUrl = SITE_URL + "/api/pledges/confirm?token=" + verifyToken;
        try {
            await sendEmail({
                to: email,
                subject: "Verify your SAFE Action pledge",
                htmlBody: verifyEmailHtml(fields.firstName, confirmUrl),
            });
        } catch (e) {
            console.error("Pledge verification send failed:", e.message);
            res.status(500).json({ error: "Could not send the verification email. Please try again." });
            return;
        }
    }
    // Generic response either way (no enumeration).
    res.status(200).json({ ok: true, message: "Check your email to verify your pledge." });
}

// ----------------------------------------------------------------- confirm
async function confirm(req, res) {
    const t = String(req.query.token || "");
    if (!/^[a-f0-9]{48}$/.test(t)) {
        res.redirect(302, SITE_URL + "/directory?invalid=1");
        return;
    }
    const q = await db().collection("pledges").where("verifyToken", "==", t).limit(1).get();
    if (q.empty) {
        res.redirect(302, SITE_URL + "/directory?invalid=1");
        return;
    }
    const doc = q.docs[0];
    if (doc.data().status !== "verified") {
        await doc.ref.update({
            status: "verified",
            verifiedAt: admin.firestore.Timestamp.now(),
            verifyToken: admin.firestore.FieldValue.delete(),
        });
    }
    res.redirect(302, SITE_URL + "/directory?verified=1");
}

// -------------------------------------------------------------------- list
// Public. Whitelisted fields only; never email or phone.
const PUBLIC_FIELDS = ["firstName", "lastName", "party", "office", "position",
    "district", "city", "state", "vaccineSupport", "question1", "question2", "question3"];

async function list(req, res) {
    const snap = await db().collection("pledges")
        .where("status", "==", "verified").limit(500).get();
    const candidates = snap.docs.map((d) => {
        const data = d.data();
        const out = { id: d.id };
        for (const f of PUBLIC_FIELDS) out[f] = data[f] || "";
        out.timestamp = data.verifiedAt ? data.verifiedAt.toDate().toISOString() : "";
        return out;
    });
    candidates.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    res.set("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).json({ candidates });
}

// ------------------------------------------------------------------ router
async function pledgesHandler(req, res) {
    const path = (req.path || "").replace(/\/+$/, "");
    try {
        if (req.method === "POST" && path.endsWith("/submit")) return await submit(req, res);
        if (req.method === "GET" && path.endsWith("/confirm")) return await confirm(req, res);
        if (req.method === "GET" && path.endsWith("/list")) return await list(req, res);
        res.status(404).json({ error: "Not found" });
    } catch (e) {
        console.error("pledges error:", e);
        res.status(500).json({ error: "Internal error" });
    }
}

module.exports = { pledgesHandler };
