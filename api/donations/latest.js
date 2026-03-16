// GET /api/donations/latest — polled by dashboard.html every 5s
// GET /api/donations/latest?totals=1 — returns running totals

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    if (req.query.totals) {
      const r = await fetch(`${KV_URL}/get/safe-action:totals`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      const j = await r.json();
      if (!j.result) return res.status(200).json({ total: 0, count: 0, today: 0 });
      return res.status(200).json(JSON.parse(j.result));
    }

    const r = await fetch(`${KV_URL}/get/safe-action:latest`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const j = await r.json();
    if (!j.result) return res.status(200).json(null);
    return res.status(200).json(JSON.parse(j.result));
  } catch {
    return res.status(500).json(null);
  }
}
