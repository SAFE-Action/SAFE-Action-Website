"""Open States REST API integration for state legislator and bill data.

Uses the Open States v3 REST API (https://v3.openstates.org/) to fetch
structured legislator and bill data without browser crawling.  Falls back
gracefully when no API key is configured.

Bill search covers a 6-month lookback window across all priority states
using science/health keywords to catch legislation that may have been
introduced, amended, or reactivated.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..config import (
    OPENSTATES_API_KEY,
    OPENSTATES_BASE_URL,
    OPENSTATES_RATE_LIMIT,
    PRIORITY_STATES,
)
from ..utils.rate_limiter import RateLimiter

rate_limiter = RateLimiter(OPENSTATES_RATE_LIMIT)

# Open States uses lowercase two-letter jurisdiction abbreviations
# (they also accept full OCDID strings, but abbreviations work fine).

# Chamber mapping: Open States returns "upper" / "lower"; we normalise to
# the labels the rest of the pipeline expects.
_CHAMBER_MAP = {
    "upper": "Senate",
    "lower": "House",
}


# ── HTTP helpers ──────────────────────────────────────────────────────────

def _headers() -> dict[str, str]:
    return {"X-API-KEY": OPENSTATES_API_KEY, "Accept": "application/json"}


async def _get(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict | list | None:
    """Issue a rate-limited GET against the Open States API.

    Returns the parsed JSON body, or *None* on failure.
    """
    url = f"{OPENSTATES_BASE_URL}{path}"
    await rate_limiter.wait(url)

    try:
        resp = await client.get(url, params=params, headers=_headers(), timeout=30.0)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        print(f"  Open States API error {exc.response.status_code} for {url}")
        return None
    except httpx.RequestError as exc:
        print(f"  Open States request failed for {url}: {exc}")
        return None


# ── Legislators ──────────────────────────────────────────────────────────

def _normalize_person(person: dict[str, Any], state: str) -> dict:
    """Normalise an Open States person record to our LegislatorProfile schema."""
    current_role = _current_role(person)
    chamber_raw = current_role.get("org_classification", "") if current_role else ""
    chamber = _CHAMBER_MAP.get(chamber_raw, chamber_raw.title() if chamber_raw else "Unknown")
    district = current_role.get("district", "") if current_role else ""
    title = current_role.get("title", "") if current_role else ""

    name = person.get("name", "Unknown")
    party = _extract_party(person)

    # Build a stable ID consistent with the rest of the pipeline
    last_name = name.split()[-1] if name else "Unknown"
    id_parts = [state.upper(), "State", chamber, last_name]
    if district:
        id_parts.append(str(district))
    legislator_id = "-".join(id_parts).replace(" ", "-")

    # Contact info
    contact: dict[str, Any] = {}
    for link in person.get("links", []):
        url = link.get("url", "")
        if url:
            contact.setdefault("website", url)
    for office in person.get("offices", []):
        if office.get("voice"):
            contact.setdefault("phone", office["voice"])
        if office.get("email"):
            contact.setdefault("email", office["email"])
        if office.get("address"):
            contact.setdefault("address", office["address"])

    # Committee memberships (included when the API returns them)
    committees: list[dict[str, str]] = []
    for membership in person.get("committees", []):
        if isinstance(membership, dict):
            committees.append({
                "name": membership.get("name", ""),
                "role": membership.get("role", "member"),
            })

    return {
        "legislator_id": legislator_id,
        "name": name,
        "party": party,
        "state": state.upper(),
        "district": district,
        "chamber": chamber,
        "level": "State",
        "office": f"State {chamber}",
        "title": title,
        "committees": committees,
        "contact": contact,
        "photo_url": person.get("image", None),
        "openstates_id": person.get("id", ""),
        "source_urls": [
            link.get("url", "") for link in person.get("links", []) if link.get("url")
        ],
        "last_crawled": datetime.now(timezone.utc).isoformat(),
    }


def _current_role(person: dict) -> dict | None:
    """Return the person's current role, if any."""
    for role in person.get("current_role", []) if isinstance(person.get("current_role"), list) else [person.get("current_role", {})]:
        if role:
            return role
    return None


def _extract_party(person: dict) -> str:
    """Extract the primary party from an Open States person record."""
    # current_role sometimes carries the party directly
    role = _current_role(person)
    if role and role.get("party"):
        return role["party"]
    # Fall back to the party list (primary first)
    for p in person.get("party", []):
        if isinstance(p, dict):
            return p.get("name", "Unknown")
        if isinstance(p, str):
            return p
    return "Unknown"


async def fetch_legislators(state: str) -> list[dict]:
    """Fetch all current legislators for *state* from the Open States API.

    *state* is a two-letter abbreviation (e.g. ``"TX"``).  Returns a list
    of dicts conforming to our LegislatorProfile schema.
    """
    if not OPENSTATES_API_KEY:
        print(f"  Open States API key not configured, skipping {state}")
        return []

    async with httpx.AsyncClient() as client:
        # The people endpoint supports pagination; we loop until exhausted.
        legislators: list[dict] = []
        page = 1
        per_page = 50

        while True:
            data = await _get(client, "/people", params={
                "jurisdiction": state.lower(),
                "org_classification": "legislature",
                "include": "links,offices,other_names",
                "per_page": per_page,
                "page": page,
            })

            if data is None:
                break

            results = data.get("results", []) if isinstance(data, dict) else data
            if not results:
                break

            for person in results:
                legislators.append(_normalize_person(person, state))

            # Check if there are more pages
            pagination = data.get("pagination", {}) if isinstance(data, dict) else {}
            total_pages = pagination.get("max_page", page)
            if page >= total_pages:
                break
            page += 1

        print(f"  Open States: found {len(legislators)} legislators for {state}")
        return legislators


async def fetch_all_priority_legislators() -> list[dict]:
    """Fetch legislators for every state in :data:`PRIORITY_STATES`."""
    all_legislators: list[dict] = []
    for state in PRIORITY_STATES:
        print(f"  Fetching {state} via Open States API...")
        state_legs = await fetch_legislators(state)
        all_legislators.extend(state_legs)
    return all_legislators


# ── Bills ────────────────────────────────────────────────────────────────

def _normalize_bill(bill: dict[str, Any], state: str) -> dict:
    """Normalise an Open States bill record to a flat dict."""
    actions = bill.get("actions", [])
    last_action = None
    if actions:
        last = actions[-1] if isinstance(actions, list) else None
        if last and isinstance(last, dict):
            last_action = {
                "description": last.get("description", ""),
                "date": last.get("date", ""),
                "classification": last.get("classification", []),
            }

    sponsors = []
    for s in bill.get("sponsors", []):
        if isinstance(s, dict):
            sponsors.append({
                "name": s.get("name", ""),
                "classification": s.get("classification", ""),
                "primary": s.get("primary", False),
            })

    return {
        "bill_id": bill.get("id", ""),
        "identifier": bill.get("identifier", ""),
        "title": bill.get("title", ""),
        "state": state.upper(),
        "session": bill.get("session", ""),
        "chamber": _CHAMBER_MAP.get(
            bill.get("from_organization", {}).get("classification", ""), ""
        ) if isinstance(bill.get("from_organization"), dict) else "",
        "classification": bill.get("classification", []),
        "subject": bill.get("subject", []),
        "sponsors": sponsors,
        "last_action": last_action,
        "openstates_url": bill.get("openstates_url", ""),
        "sources": [s.get("url", "") for s in bill.get("sources", []) if isinstance(s, dict)],
        "created_at": bill.get("created_at", ""),
        "updated_at": bill.get("updated_at", ""),
    }


async def fetch_bills(state: str, query: str, created_since: str | None = None) -> list[dict]:
    """Search for bills in *state* matching *query*.

    *created_since* is an ISO date string (YYYY-MM-DD) to limit results
    to bills created on or after that date.

    Returns a list of normalised bill dicts.
    """
    if not OPENSTATES_API_KEY:
        print(f"  Open States API key not configured, skipping bill search for {state}")
        return []

    async with httpx.AsyncClient() as client:
        bills: list[dict] = []
        page = 1
        per_page = 20

        while True:
            params: dict[str, Any] = {
                "jurisdiction": state.lower(),
                "q": query,
                "include": "sponsors,actions,sources",
                "per_page": per_page,
                "page": page,
            }
            if created_since:
                params["created_since"] = created_since

            data = await _get(client, "/bills", params=params)

            if data is None:
                break

            results = data.get("results", []) if isinstance(data, dict) else data
            if not results:
                break

            for bill in results:
                bills.append(_normalize_bill(bill, state))

            pagination = data.get("pagination", {}) if isinstance(data, dict) else {}
            total_pages = pagination.get("max_page", page)
            if page >= total_pages:
                break
            page += 1

        return bills


# ── Science/health bill keywords ─────────────────────────────────────────

# Broad set of keywords to catch bills that relate to science, public
# health, vaccines, and medical freedom.  Each query is run per-state
# so we keep the list focused but comprehensive.
BILL_SEARCH_QUERIES = [
    "vaccine",
    "immunization",
    "vaccination",
    "public health",
    "fluoride",
    "medical freedom",
    "informed consent",
    "science education",
    "evolution",
    "climate",
    "environmental health",
    "pandemic",
    "quarantine",
    "raw milk",
    "health department",
    "health officer",
    "vaccine exemption",
    "religious exemption",
    "philosophical exemption",
    "vaccine mandate",
    "vaccine registry",
    "communicable disease",
    "childhood immunization",
    "school vaccination",
    "emergency health",
    "gain of function",
    "WHO treaty",
    "NIH funding",
    "CDC authority",
]


async def fetch_all_science_bills(lookback_months: int = 6) -> list[dict]:
    """Search every priority state for science/health bills from the last
    *lookback_months* months.

    Uses :data:`BILL_SEARCH_QUERIES` across all :data:`PRIORITY_STATES`,
    deduplicates by ``bill_id``, and returns a flat list.

    Respects the 1 req/sec rate limit (500 daily cap).  With 12 states
    and ~30 keywords that's up to 360 queries; pagination may add more.
    To stay within the daily cap the function tracks request count and
    stops early if it approaches the limit.
    """
    if not OPENSTATES_API_KEY:
        print("  Open States API key not configured, skipping bill search")
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30 * lookback_months)).strftime("%Y-%m-%d")
    print(f"  Bill search window: {cutoff} → today")

    all_bills: dict[str, dict] = {}  # keyed by bill_id for dedup
    request_budget = 450  # stay safely under the 500/day cap
    requests_used = 0

    async with httpx.AsyncClient() as client:
        for state in PRIORITY_STATES:
            state_new = 0
            for query in BILL_SEARCH_QUERIES:
                if requests_used >= request_budget:
                    print(f"  ⚠ Approaching daily request limit ({requests_used}), stopping bill search")
                    break

                # Paginate through results for this state+query combo
                page = 1
                per_page = 20
                while True:
                    params: dict[str, Any] = {
                        "jurisdiction": state.lower(),
                        "q": query,
                        "include": "sponsors,actions,sources",
                        "per_page": per_page,
                        "page": page,
                        "created_since": cutoff,
                    }
                    data = await _get(client, "/bills", params=params)
                    requests_used += 1

                    if data is None:
                        break

                    results = data.get("results", []) if isinstance(data, dict) else data
                    if not results:
                        break

                    for bill in results:
                        normalized = _normalize_bill(bill, state)
                        bid = normalized.get("bill_id", "")
                        if bid and bid not in all_bills:
                            all_bills[bid] = normalized
                            state_new += 1

                    # Check pagination
                    pagination = data.get("pagination", {}) if isinstance(data, dict) else {}
                    total_pages = pagination.get("max_page", page)
                    if page >= total_pages:
                        break
                    page += 1
                    if requests_used >= request_budget:
                        break

            if state_new > 0:
                print(f"  Open States: {state} → {state_new} unique bills")

            if requests_used >= request_budget:
                break

    bills_list = list(all_bills.values())
    print(f"  Open States bill search complete: {len(bills_list)} unique bills across {len(PRIORITY_STATES)} states ({requests_used} API requests used)")
    return bills_list
