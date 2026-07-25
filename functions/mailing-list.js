/**
 * SAFE Action mailing list.
 *
 * Paths (routed via firebase.json rewrites into this one function):
 *   POST /api/list/subscribe    { email, name?, source?, website? }  (website = honeypot)
 *   GET  /api/list/confirm?token=...      double-opt-in confirmation
 *   GET  /api/list/unsubscribe?token=...  shows a confirm page (no state change)
 *   POST /api/list/unsubscribe?token=...  performs the unsubscribe (RFC 8058 compatible)
 *   POST /api/list/send         admin-only: queues a campaign (the Firestore-triggered
 *                               worker in index.js does the actual sending; Hosting
 *                               rewrites hard-cap HTTP at 60s so we never send inline)
 *
 * Data:
 *   subscribers/{sha256(email)}: email, name, status: pending|active|unsubscribed,
 *     source, tags[], confirmToken?, unsubToken, createdAt, confirmedAt?,
 *     unsubscribedAt?, lastSentAt
 *   campaigns/{id}: subject, html, tag, sentBy, status: queued|running|done,
 *     total, sentCount, failCount, startedAt, finishedAt?
 *     campaigns/{id}/sent/{subscriberDocId}: idempotency markers for the worker
 *   settings/mailing: { physicalAddress } - required before campaigns can send
 *     (CAN-SPAM needs a physical mailing address in every bulk email)
 *   mailingQuota/{utcHour}: { count } - global hourly confirmation-send budget
 *
 * Delivery uses the delegated Gmail sender (email-service.js). Fine for
 * double-opt-in + early-stage campaigns; swap for a dedicated provider
 * (Resend/SES) when volume outgrows Workspace limits.
 */
const admin = require("firebase-admin");
const crypto = require("crypto");
const { sendEmail } = require("./email-service");

const SITE_URL = (process.env.SITE_URL || "https://scienceandfreedom.com").replace(/\/+$/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_COOLDOWN_MS = 60 * 60 * 1000;      // pending addresses: 1 confirmation/hour
const RESUB_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // opted-out addresses: 1/day, not 1/hour
const CAMPAIGN_DELAY_MS = 600;                  // pace Gmail sends in the worker
const IP_MAX_PER_HOUR = 5;                      // per-instance first filter
const GLOBAL_MAX_PER_HOUR = 100;                // hard ceiling on confirmation sends

const ipHits = new Map(); // per-instance; coarse. The global budget is the real cap.

function db() { return admin.firestore(); }

function emailId(email) {
    return crypto.createHash("sha256").update(email).digest("hex");
}

function token() {
    return crypto.randomBytes(24).toString("hex");
}

function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

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

// Cross-instance send budget: one counter doc per UTC hour, taken in a txn.
// In-memory maps don't hold across autoscaled instances; this does.
async function reserveGlobalSend() {
    const hour = new Date().toISOString().slice(0, 13); // e.g. "2026-07-25T02"
    const ref = db().collection("mailingQuota").doc(hour);
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = snap.exists ? (snap.data().count || 0) : 0;
        if (count >= GLOBAL_MAX_PER_HOUR) return false;
        tx.set(ref, { count: count + 1, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
        return true;
    });
}

function confirmEmailHtml(confirmUrl) {
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A2744;">' +
        '<h2 style="color:#1A2744;">Confirm your SAFE Action signup</h2>' +
        '<p>You (or someone using this address) asked to join the SAFE Action email list for updates on science legislation, actions, and wins.</p>' +
        '<p style="margin:28px 0;"><a href="' + confirmUrl + '" style="background:#B22234;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Confirm my signup</a></p>' +
        '<p style="font-size:13px;color:#66717f;">If you did not request this, ignore this email and you will not be subscribed.</p>' +
        '<p style="font-size:13px;color:#66717f;">Science and Freedom for Everyone Action Fund</p>' +
        "</div>"
    );
}

function campaignFooterHtml(physicalAddress, unsubUrl) {
    return (
        '<hr style="border:none;border-top:1px solid #d8d3c7;margin:32px 0 16px;">' +
        '<p style="font-family:Arial,sans-serif;font-size:12px;color:#66717f;line-height:1.6;">' +
        "Science and Freedom for Everyone Action Fund<br>" +
        escapeHtml(physicalAddress) + "<br>" +
        'You are receiving this because you signed up at scienceandfreedom.com. ' +
        '<a href="' + unsubUrl + '" style="color:#66717f;">Unsubscribe</a>' +
        "</p>"
    );
}

async function requireAdmin(req) {
    const authz = req.headers.authorization || "";
    const m = authz.match(/^Bearer (.+)$/);
    if (!m) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(m[1]);
        // email_verified: never trust a self-asserted email from a custom/other
        // provider for the admins/{email} lookup.
        if (!decoded.email || decoded.email_verified !== true) return null;
        const doc = await db().collection("admins").doc(decoded.email).get();
        return doc.exists ? decoded.email : null;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------- subscribe
async function subscribe(req, res) {
    const body = req.body || {};
    // Honeypot must be PRESENT and empty. Requiring presence breaks the
    // trivial "just omit the field" scripted bypass (our JS always sends it);
    // a filled value means a bot that renders hidden inputs.
    if (typeof body.website !== "string") {
        res.status(400).json({ error: "Please enter a valid email address." });
        return;
    }
    if (body.website) {
        res.status(200).json({ ok: true, message: "Check your email to confirm your signup." });
        return;
    }
    let ip = req.headers["x-forwarded-for"] || req.ip || "unknown";
    if (typeof ip === "string") ip = ip.split(",")[0].trim();
    if (ipLimited(ip)) {
        res.status(429).json({ error: "Too many requests. Please try again later." });
        return;
    }

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 120);
    const source = String(body.source || "site").trim().slice(0, 60);
    if (!EMAIL_RE.test(email) || email.length > 254) {
        res.status(400).json({ error: "Please enter a valid email address." });
        return;
    }

    const ref = db().collection("subscribers").doc(emailId(email));
    const now = admin.firestore.Timestamp.now();

    // Transaction so N concurrent POSTs for one address cannot all pass the
    // cooldown and all send. confirmToken === null means "do not send".
    let confirmToken = null;
    await db().runTransaction(async (tx) => {
        confirmToken = null;
        const snap = await tx.get(ref);
        if (!snap.exists) {
            confirmToken = token();
            tx.set(ref, {
                email: email,
                name: name,
                status: "pending",
                source: source,
                tags: [],
                confirmToken: confirmToken,
                unsubToken: token(),
                createdAt: now,
                lastSentAt: now,
            });
            return;
        }
        const d = snap.data();
        if (d.status === "active") return;
        const last = d.lastSentAt ? d.lastSentAt.toMillis() : 0;
        const cooldown = d.status === "unsubscribed" ? RESUB_COOLDOWN_MS : RESEND_COOLDOWN_MS;
        if (Date.now() - last < cooldown) return;
        confirmToken = d.confirmToken || token();
        // Keep "unsubscribed" status until they actually re-confirm; only the
        // confirm click flips them back to active (pending would drop their
        // opt-out record if they never click).
        const update = { confirmToken: confirmToken, lastSentAt: now };
        if (d.status !== "unsubscribed") update.status = "pending";
        tx.update(ref, update);
    });

    if (confirmToken) {
        // Global budget AFTER the txn decided a send is warranted.
        if (!(await reserveGlobalSend())) {
            console.error("Mailing-list hourly send budget exhausted; refusing send.");
            res.status(429).json({ error: "Signups are temporarily paused. Please try again shortly." });
            return;
        }
        const confirmUrl = SITE_URL + "/api/list/confirm?token=" + confirmToken;
        try {
            await sendEmail({
                to: email,
                subject: "Confirm your SAFE Action signup",
                htmlBody: confirmEmailHtml(confirmUrl),
            });
        } catch (e) {
            console.error("Confirmation send failed:", e.message);
            res.status(500).json({ error: "Could not send the confirmation email. Please try again." });
            return;
        }
    }
    // Generic response either way (no account enumeration).
    res.status(200).json({ ok: true, message: "Check your email to confirm your signup." });
}

// ------------------------------------------------------------ confirm/unsub
async function confirmByToken(req, res) {
    const t = String(req.query.token || "");
    if (!/^[a-f0-9]{48}$/.test(t)) {
        res.redirect(302, SITE_URL + "/join?invalid=1");
        return;
    }
    const q = await db().collection("subscribers").where("confirmToken", "==", t).limit(1).get();
    if (q.empty) {
        res.redirect(302, SITE_URL + "/join?invalid=1");
        return;
    }
    const doc = q.docs[0];
    const status = doc.data().status;
    if (status === "active") {
        res.redirect(302, SITE_URL + "/join?confirmed=1");
        return;
    }
    // pending or unsubscribed-with-fresh-resubscribe: activate and CONSUME the
    // token so an old link in someone's inbox can never re-activate them later.
    await doc.ref.update({
        status: "active",
        confirmedAt: admin.firestore.Timestamp.now(),
        confirmToken: admin.firestore.FieldValue.delete(),
    });
    res.redirect(302, SITE_URL + "/join?confirmed=1");
}

function unsubConfirmPage(tok) {
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
        "<title>Unsubscribe - SAFE Action</title></head>" +
        "<body style='font-family:Arial,sans-serif;max-width:480px;margin:15vh auto;text-align:center;color:#1A2744;padding:0 20px;'>" +
        "<h2>Unsubscribe from SAFE Action emails?</h2>" +
        "<p style='color:#66717f;'>You will stop receiving all list emails immediately.</p>" +
        "<form method='POST' action='" + SITE_URL + "/api/list/unsubscribe?token=" + tok + "'>" +
        "<button type='submit' style='background:#B22234;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;'>Unsubscribe</button>" +
        "</form></body></html>"
    );
}

async function unsubscribeHandler(req, res) {
    const t = String(req.query.token || "");
    if (!/^[a-f0-9]{48}$/.test(t)) {
        res.redirect(302, SITE_URL + "/join?invalid=1");
        return;
    }
    const q = await db().collection("subscribers").where("unsubToken", "==", t).limit(1).get();
    if (q.empty) {
        res.redirect(302, SITE_URL + "/join?invalid=1");
        return;
    }
    if (req.method === "GET") {
        // Never mutate on GET: mail scanners prefetch links. Humans get a
        // one-button page; RFC 8058 one-click POSTs skip straight through.
        res.status(200).set("Content-Type", "text/html").send(unsubConfirmPage(t));
        return;
    }
    await q.docs[0].ref.update({
        status: "unsubscribed",
        unsubscribedAt: admin.firestore.Timestamp.now(),
    });
    res.redirect(302, SITE_URL + "/join?unsubscribed=1");
}

// ------------------------------------------------------------------- send
// Queues the campaign; the Firestore-triggered worker (index.js) sends it.
// Hosting rewrites cap HTTP responses at 60s, so inline sending would 504.
async function sendCampaign(req, res) {
    const adminEmail = await requireAdmin(req);
    if (!adminEmail) {
        res.status(401).json({ error: "Admin authentication required." });
        return;
    }
    const body = req.body || {};
    const subject = String(body.subject || "").trim().slice(0, 200);
    const html = String(body.html || "");
    const tag = String(body.tag || "").trim();
    const isTest = !!body.test;
    if (!subject || !html) {
        res.status(400).json({ error: "Subject and body are required." });
        return;
    }

    if (isTest) {
        await sendEmail({
            to: adminEmail,
            subject: "[TEST] " + subject,
            htmlBody: html + campaignFooterHtml("(test send)", SITE_URL + "/join"),
        });
        res.status(200).json({ ok: true, sent: 1, test: true });
        return;
    }

    const settings = await db().collection("settings").doc("mailing").get();
    const physicalAddress = settings.exists ? (settings.data().physicalAddress || "") : "";
    if (!physicalAddress) {
        res.status(400).json({
            error: "Set the organization's physical mailing address first. Bulk email legally requires one (CAN-SPAM).",
        });
        return;
    }

    // One campaign at a time: refuse if another is queued/running.
    const running = await db().collection("campaigns")
        .where("status", "in", ["queued", "running"]).limit(1).get();
    if (!running.empty) {
        res.status(409).json({ error: "Another campaign is still sending. Wait for it to finish." });
        return;
    }

    let q = db().collection("subscribers").where("status", "==", "active");
    if (tag) q = q.where("tags", "array-contains", tag);
    const count = (await q.count().get()).data().count;

    const campaignRef = await db().collection("campaigns").add({
        subject: subject,
        html: html,
        tag: tag || null,
        sentBy: adminEmail,
        physicalAddress: physicalAddress,
        status: "queued",
        total: count,
        sentCount: 0,
        failCount: 0,
        startedAt: admin.firestore.Timestamp.now(),
    });

    res.status(200).json({ ok: true, queued: true, campaignId: campaignRef.id, total: count });
}

// Worker body: runs inside the Firestore onDocumentCreated trigger (index.js),
// which is NOT subject to the Hosting 60s cap and gets timeoutSeconds: 540.
// Idempotent: a sent/{subscriberDocId} marker is written per delivery, so a
// retried invocation skips already-delivered recipients.
async function runCampaign(campaignId) {
    const ref = db().collection("campaigns").doc(campaignId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const c = snap.data();
    if (c.status === "done") return;
    await ref.update({ status: "running" });

    let q = db().collection("subscribers").where("status", "==", "active");
    if (c.tag) q = q.where("tags", "array-contains", c.tag);
    const subs = await q.get();

    const sentMarkers = new Set();
    (await ref.collection("sent").get()).forEach(function (d) { sentMarkers.add(d.id); });

    let sent = c.sentCount || 0, failed = c.failCount || 0;
    for (const doc of subs.docs) {
        if (sentMarkers.has(doc.id)) continue;
        const s = doc.data();
        const unsubUrl = SITE_URL + "/api/list/unsubscribe?token=" + s.unsubToken;
        try {
            await sendEmail({
                to: s.email,
                subject: c.subject,
                htmlBody: c.html + campaignFooterHtml(c.physicalAddress, unsubUrl),
                headers: {
                    "List-Unsubscribe": "<" + unsubUrl + ">",
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
            });
            sent++;
            await ref.collection("sent").doc(doc.id).set({ at: admin.firestore.Timestamp.now() });
        } catch (e) {
            console.error("Campaign send failed for", s.email, e.message);
            failed++;
        }
        if ((sent + failed) % 10 === 0) {
            await ref.update({ sentCount: sent, failCount: failed });
        }
        await new Promise(function (r) { setTimeout(r, CAMPAIGN_DELAY_MS); });
    }

    await ref.update({
        status: "done",
        sentCount: sent,
        failCount: failed,
        finishedAt: admin.firestore.Timestamp.now(),
    });
}

// ------------------------------------------------------------------ router
async function mailingList(req, res) {
    const path = (req.path || "").replace(/\/+$/, "");
    try {
        if (req.method === "POST" && path.endsWith("/subscribe")) return await subscribe(req, res);
        if (req.method === "GET" && path.endsWith("/confirm")) return await confirmByToken(req, res);
        if (path.endsWith("/unsubscribe") && (req.method === "GET" || req.method === "POST")) {
            return await unsubscribeHandler(req, res);
        }
        if (req.method === "POST" && path.endsWith("/send")) return await sendCampaign(req, res);
        res.status(404).json({ error: "Not found" });
    } catch (e) {
        console.error("mailing-list error:", e);
        res.status(500).json({ error: "Internal error" });
    }
}

module.exports = { mailingList, runCampaign };
