"""Enrich candidates in seats.json with email and website from FEC committee data,
campaign website scraping, and Ballotpedia/domain guessing.

Phase 1: FEC committee API → get campaign website + treasurer email
Phase 2: Scrape campaign websites for candidate contact email
Phase 3: Ballotpedia lookup + domain guessing for candidates still missing websites
Phase 4: Write enriched data back to seats.json

Usage: python crawler/enrich_candidates.py
       python crawler/enrich_candidates.py --scrape-only       (skip FEC, just scrape websites)
       python crawler/enrich_candidates.py --fec-only          (skip website scraping + ballotpedia)
       python crawler/enrich_candidates.py --ballotpedia-only  (only run phase 3)
"""

import asyncio
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "candidate_enrichment_cache.json"
RATE_LIMIT = 0.4  # seconds between FEC API requests
SCRAPE_RATE = 1.0  # seconds between website scrapes (be polite)

FEC_API = "https://api.open.fec.gov/v1"
FEC_API_KEY = "UVND2QWrvna2qkOqHj2jCbzIbRUfKGp5fKeVSMZt"

last_request = 0
last_scrape = 0

# Common email patterns on campaign websites
EMAIL_REGEX = re.compile(
    r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
    re.IGNORECASE
)

# Filter out junk emails (trackers, generic services, etc.)
JUNK_EMAIL_DOMAINS = {
    'example.com', 'sentry.io', 'googleapis.com', 'google.com',
    'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com',
    'schema.org', 'w3.org', 'cloudflare.com', 'wp.com',
    'wordpress.com', 'gravatar.com', 'wixpress.com', 'wix.com',
    'squarespace.com', 'mailchimp.com', 'constantcontact.com',
    'googletagmanager.com', 'doubleclick.net', 'googlesyndication.com',
    'recaptcha.net', 'gstatic.com', 'bootstrapcdn.com',
    'fontawesome.com', 'jquery.com', 'jsdelivr.net', 'cdnjs.com',
}

# Filter out common non-contact emails
JUNK_EMAIL_PREFIXES = {
    'noreply', 'no-reply', 'donotreply', 'do-not-reply',
    'mailer-daemon', 'postmaster', 'webmaster', 'admin',
    'support', 'help', 'abuse', 'spam', 'unsubscribe',
}


def is_valid_contact_email(email):
    """Filter out junk/tracker emails, keep likely campaign contact emails."""
    email = email.lower().strip()
    if len(email) > 80:
        return False

    local, _, domain = email.partition('@')
    if not domain:
        return False

    # Filter junk domains
    if domain in JUNK_EMAIL_DOMAINS:
        return False

    # Filter junk prefixes
    if local in JUNK_EMAIL_PREFIXES:
        return False

    # Filter image/asset references
    if any(ext in email for ext in ['.png', '.jpg', '.gif', '.svg', '.css', '.js']):
        return False

    return True


async def rate_limited_get(client, url, rate=RATE_LIMIT, **kwargs):
    """Make a rate-limited GET request."""
    global last_request
    elapsed = time.time() - last_request
    if elapsed < rate:
        await asyncio.sleep(rate - elapsed)
    try:
        resp = await client.get(url, timeout=15.0, **kwargs)
        last_request = time.time()
        resp.raise_for_status()
        return resp
    except Exception as e:
        return None


def load_cache():
    """Load enrichment cache from disk."""
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text())
    return {}


def save_cache(cache):
    """Save enrichment cache to disk."""
    CACHE_FILE.write_text(json.dumps(cache, indent=2))


# ── Phase 1: FEC Committee Data ─────────────────────────────────────────

async def fetch_committee_for_candidate(client, fec_id, cache):
    """Get principal campaign committee info (website + email) from FEC."""
    if fec_id in cache and cache[fec_id].get("fec_done"):
        return cache[fec_id]

    resp = await rate_limited_get(
        client,
        f"{FEC_API}/candidate/{fec_id}/committees/",
        params={"api_key": FEC_API_KEY, "designation": "P"}
    )

    result = cache.get(fec_id, {"fecId": fec_id})

    if resp is None:
        result["fec_done"] = True
        return result

    data = resp.json()
    committees = data.get("results", [])

    for comm in committees:
        website = (comm.get("website") or "").strip()
        email = (comm.get("email") or "").strip()

        if website:
            # Normalize website URL
            if not website.startswith("http"):
                website = "https://" + website
            result["website"] = website.lower()

        if email:
            # FEC sometimes has multiple emails separated by ;
            emails = [e.strip() for e in email.split(";") if e.strip()]
            valid = [e for e in emails if is_valid_contact_email(e)]
            if valid:
                result["fec_emails"] = valid

    result["fec_done"] = True
    return result


async def enrich_from_fec(candidates_by_id, cache):
    """Phase 1: Pull website + email from FEC committee data."""
    fec_ids = [fid for fid in candidates_by_id if not cache.get(fid, {}).get("fec_done")]
    total = len(fec_ids)
    print(f"\nPhase 1: Fetching FEC committee data for {total} candidates...")

    if total == 0:
        print("  All candidates already cached. Skipping FEC phase.")
        return cache

    async with httpx.AsyncClient() as client:
        for i, fec_id in enumerate(fec_ids):
            result = await fetch_committee_for_candidate(client, fec_id, cache)
            cache[fec_id] = result

            if (i + 1) % 50 == 0 or i == total - 1:
                pct = ((i + 1) / total) * 100
                with_website = sum(1 for v in cache.values() if v.get("website"))
                with_email = sum(1 for v in cache.values() if v.get("fec_emails"))
                print(f"  [{i+1}/{total}] ({pct:.0f}%) - {with_website} websites, {with_email} FEC emails found")
                save_cache(cache)

    save_cache(cache)

    with_website = sum(1 for v in cache.values() if v.get("website"))
    with_email = sum(1 for v in cache.values() if v.get("fec_emails"))
    print(f"  FEC phase complete: {with_website} websites, {with_email} emails")

    return cache


# ── Phase 2: Scrape Campaign Websites ──────────────────────────────────

async def scrape_website_for_email(client, url):
    """Try to find contact email on a campaign website."""
    global last_scrape
    emails_found = set()

    # Try main page and common contact paths
    paths_to_try = ["", "/contact", "/contact-us", "/about", "/get-involved"]

    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    for path in paths_to_try:
        target = base + path

        elapsed = time.time() - last_scrape
        if elapsed < SCRAPE_RATE:
            await asyncio.sleep(SCRAPE_RATE - elapsed)

        try:
            resp = await client.get(
                target,
                timeout=10.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "SAFE Action Foundation Research Bot (scienceandfreedom.com)",
                    "Accept": "text/html",
                }
            )
            last_scrape = time.time()

            if resp.status_code != 200:
                continue

            html = resp.text
            if not html:
                continue

            # Find all emails in page
            found = EMAIL_REGEX.findall(html)
            for email in found:
                if is_valid_contact_email(email):
                    emails_found.add(email.lower())

            # Also check for mailto: links specifically
            mailto_pattern = re.findall(r'mailto:([^"\'?\s]+)', html, re.IGNORECASE)
            for email in mailto_pattern:
                email = email.split('?')[0]  # Remove query params
                if is_valid_contact_email(email):
                    emails_found.add(email.lower())

        except Exception:
            continue

        # If we found emails, no need to check more paths
        if emails_found:
            break

    return list(emails_found)


async def enrich_from_websites(cache):
    """Phase 2: Scrape campaign websites for contact emails."""
    # Get candidates with websites but no scraped email yet
    to_scrape = [
        (fid, info["website"])
        for fid, info in cache.items()
        if info.get("website") and not info.get("scrape_done")
    ]

    total = len(to_scrape)
    print(f"\nPhase 2: Scraping {total} campaign websites for contact emails...")

    if total == 0:
        print("  All websites already scraped. Skipping.")
        return cache

    async with httpx.AsyncClient() as client:
        for i, (fec_id, website) in enumerate(to_scrape):
            emails = await scrape_website_for_email(client, website)

            if emails:
                cache[fec_id]["scraped_emails"] = emails

            cache[fec_id]["scrape_done"] = True

            if (i + 1) % 25 == 0 or i == total - 1:
                pct = ((i + 1) / total) * 100
                with_email = sum(1 for v in cache.values() if v.get("scraped_emails"))
                print(f"  [{i+1}/{total}] ({pct:.0f}%) - {with_email} emails found from websites")
                save_cache(cache)

    save_cache(cache)

    with_email = sum(1 for v in cache.values() if v.get("scraped_emails"))
    print(f"  Website scrape complete: {with_email} candidate emails found")

    return cache


# ── Phase 3: Ballotpedia + Domain Guessing ─────────────────────────────

# Common campaign domain patterns
DOMAIN_PATTERNS = [
    "{last}forcongress.com",
    "{last}forsenate.com",
    "elect{last}.com",
    "vote{last}.com",
    "{last}forus.com",
    "{last}2026.com",
    "{first}{last}.com",
    "{last}campaign.com",
    "{first}{last}forcongress.com",
    "{last}foramerica.com",
]

BALLOTPEDIA_RATE = 1.5  # be polite to Ballotpedia
last_bp_request = 0


def candidate_name_parts(name):
    """Extract first/last name parts for URL/domain generation."""
    parts = name.strip().split()
    if not parts:
        return "", ""
    first = parts[0].lower().replace(".", "").replace("'", "")
    last = parts[-1].lower().replace(".", "").replace("'", "")
    # Skip suffixes
    if last in ("jr", "jr.", "sr", "sr.", "ii", "iii", "iv"):
        last = parts[-2].lower().replace(".", "").replace("'", "") if len(parts) > 2 else first
    return first, last


async def find_ballotpedia_website(client, name, seat_id):
    """Search Ballotpedia for a candidate's campaign website."""
    global last_bp_request

    first, last = candidate_name_parts(name)
    if not first or not last:
        return None, []

    # Ballotpedia URL pattern: First_Last
    bp_name = name.strip().replace(" ", "_")
    # Also try with title case
    bp_url = f"https://ballotpedia.org/{bp_name}"

    elapsed = time.time() - last_bp_request
    if elapsed < BALLOTPEDIA_RATE:
        await asyncio.sleep(BALLOTPEDIA_RATE - elapsed)

    try:
        resp = await client.get(
            bp_url,
            timeout=12.0,
            follow_redirects=True,
            headers={
                "User-Agent": "SAFE Action Foundation Research Bot (scienceandfreedom.com)",
                "Accept": "text/html",
            }
        )
        last_bp_request = time.time()

        if resp.status_code != 200:
            return None, []

        html = resp.text
        if not html or "does not currently have" in html and "a page called" in html:
            return None, []

        # Look for campaign website link
        website = None
        # Ballotpedia lists campaign website in infobox or "Campaign website" section
        website_patterns = [
            r'Campaign\s*website[^"]*?href="(https?://[^"]+)"',
            r'class="website"[^>]*>\s*<a[^>]*href="(https?://[^"]+)"',
            r'Official\s*website[^"]*?href="(https?://[^"]+)"',
            r'href="(https?://(?:www\.)?[^"]*(?:' + re.escape(last) + r')[^"]*\.com[^"]*)"',
        ]

        for pattern in website_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                url = match.group(1)
                # Filter out ballotpedia/social media links
                parsed = urlparse(url)
                domain = parsed.netloc.lower()
                if not any(skip in domain for skip in [
                    'ballotpedia', 'wikipedia', 'facebook.com', 'twitter.com',
                    'instagram.com', 'youtube.com', 'linkedin.com', 'x.com'
                ]):
                    website = url
                    break

        # Also grab any emails from the Ballotpedia page itself
        emails = []
        found = EMAIL_REGEX.findall(html)
        for email in found:
            if is_valid_contact_email(email) and 'ballotpedia' not in email.lower():
                emails.append(email.lower())

        return website, emails

    except Exception:
        last_bp_request = time.time()
        return None, []


async def try_domain_guesses(client, name):
    """Try common campaign domain patterns to find a website."""
    first, last = candidate_name_parts(name)
    if not first or not last:
        return None

    for pattern in DOMAIN_PATTERNS:
        domain = pattern.format(first=first, last=last)
        url = f"https://{domain}"

        try:
            resp = await client.get(
                url,
                timeout=6.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "SAFE Action Foundation Research Bot (scienceandfreedom.com)",
                    "Accept": "text/html",
                }
            )
            if resp.status_code == 200 and len(resp.text) > 500:
                # Looks like a real site
                return url
        except Exception:
            continue

    return None


async def enrich_from_ballotpedia(candidates_by_id, cache):
    """Phase 3: Find websites via Ballotpedia + domain guessing for candidates with no website."""
    # Get candidates with no website yet
    to_search = [
        (fid, cand)
        for fid, cand in candidates_by_id.items()
        if not cache.get(fid, {}).get("website") and not cache.get(fid, {}).get("bp_done")
    ]

    total = len(to_search)
    print(f"\nPhase 3: Searching Ballotpedia + domain guessing for {total} candidates...")

    if total == 0:
        print("  All candidates already searched. Skipping.")
        return cache

    # Build fecId → seatId lookup once
    fec_to_seat = {}
    seats_data = json.loads((DATA_DIR / "seats.json").read_text())
    for seat in seats_data["seats"]:
        for c in seat.get("candidates", []):
            if c.get("fecId"):
                fec_to_seat[c["fecId"]] = seat["seatId"]

    async with httpx.AsyncClient() as client:
        for i, (fec_id, cand) in enumerate(to_search):
            name = cand.get("name", "")
            seat_id = fec_to_seat.get(fec_id, "")

            if fec_id not in cache:
                cache[fec_id] = {"fecId": fec_id}

            # Try Ballotpedia first
            website, bp_emails = await find_ballotpedia_website(client, name, seat_id)

            if bp_emails:
                existing = cache[fec_id].get("scraped_emails", [])
                cache[fec_id]["scraped_emails"] = list(set(existing + bp_emails))

            # If no website from Ballotpedia, try domain guessing
            if not website:
                website = await try_domain_guesses(client, name)

            if website:
                if not website.startswith("http"):
                    website = "https://" + website
                cache[fec_id]["website"] = website.lower()

                # Scrape the found website for emails if we don't have any yet
                if not cache[fec_id].get("scraped_emails"):
                    emails = await scrape_website_for_email(client, website)
                    if emails:
                        cache[fec_id]["scraped_emails"] = emails
                    cache[fec_id]["scrape_done"] = True

            cache[fec_id]["bp_done"] = True

            if (i + 1) % 25 == 0 or i == total - 1:
                pct = ((i + 1) / total) * 100
                new_websites = sum(1 for v in cache.values() if v.get("website") and v.get("bp_done"))
                new_emails = sum(1 for v in cache.values() if v.get("scraped_emails") and v.get("bp_done"))
                print(f"  [{i+1}/{total}] ({pct:.0f}%) - {new_websites} websites, {new_emails} emails found")
                save_cache(cache)

    save_cache(cache)

    bp_websites = sum(1 for v in cache.values() if v.get("website") and v.get("bp_done"))
    bp_emails = sum(1 for v in cache.values() if v.get("scraped_emails") and v.get("bp_done"))
    print(f"  Ballotpedia/domain phase complete: {bp_websites} new websites, {bp_emails} emails")

    return cache


# ── Phase 4: Write Back to seats.json ──────────────────────────────────

def apply_enrichment(seats, cache):
    """Apply enriched data back to seats.json candidates."""
    enriched_count = 0
    email_count = 0
    website_count = 0

    for seat in seats:
        for candidate in seat.get("candidates", []):
            fec_id = candidate.get("fecId")
            if not fec_id or fec_id not in cache:
                continue

            info = cache[fec_id]

            # Set website
            if info.get("website") and not candidate.get("website"):
                candidate["website"] = info["website"]
                website_count += 1

            # Pick best email: prefer scraped (candidate's own) over FEC (treasurer's)
            best_email = None
            if info.get("scraped_emails"):
                best_email = info["scraped_emails"][0]
            elif info.get("fec_emails"):
                best_email = info["fec_emails"][0]

            if best_email and not candidate.get("email"):
                candidate["email"] = best_email
                email_count += 1

            if candidate.get("email") or candidate.get("website"):
                enriched_count += 1

    return seats, enriched_count, email_count, website_count


async def main():
    args = sys.argv[1:]
    skip_fec = "--scrape-only" in args or "--ballotpedia-only" in args
    skip_scrape = "--fec-only" in args or "--ballotpedia-only" in args
    skip_bp = "--fec-only" in args or "--scrape-only" in args
    bp_only = "--ballotpedia-only" in args

    seats_path = DATA_DIR / "seats.json"
    if not seats_path.exists():
        print("ERROR: seats.json not found")
        return

    seats_data = json.loads(seats_path.read_text())
    seats = seats_data["seats"]

    # Build lookup of all candidates with FEC IDs
    candidates_by_id = {}
    for seat in seats:
        for c in seat.get("candidates", []):
            if c.get("fecId"):
                candidates_by_id[c["fecId"]] = c

    print(f"Found {len(candidates_by_id)} candidates with FEC IDs")

    # Load cache
    cache = load_cache()
    print(f"Cache has {len(cache)} entries")

    # Phase 1: FEC committee data
    if not skip_fec:
        cache = await enrich_from_fec(candidates_by_id, cache)

    # Phase 2: Website scraping
    if not skip_scrape:
        cache = await enrich_from_websites(cache)

    # Phase 3: Ballotpedia + domain guessing
    if not skip_bp:
        cache = await enrich_from_ballotpedia(candidates_by_id, cache)

    # Phase 4: Apply to seats.json
    print("\nPhase 4: Applying enrichment to seats.json...")
    seats, enriched, emails, websites = apply_enrichment(seats, cache)

    seats_data["seats"] = seats
    seats_data["enrichment_stats"] = {
        "candidates_enriched": enriched,
        "candidates_with_email": emails,
        "candidates_with_website": websites,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
    }

    seats_path.write_text(json.dumps(seats_data, indent=2))

    print(f"\nFinal enrichment stats:")
    print(f"  Candidates with email: {emails}")
    print(f"  Candidates with website: {websites}")
    print(f"  Total enriched: {enriched}")
    print(f"\nWrote updated seats.json")

    # Summary of cache coverage
    total_cached = len(cache)
    fec_done = sum(1 for v in cache.values() if v.get("fec_done"))
    has_website = sum(1 for v in cache.values() if v.get("website"))
    has_fec_email = sum(1 for v in cache.values() if v.get("fec_emails"))
    has_scraped = sum(1 for v in cache.values() if v.get("scraped_emails"))
    scrape_done = sum(1 for v in cache.values() if v.get("scrape_done"))

    print(f"\nCache summary:")
    print(f"  FEC lookups done: {fec_done}/{total_cached}")
    print(f"  Have campaign website: {has_website}")
    print(f"  Have FEC email (treasurer): {has_fec_email}")
    print(f"  Websites scraped: {scrape_done}/{has_website}")
    print(f"  Have scraped email (candidate): {has_scraped}")


if __name__ == "__main__":
    asyncio.run(main())
