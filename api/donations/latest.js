// GET /api/donations/latest — polled by dashboard.html every 5s
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent('safe-action:latest')}`,
      { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    const j = await r.json();
    if (!j.result) return res.status(200).json(null);
    return res.status(200).json(JSON.parse(j.result));
  } catch { return res.status(500).json(null); }
}
