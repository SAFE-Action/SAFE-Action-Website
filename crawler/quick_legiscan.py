"""Quick standalone script to pull bills from LegiScan and write data/bills.json.

Usage: python crawler/quick_legiscan.py
No ANTHROPIC_API_KEY or other dependencies needed — just httpx.
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

API_KEY = "3ad4f468112ab929141dd5e0863eec35"
BASE_URL = "https://api.legiscan.com/"
RATE_LIMIT = 0.6  # seconds between requests

PRIORITY_STATES = ["TX", "FL", "CA", "OH", "NY", "CO", "WA", "ID", "MO", "GA", "PA", "MA"]

SEARCH_QUERIES = [
    "vaccine",
    "vaccination",
    "immunization",
    "vaccine exemption",
    "vaccine mandate",
    "medical freedom",
    "informed consent vaccine",
    "public health emergency",
    "school immunization",
    "childhood vaccination",
]

# Classification keywords
ANTI_KEYWORDS = [
    "exemption", "exempt", "medical freedom", "freedom act",
    "informed consent", "prohibit mandate", "prohibit vaccination",
    "eliminate requirement", "remove requirement", "parental rights",
    "conscience", "religious exemption", "philosophical exemption",
    "ban mandate", "liability", "injury compensation",
    "opt out", "opt-out", "voluntary", "prohibit require",
]
PRO_KEYWORDS = [
    "strengthen immunization", "require vaccination", "require immunization",
    "safeguard vaccine", "protect public health", "limit exemption",
    "remove exemption", "tighten exemption", "vaccine access",
    "immunization registry", "disease surveillance", "outbreak response",
]
CATEGORY_PATTERNS = {
    "vaccine-exemption": ["exemption", "exempt", "opt out", "opt-out"],
    "vaccine-mandate": ["mandate", "require", "requirement", "compulsory"],
    "medical-freedom": ["medical freedom", "freedom act", "health freedom"],
    "informed-consent": ["informed consent"],
    "public-health": ["public health", "disease surveillance", "outbreak", "immunization registry"],
    "vaccine-liability": ["liability", "injury", "compensation", "indemnity"],
}
STATUS_MAP = {1: "Introduced", 2: "In Committee", 3: "Passed One Chamber", 4: "Passed Both Chambers", 5: "Vetoed", 6: "Signed into Law"}

last_request = 0

async def api_call(client, op, **params):
    global last_request
    elapsed = time.time() - last_request
    if elapsed < RATE_LIMIT:
        await asyncio.sleep(RATE_LIMIT - elapsed)

    query_params = {"key": API_KEY, "op": op, **params}
    try:
        resp = await client.get(BASE_URL, params=query_params, timeout=30.0)
        last_request = time.time()
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "ERROR":
            msg = data.get("alert", {}).get("message", "Unknown")
            print(f"  API error: {msg}")
            return None
        return data
    except Exception as e:
        print(f"  Request failed: {e}")
        return None


RELEVANCE_KEYWORDS = [
    "vaccine", "vaccin", "immuniz", "immunis", "inoculat",
    "public health", "communicable disease", "infectious disease",
    "exemption", "mandate", "medical freedom", "informed consent",
    "fluorid", "pandemic", "epidemic", "quarantine", "isolation order",
    "school health", "childhood disease", "measles", "polio", "whooping",
    "health freedom", "bodily autonomy", "parental rights",
    "vaccine injury", "vaers", "adverse event",
]


def is_relevant(title, description=""):
    """Check if a bill is actually about science/health topics we track."""
    text = f"{title} {description}".lower()
    return any(kw in text for kw in RELEVANCE_KEYWORDS)


def classify_bill(title, description=""):
    text = f"{title} {description}".lower()
    anti = sum(1 for kw in ANTI_KEYWORDS if kw in text)
    pro = sum(1 for kw in PRO_KEYWORDS if kw in text)

    if anti == 0 and pro == 0:
        # No signal — default to monitor/neutral, not anti
        bill_type = "monitor"
        stance = "Monitor"
    elif pro > anti:
        bill_type = "pro"
        stance = "Support"
    elif anti > pro:
        bill_type = "anti"
        stance = "Oppose"
    else:
        # Tied — default to monitor
        bill_type = "monitor"
        stance = "Monitor"

    category = "public-health"
    best = 0
    for cat, patterns in CATEGORY_PATTERNS.items():
        score = sum(1 for p in patterns if p in text)
        if score > best:
            best = score
            category = cat
    return bill_type, stance, category


def determine_status(bill):
    status_id = bill.get("status", 0)
    status_label = STATUS_MAP.get(status_id, "Introduced")
    la = (bill.get("last_action") or "").lower()
    if "signed" in la or "enacted" in la or "approved" in la:
        status_label = "Signed into Law"
    elif "vetoed" in la:
        status_label = "Vetoed"
    elif "died" in la or "failed" in la or "tabled" in la:
        status_label = "Died in Committee"
    elif "withdrawn" in la:
        status_label = "Withdrawn"
    elif "passed" in la and ("senate" in la or "house" in la):
        status_label = "Passed One Chamber"
    elif "floor" in la or "third reading" in la:
        status_label = "Floor Vote Scheduled"
    elif "committee" in la and ("referred" in la or "assigned" in la):
        status_label = "In Committee"
    dead = {"Vetoed", "Died in Committee", "Tabled", "Withdrawn", "Signed into Law"}
    is_active = "No" if status_label in dead else "Yes"
    return status_label, is_active


def determine_impact(bill, bill_type):
    text = f"{bill.get('title', '')} {bill.get('description', '')}".lower()
    high = ["all vaccine", "eliminate", "prohibit", "ban", "compulsory", "mandatory", "statewide", "repeal", "remove all"]
    if any(s in text for s in high):
        return "High"
    if bill.get("status", 0) >= 2:
        return "High"
    return "Medium"


def normalize_bill(bill, state):
    title = bill.get("title", "")
    desc = bill.get("description", "")
    bill_type, stance, category = classify_bill(title, desc)
    status_label, is_active = determine_status(bill)
    impact = determine_impact(bill, bill_type)
    bill_number = bill.get("bill_number", "")
    bill_id = f"{state.upper()}-{bill_number.replace(' ', '').replace('.', '')}"

    sponsors = bill.get("sponsors", [])
    sponsor_text = ""
    if isinstance(sponsors, list) and sponsors:
        primary = [s for s in sponsors if isinstance(s, dict) and s.get("sponsor_type_id") == 1]
        if primary:
            sponsor_text = primary[0].get("name", "")
            party = primary[0].get("party", "")
            if party:
                sponsor_text += f" ({party})"
        elif isinstance(sponsors[0], dict):
            sponsor_text = sponsors[0].get("name", "")

    return {
        "billId": bill_id,
        "state": state.upper(),
        "billNumber": bill_number,
        "title": title,
        "status": status_label,
        "isActive": is_active,
        "billType": bill_type,
        "stance": stance,
        "category": category,
        "level": "Federal" if state.upper() == "US" else "State",
        "impact": impact,
        "summary": desc[:300] if desc else title,
        "sponsor": sponsor_text,
        "lastAction": bill.get("last_action", ""),
        "lastActionDate": bill.get("last_action_date", ""),
        "actionCount": 0,
        "stoppedWithAction": False,
        "sourceUrl": bill.get("url", "") or bill.get("state_link", ""),
        "legiscan_bill_id": bill.get("bill_id"),
    }


async def main():
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    all_bills = {}  # keyed by billId for dedup
    requests_used = 0

    print(f"LegiScan Quick Pull — searching {len(PRIORITY_STATES)} states × {len(SEARCH_QUERIES)} keywords")
    print(f"API Key: {API_KEY[:8]}...")
    print()

    async with httpx.AsyncClient() as client:
        # Phase 1: Search
        for state in PRIORITY_STATES:
            state_new = 0
            for query in SEARCH_QUERIES:
                if requests_used >= 500:
                    print(f"  Budget limit reached ({requests_used})")
                    break

                data = await api_call(client, "getSearch", state=state, query=query, year=2)
                requests_used += 1

                if data is None:
                    continue

                sr = data.get("searchresult", {})
                for key, val in sr.items():
                    if key == "summary":
                        continue
                    if not isinstance(val, dict) or not val.get("bill_id"):
                        continue

                    bn = val.get("bill_number", "")
                    bid = f"{state}-{bn.replace(' ', '').replace('.', '')}"
                    if bid in all_bills:
                        continue

                    relevance = val.get("relevance", 0)
                    if relevance and relevance < 50:
                        continue

                    # Relevance check: skip bills that don't mention health/science topics
                    bill_title = val.get("title", "")
                    if not is_relevant(bill_title):
                        continue

                    all_bills[bid] = {
                        "_legiscan_id": val.get("bill_id"),
                        "_state": state,
                        "title": val.get("title", ""),
                        "bill_number": bn,
                        "last_action": val.get("last_action", ""),
                        "last_action_date": val.get("last_action_date", ""),
                        "url": val.get("url", ""),
                        "relevance": relevance,
                    }
                    state_new += 1

            if state_new > 0:
                print(f"  {state}: {state_new} unique bills found")

        print(f"\nPhase 1 complete: {len(all_bills)} unique bills ({requests_used} API requests)")

        # Phase 2: Enrich top bills with full details
        candidates = sorted(all_bills.values(), key=lambda b: b.get("relevance", 0), reverse=True)
        max_enrich = min(len(candidates), 100)
        enriched = []

        print(f"Phase 2: Enriching top {max_enrich} bills with full details...")
        for entry in candidates[:max_enrich]:
            if requests_used >= 500:
                break

            lid = entry.get("_legiscan_id")
            if not lid:
                continue

            data = await api_call(client, "getBill", id=lid)
            requests_used += 1

            if data is None:
                # Fallback: use search data
                bill_type, stance, category = classify_bill(entry["title"])
                enriched.append({
                    "billId": f"{entry['_state']}-{entry['bill_number'].replace(' ', '').replace('.', '')}",
                    "state": entry["_state"],
                    "billNumber": entry["bill_number"],
                    "title": entry["title"],
                    "status": "Introduced",
                    "isActive": "Yes",
                    "billType": bill_type,
                    "stance": stance,
                    "category": category,
                    "level": "State",
                    "impact": "Medium",
                    "summary": entry["title"],
                    "sponsor": "",
                    "lastAction": entry.get("last_action", ""),
                    "lastActionDate": entry.get("last_action_date", ""),
                    "actionCount": 0,
                    "stoppedWithAction": False,
                    "sourceUrl": entry.get("url", ""),
                    "legiscan_bill_id": lid,
                })
                continue

            bill = data.get("bill", {})
            if bill:
                # Double-check relevance with full description
                desc = bill.get("description", "")
                title = bill.get("title", "")
                if not is_relevant(title, desc):
                    continue
                enriched.append(normalize_bill(bill, entry["_state"]))

        print(f"\nDone! {len(enriched)} bills enriched ({requests_used} total API requests)")

    # Write output
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "legiscan",
        "total": len(enriched),
        "bills": enriched,
    }

    out_path = data_dir / "bills.json"
    out_path.write_text(json.dumps(output, indent=2))
    print(f"Wrote {len(enriched)} bills to {out_path}")

    # Stats
    active = [b for b in enriched if b.get("isActive") == "Yes"]
    anti = [b for b in enriched if b.get("billType") == "anti"]
    pro = [b for b in enriched if b.get("billType") == "pro"]
    high = [b for b in enriched if b.get("impact") == "High"]
    print(f"\nBreakdown:")
    print(f"  Active: {len(active)}")
    print(f"  Anti-science: {len(anti)}")
    print(f"  Pro-science: {len(pro)}")
    print(f"  High impact: {len(high)}")

    states = set(b["state"] for b in enriched)
    print(f"  States covered: {', '.join(sorted(states))}")


if __name__ == "__main__":
    asyncio.run(main())
