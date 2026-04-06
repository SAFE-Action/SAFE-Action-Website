"""Dry-run LLM verification against existing bills.json.

Loads current bill data, runs the LLM secondary check, and writes:
  1. A detailed report to stdout
  2. A JSON file with proposed changes (does NOT overwrite bills.json)

Usage:
    cd crawler
    python run_verification_dryrun.py
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv

# Fix Windows console encoding
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Load .env from crawler directory
load_dotenv(Path(__file__).parent / ".env")

# Now set up imports — we need to use the verification module directly
# rather than via relative imports
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
EXTRACTION_MODEL = os.getenv("EXTRACTION_MODEL", "claude-sonnet-4-20250514")

BILLS_JSON = Path(__file__).parent.parent / "data" / "bills.json"
OUTPUT_REPORT = Path(__file__).parent.parent / "data" / "verification_dryrun_report.json"

CONFIDENCE_THRESHOLD = 0.70
BILLS_PER_BATCH = 10
INTER_BATCH_DELAY = 5  # seconds

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

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
def call_llm(user_prompt: str) -> str:
    response = client.messages.create(
        model=EXTRACTION_MODEL,
        max_tokens=4096,
        temperature=0.1,
        system=VERIFICATION_SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.content[0].text


def verify_batch(bills: list[dict]) -> list[dict]:
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
        response_text = call_llm(user_prompt)
        json_text = response_text.strip()
        # Strip markdown code fences
        if "```" in json_text:
            match = re.search(r'```(?:json)?\s*\n?(.*?)```', json_text, re.DOTALL)
            if match:
                json_text = match.group(1).strip()
        # If still not valid JSON, try to find array/object boundaries
        if not json_text.startswith('[') and not json_text.startswith('{'):
            arr_start = json_text.find('[')
            obj_start = json_text.find('{')
            if arr_start >= 0:
                json_text = json_text[arr_start:]
                # Find matching closing bracket
                depth = 0
                for idx, ch in enumerate(json_text):
                    if ch == '[': depth += 1
                    elif ch == ']': depth -= 1
                    if depth == 0:
                        json_text = json_text[:idx+1]
                        break
            elif obj_start >= 0:
                json_text = json_text[obj_start:]
        parsed = json.loads(json_text)

        if isinstance(parsed, dict):
            parsed = parsed.get("bills", parsed.get("results", []))
        if not isinstance(parsed, list):
            return []

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
        print(f"    ⚠ Batch failed: {e}")
        return []


def main():
    if not GROQ_API_KEY:
        print("ERROR: No GROQ_API_KEY found in .env")
        sys.exit(1)

    print(f"Loading bills from {BILLS_JSON}...")
    with open(BILLS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_bills = data.get("bills", [])
    print(f"Total bills: {len(all_bills)}")

    # Count current classifications
    anti_bills = [b for b in all_bills if b.get("billType") == "anti"]
    pro_bills = [b for b in all_bills if b.get("billType") == "pro"]
    monitor_bills = [b for b in all_bills if b.get("billType") == "monitor"]
    print(f"\nCurrent classifications:")
    print(f"  Anti-science:  {len(anti_bills)}")
    print(f"  Pro-science:   {len(pro_bills)}")
    print(f"  Monitor:       {len(monitor_bills)}")

    classified = [b for b in all_bills if b.get("billType") in ("anti", "pro")]
    print(f"\nBills to verify (anti + pro): {len(classified)}")

    total_batches = (len(classified) + BILLS_PER_BATCH - 1) // BILLS_PER_BATCH
    est_minutes = (total_batches * INTER_BATCH_DELAY) / 60
    print(f"Estimated time: ~{est_minutes:.0f} minutes ({total_batches} batches × {INTER_BATCH_DELAY}s delay)")
    print(f"Using model: {EXTRACTION_MODEL}")
    print(f"Confidence threshold: {CONFIDENCE_THRESHOLD}")
    print(f"\n{'='*70}")
    print("STARTING DRY RUN — bills.json will NOT be modified")
    print(f"{'='*70}\n")

    all_results = []
    for i in range(0, len(classified), BILLS_PER_BATCH):
        batch = classified[i:i + BILLS_PER_BATCH]
        batch_num = (i // BILLS_PER_BATCH) + 1

        if i > 0:
            print(f"  Waiting {INTER_BATCH_DELAY}s for rate limit cooldown...")
            import time
            time.sleep(INTER_BATCH_DELAY)

        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} bills)...", end=" ", flush=True)
        results = verify_batch(batch)
        all_results.extend(results)
        agrees = sum(1 for r in results if r["agrees_with_heuristic"])
        print(f"✓ {len(results)} verified, {agrees} agree, {len(results)-agrees} disagree")

    # Analyze results
    disagreements = []
    low_confidence = []
    confirmed = []
    overrides = []

    for r in all_results:
        if r["agrees_with_heuristic"] and r["confidence"] >= CONFIDENCE_THRESHOLD:
            confirmed.append(r)
        elif r["confidence"] < CONFIDENCE_THRESHOLD:
            low_confidence.append(r)
        elif not r["agrees_with_heuristic"] and r["confidence"] >= CONFIDENCE_THRESHOLD:
            overrides.append(r)
        else:
            disagreements.append(r)

    # Print report
    print(f"\n{'='*70}")
    print("VERIFICATION REPORT (DRY RUN)")
    print(f"{'='*70}")
    print(f"\nTotal verified:                {len(all_results)}")
    print(f"✅ Confirmed (agree, high conf): {len(confirmed)}")
    print(f"⬇️  Downgrade to monitor (low):   {len(low_confidence)}")
    print(f"🔄 LLM overrides (disagree):     {len(overrides)}")

    # Projected new counts
    new_anti = len([r for r in all_results if r["agrees_with_heuristic"] and r["confidence"] >= CONFIDENCE_THRESHOLD and r["original_classification"] == "anti"])
    new_anti += len([r for r in overrides if r["llm_classification"] == "anti"])

    new_pro = len([r for r in all_results if r["agrees_with_heuristic"] and r["confidence"] >= CONFIDENCE_THRESHOLD and r["original_classification"] == "pro"])
    new_pro += len([r for r in overrides if r["llm_classification"] == "pro"])

    lost_to_monitor = len(low_confidence) + len([r for r in overrides if r["llm_classification"] == "monitor"])

    print(f"\n📊 PROJECTED IMPACT:")
    print(f"  Anti-science: {len(anti_bills)} → ~{len(anti_bills) - len([r for r in low_confidence if r['original_classification']=='anti']) - len([r for r in overrides if r['original_classification']=='anti' and r['llm_classification']!='anti'])}")
    print(f"  Pro-science:  {len(pro_bills)} → ~{len(pro_bills) - len([r for r in low_confidence if r['original_classification']=='pro']) - len([r for r in overrides if r['original_classification']=='pro' and r['llm_classification']!='pro'])}")
    print(f"  Monitor:      {len(monitor_bills)} → ~{len(monitor_bills) + lost_to_monitor}")

    if low_confidence:
        print(f"\n--- LOW CONFIDENCE DOWNGRADES (would become 'monitor') ---")
        for r in low_confidence:
            print(f"  {r['bill_id']}: was '{r['original_classification']}', confidence={r['confidence']:.2f}")
            print(f"    → {r['explanation']}")

    if overrides:
        print(f"\n--- LLM OVERRIDES (would change category) ---")
        for r in overrides:
            print(f"  {r['bill_id']}: '{r['original_classification']}' → '{r['llm_classification']}' (confidence={r['confidence']:.2f})")
            print(f"    Evidence: {', '.join(r['evidence'][:3])}")
            print(f"    → {r['explanation']}")

    # Save full report as JSON
    report = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "model": EXTRACTION_MODEL,
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "total_bills": len(all_bills),
        "total_verified": len(all_results),
        "summary": {
            "before": {"anti": len(anti_bills), "pro": len(pro_bills), "monitor": len(monitor_bills)},
            "confirmed": len(confirmed),
            "low_confidence_downgrades": len(low_confidence),
            "llm_overrides": len(overrides),
        },
        "low_confidence_downgrades": low_confidence,
        "llm_overrides": overrides,
        "all_results": all_results,
    }

    with open(OUTPUT_REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\nFull report saved to: {OUTPUT_REPORT}")
    print("bills.json was NOT modified. Review the report before running live.")


if __name__ == "__main__":
    main()
