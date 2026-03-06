"""Populate seats.json with incumbent and candidate data from public APIs.

Phase 1: Congress.gov API for all 435 House + 100 Senate incumbents
Phase 2: FEC API for 2026 candidate filings
Phase 3: (Future) State-level data from Ballotpedia/Civic API

Usage: python crawler/populate_candidates.py
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

DATA_DIR = Path(__file__).parent.parent / "data"
RATE_LIMIT = 0.35  # seconds between requests

last_request = 0


async def rate_limited_get(client, url, **kwargs):
    global last_request
    elapsed = time.time() - last_request
    if elapsed < RATE_LIMIT:
        await asyncio.sleep(RATE_LIMIT - elapsed)
    try:
        resp = await client.get(url, timeout=30.0, **kwargs)
        last_request = time.time()
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  Request failed: {e}")
        return None


# ── Phase 1: Congress.gov API ─────────────────────────────────────────────
# Free API, no key required for basic member listings
# https://api.congress.gov/v3/member

CONGRESS_API = "https://api.congress.gov/v3"
CONGRESS_API_KEY = "ioZ2kWqXLnTjfJMU8lNWOWWXNaiSf8s6Gq0xkDXv"  # public demo key from docs


async def fetch_all_congress_members(client):
    """Fetch all current members of Congress."""
    members = []
    offset = 0
    limit = 250

    while True:
        url = f"{CONGRESS_API}/member"
        params = {
            "api_key": CONGRESS_API_KEY,
            "limit": limit,
            "offset": offset,
            "format": "json",
            "currentMember": "true",
        }

        data = await rate_limited_get(client, url, params=params)
        if data is None:
            break

        batch = data.get("members", [])
        if not batch:
            break

        members.extend(batch)
        print(f"  Fetched {len(members)} members so far...")

        # Check pagination
        pagination = data.get("pagination", {})
        total = pagination.get("count", 0)
        if offset + limit >= total:
            break
        offset += limit

    print(f"  Total Congress members fetched: {len(members)}")
    return members


def match_congress_to_seats(members, seats):
    """Match Congress.gov member data to seat entries."""
    matched = 0
    seat_map = {s["seatId"]: s for s in seats}

    for member in members:
        name = member.get("name", "")
        party_code = member.get("partyName", "")
        state = member.get("state", "")
        district = member.get("district")
        terms = member.get("terms", {}).get("item", [])

        # Parse party
        if "Republican" in party_code:
            party = "R"
        elif "Democrat" in party_code:
            party = "D"
        elif "Independent" in party_code:
            party = "I"
        else:
            party = party_code[:1] if party_code else "?"

        # Determine chamber from most recent term
        chamber = ""
        if terms:
            latest = terms[-1] if isinstance(terms, list) else terms
            chamber = latest.get("chamber", "")

        # Match to seat
        if chamber == "House of Representatives" or (district is not None and district > 0):
            # House member
            if district and district > 0:
                seat_id = f"US-HOUSE-{state}-{district:02d}"
            else:
                seat_id = f"US-HOUSE-{state}-AL"

            if seat_id in seat_map:
                seat_map[seat_id]["incumbent"] = {
                    "name": name,
                    "party": party,
                    "bioguideId": member.get("bioguideId", ""),
                }
                matched += 1

        elif chamber == "Senate":
            # Try to match to Class II seat
            seat_id = f"US-SENATE-{state}-II"
            if seat_id in seat_map:
                # Check if this is actually the Class II senator
                # The Class II data already has incumbents, so verify/update
                existing = seat_map[seat_id].get("incumbent", {})
                if existing and existing.get("name"):
                    # Already have incumbent from our static data
                    # Add bioguideId if available
                    existing["bioguideId"] = member.get("bioguideId", "")
                else:
                    seat_map[seat_id]["incumbent"] = {
                        "name": name,
                        "party": party,
                        "bioguideId": member.get("bioguideId", ""),
                    }
                matched += 1

    print(f"  Matched {matched} Congress members to seats")
    return seats


# ── Phase 2: FEC API ──────────────────────────────────────────────────────
# Free API - https://api.open.fec.gov/
# Get candidates who have filed for 2026

FEC_API = "https://api.open.fec.gov/v1"
FEC_API_KEY = "DEMO_KEY"  # Free demo key, 1000 requests/hr


async def fetch_fec_candidates(client, state=None, office="H"):
    """Fetch 2026 candidate filings from FEC.

    office: H=House, S=Senate, P=President
    """
    candidates = []
    page = 1

    while True:
        url = f"{FEC_API}/candidates/"
        params = {
            "api_key": FEC_API_KEY,
            "election_year": 2026,
            "office": office,
            "sort": "name",
            "per_page": 100,
            "page": page,
            "is_active_candidate": "true",
        }
        if state:
            params["state"] = state

        data = await rate_limited_get(client, url, params=params)
        if data is None:
            break

        batch = data.get("results", [])
        if not batch:
            break

        candidates.extend(batch)

        pagination = data.get("pagination", {})
        total_pages = pagination.get("pages", 1)
        if page >= total_pages:
            break
        page += 1

    return candidates


async def populate_fec_candidates(client, seats):
    """Fetch FEC filings and match to seats."""
    seat_map = {s["seatId"]: s for s in seats}

    # Fetch House candidates
    print("  Fetching FEC House candidate filings for 2026...")
    house_candidates = await fetch_fec_candidates(client, office="H")
    print(f"  Found {len(house_candidates)} House candidates filed with FEC")

    for c in house_candidates:
        state = c.get("state", "")
        district = c.get("district", "")
        name = c.get("name", "")
        party = c.get("party", "")
        candidate_id = c.get("candidate_id", "")

        if not state or not district:
            continue

        # Parse district number
        try:
            dist_num = int(district)
            seat_id = f"US-HOUSE-{state}-{dist_num:02d}" if dist_num > 0 else f"US-HOUSE-{state}-AL"
        except ValueError:
            seat_id = f"US-HOUSE-{state}-AL"

        if seat_id in seat_map:
            # Check if already in candidates list
            existing_ids = [x.get("fecId") for x in seat_map[seat_id]["candidates"]]
            if candidate_id not in existing_ids:
                # Format name from "LAST, FIRST" to "First Last"
                formatted_name = name
                if "," in name:
                    parts = name.split(",", 1)
                    last = parts[0].strip().title()
                    first = parts[1].strip().title() if len(parts) > 1 else ""
                    formatted_name = f"{first} {last}".strip()

                party_short = party[0] if party else "?"

                seat_map[seat_id]["candidates"].append({
                    "name": formatted_name,
                    "party": party_short,
                    "fecId": candidate_id,
                    "source": "fec",
                })

    # Fetch Senate candidates
    print("  Fetching FEC Senate candidate filings for 2026...")
    senate_candidates = await fetch_fec_candidates(client, office="S")
    print(f"  Found {len(senate_candidates)} Senate candidates filed with FEC")

    for c in senate_candidates:
        state = c.get("state", "")
        name = c.get("name", "")
        party = c.get("party", "")
        candidate_id = c.get("candidate_id", "")

        if not state:
            continue

        seat_id = f"US-SENATE-{state}-II"
        if seat_id not in seat_map:
            continue

        existing_ids = [x.get("fecId") for x in seat_map[seat_id]["candidates"]]
        if candidate_id not in existing_ids:
            formatted_name = name
            if "," in name:
                parts = name.split(",", 1)
                last = parts[0].strip().title()
                first = parts[1].strip().title() if len(parts) > 1 else ""
                formatted_name = f"{first} {last}".strip()

            party_short = party[0] if party else "?"

            seat_map[seat_id]["candidates"].append({
                "name": formatted_name,
                "party": party_short,
                "fecId": candidate_id,
                "source": "fec",
            })

    # Count populated
    house_with_candidates = sum(1 for s in seats if s["body"] == "US House" and s["candidates"])
    senate_with_candidates = sum(1 for s in seats if s["body"] == "US Senate" and s["candidates"])
    total_candidates = sum(len(s["candidates"]) for s in seats)
    print(f"  {total_candidates} total candidates mapped to {house_with_candidates} House + {senate_with_candidates} Senate seats")

    return seats


async def main():
    seats_path = DATA_DIR / "seats.json"
    if not seats_path.exists():
        print("ERROR: Run build_seats.py first to generate the seat map")
        return

    seats_data = json.loads(seats_path.read_text())
    seats = seats_data["seats"]
    print(f"Loaded {len(seats)} seats from seats.json")

    async with httpx.AsyncClient() as client:
        # Phase 1: Congress members (incumbents)
        print("\n--- Phase 1: Congress.gov Members ---")
        members = await fetch_all_congress_members(client)
        if members:
            seats = match_congress_to_seats(members, seats)

        # Phase 2: FEC candidate filings
        print("\n--- Phase 2: FEC Candidate Filings ---")
        seats = await populate_fec_candidates(client, seats)

    # Update and write output
    seats_data["seats"] = seats
    seats_data["generated_at"] = datetime.now(timezone.utc).isoformat()
    seats_data["candidates_populated_at"] = datetime.now(timezone.utc).isoformat()

    # Recount stats
    total_with_incumbent = sum(1 for s in seats if s.get("incumbent"))
    total_with_candidates = sum(1 for s in seats if s.get("candidates"))
    total_candidates = sum(len(s.get("candidates", [])) for s in seats)

    seats_data["population_stats"] = {
        "seats_with_incumbent": total_with_incumbent,
        "seats_with_candidates": total_with_candidates,
        "total_candidates_filed": total_candidates,
    }

    seats_path.write_text(json.dumps(seats_data, indent=2))
    print(f"\nFinal stats:")
    print(f"  Seats with incumbent data: {total_with_incumbent}")
    print(f"  Seats with filed candidates: {total_with_candidates}")
    print(f"  Total candidates: {total_candidates}")
    print(f"\nWrote updated seats.json")


if __name__ == "__main__":
    asyncio.run(main())
