const admin = require("firebase-admin");

async function trackAction(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, city, state, repName, repTitle, billId, billTitle } = req.body;
  if (!type || !["email", "call"].includes(type)) {
    return res.status(400).json({ error: "Invalid action type. Must be 'email' or 'call'." });
  }

  const db = admin.firestore();

  // Date keys
  const now = new Date();
  const dayKey = now.toISOString().split("T")[0]; // e.g. "2026-03-14"
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7));
  const weekKey = mon.toISOString().split("T")[0]; // Monday of current week

  const increment = admin.firestore.FieldValue.increment(1);

  try {
    const counterRef = db.collection("actionStats").doc("counters");

    // 1. Increment aggregate counters
    await counterRef.set({
      // Daily counters
      [`daily_${dayKey}_total`]: increment,
      [`daily_${dayKey}_${type}s`]: increment,
      // Weekly counters
      [`weekly_${weekKey}_total`]: increment,
      [`weekly_${weekKey}_${type}s`]: increment,
      // All-time counters
      allTime_total: increment,
      [`allTime_${type}s`]: increment,
      // Metadata
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      currentDayKey: dayKey,
      currentWeekKey: weekKey,
    }, { merge: true });

    // 2. Store individual action event for live dashboard
    const eventData = {
      type,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (city) eventData.city = city;
    if (state) eventData.state = state;
    if (repName) eventData.repName = repName;
    if (repTitle) eventData.repTitle = repTitle;
    if (billId) eventData.billId = billId;
    if (billTitle) eventData.billTitle = billTitle;

    await db.collection("actionEvents").add(eventData);

    return res.status(200).json({ success: true, type, dayKey, weekKey });
  } catch (error) {
    console.error("Track action error:", error);
    return res.status(500).json({ error: "Failed to track action" });
  }
}

module.exports = { trackAction };
