"""LLM-based secondary verification for bill classification.

The keyword heuristic in legiscan.py is the first pass. This module provides
a second-opinion check using Claude (Anthropic API), implementing the
confidence-threshold approach recommended by our ML advisor:

1. Score each bill with a confidence probability (0.0–1.0).
2. Cite specific bill language that drove the classification.
3. Flag disagreements between keyword heuristic and LLM for human review.
4. Apply a configurable confidence threshold — bills below it are
   downgraded to "monitor" to avoid false positives that erode credibility.
"""

import asyncio
import json
from datetime import datetime, timezone
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential
from ..config import ANTHROPIC_API_KEY, EXTRACTION_MODEL

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Tuneable thresholds ──────────────────────────────────────────────────
# Bills below this confidence are downgraded to "monitor".
# Start conservative (0.70) — review the disagreement log and lower if
# too many true positives are being dropped.
CONFIDENCE_THRESHOLD = 0.70

# Maximum bills per LLM batch (token budget management)
BILLS_PER_BATCH = 10

# Delay between batches (seconds) — Claude API has generous rate limits
INTER_BATCH_DELAY = 5

VERIFICATION_SYSTEM_PROMPT = """You are an expert policy analyst specialising in science, public health, and vaccine legislation in the United States. Your task is to verify whether a bill has been correctly classified.

CLASSIFICATION DEFINITIONS:
- "anti" (anti-science): Bills that weaken vaccine requirements, expand non-medical exemptions, restrict public health authority, deregulate raw milk or fluoride safety standards, reclassify mRNA vaccines as gene therapy, or use "medical freedom" / "informed consent" framing to undermine evidence-based health policy.
- "pro" (pro-science): Bills that strengthen immunisation requirements, limit non-medical exemptions, expand vaccine access, fund public health infrastructure, or support evidence-based medicine.
- "monitor": Bills that touch health topics but do NOT clearly push an anti-science or pro-science agenda. Includes routine appropriations, administrative reorganisations, or genuinely neutral public health measures.

IMPORTANT GUIDANCE:
- Be PRECISE. A bill about school funding that mentions "health education" is NOT anti-science — it's "monitor".
- "Informed consent" in a VACCINE context is almost always anti-science coded language. In other medical contexts it may be neutral.
- "Parental rights" regarding vaccination decisions is anti-science framing. In non-vaccine contexts it may be neutral.
- Raw milk deregulation and fluoride removal are anti-science positions per scientific consensus.
- Pandemic preparedness bills that LIMIT government authority are anti-science. Those that FUND preparedness are pro-science.

For each bill, return:
- Your independent classification ("anti", "pro", or "monitor")
- A confidence score from 0.0 to 1.0 (how certain are you?)
- The specific language/phrases in the title or description that drove your decision
- A 1-sentence explanation

Return ONLY valid JSON — an array of objects."""


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=3, min=5, max=60))
async def _call_llm(user_prompt: str) -> str:
    """Call Claude via Anthropic API with retry logic."""
    response = client.messages.create(
        model=EXTRACTION_MODEL,
        max_tokens=4096,
        temperature=0.1,  # low temp for consistent classification
        system=VERIFICATION_SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.content[0].text


async def verify_bill_batch(bills: list[dict]) -> list[dict]:
    """Verify a batch of bills. Returns verification results with confidence scores.

    Each result dict contains:
        bill_id:             str — matches input billId
        llm_classification:  str — "anti", "pro", or "monitor"
        confidence:          float — 0.0–1.0
        evidence:            list[str] — phrases from bill text that drove decision
        explanation:         str — 1-sentence reasoning
        agrees_with_heuristic: bool
        original_classification: str — the keyword heuristic's billType
    """
    if not bills:
        return []

    bill_summaries = []
    for b in bills:
        bill_summaries.append({
            "billId": b.get("billId", ""),
            "billNumber": b.get("billNumber", ""),
            "state": b.get("state", ""),
            "title": b.get("title", ""),
            "summary": (b.get("summary") or b.get("title", ""))[:500],
            "category": b.get("category", ""),
            "heuristic_classification": b.get("billType", "monitor"),
        })

    user_prompt = (
        f"Verify the classification of these {len(bills)} bills.\n\n"
        f"BILLS:\n{json.dumps(bill_summaries, indent=2)}\n\n"
        "For each bill, return a JSON array of objects with:\n"
        '- "billId": matching the input\n'
        '- "classification": your independent verdict ("anti", "pro", or "monitor")\n'
        '- "confidence": float 0.0-1.0\n'
        '- "evidence": array of specific phrases from the title/summary\n'
        '- "explanation": 1 sentence\n'
    )

    try:
        response_text = await _call_llm(user_prompt)
        json_text = response_text.strip()
        if json_text.startswith("```"):
            json_text = json_text.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(json_text)

        if isinstance(parsed, dict):
            parsed = parsed.get("bills", parsed.get("results", []))
        if not isinstance(parsed, list):
            return []

        # Build lookup for original classifications
        orig_map = {b.get("billId", ""): b.get("billType", "monitor") for b in bills}

        results = []
        for item in parsed:
            bill_id = item.get("billId", "")
            llm_class = item.get("classification", "monitor")
            confidence = float(item.get("confidence", 0.5))
            orig_class = orig_map.get(bill_id, "monitor")

            results.append({
                "bill_id": bill_id,
                "llm_classification": llm_class,
                "confidence": confidence,
                "evidence": item.get("evidence", []),
                "explanation": item.get("explanation", ""),
                "agrees_with_heuristic": llm_class == orig_class,
                "original_classification": orig_class,
            })

        return results

    except (json.JSONDecodeError, Exception) as e:
        print(f"    Warning: Bill verification batch failed: {e}")
        return []


async def verify_all_bills(bills: list[dict]) -> list[dict]:
    """Run LLM verification on all classified bills, apply confidence threshold,
    and return the updated bill list.

    Bills where the LLM disagrees or confidence is below threshold are:
    - Downgraded to "monitor" if confidence < CONFIDENCE_THRESHOLD
    - Flagged with verification metadata for human review

    Also prints a disagreement report for manual inspection.
    """
    if not ANTHROPIC_API_KEY:
        print("  Skipping bill verification (no ANTHROPIC_API_KEY)")
        return bills

    # Only verify bills that were classified as anti or pro (not monitor)
    classified = [b for b in bills if b.get("billType") in ("anti", "pro")]
    if not classified:
        print("  No anti/pro bills to verify")
        return bills

    print(f"  Verifying {len(classified)} classified bills with Claude secondary check...")

    all_results = []
    total_batches = (len(classified) + BILLS_PER_BATCH - 1) // BILLS_PER_BATCH

    for i in range(0, len(classified), BILLS_PER_BATCH):
        batch = classified[i:i + BILLS_PER_BATCH]
        batch_num = (i // BILLS_PER_BATCH) + 1

        if i > 0:
            print(f"    Waiting {INTER_BATCH_DELAY}s for rate limit cooldown...")
            await asyncio.sleep(INTER_BATCH_DELAY)

        print(f"    Verifying batch {batch_num}/{total_batches} ({len(batch)} bills)...")
        results = await verify_bill_batch(batch)
        all_results.extend(results)
        print(f"    Verified {len(results)} bills in batch {batch_num}")

    # Build result lookup
    verification_map = {r["bill_id"]: r for r in all_results}

    # Apply results to bills
    disagreements = []
    downgrades = []

    for bill in bills:
        bill_id = bill.get("billId", "")
        verification = verification_map.get(bill_id)

        if not verification:
            continue

        # Attach verification metadata
        bill["verification"] = {
            "llm_classification": verification["llm_classification"],
            "confidence": verification["confidence"],
            "evidence": verification["evidence"],
            "explanation": verification["explanation"],
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

        original = verification["original_classification"]
        llm_class = verification["llm_classification"]
        confidence = verification["confidence"]

        # Case 1: LLM agrees with high confidence — keep as-is
        if verification["agrees_with_heuristic"] and confidence >= CONFIDENCE_THRESHOLD:
            bill["verification"]["status"] = "confirmed"
            continue

        # Case 2: Low confidence — downgrade to monitor
        if confidence < CONFIDENCE_THRESHOLD:
            bill["verification"]["status"] = "low_confidence_downgrade"
            bill["verification"]["original_billType"] = original
            bill["verification"]["original_stance"] = bill.get("stance", "")
            bill["billType"] = "monitor"
            bill["stance"] = "Monitor"
            downgrades.append({
                "billId": bill_id,
                "billNumber": bill.get("billNumber", ""),
                "state": bill.get("state", ""),
                "title": bill.get("title", "")[:80],
                "was": original,
                "confidence": confidence,
                "reason": verification["explanation"],
            })
            continue

        # Case 3: LLM disagrees but with high confidence — use LLM's answer
        if not verification["agrees_with_heuristic"] and confidence >= CONFIDENCE_THRESHOLD:
            bill["verification"]["status"] = "llm_override"
            bill["verification"]["original_billType"] = original

            # Override classification
            bill["billType"] = llm_class
            if llm_class == "anti":
                bill["stance"] = "Oppose"
            elif llm_class == "pro":
                bill["stance"] = "Support"
            else:
                bill["stance"] = "Monitor"

            disagreements.append({
                "billId": bill_id,
                "billNumber": bill.get("billNumber", ""),
                "state": bill.get("state", ""),
                "title": bill.get("title", "")[:80],
                "heuristic": original,
                "llm": llm_class,
                "confidence": confidence,
                "evidence": verification["evidence"],
                "explanation": verification["explanation"],
            })

    # Print report
    verified_count = len(verification_map)
    agree_count = sum(1 for r in all_results if r["agrees_with_heuristic"] and r["confidence"] >= CONFIDENCE_THRESHOLD)

    print(f"\n  ── Bill Verification Report ──")
    print(f"  Verified: {verified_count} bills")
    print(f"  Confirmed (agree + high confidence): {agree_count}")
    print(f"  Downgraded to monitor (low confidence): {len(downgrades)}")
    print(f"  LLM overrides (disagree + high confidence): {len(disagreements)}")

    if downgrades:
        print(f"\n  Low-confidence downgrades (threshold={CONFIDENCE_THRESHOLD}):")
        for d in downgrades:
            print(f"    {d['state']} {d['billNumber']}: was '{d['was']}', "
                  f"confidence={d['confidence']:.2f} — {d['reason']}")

    if disagreements:
        print(f"\n  LLM classification overrides:")
        for d in disagreements:
            print(f"    {d['state']} {d['billNumber']}: "
                  f"heuristic='{d['heuristic']}' → LLM='{d['llm']}' "
                  f"(confidence={d['confidence']:.2f})")
            print(f"      Evidence: {', '.join(d['evidence'][:3])}")
            print(f"      Reason: {d['explanation']}")

    return bills
