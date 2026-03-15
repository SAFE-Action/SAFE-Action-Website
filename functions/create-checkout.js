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

const stripe = require("stripe");

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
    var stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
        console.error("STRIPE_SECRET_KEY not configured");
        res.status(500).json({ error: "Payment system not configured" });
        return;
    }

    var stripeClient = stripe(stripeKey);

    try {
        var sessionParams = {
            payment_method_types: undefined, // let Stripe auto-detect (dynamic payment methods)
            success_url: "https://safe-action-website.web.app/donate?success=true",
            cancel_url: "https://safe-action-website.web.app/donate?canceled=true",
            submit_type: frequency === "onetime" ? "donate" : undefined,
            metadata: {
                source: "safe-action-donate-page",
                frequency: frequency
            }
        };

        if (frequency === "monthly") {
            // Recurring subscription - create a price on the fly
            sessionParams.mode = "subscription";
            sessionParams.line_items = [{
                price_data: {
                    currency: "usd",
                    unit_amount: amount * 100, // cents
                    recurring: {
                        interval: "month"
                    },
                    product_data: {
                        name: "SAFE Action Fund Monthly Donation",
                        description: "$" + amount + "/month recurring donation to SAFE Action Fund"
                    }
                },
                quantity: 1
            }];
        } else {
            // One-time payment
            sessionParams.mode = "payment";
            sessionParams.line_items = [{
                price_data: {
                    currency: "usd",
                    unit_amount: amount * 100, // cents
                    product_data: {
                        name: "SAFE Action Fund Donation",
                        description: "One-time $" + amount + " donation to SAFE Action Fund"
                    }
                },
                quantity: 1
            }];
        }

        var session = await stripeClient.checkout.sessions.create(sessionParams);

        res.status(200).json({ url: session.url });
    } catch (err) {
        console.error("Stripe error:", err.message);
        res.status(500).json({ error: "Failed to create checkout session" });
    }
}

module.exports = { createCheckout };
