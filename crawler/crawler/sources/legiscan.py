"""LegiScan API integration for state and federal bill tracking.

Uses the LegiScan Pull API (https://legiscan.com/legiscan) to search for
and fetch detailed bill data across all 50 states + Congress.  The free
tier allows 30,000 requests per 30-day rolling window — more than enough
for daily refreshes of ~50-100 tracked bills plus periodic keyword searches.

Bill data is normalised to the same schema used by the SAFE Action website
(``data/bills.json``), including SAFE-specific fields like ``billType``,
``stance``, ``isActive``, and ``category``.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import (
    LEGISCAN_API_KEY,
    LEGISCAN_BASE_URL,
    LEGISCAN_RATE_LIMIT,
    PRIORITY_STATES,
)
from ..utils.rate_limiter import RateLimiter

rate_limiter = RateLimiter(LEGISCAN_RATE_LIMIT)

# ── Keywords that signal science/health/vaccine bills ───────────────────

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
    "vaccine registry",
    "vaccine injury",
    "religious exemption vaccine",
    "philosophical exemption",
    "communicable disease",
    "quarantine",
    "fluoride",
    "raw milk",
    "health officer authority",
    "pandemic preparedness",
]

# ── Heuristic classification ───────────────────────────────────────────

# ── Core topics that qualify for anti-science classification ──────────
# Only bills explicitly about these topics get classified as anti/pro.
# Everything else found via search is classified as "monitor".
# Based on AP/Plural Policy analysis of 420+ curated anti-science bills.
_CORE_TOPICS = [
    # Vaccines (350+ bills tracked by AP in 2025)
    "vaccine", "vaccination", "immunization", "immunize", "unvaccinated",
    # Raw milk (part of 70+ bills)
    "raw milk", "unpasteurized milk", "unpasteurised milk",
    # Fluoride (part of 70+ bills)
    "fluoride", "fluoridation", "water fluorid",
    # mRNA / anti-vaccine coded language
    "mrna", "mRNA",
    # Geoengineering / chemtrails (FL made it a felony)
    "geoengineering", "chemtrail",
]

# Anti-science keywords — expanded from AP/Plural Policy curated bill patterns.
# Anti-vaccine activists use coded language like "informed consent", "medical
# freedom", "health freedom", and even designate mRNA vaccines as "weapons of
# mass destruction" (MN SF 3456).
_ANTI_KEYWORDS = [
    # Exemption expansion (most common category)
    "exemption", "exempt", "religious exemption", "philosophical exemption",
    "personal belief", "conscience", "nonmedical exemption",
    "opt out", "opt-out", "voluntary",
    # "Freedom" framing
    "medical freedom", "freedom act", "health freedom",
    "right to refuse", "bodily autonomy", "personal liberty",
    "informed health decision",
    # Anti-mandate
    "prohibit mandate", "prohibit vaccination", "ban mandate",
    "prohibit require", "eliminate requirement", "remove requirement",
    # Informed consent (primary coded language per user feedback)
    "informed consent",
    # Anti-vaccine discrimination protections
    "discrimination against unvaccinated", "vaccine status",
    "vaccination status discrimination",
    # Vaccine injury / liability
    "vaccine injury", "vaccine harm", "injury compensation",
    "liability", "criminal offense of vaccine",
    # mRNA reclassification (MN SF 3456 pattern)
    "weapons of mass destruction", "gene therapy", "experimental",
    "biological agent",
    # Waiting periods / blood bank testing
    "vaccine waiting period", "blood bank",
    # Fluoride opposition
    "ban fluoride", "prohibit fluoride", "remove fluoride",
    "fluoride choice",
    # Raw milk expansion
    "raw milk sales", "real milk", "unpasteurized sales",
    # Parental rights framing
    "parental rights", "parent right",
    # Vaccine passport (surveillance concern)
    "vaccine passport", "vaccination passport",
    # Vaccination status (same intent as "vaccine status")
    "vaccination status",
    # "No mandates" pattern (opposing mandates)
    "no mandate",
    # Repeal existing vaccine requirements
    "repeal",
    # Prohibition pattern (banning vaccine requirements, fluoride, etc.)
    "prohibition",
    # Unprofessional conduct (penalizing pro-vaccine doctors)
    "unprofessional conduct",
    # Specific anti patterns
    "vaccine injured",
    "harmful vaccine",
    "vaccine carveout",
    "non-discrimination",
    "no vaccine mandate",
    "no vaccination mandate",
    "no immunization mandate",
]

# Pro-science keywords
_PRO_KEYWORDS = [
    # Vaccine strengthening
    "strengthen immunization", "require vaccination", "require immunization",
    "safeguard vaccine", "protect public health",
    "limit exemption", "remove exemption", "tighten exemption",
    "eliminate exemption", "restrict exemption",
    "vaccine access", "expand vaccine",
    "immunization registry", "disease surveillance", "outbreak response",
    # Fluoride support
    "fluoridation program", "community water fluoridation",
    "optimal fluoride", "dental health",
    # Pasteurization support
    "pasteurization", "pasteurized", "food safety standard",
    # Science education
    "evidence-based", "science-based",
    # Funding / access expansion
    "fund research", "fund vaccine", "vaccine program",
    "vaccination program", "immunization program",
    "vaccination strategy", "vaccine strategy",
    "vaccine transportation",
]

# Category detection from title/description
# Expanded with patterns from AP/Plural Policy bill tracking
_CATEGORY_PATTERNS = {
    "vaccine-exemption": ["exemption", "exempt", "opt out", "opt-out",
                          "nonmedical", "personal belief", "philosophical",
                          "religious exemption", "conscience"],
    "vaccine-mandate": ["mandate", "require", "requirement", "compulsory",
                        "prohibit mandate", "ban mandate"],
    "medical-freedom": ["medical freedom", "freedom act", "health freedom",
                        "bodily autonomy", "right to refuse", "personal liberty"],
    "informed-consent": ["informed consent", "informed health decision"],
    "vaccine-discrimination": ["discrimination", "vaccine status",
                               "unvaccinated", "vaccination status"],
    "mRNA-reclassification": ["mrna", "mRNA", "gene therapy",
                              "weapons of mass destruction", "biological agent"],
    "vaccine-injury": ["vaccine injury", "vaccine harm", "injury compensation",
                       "liability", "adverse event"],
    "raw-milk": ["raw milk", "unpasteurized", "unpasteurised", "real milk",
                 "donkey milk"],
    "fluoride": ["fluoride", "fluoridation", "fluoride choice"],
    "geoengineering": ["geoengineering", "chemtrail", "cloud seeding"],
    "public-health": ["public health", "disease surveillance", "outbreak",
                      "immunization registry", "quarantine"],
}

# Status mapping from LegiScan status codes to our labels
_STATUS_MAP = {
    1: "Introduced",
    2: "In Committee",         # Engrossed (passed originating chamber)
    3: "Passed One Chamber",   # Enrolled (passed both chambers)
    4: "Passed Both Chambers",
    5: "Vetoed",
    6: "Signed into Law",      # Enacted (sometimes)
}

# LegiScan progress codes for active/dead determination
_DEAD_PROGRESS = {0}  # 0 = not available / dead
_ENACTED_PROGRESS = {4}  # 4 = enacted/signed


def _classify_bill(title: str, description: str = "") -> tuple[str, str, str]:
    """Classify a bill as pro/anti science and assign a category.

    Returns (billType, stance, category).

    STRICT CLASSIFICATION: Only bills explicitly about vaccines, raw milk,
    or fluoride are classified as anti/pro-science. All other health-related
    bills are classified as "monitor" to avoid false positives.
    """
    text = f"{title} {description}".lower()

    # Determine category first
    category = "public-health"  # default
    best_score = 0
    for cat, patterns in _CATEGORY_PATTERNS.items():
        score = sum(1 for p in patterns if p in text)
        if score > best_score:
            best_score = score
            category = cat

    # GATE: Only classify as anti/pro if bill is about core topics
    is_core_topic = any(topic.lower() in text for topic in _CORE_TOPICS)

    if not is_core_topic:
        # Not about vaccines, raw milk, or fluoride — track but don't label
        return "monitor", "Monitor", category

    # For core-topic bills, use keyword scoring
    anti_score = sum(1 for kw in _ANTI_KEYWORDS if kw in text)
    pro_score = sum(1 for kw in _PRO_KEYWORDS if kw in text)

    if pro_score > anti_score:
        bill_type = "pro"
        stance = "Support"
    elif anti_score > 0:
        bill_type = "anti"
        stance = "Oppose"
    else:
        # Core topic but no clear anti/pro signals — monitor
        bill_type = "monitor"
        stance = "Monitor"

    return bill_type, stance, category


def _determine_status(bill: dict) -> tuple[str, str]:
    """Determine human-readable status and isActive from LegiScan data.

    Returns (status_label, isActive).
    """
    status_id = bill.get("status", 0)
    progress = bill.get("progress", [])

    # Check progress events for more detail
    last_progress = 0
    if isinstance(progress, list) and progress:
        last_progress = max(p.get("event", 0) if isinstance(p, dict) else (p if isinstance(p, int) else 0)
                           for p in progress)

    status_label = _STATUS_MAP.get(status_id, "Introduced")

    # Override with more specific labels from last action
    last_action = bill.get("last_action", "")
    la_lower = last_action.lower() if last_action else ""

    if "signed" in la_lower or "enacted" in la_lower or "approved" in la_lower:
        status_label = "Signed into Law"
    elif "vetoed" in la_lower or "veto" in la_lower:
        status_label = "Vetoed"
    elif "died" in la_lower or "failed" in la_lower or "tabled" in la_lower:
        status_label = "Died in Committee"
    elif "withdrawn" in la_lower:
        status_label = "Withdrawn"
    elif "passed" in la_lower and ("senate" in la_lower or "house" in la_lower):
        status_label = "Passed One Chamber"
    elif "floor" in la_lower or "third reading" in la_lower:
        status_label = "Floor Vote Scheduled"
    elif "committee" in la_lower and ("referred" in la_lower or "assigned" in la_lower):
        status_label = "In Committee"
    elif "filed" in la_lower or "prefiled" in la_lower or "introduced" in la_lower:
        status_label = "Introduced"

    # Determine if active
    dead_statuses = {"Vetoed", "Died in Committee", "Tabled", "Withdrawn", "Signed into Law"}
    is_active = "No" if status_label in dead_statuses else "Yes"

    return status_label, is_active


def _determine_impact(bill: dict, bill_type: str) -> str:
    """3-tier impact scoring based on bill language, status, and momentum."""
    title = (bill.get("title") or "").lower()
    desc = (bill.get("description") or "").lower()
    text = f"{title} {desc}"
    status = bill.get("status", 0)
    sponsors = bill.get("sponsors", [])
    sponsor_count = len(sponsors) if isinstance(sponsors, list) else 0
    last_action = bill.get("last_action", "")
    last_action_date = bill.get("last_action_date", "")

    # HIGH: aggressive language, advanced status, or strong co-sponsorship
    high_signals = [
        "all vaccine", "eliminate", "prohibit", "ban",
        "compulsory", "mandatory", "statewide",
        "all school", "every child", "all children",
        "repeal", "remove all", "abolish",
        "weapons of mass destruction", "gene therapy",
        "criminal penalty", "felony", "misdemeanor",
    ]
    if any(s in text for s in high_signals):
        return "High"
    if status >= 2:  # engrossed or further
        return "High"
    if sponsor_count >= 5:
        return "High"

    # LOW: stalled, no recent action, single sponsor just introduced
    if last_action_date:
        try:
            from datetime import datetime as _dt
            action_dt = _dt.strptime(last_action_date[:10], "%Y-%m-%d")
            days_since = (_dt.now() - action_dt).days
            if days_since > 90 and status <= 1:
                return "Low"
        except (ValueError, TypeError):
            pass

    if sponsor_count <= 1 and status <= 1:
        la = (last_action or "").lower()
        if "introduced" in la or "referred" in la or "filed" in la:
            return "Low"

    # MEDIUM: active but not yet critical
    return "Medium"


def _normalize_bill(bill: dict, state: str) -> dict:
    """Normalise a LegiScan bill record to the SAFE Action bills.json schema."""
    title = bill.get("title", "")
    description = bill.get("description", "")
    bill_type, stance, category = _classify_bill(title, description)
    status_label, is_active = _determine_status(bill)
    impact = _determine_impact(bill, bill_type)

    bill_number = bill.get("bill_number", "")
    bill_id_str = f"{state.upper()}-{bill_number.replace(' ', '').replace('.', '')}"

    # Sponsor info
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

    # Last action
    last_action = bill.get("last_action", "")
    last_action_date = bill.get("last_action_date", "")

    # Source URL
    source_url = bill.get("url", "") or bill.get("state_link", "")
    legiscan_url = f"https://legiscan.com/{state.upper()}/bill/{bill_number.replace(' ', '').replace('.', '')}/{bill.get('session', {}).get('session_name', '')}"

    return {
        "billId": bill_id_str,
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
        "summary": description[:300] if description else title,
        "sponsor": sponsor_text,
        "lastAction": last_action,
        "lastActionDate": last_action_date,
        "actionCount": 0,
        "stoppedWithAction": False,
        "sourceUrl": source_url or legiscan_url,
        "legiscan_bill_id": bill.get("bill_id"),
    }


# ── HTTP helpers ──────────────────────────────────────────────────────────

async def _api_call(client: httpx.AsyncClient, op: str, **params) -> dict | None:
    """Issue a rate-limited GET against the LegiScan API.

    Returns the parsed JSON body, or None on failure.
    """
    await rate_limiter.wait(LEGISCAN_BASE_URL)

    query_params = {
        "key": LEGISCAN_API_KEY,
        "op": op,
        **params,
    }

    try:
        resp = await client.get(LEGISCAN_BASE_URL, params=query_params, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()

        if data.get("status") == "ERROR":
            print(f"  LegiScan API error: {data.get('alert', {}).get('message', 'Unknown error')}")
            return None

        return data
    except httpx.HTTPStatusError as exc:
        print(f"  LegiScan API HTTP error {exc.response.status_code}")
        return None
    except httpx.RequestError as exc:
        print(f"  LegiScan request failed: {exc}")
        return None


# ── Bill search ──────────────────────────────────────────────────────────

async def search_bills(state: str, query: str, year: int = 2) -> list[dict]:
    """Search for bills in *state* matching *query*.

    *year* controls the session scope:
      1 = current session only
      2 = current + prior session (default)
      3 = all available sessions

    Returns a list of raw LegiScan search result entries.
    """
    if not LEGISCAN_API_KEY:
        return []

    async with httpx.AsyncClient() as client:
        data = await _api_call(client, "getSearch",
                               state=state.upper(),
                               query=query,
                               year=year)

        if data is None:
            return []

        searchresult = data.get("searchresult", {})
        # searchresult contains numeric keys for results + "summary"
        results = []
        for key, val in searchresult.items():
            if key == "summary":
                continue
            if isinstance(val, dict) and val.get("bill_id"):
                results.append(val)

        return results


async def get_bill_detail(bill_id: int) -> dict | None:
    """Fetch full details for a specific bill by its LegiScan bill_id."""
    if not LEGISCAN_API_KEY:
        return None

    async with httpx.AsyncClient() as client:
        data = await _api_call(client, "getBill", id=bill_id)
        if data is None:
            return None
        return data.get("bill", {})


async def fetch_all_science_bills(states: list[str] | None = None) -> list[dict]:
    """Search all priority states for science/health bills via LegiScan.

    Returns normalised bill dicts matching the SAFE Action bills.json schema.
    Deduplicates by billId. Tracks API request count to stay within budget.
    """
    if not LEGISCAN_API_KEY:
        print("  LegiScan API key not configured, skipping bill search")
        return []

    target_states = states or PRIORITY_STATES
    all_bills: dict[str, dict] = {}  # keyed by billId for dedup
    request_budget = 800  # conservative limit per run (30k/month ÷ 30 days = 1k/day)
    requests_used = 0
    bills_enriched = 0

    async with httpx.AsyncClient() as client:
        # Phase 1: Search for bills across states and keywords
        for state in target_states:
            if requests_used >= request_budget:
                print(f"  ⚠ Approaching request budget ({requests_used}), stopping search")
                break

            state_new = 0
            for query in SEARCH_QUERIES:
                if requests_used >= request_budget:
                    break

                data = await _api_call(client, "getSearch",
                                       state=state.upper(),
                                       query=query,
                                       year=2)  # current + prior session
                requests_used += 1

                if data is None:
                    continue

                searchresult = data.get("searchresult", {})
                for key, val in searchresult.items():
                    if key == "summary":
                        continue
                    if not isinstance(val, dict) or not val.get("bill_id"):
                        continue

                    # Quick normalize from search result (limited data)
                    bill_number = val.get("bill_number", "")
                    bill_id_str = f"{state.upper()}-{bill_number.replace(' ', '').replace('.', '')}"

                    if bill_id_str in all_bills:
                        continue  # already have this bill

                    title = val.get("title", "")
                    relevance = val.get("relevance", 0)

                    # Only include bills with reasonable relevance
                    if relevance and relevance < 50:
                        continue

                    all_bills[bill_id_str] = {
                        "_legiscan_bill_id": val.get("bill_id"),
                        "_search_state": state.upper(),
                        "billId": bill_id_str,
                        "state": state.upper(),
                        "billNumber": bill_number,
                        "title": title,
                        "lastActionDate": val.get("last_action_date", ""),
                        "lastAction": val.get("last_action", ""),
                        "sourceUrl": val.get("url", ""),
                        "relevance": relevance,
                    }
                    state_new += 1

            if state_new > 0:
                print(f"  LegiScan: {state} → {state_new} unique bills")

        # Phase 2: Fetch full details for top bills
        # Sort by relevance (highest first) and enrich the most relevant
        candidates = sorted(
            all_bills.values(),
            key=lambda b: b.get("relevance", 0),
            reverse=True,
        )

        enriched_bills: dict[str, dict] = {}
        max_enrich = min(len(candidates), 150)  # cap enrichment to control API usage

        print(f"  Enriching top {max_enrich} bills with full details...")
        for entry in candidates[:max_enrich]:
            if requests_used >= request_budget:
                print(f"  ⚠ Budget reached ({requests_used}), stopping enrichment")
                break

            legiscan_id = entry.get("_legiscan_bill_id")
            if not legiscan_id:
                continue

            data = await _api_call(client, "getBill", id=legiscan_id)
            requests_used += 1

            if data is None:
                # Use search-result data as fallback
                bill_type, stance, category = _classify_bill(entry.get("title", ""))
                enriched_bills[entry["billId"]] = {
                    "billId": entry["billId"],
                    "state": entry["state"],
                    "billNumber": entry["billNumber"],
                    "title": entry["title"],
                    "status": "Introduced",
                    "isActive": "Yes",
                    "billType": bill_type,
                    "stance": stance,
                    "category": category,
                    "level": "Federal" if entry["state"] == "US" else "State",
                    "impact": "Medium",
                    "summary": entry["title"],
                    "sponsor": "",
                    "lastAction": entry.get("lastAction", ""),
                    "lastActionDate": entry.get("lastActionDate", ""),
                    "actionCount": 0,
                    "stoppedWithAction": False,
                    "sourceUrl": entry.get("sourceUrl", ""),
                }
                continue

            bill = data.get("bill", {})
            if bill:
                normalized = _normalize_bill(bill, entry["state"])
                enriched_bills[normalized["billId"]] = normalized
                bills_enriched += 1

    # Also include non-enriched search results with basic classification
    for bill_id, entry in all_bills.items():
        if bill_id not in enriched_bills:
            title = entry.get('title', '')
            bill_type, stance, category = _classify_bill(title)
            status_label = 'Introduced'
            last_action = entry.get('lastAction', '')
            la_lower = last_action.lower() if last_action else ''
            if 'signed' in la_lower or 'enacted' in la_lower:
                status_label = 'Signed into Law'
            elif 'died' in la_lower or 'failed' in la_lower or 'tabled' in la_lower:
                status_label = 'Died in Committee'
            elif 'passed' in la_lower:
                status_label = 'Passed One Chamber'
            elif 'committee' in la_lower:
                status_label = 'In Committee'
            dead_statuses = {'Vetoed', 'Died in Committee', 'Tabled', 'Withdrawn', 'Signed into Law'}
            is_active = 'No' if status_label in dead_statuses else 'Yes'
            enriched_bills[bill_id] = {
                'billId': bill_id,
                'state': entry['state'],
                'billNumber': entry['billNumber'],
                'title': title,
                'status': status_label,
                'isActive': is_active,
                'billType': bill_type,
                'stance': stance,
                'category': category,
                'level': 'Federal' if entry['state'] == 'US' else 'State',
                'impact': 'Medium',
                'summary': title,
                'sponsor': '',
                'lastAction': last_action,
                'lastActionDate': entry.get('lastActionDate', ''),
                'actionCount': 0,
                'stoppedWithAction': False,
                'sourceUrl': entry.get('sourceUrl', ''),
                'legiscan_bill_id': entry.get('_legiscan_bill_id'),
            }

    result = list(enriched_bills.values())
    print(f'  LegiScan search complete: {len(result)} bills, {bills_enriched} enriched ({requests_used} API requests)')
    return result


# ── Refresh existing tracked bills ───────────────────────────────────────

async def refresh_tracked_bills(existing_bills: list[dict]) -> list[dict]:
    """Update status/lastAction for bills that have a ``legiscan_bill_id``.

    Returns the updated list. Bills without a LegiScan ID are passed through
    unchanged.
    """
    if not LEGISCAN_API_KEY or not existing_bills:
        return existing_bills

    print(f"  Refreshing {len(existing_bills)} tracked bills via LegiScan...")
    updated = []
    requests_used = 0

    async with httpx.AsyncClient() as client:
        for bill in existing_bills:
            legiscan_id = bill.get("legiscan_bill_id")
            if not legiscan_id:
                updated.append(bill)
                continue

            if requests_used >= 200:  # cap refresh requests
                updated.append(bill)
                continue

            data = await _api_call(client, "getBill", id=legiscan_id)
            requests_used += 1

            if data is None:
                updated.append(bill)
                continue

            fresh = data.get("bill", {})
            if not fresh:
                updated.append(bill)
                continue

            # Update mutable fields, keep our classification
            status_label, is_active = _determine_status(fresh)
            bill["status"] = status_label
            bill["isActive"] = is_active
            bill["lastAction"] = fresh.get("last_action", bill.get("lastAction", ""))
            bill["lastActionDate"] = fresh.get("last_action_date", bill.get("lastActionDate", ""))
            bill["sourceUrl"] = fresh.get("url", "") or bill.get("sourceUrl", "")

            updated.append(bill)

    print(f"  Refreshed {requests_used} bills via LegiScan")
    return updated
