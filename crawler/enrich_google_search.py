"""Search for candidate emails when Ballotpedia enrichment didn't find one.

Uses DuckDuckGo search (via ddgs library) to find candidate contact pages,
then scrapes those pages for email addresses.

Picks up candidates from ballotpedia_candidates_cache.json that have no email
in either discovered[].email or enriched[url].email, and saves results back
to the enriched dict.

Usage:
    python crawler/enrich_google_search.py                  # Full run
    python crawler/enrich_google_search.py --state TX       # Single state
    python crawler/enrich_google_search.py --limit 20       # Cap searches
    python crawler/enrich_google_search.py --dry-run        # Preview only

Requirements:
    pip install ddgs requests beautifulsoup4
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS

sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "ballotpedia_candidates_cache.json"

SEARCH_RATE = 5.0    # seconds between search queries (avoid rate limits)
SCRAPE_RATE = 1.5    # seconds between page scrapes
MAX_RESULT_PAGES = 3  # top N search results to follow and scrape

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}

# ── Email extraction (same as scrape_ballotpedia.py) ─────────────────────

EMAIL_REGEX = re.compile(
    r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}',
    re.IGNORECASE,
)

# Words that get concatenated with emails in search snippets
# e.g. "emailing info@domain.com" -> "emailinginfo@domain.com"
SNIPPET_PREFIX_JUNK = [
    'emailing', 'email', 'mailing', 'contacting', 'reaching',
    'writing', 'sending', 'visiting', 'calling', 'texting',
    'oremailing', 'oremail', 'byemailing', 'atbyemailing',
    'at', 'to', 'by', 'via', 'or', 'and',
]

JUNK_EMAIL_DOMAINS = {
    'example.com', 'mysite.com', 'test.com', 'email.com', 'address.com',
    'yourname.com', 'yourdomain.com', 'domain.com', 'sample.com',
    'sentry.io', 'googleapis.com', 'google.com',
    'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com',
    'schema.org', 'w3.org', 'cloudflare.com', 'wp.com',
    'wordpress.com', 'gravatar.com', 'wixpress.com', 'wix.com',
    'squarespace.com', 'mailchimp.com', 'constantcontact.com',
    'googletagmanager.com', 'doubleclick.net', 'googlesyndication.com',
    'recaptcha.net', 'gstatic.com', 'bootstrapcdn.com',
    'fontawesome.com', 'jquery.com', 'jsdelivr.net', 'cdnjs.com',
    'x.com',
    # Additional junk domains
    'sentry-next.wixpress.com', 'googleusercontent.com',
    'googlevideo.com', 'bing.com', 'yahoo.com',
    'ballotpedia.org', 'wikipedia.org', 'duckduckgo.com',
}

JUNK_EMAIL_PREFIXES = {
    'noreply', 'no-reply', 'donotreply', 'do-not-reply',
    'mailer-daemon', 'postmaster', 'webmaster', 'admin',
    'support', 'help', 'abuse', 'spam', 'unsubscribe',
    'subscription', 'subscribe', 'newsletter', 'editor',
    'tips', 'press', 'media', 'news', 'letters',
}

# Domains to skip when following search result links (news, social, reference)
SKIP_DOMAINS = {
    'google.com', 'youtube.com', 'facebook.com', 'twitter.com',
    'x.com', 'instagram.com', 'linkedin.com', 'tiktok.com',
    'ballotpedia.org', 'wikipedia.org', 'reddit.com',
    'amazon.com', 'pinterest.com', 'duckduckgo.com',
    # News sites - their emails are not candidate emails
    'nytimes.com', 'washingtonpost.com', 'cnn.com',
    'foxnews.com', 'npr.org', 'apnews.com', 'reuters.com',
    'politico.com', 'thehill.com', 'axios.com',
}


def clean_snippet_email(email):
    """Remove common prefix words concatenated with emails in search snippets.
    e.g. 'emailinginfo@domain.com' -> 'info@domain.com'"""
    local, _, domain = email.partition('@')
    if not domain:
        return email
    local_lower = local.lower()
    # Try stripping known prefixes (longest first to handle 'oremailing' before 'or')
    for prefix in sorted(SNIPPET_PREFIX_JUNK, key=len, reverse=True):
        if local_lower.startswith(prefix) and len(local_lower) > len(prefix):
            cleaned = local[len(prefix):]
            # Make sure what remains looks like a valid local part
            if cleaned and cleaned[0].isalnum():
                return cleaned + '@' + domain
    return email


def is_valid_contact_email(email):
    """Check if an email looks like a real candidate contact email."""
    email = email.lower().strip()
    if len(email) > 80:
        return False
    local, _, domain = email.partition('@')
    if not domain:
        return False
    if domain in JUNK_EMAIL_DOMAINS:
        return False
    # Also check if domain *contains* a junk domain (e.g. sentry-next.wixpress.com)
    for junk in JUNK_EMAIL_DOMAINS:
        if domain.endswith('.' + junk):
            return False
    if local in JUNK_EMAIL_PREFIXES:
        return False
    if any(c in email for c in ['<', '>', '{', '}', '(', ')']):
        return False
    if not re.match(r'^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,6}$', email):
        return False
    # Reject emails where the TLD is suspiciously long (e.g. "govphone")
    tld = domain.rsplit('.', 1)[-1]
    if len(tld) > 4:
        return False
    # Reject government emails (we want campaign emails, not .gov addresses)
    if domain.endswith('.gov') or domain.endswith('.gov.us'):
        return False
    # Reject .edu emails
    if domain.endswith('.edu'):
        return False
    return True


# ── State code mapping ───────────────────────────────────────────────────

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}


# ── Cache management ─────────────────────────────────────────────────────

def load_cache():
    if CACHE_FILE.exists():
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'discovered': {}, 'enriched': {}, 'last_updated': None}


def save_cache(cache):
    cache['last_updated'] = datetime.now(timezone.utc).isoformat()
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


# ── Search + scraping ────────────────────────────────────────────────────

last_search_time = 0
last_scrape_time = 0


def search_for_candidate(query):
    """Search DuckDuckGo, return (snippet_emails, result_urls_to_scrape)."""
    global last_search_time

    elapsed = time.time() - last_search_time
    if elapsed < SEARCH_RATE:
        time.sleep(SEARCH_RATE - elapsed)

    snippet_emails = set()
    result_urls = []

    try:
        results = DDGS().text(query, max_results=8)
        last_search_time = time.time()
    except Exception as e:
        last_search_time = time.time()
        print(f"[!] Search error: {e}", end='')
        return list(snippet_emails), result_urls

    for r in results:
        # Check snippet text for emails
        body = r.get('body', '')
        title = r.get('title', '')
        for text in [body, title]:
            for email in EMAIL_REGEX.findall(text):
                # Clean up snippet concatenation artifacts
                email = clean_snippet_email(email)
                if is_valid_contact_email(email):
                    snippet_emails.add(email.lower())

        # Collect URLs to scrape (skip news/social/wiki sites)
        href = r.get('href', '')
        if href:
            domain = urlparse(href).netloc.lower()
            if not any(d in domain for d in SKIP_DOMAINS):
                result_urls.append(href)

    # Deduplicate preserving order
    seen = set()
    unique_urls = []
    for u in result_urls:
        if u not in seen:
            seen.add(u)
            unique_urls.append(u)

    return list(snippet_emails), unique_urls[:MAX_RESULT_PAGES]


def scrape_page_for_emails(url, session, candidate_name=''):
    """Scrape a page for email addresses.
    When candidate_name is provided, prioritize emails related to the candidate."""
    global last_scrape_time

    elapsed = time.time() - last_scrape_time
    if elapsed < SCRAPE_RATE:
        time.sleep(SCRAPE_RATE - elapsed)

    try:
        resp = session.get(url, headers=HEADERS, timeout=10)
        last_scrape_time = time.time()
        if resp.status_code != 200:
            return set()
        html = resp.text
    except Exception:
        last_scrape_time = time.time()
        return set()

    emails = set()

    # mailto: links
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.find_all('a', href=True):
        href = a.get('href', '')
        if 'mailto:' in href:
            email = href.split('mailto:')[1].split('?')[0].split('&')[0].strip()
            if is_valid_contact_email(email):
                emails.add(email.lower())

    # Regex on full HTML
    for email in EMAIL_REGEX.findall(html):
        if is_valid_contact_email(email):
            emails.add(email.lower())

    # If we're scraping a third-party page (not a candidate site),
    # filter to only emails that look campaign-related
    page_domain = urlparse(url).netloc.lower()
    name_parts = [p.lower() for p in candidate_name.split() if len(p) > 2]
    is_candidate_site = any(part in page_domain for part in name_parts)

    if not is_candidate_site and candidate_name:
        campaign_emails = set()
        for e in emails:
            local = e.split('@')[0]
            domain = e.split('@')[1] if '@' in e else ''
            # Keep only if email domain or local part contains candidate name
            if any(part in local or part in domain for part in name_parts):
                campaign_emails.add(e)
        if campaign_emails:
            return campaign_emails
        # If no name-matched emails found on third-party site, return empty
        # rather than returning the site's own contact emails
        return set()

    return emails


def pick_best_email(emails, candidate_name=''):
    """From a set of emails, pick the most likely candidate contact email.
    Uses candidate name to prioritize emails containing name parts."""
    if not emails:
        return None

    # Score each email
    name_parts = [p.lower() for p in candidate_name.split() if len(p) > 2]

    def score(email):
        local = email.split('@')[0]
        domain = email.split('@')[1] if '@' in email else ''
        s = 0
        # Candidate name in local part or domain is best
        for part in name_parts:
            if part in local or part in domain:
                s += 10
        # Priority prefixes
        priority = {'info': 5, 'contact': 5, 'campaign': 8, 'elect': 7, 'vote': 7}
        for prefix, val in priority.items():
            if local == prefix or local.startswith(prefix):
                s += val
        return s

    scored = sorted(emails, key=lambda e: (-score(e), e))
    return scored[0]


# ── Build candidate list needing search ──────────────────────────────────

def get_candidates_needing_email(cache, state_filter=None):
    """Return list of (candidate_dict, cache_key, state_code, body) for
    candidates that have no email after enrichment."""
    results = []
    for key, candidates in cache['discovered'].items():
        if key == 'GOVERNORS' or key.startswith('GOV-'):
            # Governor data: {state: [candidates]}
            if isinstance(candidates, dict):
                for state_code, gov_cands in candidates.items():
                    if state_filter and state_code != state_filter:
                        continue
                    for cand in gov_cands:
                        bp_url = cand.get('ballotpediaUrl', '')
                        cache_key = bp_url or cand['name']
                        if cand.get('email'):
                            continue
                        enriched = cache.get('enriched', {}).get(cache_key, {})
                        if enriched.get('email'):
                            continue
                        # Skip if already google-searched (resumability)
                        if enriched.get('google_search'):
                            continue
                        results.append((cand, cache_key, state_code, 'Governor'))
        else:
            state_code = key.split('|')[0]
            body = key.split('|')[1] if '|' in key else key
            if state_filter and state_code != state_filter:
                continue
            for cand in candidates:
                bp_url = cand.get('ballotpediaUrl', '')
                cache_key = bp_url or cand['name']
                if cand.get('email'):
                    continue
                enriched = cache.get('enriched', {}).get(cache_key, {})
                if enriched.get('email'):
                    continue
                # Skip if already google-searched (resumability)
                if enriched.get('google_search'):
                    continue
                results.append((cand, cache_key, state_code, body))
    return results


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Search for candidate emails missing from Ballotpedia enrichment"
    )
    parser.add_argument('--state', type=str, help='Limit to one state (e.g. TX)')
    parser.add_argument('--limit', type=int, help='Max number of searches')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be searched without actually searching')
    args = parser.parse_args()

    state_filter = args.state.upper() if args.state else None

    print("=" * 60)
    print("SAFE Action - Search Email Enrichment")
    print("=" * 60)
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if state_filter:
        print(f"State filter: {state_filter}")
    if args.limit:
        print(f"Limit: {args.limit} searches")
    if args.dry_run:
        print("Mode: DRY RUN (no actual searches)")

    cache = load_cache()
    candidates = get_candidates_needing_email(cache, state_filter)
    print(f"\nCandidates without email: {len(candidates)}")

    if args.limit:
        candidates = candidates[:args.limit]
        print(f"Will search for: {len(candidates)} (limited)")

    if not candidates:
        print("Nothing to do.")
        return

    if args.dry_run:
        print(f"\n--- DRY RUN: would search for these {len(candidates)} candidates ---")
        for cand, cache_key, state_code, body in candidates:
            state_name = STATE_NAMES.get(state_code, state_code)
            name = cand['name']
            print(f"  {name} ({state_code}) - {body}")
            print(f"    Query 1: {name} {state_name} campaign email")
            print(f"    Query 2: {name} for {body} contact")
        return

    # Run searches
    session = requests.Session()
    found_count = 0
    searched_count = 0

    for i, (cand, cache_key, state_code, body) in enumerate(candidates):
        name = cand['name']
        state_name = STATE_NAMES.get(state_code, state_code)

        print(f"\n  [{i+1}/{len(candidates)}] {name} ({state_code}, {body})")

        all_emails = set()
        queries = [
            f"{name} {state_name} campaign email",
            f"{name} for {body} contact",
        ]

        for qi, query in enumerate(queries):
            print(f"    Search {qi+1}: \"{query}\" ... ", end='', flush=True)
            snippet_emails, result_urls = search_for_candidate(query)

            if snippet_emails:
                all_emails.update(snippet_emails)
                print(f"found {len(snippet_emails)} in snippets", end='')
            else:
                print(f"{len(result_urls)} results", end='')

            # Follow top result links and scrape for emails
            for url in result_urls:
                page_emails = scrape_page_for_emails(url, session, name)
                if page_emails:
                    all_emails.update(page_emails)
                    domain = urlparse(url).netloc
                    print(f" +{len(page_emails)} from {domain}", end='')

            print()

            # Stop searching if we found emails
            if all_emails:
                break

        searched_count += 1

        # Pick best email and save
        best = pick_best_email(all_emails, name)
        if best:
            found_count += 1
            print(f"    -> EMAIL FOUND: {best}")
            existing = cache.get('enriched', {}).get(cache_key, {})
            existing['email'] = best
            existing.setdefault('website', '')
            existing['google_search'] = True
            cache['enriched'][cache_key] = existing
        else:
            print(f"    -> no email found")
            existing = cache.get('enriched', {}).get(cache_key, {})
            existing.setdefault('email', '')
            existing.setdefault('website', '')
            existing['google_search'] = True
            cache['enriched'][cache_key] = existing

        # Save cache periodically
        if (i + 1) % 10 == 0:
            save_cache(cache)
            print(f"  --- Saved cache. Progress: {searched_count} searched, {found_count} emails found ---")

    save_cache(cache)
    print(f"\n{'=' * 60}")
    print(f"DONE: Searched {searched_count} candidates, found {found_count} emails")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
