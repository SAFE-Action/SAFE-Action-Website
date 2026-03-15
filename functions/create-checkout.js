/**
 * Create Stripe Checkout Session
 * Accepts { amount, frequency } and returns a Stripe Checkout URL.
 *
 * Amount is in dollars (e.g. 50 = $50.00)
 * Frequency is "onetime" or "monthly"
 *
 * Set your Stripe secret key with:
 *   firebase functions:secrets:set STRIPE_SECRET_KEY
 */

const https = require("https");

function stripeRequest(secretKey, params) {
    return new Promise(function(resolve, reject) {
        var postData = new URLSearchParams(params).toString();
        var options = {
            hostname: "api.stripe.com",
            port: 443,
            path: "/v1/checkout/sessions",
            method: "POST",
            headers: {
                "Authorization": "Bearer " + secretKey,
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(postData)
            }
        };
        var req = https.request(options, function(res) {
            var data = "";
            res.on("data", function(chunk) { data += chunk; });
            res.on("end", function() {
                try {
                    var parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(parsed.error.message));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error("Invalid response from Stripe"));
                }
            });
        });
        req.on("error", function(e) { reject(e); });
        req.write(postData);
        req.end();
    });
}

async function createCheckout(req, res) {
    // Only allow POST
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    var body = req.body || {};
    var amount = parseInt(body.amount, 10);
    var frequency = body.frequency || "onetime";

    // Validate amount
    if (!amount || amount < 1 || amount > 50000) {
        res.status(400).json({ error: "Invalid amount. Must be between $1 and $50,000." });
        return;
    }

    // Validate frequency
    if (frequency !== "onetime" && frequency !== "monthly") {
        res.status(400).json({ error: "Invalid frequency. Must be 'onetime' or 'monthly'." });
        return;
    }

    // Get Stripe key from environment/secrets
    var stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    if (!stripeKey) {
        console.error("STRIPE_SECRET_KEY not configured");
        res.status(500).json({ error: "Payment system not configured" });
        return;
    }

    try {
        var params = {
            "success_url": "https://safe-action-website.web.app/donate?success=true",
            "cancel_url": "https://safe-action-website.web.app/donate?canceled=true",
            "metadata[source]": "safe-action-donate-page",
            "metadata[frequency]": frequency
        };

        if (frequency === "monthly") {
            params["mode"] = "subscription";
            params["line_items[0][price_data][currency]"] = "usd";
            params["line_items[0][price_data][unit_amount]"] = String(amount * 100);
            params["line_items[0][price_data][recurring][interval]"] = "month";
            params["line_items[0][price_data][product_data][name]"] = "SAFE Action Fund Monthly Donation";
            params["line_items[0][price_data][product_data][description]"] = "$" + amount + "/month recurring donation";
            params["line_items[0][quantity]"] = "1";
        } else {
            params["mode"] = "payment";
            params["submit_type"] = "donate";
            params["line_items[0][price_data][currency]"] = "usd";
            params["line_items[0][price_data][unit_amount]"] = String(amount * 100);
            params["line_items[0][price_data][product_data][name]"] = "SAFE Action Fund Donation";
            params["line_items[0][price_data][product_data][description]"] = "One-time $" + amount + " donation";
            params["line_items[0][quantity]"] = "1";
        }

        console.log("Creating checkout session:", JSON.stringify({ amount: amount, frequency: frequency }));
        var session = await stripeRequest(stripeKey, params);
        console.log("Checkout session created:", session.id);

        res.status(200).json({ url: session.url });
    } catch (err) {
        console.error("Stripe error:", err.message);
        res.status(500).json({ error: "Failed to create checkout session" });
    }
}

module.exports = { createCheckout };
