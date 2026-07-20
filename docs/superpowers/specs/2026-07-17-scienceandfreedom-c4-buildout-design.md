# SAFE Action (scienceandfreedom.com) — c4 Build-Out Design

**Date:** 2026-07-17
**Site:** scienceandfreedom.com (the 501(c)(4), "SAFE Action")
**Stack:** Static HTML + Firebase Hosting + Cloud Functions + Firestore. Custom, in-house, no third-party org platform.

## Context & guardrails

- **Entity separation.** scienceandfreedom.com is the c4 (SAFE Action), a **separate entity** from the c3 (Science and Freedom for Everyone Foundation, branded SAFE Research Institute, saferi.org).
- **Money.** Tax-deductible donations belong to the **c3**. The c4 self-funds via **merch** (WRX Printing, later) and **events** (annual conference, later). This site must **not** solicit tax-deductible donations.
- **No fabricated metrics.** Public counters show real numbers (baseline + real, disclosed).

## Build pieces & sequence

Built and shipped in order; each is deployed on its own. Candidate automation runs on a **parallel track** (it's data/CI work, independent of the web features).

| # | Piece | Depends on |
|---|-------|-----------|
| A | Candidate-data automation (parallel track) | none |
| 1 | Groundwork / c4 identity | none |
| 2 | Mailing list | 1 |
| 3 | Coordinator program | 1, 2 |
| 4 | Organizing-engine glue | 2, 3 |
| — | Merch (WRX), conference | later, out of scope now |

---

## Piece A — Candidate-data automation

**Problem.** `data/seats.json` (candidates/seats; powers Pledge Directory, Candidate Quiz, elections) is 4+ months stale. An 11-script pipeline exists (`scrape_ballotpedia → build_seats → populate_candidates/incumbents → enrich_candidates/openstates/google_search/from_legislators → merge_enrichment → fix_district_mismatches → validate_emails`) but was **never orchestrated or scheduled**, so it silently stopped.

**Design.**
1. **Runner** — one ordered orchestrator (`crawler/run_candidate_pipeline.py`) that runs the phases in the correct sequence with logging, per-phase failure handling, and a `--dry-run`. Documents the order that is currently tribal knowledge.
2. **Cheap LLM.** The enrichment step already reads `EXTRACTION_MODEL`; default it to **Haiku** (`claude-haiku-4-5`) for CI, so unattended runs are cheap. (Local runs on the Mac Mini can use Ollama for free; CI uses Haiku.)
3. **Schedule.** New GitHub Actions workflow `candidate-crawl.yml`, cron **weekly** (candidate data moves slower than bills), `timeout-minutes: 120`, commits refreshed `seats.json` `[skip ci]` and deploys `--only hosting` (mirrors the bills crawler that works today).
4. **Secrets fix.** Congress + FEC API keys are **hardcoded in a public repo** (`populate_candidates.py`, `enrich_candidates.py`). Move to env/GitHub secrets and rotate them. `ANTHROPIC_API_KEY` stays env-only (already is).
5. **First run** produces a current `seats.json`; commit + deploy.

**Success:** `candidate-crawl.yml` runs green on schedule and on manual dispatch; `seats.json` `generated_at` is current; no keys in source.

---

## Piece 1 — Groundwork / c4 identity

**Goal.** Make the site unambiguously the c4, compliant, and shed c3-shaped machinery.

**Design.**
1. **Compliance chrome** (shared across all pages, via the existing footer/sync pattern):
   - "Paid for by SAFE Action" disclaimer in the footer.
   - EIN **41-4491870** (501(c)(4), IRS application pending) + "SAFE Action is organized as a 501(c)(4) social welfare organization. Contributions are **not** tax-deductible as charitable contributions." (DECIDED 2026-07-17. Given pending status, use "organized as"; counsel can adjust final wording later.)
2. **Remove the donate path.** The c4 must not take deductible-framed gifts. Remove the Donate button/links (`about.html#donate`, footer) and the `createCheckout` Stripe function from the deploy, **or** redirect "Donate/Support" to the c3 (saferi.org). Recommendation: **redirect to the c3** so the intent (support the mission) still lands somewhere legitimate. Final call: Greg.
   - **DECIDED 2026-07-17: redirect** "Donate/Support" to the c3 (saferi.org).
3. **Retire the heavy volunteer/NDA/Workspace flow.** `volunteer-apply`, `admin-volunteers`, `volunteer-sign-nda`, `google-workspace`, `nda-template` implement formal-board onboarding (NDA + Drive/Calendar/Chat). That is c3/Research-Institute machinery. Decommission it from this site (keep the code archived / hand to the saferi.org column). This clears the way for the light Coordinator program (Piece 3).
4. **Copy pass** for c4 voice/consistency (org name usage, no em-dashes, no banned phrases).

**Success:** every page shows correct c4 disclaimers + EIN; no deductible-donation solicitation; the NDA/Workspace flow is gone; compliance audit clean.

---

## Piece 2 — Mailing list

**Goal.** A real, owned mailing list: people subscribe, you can email them, they can unsubscribe.

**Design.**
- **Data (Firestore).** `subscribers/{id}`: email, name (optional), status (`pending`|`active`|`unsubscribed`), source (which form/page), consent timestamp, double-opt-in token, tags[] (e.g. `coordinator`, `state:CA`), createdAt.
- **Sending (the one non-Firebase dependency).** Delivery goes through a transactional email API for deliverability — **recommend Resend** (simple API, cheap, works from Cloud Functions; SES is the cheaper-at-scale alternative). Requires DNS on a sending subdomain (`mail.scienceandfreedom.com`: SPF + DKIM + DMARC) — I'll drive that in your Chrome/registrar when we get there.
- **Flows (Cloud Functions):**
  - `subscribe` — validate, create `pending`, send double-opt-in confirmation email (real consent record for compliance).
  - `confirm?token=` — flip to `active`.
  - `unsubscribe?token=` — flip to `unsubscribed` (one-click, in every email footer; legally required).
  - `sendCampaign` (admin-only) — send a broadcast to a tag/segment, rate-limited, with unsubscribe + physical-address footer.
- **Front end.** A reusable signup component dropped into the homepage, footer, and a `/join` page. Honeypot + rate-limit against spam.
- **Admin.** Minimal authed page: subscriber count, export CSV, compose/send a campaign to a segment.

**Success:** double-opt-in works end to end; unsubscribe works; a test campaign sends from the domain and lands in inbox; admin can see/export the list.

**DECIDED 2026-07-17:** Resend for delivery.

---

## Piece 3 — Coordinator program

**Goal.** Recruit **coordinators** ("power position") who run relational organizing — host come-together/coworking sessions, rally friends, drive their circle to contact reps. NOT literal cold-call phone banking; the site *is* the outreach tool.

**Design.**
- **Signup** = a mailing-list subscribe (Piece 2) **plus** a `coordinator` profile in Firestore: name, email, region/state, what they want to help with (host sessions, social, recruit friends), commitment level. Tagged `coordinator` on the list.
- **Toolkit (post-signup).** A `/coordinator` page + a welcome email with: how to run a come-together session, shareable links (their reps / a bill / the pledge), copy-paste social + text-your-friends scripts, and the site's action tools. Lightweight and self-serve — no approval gate, no NDA.
- **Light tracking (optional, phase-2).** A referral tag on shared links so a coordinator can see roughly how many actions their circle drove. Keep simple; defer if it balloons.
- **Replaces** the retired heavy volunteer flow. `positions.html` (already live, "Social Media Manager") folds in here as one coordinator flavor.

**Success:** someone can sign up as a coordinator, land on the list tagged `coordinator`, and get the toolkit email + page.

---

## Piece 4 — Organizing-engine glue

**Goal.** The list, coordinators, and existing action tools (contact reps, pledges, tracker) act as one system.

**Design.**
- **Action → list.** When someone takes an action (emails a rep, signs a pledge), offer to join the list inline; on yes, subscribe them (double-opt-in) tagged with what they did / their state.
- **List → action.** Campaign emails carry deep-links into the action tools (a specific bill via the `#browse-bills` deep-links we just fixed, a pledge, their reps).
- **Coordinator → circle.** Coordinator toolkit links are trackable (ties to Piece 3 tracking).
- **One admin surface.** Fold list + coordinators + action stats into the existing admin dashboard.

**Success:** an action can convert to a subscriber; a campaign can drive people back into an action; the admin sees the whole funnel.

---

## Cross-cutting

- **Security.** No secrets in source (fixes the hardcoded Congress/FEC keys; keeps Anthropic/Resend keys in Functions secrets). Firestore rules: subscribers/coordinators are admin-read only, write only via Functions.
- **Compliance chrome** (Piece 1) applies to every new page.
- **Testing.** Each Function gets input-validation + happy-path/failure tests before it's called done; each piece is verified live before moving on.
- **Deploys** ship per-piece via the (now working) CI.

## Out of scope (now)

Merch (WRX Printing storefront), annual conference/events, any tax-deductible donation flow (that's the c3).
