// ============================================================
// SAFE-Action — Stripe Webhook Receiver
// POST /api/donations/webhook
// ============================================================

import crypto from 'crypto';

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvSet(key, value, exSeconds = 86400) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: JSON.stringify(value), ex: exSeconds }),
  });
}

async function kvLPush(key, value) {
  await fetch(`${KV_URL}/lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ element: JSON.stringify(value) }),
  });
  await fetch(`${KV_URL}/ltrim/${encodeURIComponent(key)}/0/99`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

function verifyStripe(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const payload = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let rawBody = '';
  await new Promise((resolve) => {
    req.on('data', chunk => rawBody += chunk);
    req.on('end', resolve);
  });

  // Verify Stripe signature
  const sig = req.headers['stripe-signature'];
  const secret = process.env.SAFE_STRIPE_WEBHOOK_SECRET;
  if (sig && secret) {
    try {
      if (!verifyStripe(rawBody, sig, secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch {
      return res.status(401).json({ error: 'Signature verification failed' });
    }
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(400).end(); }

  const type = body.type;
  if (!['payment_intent.succeeded', 'checkout.session.completed', 'charge.succeeded'].includes(type)) {
    return res.status(200).json({ received: true, skipped: true });
  }

  const obj = body.data?.object;
  if (!obj) return res.status(200).json({ received: true, skipped: true });

  const name = obj.billing_details?.name
    || obj.metadata?.name
    || obj.customer_details?.name
    || 'Anonymous';
  const amountCents = obj.amount_received || obj.amount || 0;
  const message = obj.metadata?.message || '';

  const donation = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    name,
    amountCents,
    message,
    platform: 'stripe',
  };

  await kvSet('safe-action:latest', donation);
  await kvLPush('safe-action:history', donation);

  // Update running totals
  const totalsRaw = await fetch(`${KV_URL}/get/safe-action:totals`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  }).then(r => r.json());

  let totals = { total: 0, count: 0, today: 0, date: new Date().toDateString() };
  try { totals = JSON.parse(totalsRaw.result) || totals; } catch {}

  // Reset today if new day
  if (totals.date !== new Date().toDateString()) {
    totals.today = 0;
    totals.date = new Date().toDateString();
  }

  totals.total += amountCents;
  totals.today += amountCents;
  totals.count += 1;

  await kvSet('safe-action:totals', totals, 2592000); // 30 days

  console.log(`[safe-action] Stripe ${name} ${amountCents}¢`);
  return res.status(200).json({ received: true, id: donation.id });
}

export const config = { api: { bodyParser: false } };
