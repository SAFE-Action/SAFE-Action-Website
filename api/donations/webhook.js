// POST /api/donations/webhook — Stripe only
import crypto from 'crypto';

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(method, path, body) {
  const r = await fetch(`${KV_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

function verifyStripe(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let rawBody = '';
  await new Promise(resolve => { req.on('data', c => rawBody += c); req.on('end', resolve); });

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.SAFE_STRIPE_WEBHOOK_SECRET;
  if (sig && secret && !verifyStripe(rawBody, sig, secret))
    return res.status(401).json({ error: 'Bad signature' });

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(400).end(); }

  const VALID = ['payment_intent.succeeded','checkout.session.completed','charge.succeeded'];
  if (!VALID.includes(body.type)) return res.status(200).json({ skipped: true });

  const obj = body.data?.object;
  if (!obj) return res.status(200).json({ skipped: true });

  const donation = {
    id:          crypto.randomUUID(),
    ts:          Date.now(),
    name:        obj.billing_details?.name || obj.metadata?.name || obj.customer_details?.name || 'Anonymous',
    amountCents: obj.amount_received || obj.amount || 0,
    message:     obj.metadata?.message || '',
  };

  await kv('POST', `/set/${encodeURIComponent('safe-action:latest')}`,
    { value: JSON.stringify(donation), ex: 86400 });
  await kv('POST', `/lpush/${encodeURIComponent('safe-action:history')}`,
    { element: JSON.stringify(donation) });
  await kv('POST', `/ltrim/${encodeURIComponent('safe-action:history')}/0/99`, undefined);

  return res.status(200).json({ received: true, id: donation.id });
}

export const config = { api: { bodyParser: false } };
