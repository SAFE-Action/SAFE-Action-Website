"""Classify the backlog of relevant "monitor" bills and rebuild derived data.

Usage: python -m run_classification [--limit N]   (from the crawler/ directory,
with ANTHROPIC_API_KEY set). Writes data/bills.json, records.json,
records-unmatched.json, scorecard.json. Exits 1 if candidates existed but
none could be processed, so a dead SDK/model fails loudly.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from crawler.analysis.bill_verification import classify_candidate_bills, classification_candidates  # noqa: E402
from crawler.records import build_records, build_scorecard  # noqa: E402

DATA = Path(__file__).parent.parent / "data"


def _load(name, default=None):
    try:
        return json.load(open(DATA / name, encoding="utf-8"))
    except Exception:
        return default


async def main(limit):
    doc = _load("bills.json")
    bills = doc["bills"]
    cands = classification_candidates(bills)
    print(f"candidates: {len(cands)} (limit {limit or 'none'})")
    before = sum(1 for b in bills if b.get("billType") in ("anti", "pro"))
    await classify_candidate_bills(bills, limit=limit)
    after = sum(1 for b in bills if b.get("billType") in ("anti", "pro"))
    processed = sum(1 for b in cands if b.get("verification"))
    print(f"anti/pro bills: {before} -> {after}; processed {processed}")
    if cands and processed == 0:
        print("ERROR: nothing processed")
        return 1
    json.dump(doc, open(DATA / "bills.json", "w"), separators=(",", ":"))
    legs = _load("legislators.json", {})
    legs = legs if isinstance(legs, list) else legs.get("legislators", [])
    seats = (_load("seats.json", {}) or {}).get("seats", [])
    rollcalls = _load("rollcalls.json", {"rollcalls": {}, "people": {}})
    rec, un = build_records(bills, legs, seats, rollcalls)
    rec["generated_at"] = doc.get("generated_at")
    json.dump(rec, open(DATA / "records.json", "w"), separators=(",", ":"))
    json.dump({"generated_at": rec["generated_at"], "count": len(un), "unmatched": un},
              open(DATA / "records-unmatched.json", "w"), indent=1)
    sc = build_scorecard(rec)
    sc["generated_at"] = doc.get("generated_at")
    json.dump(sc, open(DATA / "scorecard.json", "w"), separators=(",", ":"))
    print("records:", rec["summary"])
    print("scorecard:", sc["summary"])
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    sys.exit(asyncio.run(main(ap.parse_args().limit)))
