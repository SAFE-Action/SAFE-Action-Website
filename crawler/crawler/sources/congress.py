"""Fetch federal legislator data from the unitedstates.io open dataset.

Uses the maintained @unitedstates/congress-legislators project:
  https://github.com/unitedstates/congress-legislators

No API key required. No LLM needed. Structured JSON data with:
- All current members of Congress (535 legislators)
- Committee memberships with roles (chair, ranking member, etc.)
- Contact info, photos, and biographical data
"""

import asyncio
from datetime import datetime, timezone

import httpx

BASE_URL = "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages"
LEGISLATORS_URL = f"{BASE_URL}/legislators-current.json"
COMMITTEES_URL = f"{BASE_URL}/committees-current.json"
MEMBERSHIP_URL = f"{BASE_URL}/committee-membership-current.json"

# Fallback URLs (raw GitHub) if theunitedstates.io is down
# YAML source is on main branch; fallback parses YAML if JSON unavailable
GH_BASE = "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages"
# Fallback not needed since we use gh-pages for both


async def _fetch_json(client: httpx.AsyncClient, url: str, fallback: str | None = None) -> list | dict | None:
    """Download and parse a JSON file, with optional fallback URL."""
    for attempt_url in [url] + ([fallback] if fallback else []):
        try:
            resp = await client.get(attempt_url, timeout=30.0, follow_redirects=True)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, Exception) as e:
            print(f"  Warning: Failed to fetch {attempt_url}: {e}")
    return None


async def crawl_congress_members() -> list[dict]:
    """Fetch all current Congress members from the unitedstates.io dataset."""
    now = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient() as client:
        # Fetch all three datasets in parallel
        legislators_data, committees_data, membership_data = await asyncio.gather(
            _fetch_json(client, LEGISLATORS_URL),
            _fetch_json(client, COMMITTEES_URL),
            _fetch_json(client, MEMBERSHIP_URL),
        )

    if not legislators_data:
        print("  ERROR: Could not fetch legislators data")
        return []

    # Build committee name lookup: committee_id -> name
    committee_names: dict[str, str] = {}
    if committees_data and isinstance(committees_data, list):
        for comm in committees_data:
            cid = comm.get("thomas_id", "")
            if cid:
                committee_names[cid] = comm.get("name", cid)
            for sub in comm.get("subcommittees", []):
                sub_id = f"{cid}{sub.get('thomas_id', '')}"
                committee_names[sub_id] = f"{comm.get('name', '')} - {sub.get('name', '')}"

    # Build reverse membership lookup: bioguide_id -> [{name, role}]
    member_committees: dict[str, list[dict]] = {}
    if membership_data and isinstance(membership_data, dict):
        for comm_id, members_list in membership_data.items():
            comm_name = committee_names.get(comm_id, comm_id)
            if not isinstance(members_list, list):
                continue
            for m in members_list:
                bio_id = m.get("bioguide", "")
                if not bio_id:
                    continue
                member_committees.setdefault(bio_id, []).append({
                    "name": comm_name,
                    "role": m.get("title", "member"),
                })

    # Process legislators
    members = []
    for leg in legislators_data:
        if not isinstance(leg, dict):
            continue

        terms = leg.get("terms", [])
        if not terms:
            continue
        current_term = terms[-1]

        # Determine chamber
        term_type = current_term.get("type", "")
        if term_type == "sen":
            chamber = "Senate"
        elif term_type == "rep":
            chamber = "House"
        else:
            continue

        # Name
        name_data = leg.get("name", {})
        name = (
            name_data.get("official_full", "")
            or f"{name_data.get('first', '')} {name_data.get('last', '')}".strip()
        )
        if not name:
            continue

        # IDs
        ids = leg.get("id", {})
        bioguide = ids.get("bioguide", "")

        state = current_term.get("state", "XX")
        district = str(current_term.get("district", "")) if current_term.get("district") else ""
        party = current_term.get("party", "Unknown")

        # Contact info
        contact: dict[str, str] = {}
        if current_term.get("phone"):
            contact["phone"] = current_term["phone"]
        if current_term.get("url"):
            contact["website"] = current_term["url"]
        if current_term.get("contact_form"):
            contact["contact_form"] = current_term["contact_form"]
        if current_term.get("address"):
            contact["address"] = current_term["address"]

        # Committees
        committees = member_committees.get(bioguide, [])

        # Stable legislator ID
        last_name = name.split()[-1] if name else "Unknown"
        id_parts = [state, chamber, last_name]
        if district:
            id_parts.append(district)
        legislator_id = "-".join(id_parts).replace(" ", "-")

        member = {
            "legislator_id": legislator_id,
            "bioguide_id": bioguide,
            "name": name,
            "party": party,
            "state": state,
            "district": district,
            "chamber": chamber,
            "level": "Federal",
            "office": f"U.S. {chamber}",
            "committees": committees,
            "contact": contact,
            "photo_url": f"https://theunitedstates.io/images/congress/225x275/{bioguide}.jpg" if bioguide else None,
            "source_urls": [current_term.get("url", "")],
            "last_crawled": now,
        }

        members.append(member)

    print(f"  Found {len(members)} federal legislators")
    return members


async def crawl_member_detail(member: dict) -> dict | None:
    """No-op: all member details are included in the dataset."""
    return None
