"""Enrich candidate data with contact info from the Open States API v3.

Queries https://v3.openstates.org/people for current state legislators and
matches them to candidates in ballotpedia_candidates_cache.json by name,
district, and chamber.  Extracts email, website, and office contact info.

Usage:
    python crawler/enrich_openstates.py                          # All states
    python crawler/enrich_openstates.py --state TX               # Single state
    python crawler/enrich_openstates.py --api-key YOUR_KEY       # Explicit key
    python crawler/enrich_openstates.py --dry-run                # Preview matches
    python crawler/enrich_openstates.py --stats                  # Show stats only

API key: provide via --api-key or OPENSTATES_API_KEY env var.
Register free at https://openstates.org/accounts/profile/
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from difflib import SequenceMatcher
from urllib.parse import urlencode

sys.stdout.reconfigure(encoding='utf-8')

try:
    import httpx
except ImportError:
    print("ERROR: httpx is required.  pip install httpx")
    sys.exit(1)

# ── Paths ─────────────────────────────────────────────────────────────────

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "ballotpedia_candidates_cache.json"
OS_CACHE_FILE = DATA_DIR / "openstates_cache.json"

# ── Constants ─────────────────────────────────────────────────────────────

API_BASE = "https://v3.openstates.org"
RATE_LIMIT = 1.0  # seconds between API requests (conservative)
PER_PAGE = 50     # max results per page

STATE_CODES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]

# Map cache body names to Open States org_classification values
# Open States uses "lower" and "upper" for chambers
BODY_CHAMBER_MAP = {
    "House": "lower",
    "Assembly": "lower",
    "Legislature": "legislature",   # Nebraska unicameral
    "Senate": "upper",
}


def body_to_chamber(body_name):
    """Convert a body name like 'Texas House' to an Open States chamber."""
    parts = body_name.split()
    chamber_word = parts[-1] if parts else ""
    return BODY_CHAMBER_MAP.get(chamber_word)


def state_jurisdiction(state_code):
    """Build Open States jurisdiction string for a state."""
    return f"ocd-jurisdiction/country:us/state:{state_code.lower()}/government"


# ── Name matching ─────────────────────────────────────────────────────────

def normalize_name(name):
    """Normalize a name for comparison."""
    name = name.lower().strip()
    # Remove suffixes
    for suffix in [' jr.', ' jr', ' sr.', ' sr', ' ii', ' iii', ' iv', ' v']:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
    # Remove punctuation
    name = re.sub(r'[.\-\']', '', name)
    # Collapse whitespace
    name = re.sub(r'\s+', ' ', name)
    return name


def names_match(name_a, name_b, threshold=0.80):
    """Check if two names match, handling partial/nickname variations."""
    na = normalize_name(name_a)
    nb = normalize_name(name_b)

    # Exact match
    if na == nb:
        return True

    # Last name must match (or be very close)
    parts_a = na.split()
    parts_b = nb.split()
    if not parts_a or not parts_b:
        return False

    last_a = parts_a[-1]
    last_b = parts_b[-1]
    if last_a != last_b:
        # Allow close last names (e.g. typos)
        if SequenceMatcher(None, last_a, last_b).ratio() < 0.85:
            return False

    # First name: check prefix match (e.g. "Rob" vs "Robert")
    first_a = parts_a[0]
    first_b = parts_b[0]
    if first_a == first_b:
        return True
    if first_a.startswith(first_b) or first_b.startswith(first_a):
        return True

    # Fuzzy overall
    return SequenceMatcher(None, na, nb).ratio() >= threshold


# ── API client ────────────────────────────────────────────────────────────

class OpenStatesClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.last_request = 0
        self.client = httpx.Client(
            headers={
                "X-API-KEY": api_key,
                "Accept": "application/json",
            },
            timeout=30.0,
            follow_redirects=True,
        )

    def close(self):
        self.client.close()

    def _rate_limit(self):
        elapsed = time.time() - self.last_request
        if elapsed < RATE_LIMIT:
            time.sleep(RATE_LIMIT - elapsed)

    def get_people(self, jurisdiction, org_classification=None, page=1):
        """Fetch people (legislators) for a jurisdiction."""
        self._rate_limit()

        params = {
            "jurisdiction": jurisdiction,
            "per_page": PER_PAGE,
            "page": page,
            "include": ["links", "offices"],
        }
        if org_classification:
            params["org_classification"] = org_classification

        url = f"{API_BASE}/people"
        try:
            resp = self.client.get(url, params=params)
            self.last_request = time.time()

            if resp.status_code == 401:
                print("\nERROR: Invalid API key (401 Unauthorized)")
                print("Register at https://open.pluralpolicy.com/accounts/profile/")
                sys.exit(1)
            if resp.status_code == 403:
                print("\nERROR: API key forbidden (403). Check your key.")
                sys.exit(1)
            if resp.status_code == 429:
                print("  Rate limited (429), waiting 60s ...", flush=True)
                time.sleep(60)
                return self.get_people(jurisdiction, org_classification, page)
            if resp.status_code != 200:
                print(f"  HTTP {resp.status_code} for {url}?{urlencode(params)}")
                return None

            return resp.json()
        except Exception as e:
            print(f"  Request error: {e}")
            return None

    def get_all_people(self, jurisdiction, org_classification=None):
        """Fetch all people for a jurisdiction, handling pagination."""
        all_people = []
        page = 1

        while True:
            data = self.get_people(jurisdiction, org_classification, page)
            if not data or "results" not in data:
                break

            results = data["results"]
            all_people.extend(results)

            pagination = data.get("pagination", {})
            max_page = pagination.get("max_page", 1)

            if page >= max_page:
                break
            page += 1

        return all_people


# ── Extract contact info from Open States person record ───────────────────

def extract_contact(person):
    """Extract email, website, phone, and address from an OS person record."""
    info = {
        "email": "",
        "website": "",
        "capitol_phone": "",
        "district_phone": "",
        "capitol_address": "",
        "district_address": "",
    }

    # Direct email field
    email = (person.get("email") or "").strip()
    if email:
        info["email"] = email

    # Links -> website
    for link in person.get("links", []):
        url = link.get("url", "")
        note = (link.get("note") or "").lower()
        if url and ("campaign" in note or "official" in note or not note):
            # Skip social media
            domain = url.lower()
            socials = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com',
                       'youtube.com', 'linkedin.com', 'tiktok.com']
            if not any(s in domain for s in socials):
                if not info["website"]:
                    info["website"] = url

    # Offices -> phone + address
    for office in person.get("offices", []):
        classification = (office.get("classification") or "").lower()
        voice = (office.get("voice") or "").strip()
        address = (office.get("address") or "").strip()
        fax = (office.get("fax") or "").strip()

        if "capitol" in classification:
            if voice:
                info["capitol_phone"] = voice
            if address:
                info["capitol_address"] = address
        elif "district" in classification:
            if voice:
                info["district_phone"] = voice
            if address:
                info["district_address"] = address
        else:
            # Generic office
            if voice and not info["capitol_phone"]:
                info["capitol_phone"] = voice
            if address and not info["capitol_address"]:
                info["capitol_address"] = address

    return info


# ── Cache management ──────────────────────────────────────────────────────

def load_bp_cache():
    """Load the Ballotpedia candidates cache."""
    if CACHE_FILE.exists():
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'discovered': {}, 'enriched': {}, 'last_updated': None}


def save_bp_cache(cache):
    """Save updates to the Ballotpedia candidates cache."""
    cache['last_updated'] = datetime.now(timezone.utc).isoformat()
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def load_os_cache():
    """Load the Open States API response cache (raw legislator data)."""
    if OS_CACHE_FILE.exists():
        with open(OS_CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"states": {}, "last_updated": None}


def save_os_cache(os_cache):
    """Save the Open States API response cache."""
    os_cache["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(OS_CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(os_cache, f, indent=2, ensure_ascii=False)


# ── Matching engine ───────────────────────────────────────────────────────

def match_candidates(os_people, candidates, chamber):
    """Match Open States legislators to our candidate list.

    Returns list of (candidate, os_person, contact_info) tuples.
    """
    matches = []

    # Index OS people by district for faster lookup
    os_by_district = {}
    for person in os_people:
        role = person.get("current_role", {})
        district = (role.get("district") or "").strip()
        if district:
            os_by_district.setdefault(district, []).append(person)

    for cand in candidates:
        cand_district = str(cand.get("district", "")).strip()
        cand_name = cand.get("name", "")

        if not cand_name:
            continue

        # Look for matching OS people in the same district
        os_candidates = os_by_district.get(cand_district, [])

        best_match = None
        best_score = 0

        for person in os_candidates:
            os_name = person.get("name", "")
            if names_match(cand_name, os_name):
                score = SequenceMatcher(
                    None, normalize_name(cand_name), normalize_name(os_name)
                ).ratio()
                if score > best_score:
                    best_score = score
                    best_match = person

        # Fallback: search all people if no district match
        if not best_match:
            for person in os_people:
                os_name = person.get("name", "")
                if names_match(cand_name, os_name, threshold=0.85):
                    score = SequenceMatcher(
                        None, normalize_name(cand_name), normalize_name(os_name)
                    ).ratio()
                    if score > best_score:
                        best_score = score
                        best_match = person

        if best_match:
            contact = extract_contact(best_match)
            matches.append((cand, best_match, contact))

    return matches


# ── Main pipeline ─────────────────────────────────────────────────────────

def run(api_key, state_filter=None, dry_run=False, stats_only=False):
    """Main enrichment pipeline."""
    bp_cache = load_bp_cache()
    os_cache = load_os_cache()

    if stats_only:
        show_stats(bp_cache, os_cache)
        return

    client = OpenStatesClient(api_key)

    try:
        # Determine which states to process
        states_needed = set()
        for key in bp_cache.get("discovered", {}):
            if key in ("GOVERNORS",) or key.startswith("GOV-"):
                continue
            state_code = key.split("|")[0]
            if state_filter and state_code != state_filter:
                continue
            states_needed.add(state_code)

        if state_filter and state_filter not in states_needed:
            states_needed.add(state_filter)

        states_needed = sorted(states_needed)
        print(f"\nStates to process: {len(states_needed)}")

        total_matches = 0
        total_new_emails = 0
        total_new_websites = 0

        for si, state_code in enumerate(states_needed):
            print(f"\n[{si+1}/{len(states_needed)}] {state_code}")

            # Check if already cached in OS cache
            if state_code in os_cache["states"] and not state_filter:
                os_people = os_cache["states"][state_code]
                print(f"  Open States data cached ({len(os_people)} legislators)")
            else:
                # Fetch from API
                jurisdiction = state_jurisdiction(state_code)
                print(f"  Fetching legislators from Open States ...", end=" ", flush=True)

                os_people = client.get_all_people(jurisdiction)
                if os_people is None:
                    print("FAILED")
                    continue

                print(f"{len(os_people)} legislators")
                os_cache["states"][state_code] = os_people
                save_os_cache(os_cache)

            if not os_people:
                print("  No legislators found, skipping")
                continue

            # Match against each body in this state
            for key, candidates in bp_cache.get("discovered", {}).items():
                if not key.startswith(f"{state_code}|"):
                    continue

                body_name = key.split("|")[1]
                chamber = body_to_chamber(body_name)

                if not candidates:
                    continue

                # Filter OS people by chamber
                if chamber == "legislature":
                    # Nebraska unicameral - use all
                    chamber_people = os_people
                elif chamber:
                    chamber_people = [
                        p for p in os_people
                        if (p.get("current_role", {}).get("org_classification") or "").lower() == chamber
                    ]
                else:
                    chamber_people = os_people

                matches = match_candidates(chamber_people, candidates, chamber)
                state_new_emails = 0
                state_new_websites = 0

                for cand, os_person, contact in matches:
                    bp_key = cand.get("ballotpediaUrl", cand["name"])

                    # Get existing enrichment
                    existing = bp_cache.get("enriched", {}).get(bp_key, {})
                    existing_email = existing.get("email", "") or cand.get("email", "")
                    existing_website = existing.get("website", "") or cand.get("website", "")

                    new_email = contact["email"]
                    new_website = contact["website"]

                    # Only update if we have new info the candidate is missing
                    updated = False
                    enrichment = dict(existing) if existing else {"website": "", "email": ""}

                    if new_email and not existing_email:
                        enrichment["email"] = new_email
                        state_new_emails += 1
                        updated = True

                    if new_website and not existing_website:
                        enrichment["website"] = new_website
                        state_new_websites += 1
                        updated = True

                    # Store additional Open States contact info
                    if contact.get("capitol_phone"):
                        enrichment["capitol_phone"] = contact["capitol_phone"]
                        updated = True
                    if contact.get("district_phone"):
                        enrichment["district_phone"] = contact["district_phone"]
                        updated = True
                    if contact.get("capitol_address"):
                        enrichment["capitol_address"] = contact["capitol_address"]
                        updated = True
                    if contact.get("district_address"):
                        enrichment["district_address"] = contact["district_address"]
                        updated = True

                    # Mark data source
                    enrichment["openstates_id"] = os_person.get("id", "")
                    enrichment["openstates_match"] = os_person.get("name", "")

                    if not dry_run:
                        bp_cache.setdefault("enriched", {})[bp_key] = enrichment

                    if updated and dry_run:
                        print(f"    MATCH: {cand['name']} -> {os_person['name']}"
                              f" (D{cand.get('district','')})")
                        if new_email and not existing_email:
                            print(f"      +email: {new_email}")
                        if new_website and not existing_website:
                            print(f"      +website: {new_website}")

                total_matches += len(matches)
                total_new_emails += state_new_emails
                total_new_websites += state_new_websites

                print(f"  {body_name}: {len(matches)}/{len(candidates)} matched"
                      f" (+{state_new_emails} emails, +{state_new_websites} websites)")

            # Save periodically
            if not dry_run and (si + 1) % 5 == 0:
                save_bp_cache(bp_cache)

        # Final save
        if not dry_run:
            save_bp_cache(bp_cache)

        print("\n" + "=" * 60)
        print(f"Open States enrichment complete")
        print(f"  Total matches: {total_matches}")
        print(f"  New emails added: {total_new_emails}")
        print(f"  New websites added: {total_new_websites}")
        print("=" * 60)

    finally:
        client.close()


def show_stats(bp_cache, os_cache):
    """Show statistics about current enrichment coverage."""
    print("\n" + "=" * 60)
    print("ENRICHMENT STATISTICS")
    print("=" * 60)

    # Count candidates by state
    total_candidates = 0
    total_with_email = 0
    total_with_website = 0
    total_with_os_match = 0

    enriched = bp_cache.get("enriched", {})

    for key, candidates in bp_cache.get("discovered", {}).items():
        if key in ("GOVERNORS",) or key.startswith("GOV-"):
            continue
        for cand in candidates:
            total_candidates += 1
            bp_key = cand.get("ballotpediaUrl", cand["name"])
            enr = enriched.get(bp_key, {})

            has_email = bool(enr.get("email") or cand.get("email"))
            has_website = bool(enr.get("website") or cand.get("website"))
            has_os = bool(enr.get("openstates_id"))

            if has_email:
                total_with_email += 1
            if has_website:
                total_with_website += 1
            if has_os:
                total_with_os_match += 1

    print(f"\nTotal state legislative candidates: {total_candidates}")
    print(f"  With email:          {total_with_email:>5} ({100*total_with_email/max(total_candidates,1):.1f}%)")
    print(f"  With website:        {total_with_website:>5} ({100*total_with_website/max(total_candidates,1):.1f}%)")
    print(f"  Open States matched: {total_with_os_match:>5} ({100*total_with_os_match/max(total_candidates,1):.1f}%)")

    # OS cache stats
    os_states = len(os_cache.get("states", {}))
    os_total = sum(len(v) for v in os_cache.get("states", {}).values())
    print(f"\nOpen States cache: {os_states} states, {os_total} legislators")


# ── CLI ───────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]

    # Parse arguments
    api_key = os.environ.get("OPENSTATES_API_KEY", "")
    state_filter = None
    dry_run = "--dry-run" in args
    stats_only = "--stats" in args

    if "--api-key" in args:
        idx = args.index("--api-key")
        if idx + 1 < len(args):
            api_key = args[idx + 1]

    if "--state" in args:
        idx = args.index("--state")
        if idx + 1 < len(args):
            state_filter = args[idx + 1].upper()

    print("=" * 60)
    print("SAFE Action - Open States Legislator Enrichment")
    print("=" * 60)
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if state_filter:
        print(f"State filter: {state_filter}")
    if dry_run:
        print("Mode: DRY RUN (no changes saved)")

    if stats_only:
        bp_cache = load_bp_cache()
        os_cache = load_os_cache()
        show_stats(bp_cache, os_cache)
        return

    if not api_key:
        print("\nERROR: No API key provided.")
        print("  Set OPENSTATES_API_KEY env var or pass --api-key YOUR_KEY")
        print("  Register free at https://openstates.org/accounts/profile/")
        sys.exit(1)

    run(api_key, state_filter=state_filter, dry_run=dry_run)


if __name__ == "__main__":
    main()
