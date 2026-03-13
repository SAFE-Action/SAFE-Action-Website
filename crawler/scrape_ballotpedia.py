"""Scrape Ballotpedia for 2026 state legislative + gubernatorial candidates.

Phase 1: Discover candidates from election listing pages (~100 pages)
Phase 2: Enrich from profile pages + campaign websites (~5,000-10,000 pages)

Usage:
    python crawler/scrape_ballotpedia.py                    # Full run (Phase 1 + 2)
    python crawler/scrape_ballotpedia.py --discover-only    # Phase 1 only (discover candidates)
    python crawler/scrape_ballotpedia.py --enrich-only      # Phase 2 only (enrich existing)
    python crawler/scrape_ballotpedia.py --state TX         # Single state for testing
    python crawler/scrape_ballotpedia.py --governors-only   # Only gubernatorial races
"""

import asyncio
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, unquote

import httpx
from bs4 import BeautifulSoup

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "ballotpedia_candidates_cache.json"
SEATS_FILE = DATA_DIR / "seats.json"

BP_RATE = 3.0       # seconds between Ballotpedia requests (higher to avoid 202 rate limits)
SCRAPE_RATE = 1.0   # seconds between campaign website scrapes
BP_BASE = "https://ballotpedia.org"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BP_MAX_RETRIES = 3  # retries for 202/429 responses
BP_RETRY_WAIT = 15  # seconds to wait before retrying a 202

last_bp_request = 0
last_scrape_request = 0

# ── Email extraction (reused from enrich_candidates.py) ──────────────────

EMAIL_REGEX = re.compile(
    r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
    re.IGNORECASE
)

JUNK_EMAIL_DOMAINS = {
    'example.com', 'sentry.io', 'googleapis.com', 'google.com',
    'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com',
    'schema.org', 'w3.org', 'cloudflare.com', 'wp.com',
    'wordpress.com', 'gravatar.com', 'wixpress.com', 'wix.com',
    'squarespace.com', 'mailchimp.com', 'constantcontact.com',
    'googletagmanager.com', 'doubleclick.net', 'googlesyndication.com',
    'recaptcha.net', 'gstatic.com', 'bootstrapcdn.com',
    'fontawesome.com', 'jquery.com', 'jsdelivr.net', 'cdnjs.com',
    'x.com', 'herokuapp.com', 'netlify.app', 'vercel.app',
    'amazonaws.com', 'googleusercontent.com',
}

JUNK_EMAIL_PREFIXES = {
    'noreply', 'no-reply', 'donotreply', 'do-not-reply',
    'mailer-daemon', 'postmaster', 'webmaster', 'admin',
    'support', 'help', 'abuse', 'spam', 'unsubscribe',
}


def is_valid_contact_email(email):
    email = email.lower().strip()
    if len(email) > 80:
        return False
    local, _, domain = email.partition('@')
    if not domain:
        return False
    # Check exact domain match AND subdomain match (e.g. sentry-next.wixpress.com -> wixpress.com)
    if domain in JUNK_EMAIL_DOMAINS or any(domain.endswith('.' + junk) for junk in JUNK_EMAIL_DOMAINS):
        return False
    # Reject hex-hash local parts (e.g. 605a7baede844d278b89dc95ae0a9123)
    if len(local) > 16 and all(c in '0123456789abcdef' for c in local):
        return False
    if local in JUNK_EMAIL_PREFIXES:
        return False
    if any(c in email for c in ['<', '>', '{', '}', '(', ')']):
        return False
    if not re.match(r'^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$', email):
        return False
    return True


# ── State/Chamber to Ballotpedia URL mapping ────────────────────────────

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New_Hampshire", "NJ": "New_Jersey", "NM": "New_Mexico", "NY": "New_York",
    "NC": "North_Carolina", "ND": "North_Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode_Island", "SC": "South_Carolina",
    "SD": "South_Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West_Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}

# Map seats.json body names to Ballotpedia URL patterns
# Pattern: {State}_{Official_Chamber_Name}_elections,_2026
CHAMBER_URL_MAP = {
    # Lower chambers
    "House": "House_of_Representatives",
    "Assembly": "State_Assembly",
    "Legislature": "State_Senate",  # Nebraska unicameral
}

# Overrides for states with non-standard Ballotpedia naming
BODY_URL_OVERRIDES = {
    "California Assembly": "California_State_Assembly_elections,_2026",
    "Nevada Assembly": "Nevada_State_Assembly_elections,_2026",
    "New York Assembly": "New_York_State_Assembly_elections,_2026",
    "Wisconsin Assembly": "Wisconsin_State_Assembly_elections,_2026",
    "Nebraska Legislature": "Nebraska_State_Senate_elections,_2026",
    "Maryland House": "Maryland_House_of_Delegates_elections,_2026",
    "West Virginia House": "West_Virginia_House_of_Delegates_elections,_2026",
}


def get_election_url(body, state_code):
    """Convert a seats.json body name to a Ballotpedia election page URL."""
    # Check overrides first
    if body in BODY_URL_OVERRIDES:
        return f"{BP_BASE}/{BODY_URL_OVERRIDES[body]}"

    state_name = STATE_NAMES.get(state_code, "")
    if not state_name:
        return None

    # Parse body: "Texas House" -> chamber = "House"
    # Body format is "{StateName} {Chamber}"
    parts = body.split()
    chamber = parts[-1] if parts else ""

    if chamber == "Senate":
        return f"{BP_BASE}/{state_name}_State_Senate_elections,_2026"
    elif chamber == "House":
        return f"{BP_BASE}/{state_name}_House_of_Representatives_elections,_2026"
    elif chamber == "Assembly":
        return f"{BP_BASE}/{state_name}_State_Assembly_elections,_2026"

    return None


# ── Rate-limited HTTP ────────────────────────────────────────────────────

async def bp_get(client, url):
    """Rate-limited GET for Ballotpedia with retry on 202/429."""
    global last_bp_request

    for attempt in range(BP_MAX_RETRIES + 1):
        elapsed = time.time() - last_bp_request
        if elapsed < BP_RATE:
            await asyncio.sleep(BP_RATE - elapsed)
        try:
            resp = await client.get(url, timeout=30.0, follow_redirects=True)
            last_bp_request = time.time()
            if resp.status_code == 200:
                return resp.text
            if resp.status_code in (202, 429, 503):
                wait = BP_RETRY_WAIT * (attempt + 1)
                if attempt < BP_MAX_RETRIES:
                    print(f"  HTTP {resp.status_code}, waiting {wait}s (retry {attempt+1}/{BP_MAX_RETRIES}) ... ", end='', flush=True)
                    await asyncio.sleep(wait)
                    continue
                else:
                    print(f"  HTTP {resp.status_code} after {BP_MAX_RETRIES} retries for {url}")
                    return None
            print(f"  HTTP {resp.status_code} for {url}")
            return None
        except Exception as e:
            if attempt < BP_MAX_RETRIES:
                wait = BP_RETRY_WAIT * (attempt + 1)
                print(f"  Error: {e}, retrying in {wait}s ... ", end='', flush=True)
                await asyncio.sleep(wait)
                continue
            print(f"  Request failed for {url}: {e}")
            return None
    return None


async def scrape_get(client, url):
    """Rate-limited GET for campaign websites."""
    global last_scrape_request
    elapsed = time.time() - last_scrape_request
    if elapsed < SCRAPE_RATE:
        await asyncio.sleep(SCRAPE_RATE - elapsed)
    try:
        resp = await client.get(url, timeout=15.0, follow_redirects=True)
        last_scrape_request = time.time()
        if resp.status_code == 200:
            return resp.text
        return None
    except Exception:
        return None


# ── Phase 1: Discover candidates from election listing pages ─────────────

def parse_candidate_name(text):
    """Parse candidate name, removing incumbent marker and whitespace."""
    name = text.strip()
    is_incumbent = False
    if "(i)" in name:
        is_incumbent = True
        name = name.replace("(i)", "").strip()
    # Remove any remaining parenthetical notes
    name = re.sub(r'\s*\(.*?\)\s*$', '', name).strip()
    return name, is_incumbent


def split_name(full_name):
    """Split a full name into firstName and lastName."""
    parts = full_name.strip().split()
    if len(parts) == 0:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    # Handle suffixes like Jr., III, etc.
    suffixes = {'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'}
    last = parts[-1]
    if last.lower().rstrip('.') in suffixes and len(parts) > 2:
        return parts[0], ' '.join(parts[1:])
    return parts[0], ' '.join(parts[1:])


def parse_district_number(district_text):
    """Extract district number from text like 'District 1' or 'District 42'."""
    m = re.search(r'District\s+(\d+)', district_text, re.IGNORECASE)
    if m:
        return m.group(1)
    # Try just a number
    m = re.search(r'(\d+)', district_text)
    if m:
        return m.group(1)
    return None


def parse_state_legislative_table(html, body, state_code):
    """Parse a Ballotpedia state legislative election table page.
    Returns list of candidate dicts."""
    soup = BeautifulSoup(html, 'lxml')
    candidates = []

    tables = soup.find_all('table', class_='candidateListTablePartisan')
    if not tables:
        print(f"  No candidateListTablePartisan tables found for {body}")
        return candidates

    # Use the first table (general election) — later tables are primaries/runoffs
    table = tables[0]
    rows = table.find_all('tr')

    for row in rows:
        cells = row.find_all('td')
        if len(cells) < 3:
            continue

        # First cell: district
        district_text = cells[0].get_text(strip=True)
        district_num = parse_district_number(district_text)
        if not district_num:
            continue

        # Remaining cells: candidates by party column
        # Typically: [District, Democratic, Republican, Other]
        party_columns = ['Democrat', 'Republican', 'Other']
        for i, party in enumerate(party_columns):
            cell_idx = i + 1
            if cell_idx >= len(cells):
                break

            cell = cells[cell_idx]
            # Find all candidate links in this cell
            links = cell.find_all('a', href=True)
            for link in links:
                href = link.get('href', '')
                name_text = link.get_text(strip=True)

                # Skip non-candidate links (survey badges, district links, icons)
                if not name_text or len(name_text) < 2:
                    continue
                if '/Survey' in href or 'Overview' in href:
                    continue
                if '#' in href and 'Campaign' in href:
                    continue
                if 'District' in name_text and 'District' in href:
                    continue

                full_name, is_incumbent = parse_candidate_name(name_text)
                if not full_name or len(full_name) < 3:
                    continue

                first_name, last_name = split_name(full_name)
                profile_url = href if href.startswith('http') else BP_BASE + href

                candidates.append({
                    'firstName': first_name,
                    'lastName': last_name,
                    'name': full_name,
                    'party': party,
                    'district': district_num,
                    'isIncumbent': is_incumbent,
                    'ballotpediaUrl': profile_url,
                    'website': '',
                    'email': '',
                    'source': 'ballotpedia',
                })

    return candidates


def parse_governor_tables(html):
    """Parse the gubernatorial elections page.
    Returns dict of state_code -> list of candidates."""
    soup = BeautifulSoup(html, 'lxml')
    by_state = {}

    # The page has sortable tables per state with columns: candidate, party, office, status
    tables = soup.find_all('table', class_='sortable')

    for table in tables:
        rows = table.find_all('tr')
        if len(rows) < 2:
            continue

        # Check headers
        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(['th', 'td'])]
        if 'candidate' not in headers or 'party' not in headers:
            continue

        cand_idx = headers.index('candidate')
        party_idx = headers.index('party')
        status_idx = headers.index('status') if 'status' in headers else -1

        for row in rows[1:]:
            cells = row.find_all(['td', 'th'])
            if len(cells) <= max(cand_idx, party_idx):
                continue

            # Get candidate name and profile link
            cand_cell = cells[cand_idx]
            name_text = cand_cell.get_text(strip=True)
            link = cand_cell.find('a', href=True)
            profile_url = ''
            if link:
                href = link.get('href', '')
                profile_url = href if href.startswith('http') else BP_BASE + href
                name_text = link.get_text(strip=True)

            # Clean up incumbent marker
            is_incumbent = 'Incumbent' in name_text
            name_text = name_text.replace('Incumbent', '').strip()
            full_name, inc2 = parse_candidate_name(name_text)
            is_incumbent = is_incumbent or inc2

            if not full_name or len(full_name) < 3:
                continue

            # Party
            party_text = cells[party_idx].get_text(strip=True)
            party = 'Democrat' if 'Dem' in party_text else 'Republican' if 'Rep' in party_text else party_text

            # Status — skip withdrawn candidates
            if status_idx >= 0 and status_idx < len(cells):
                status = cells[status_idx].get_text(strip=True)
                if 'Withdrew' in status or 'Disqualified' in status or 'Lost' in status:
                    continue

            # Extract state from office column or from the preceding heading
            office_idx = headers.index('office') if 'office' in headers else -1
            state_code = None
            if office_idx >= 0 and office_idx < len(cells):
                office_text = cells[office_idx].get_text(strip=True)
                # "Governor of Texas" -> find state
                m = re.search(r'Governor of (.+)', office_text)
                if m:
                    state_name = m.group(1).strip()
                    # Reverse lookup
                    for code, name in STATE_NAMES.items():
                        if name.replace('_', ' ') == state_name:
                            state_code = code
                            break

            if not state_code:
                continue

            first_name, last_name = split_name(full_name)

            if state_code not in by_state:
                by_state[state_code] = []

            by_state[state_code].append({
                'firstName': first_name,
                'lastName': last_name,
                'name': full_name,
                'party': party,
                'isIncumbent': is_incumbent,
                'ballotpediaUrl': profile_url,
                'website': '',
                'email': '',
                'source': 'ballotpedia',
            })

    return by_state


# ── Phase 2: Enrich from profile pages + campaign websites ───────────────

async def get_campaign_website(client, profile_url):
    """Fetch a Ballotpedia profile page and extract the campaign website URL."""
    html = await bp_get(client, profile_url)
    if not html:
        return None

    soup = BeautifulSoup(html, 'lxml')

    # Look for "Campaign website" or "Website" links
    for a in soup.find_all('a', href=True):
        text = a.get_text(strip=True).lower()
        href = a.get('href', '')
        if ('campaign' in text and 'website' in text) or text == 'website':
            if href.startswith('http') and 'ballotpedia' not in href:
                return href

    # Fallback: check infobox for external links
    infobox = soup.find('table', class_='infobox')
    if infobox:
        for a in infobox.find_all('a', href=True):
            href = a.get('href', '')
            if href.startswith('http') and 'ballotpedia' not in href:
                domain = urlparse(href).netloc.lower()
                # Skip social media
                socials = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com',
                           'youtube.com', 'linkedin.com', 'tiktok.com']
                if not any(s in domain for s in socials):
                    return href

    return None


async def scrape_email_from_website(client, website_url):
    """Scrape a campaign website for contact email addresses."""
    if not website_url:
        return None

    # Try the main page and /contact page
    urls_to_try = [website_url]
    base = website_url.rstrip('/')
    if not base.endswith('/contact'):
        urls_to_try.append(base + '/contact')
        urls_to_try.append(base + '/contact-us')

    found_emails = set()
    for url in urls_to_try:
        html = await scrape_get(client, url)
        if not html:
            continue
        emails = EMAIL_REGEX.findall(html)
        for email in emails:
            if is_valid_contact_email(email):
                found_emails.add(email.lower())

    if not found_emails:
        return None

    # Prefer emails that look like candidate contact
    # Priority: info@, contact@, [name]@
    for e in sorted(found_emails):
        local = e.split('@')[0]
        if local in ('info', 'contact'):
            return e

    # Return first valid one
    return sorted(found_emails)[0]


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


# ── Main pipeline ────────────────────────────────────────────────────────

async def phase1_discover(client, seats_data, cache, state_filter=None, governors_only=False):
    """Phase 1: Discover candidates from Ballotpedia election listing pages."""
    print("\n" + "=" * 60)
    print("PHASE 1: Discovering candidates from Ballotpedia")
    print("=" * 60)

    seats = seats_data['seats']
    total_found = 0

    if not governors_only:
        # Get unique state+body combinations for state legislative seats
        state_bodies = {}
        for seat in seats:
            if seat['body'] in ('US House', 'US Senate', 'Governor'):
                continue
            if not seat.get('upIn2026'):
                continue
            if state_filter and seat['state'] != state_filter:
                continue
            key = f"{seat['state']}|{seat['body']}"
            if key not in state_bodies:
                state_bodies[key] = seat['body']

        print(f"\nState legislative chambers to scrape: {len(state_bodies)}")

        for i, (key, body) in enumerate(sorted(state_bodies.items())):
            state_code = key.split('|')[0]

            # Skip if already cached
            if key in cache['discovered']:
                count = len(cache['discovered'][key])
                total_found += count
                print(f"  [{i+1}/{len(state_bodies)}] {body} — cached ({count} candidates)")
                continue

            url = get_election_url(body, state_code)
            if not url:
                print(f"  [{i+1}/{len(state_bodies)}] {body} — no URL mapping, skipping")
                continue

            print(f"  [{i+1}/{len(state_bodies)}] {body} ... ", end='', flush=True)
            html = await bp_get(client, url)
            if not html:
                print("FAILED")
                continue

            candidates = parse_state_legislative_table(html, body, state_code)
            cache['discovered'][key] = candidates
            total_found += len(candidates)
            print(f"{len(candidates)} candidates")

            # Save cache periodically
            if (i + 1) % 10 == 0:
                save_cache(cache)

    # Governors
    if not state_filter or governors_only:
        gov_cache_key = "GOVERNORS"
        if gov_cache_key not in cache['discovered']:
            print(f"\n  Scraping gubernatorial elections page ...")
            html = await bp_get(client, f"{BP_BASE}/Gubernatorial_elections,_2026")
            if html:
                gov_by_state = parse_governor_tables(html)
                cache['discovered'][gov_cache_key] = gov_by_state
                gov_total = sum(len(v) for v in gov_by_state.values())
                total_found += gov_total
                print(f"  Found {gov_total} gubernatorial candidates across {len(gov_by_state)} states")
            else:
                print("  FAILED to fetch governor page")
        else:
            gov_total = sum(len(v) for v in cache['discovered'][gov_cache_key].values())
            total_found += gov_total
            print(f"\n  Governors — cached ({gov_total} candidates)")
    elif state_filter:
        # For single-state testing, scrape that state's governor page
        gov_cache_key = f"GOV-{state_filter}"
        if gov_cache_key not in cache['discovered']:
            state_name = STATE_NAMES.get(state_filter, '')
            if state_name:
                url = f"{BP_BASE}/{state_name}_gubernatorial_election,_2026"
                print(f"\n  Scraping {state_name} governor race ...")
                html = await bp_get(client, url)
                if html:
                    # Parse the state-specific governor page (uses same sortable table format)
                    soup = BeautifulSoup(html, 'lxml')
                    gov_candidates = []
                    for table in soup.find_all('table', class_='sortable'):
                        rows = table.find_all('tr')
                        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(['th', 'td'])] if rows else []
                        if 'candidate' not in headers:
                            continue
                        cand_idx = headers.index('candidate')
                        party_idx = headers.index('party') if 'party' in headers else -1
                        for row in rows[1:]:
                            cells = row.find_all(['td', 'th'])
                            if len(cells) <= cand_idx:
                                continue
                            cand_cell = cells[cand_idx]
                            name_text = cand_cell.get_text(strip=True)
                            link = cand_cell.find('a', href=True)
                            profile_url = ''
                            if link:
                                href = link.get('href', '')
                                profile_url = href if href.startswith('http') else BP_BASE + href
                                name_text = link.get_text(strip=True)
                            is_incumbent = 'Incumbent' in name_text
                            name_text = name_text.replace('Incumbent', '').strip()
                            full_name, inc2 = parse_candidate_name(name_text)
                            is_incumbent = is_incumbent or inc2
                            if not full_name or len(full_name) < 3:
                                continue
                            party = ''
                            if party_idx >= 0 and party_idx < len(cells):
                                pt = cells[party_idx].get_text(strip=True)
                                party = 'Democrat' if 'Dem' in pt else 'Republican' if 'Rep' in pt else pt
                            first_name, last_name = split_name(full_name)
                            gov_candidates.append({
                                'firstName': first_name, 'lastName': last_name,
                                'name': full_name, 'party': party,
                                'isIncumbent': is_incumbent,
                                'ballotpediaUrl': profile_url,
                                'website': '', 'email': '', 'source': 'ballotpedia',
                            })
                    cache['discovered'][gov_cache_key] = {state_filter: gov_candidates}
                    total_found += len(gov_candidates)
                    print(f"  Found {len(gov_candidates)} candidates")

    save_cache(cache)
    print(f"\nPhase 1 complete: {total_found} total candidates discovered")
    return total_found


async def phase2_enrich(client, cache, state_filter=None):
    """Phase 2: Get campaign websites from profiles, then scrape for emails."""
    print("\n" + "=" * 60)
    print("PHASE 2: Enriching candidates with websites + emails")
    print("=" * 60)

    # Collect all candidates that need enrichment
    to_enrich = []
    for key, candidates in cache['discovered'].items():
        if key == 'GOVERNORS' or key.startswith('GOV-'):
            # Governor data is nested: {state: [candidates]}
            for state_code, gov_cands in candidates.items():
                if state_filter and state_code != state_filter:
                    continue
                for cand in gov_cands:
                    cache_key = cand.get('ballotpediaUrl', cand['name'])
                    if cache_key and cache_key not in cache['enriched']:
                        to_enrich.append((cand, cache_key, 'governor'))
        else:
            state_code = key.split('|')[0]
            if state_filter and state_code != state_filter:
                continue
            for cand in candidates:
                cache_key = cand.get('ballotpediaUrl', cand['name'])
                if cache_key and cache_key not in cache['enriched']:
                    to_enrich.append((cand, cache_key, 'state'))

    print(f"\nCandidates to enrich: {len(to_enrich)}")
    if not to_enrich:
        print("Nothing to do.")
        return

    enriched_count = 0
    email_count = 0
    website_count = 0

    for i, (cand, cache_key, cand_type) in enumerate(to_enrich):
        profile_url = cand.get('ballotpediaUrl', '')
        if not profile_url:
            cache['enriched'][cache_key] = {'website': '', 'email': ''}
            continue

        print(f"  [{i+1}/{len(to_enrich)}] {cand['name']} ... ", end='', flush=True)

        # Step 1: Get campaign website from Ballotpedia profile
        website = await get_campaign_website(client, profile_url)

        # Step 2: Scrape campaign website for email
        email = None
        if website:
            website_count += 1
            email = await scrape_email_from_website(client, website)
            if email:
                email_count += 1

        result = {'website': website or '', 'email': email or ''}
        cache['enriched'][cache_key] = result
        enriched_count += 1

        status = f"website={website or 'none'}"
        if email:
            status += f" email={email}"
        print(status)

        # Save cache every 25 candidates
        if (i + 1) % 25 == 0:
            save_cache(cache)
            print(f"  --- Progress: {i+1}/{len(to_enrich)} enriched, {website_count} websites, {email_count} emails ---")

    save_cache(cache)
    print(f"\nPhase 2 complete: {enriched_count} enriched, {website_count} websites, {email_count} emails")


def apply_to_seats(seats_data, cache, state_filter=None):
    """Apply discovered + enriched candidates to seats.json."""
    print("\n" + "=" * 60)
    print("APPLYING CANDIDATES TO SEATS.JSON")
    print("=" * 60)

    seats = seats_data['seats']
    total_added = 0
    total_with_email = 0
    total_with_website = 0

    # Build a lookup: state|body -> {district -> [candidates]}
    # From discovered cache
    by_seat = {}
    for key, candidates in cache['discovered'].items():
        if key == 'GOVERNORS' or key.startswith('GOV-'):
            continue  # Handle governors separately
        state_code = key.split('|')[0]
        body = key.split('|')[1]
        if state_filter and state_code != state_filter:
            continue
        for cand in candidates:
            district = cand.get('district', '')
            seat_key = f"{state_code}|{body}|{district}"
            if seat_key not in by_seat:
                by_seat[seat_key] = []
            by_seat[seat_key].append(cand)

    # Apply to seats
    for seat in seats:
        if seat['body'] in ('US House', 'US Senate'):
            continue
        if state_filter and seat['state'] != state_filter:
            continue

        # Handle governor seats
        if seat['body'] == 'Governor':
            state_code = seat['state']
            gov_cands = []
            # Check both GOVERNORS and GOV-{state} cache keys
            for gk in ['GOVERNORS', f'GOV-{state_code}']:
                if gk in cache['discovered']:
                    gov_data = cache['discovered'][gk]
                    if state_code in gov_data:
                        gov_cands = gov_data[state_code]
                        break

            if gov_cands:
                new_candidates = []
                for cand in gov_cands:
                    # Apply enrichment
                    cache_key = cand.get('ballotpediaUrl', cand['name'])
                    enrichment = cache.get('enriched', {}).get(cache_key, {})
                    website = enrichment.get('website', '') or cand.get('website', '')
                    email = enrichment.get('email', '') or cand.get('email', '')

                    new_candidates.append({
                        'firstName': cand['firstName'],
                        'lastName': cand['lastName'],
                        'name': cand['name'],
                        'party': cand['party'],
                        'email': email,
                        'website': website,
                        'ballotpediaUrl': cand.get('ballotpediaUrl', ''),
                        'source': 'ballotpedia',
                    })
                    total_added += 1
                    if email:
                        total_with_email += 1
                    if website:
                        total_with_website += 1

                    # Set incumbent if marked
                    if cand.get('isIncumbent') and not seat.get('incumbent'):
                        seat['incumbent'] = {
                            'name': cand['name'],
                            'party': cand['party'][0] if cand['party'] else '?',
                        }

                seat['candidates'] = new_candidates
            continue

        # State legislative seats
        seat_key = f"{seat['state']}|{seat['body']}|{seat.get('district', '')}"
        candidates = by_seat.get(seat_key, [])
        if not candidates:
            continue

        new_candidates = []
        for cand in candidates:
            # Apply enrichment
            cache_key = cand.get('ballotpediaUrl', cand['name'])
            enrichment = cache.get('enriched', {}).get(cache_key, {})
            website = enrichment.get('website', '') or cand.get('website', '')
            email = enrichment.get('email', '') or cand.get('email', '')

            new_candidates.append({
                'firstName': cand['firstName'],
                'lastName': cand['lastName'],
                'name': cand['name'],
                'party': cand['party'],
                'email': email,
                'website': website,
                'ballotpediaUrl': cand.get('ballotpediaUrl', ''),
                'source': 'ballotpedia',
            })
            total_added += 1
            if email:
                total_with_email += 1
            if website:
                total_with_website += 1

            # Set incumbent if marked
            if cand.get('isIncumbent') and not seat.get('incumbent'):
                seat['incumbent'] = {
                    'name': cand['name'],
                    'party': cand['party'][0] if cand['party'] else '?',
                }

        seat['candidates'] = new_candidates

    print(f"\nAdded {total_added} candidates to seats.json")
    print(f"  With website: {total_with_website}")
    print(f"  With email: {total_with_email}")

    # Save seats.json
    with open(SEATS_FILE, 'w', encoding='utf-8') as f:
        json.dump(seats_data, f, indent=2, ensure_ascii=False)
    print(f"Saved to {SEATS_FILE}")


async def main():
    args = sys.argv[1:]
    discover_only = '--discover-only' in args
    enrich_only = '--enrich-only' in args
    governors_only = '--governors-only' in args
    state_filter = None
    if '--state' in args:
        idx = args.index('--state')
        if idx + 1 < len(args):
            state_filter = args[idx + 1].upper()

    print("=" * 60)
    print("SAFE Action — Ballotpedia State Candidate Scraper")
    print("=" * 60)
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if state_filter:
        print(f"State filter: {state_filter}")
    if discover_only:
        print("Mode: Discovery only (Phase 1)")
    elif enrich_only:
        print("Mode: Enrichment only (Phase 2)")
    elif governors_only:
        print("Mode: Governors only")

    # Load data
    with open(SEATS_FILE, 'r', encoding='utf-8') as f:
        seats_data = json.load(f)
    cache = load_cache()

    async with httpx.AsyncClient(
        headers={'User-Agent': UA},
        follow_redirects=True,
        timeout=30.0,
    ) as client:

        if not enrich_only:
            await phase1_discover(client, seats_data, cache, state_filter, governors_only)

        if not discover_only:
            await phase2_enrich(client, cache, state_filter)

    # Apply to seats.json
    apply_to_seats(seats_data, cache, state_filter)

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    asyncio.run(main())
