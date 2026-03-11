"""Fetch state legislator data from Open States free CSV downloads.

Uses the publicly available CSV files at data.openstates.org/people/current/
which cover all 50 states + DC. No API key required.
"""

import asyncio
import csv
import io
from datetime import datetime, timezone

import httpx

CSV_BASE_URL = 'https://data.openstates.org/people/current'

ALL_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC',
]

_CHAMBER_MAP = {
    'upper': 'Senate',
    'lower': 'House',
}


async def _fetch_state_csv(client: httpx.AsyncClient, state: str) -> list[dict]:
    """Download and parse the CSV for a single state."""
    url = f'{CSV_BASE_URL}/{state.lower()}.csv'
    try:
        resp = await client.get(url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        text = resp.text
    except (httpx.HTTPError, Exception) as e:
        print(f'  Warning: Failed to fetch {state}: {e}')
        return []

    reader = csv.DictReader(io.StringIO(text))
    now = datetime.now(timezone.utc).isoformat()
    legislators = []

    for row in reader:
        name = row.get('name', '').strip()
        if not name:
            continue

        chamber_raw = row.get('current_chamber', '').strip()
        chamber = _CHAMBER_MAP.get(chamber_raw, chamber_raw.title() if chamber_raw else 'Unknown')
        district = row.get('current_district', '').strip()
        party = row.get('current_party', 'Unknown').strip()

        # Build stable ID
        last_name = name.split()[-1] if name else 'Unknown'
        id_parts = [state.upper(), 'State', chamber, last_name]
        if district:
            id_parts.append(str(district))
        legislator_id = '-'.join(id_parts).replace(' ', '-')

        # Contact info
        contact = {}
        email = row.get('email', '').strip()
        if email:
            contact['email'] = email
        phone = row.get('capitol_voice', '').strip() or row.get('district_voice', '').strip()
        if phone:
            contact['phone'] = phone
        address = row.get('capitol_address', '').strip() or row.get('district_address', '').strip()
        if address:
            contact['address'] = address

        # Links -> website
        links = row.get('links', '').strip()
        if links:
            first_link = links.split(';')[0].strip()
            if first_link:
                contact['website'] = first_link

        # Photo
        photo = row.get('image', '').strip() or None

        # Source URLs
        sources = row.get('sources', '').strip()
        source_urls = [s.strip() for s in sources.split(';') if s.strip()] if sources else []

        legislators.append({
            'legislator_id': legislator_id,
            'name': name,
            'party': party,
            'state': state.upper(),
            'district': district,
            'chamber': chamber,
            'level': 'State',
            'office': f'State {chamber}',
            'committees': [],
            'contact': contact,
            'photo_url': photo,
            'source_urls': source_urls[:3],
            'last_crawled': now,
        })

    return legislators


async def crawl_all_state_legislators(states: list[str] | None = None) -> list[dict]:
    """Fetch state legislators from free Open States CSV downloads.

    Covers all 50 states + DC by default. No API key needed.
    """
    target_states = states or ALL_STATES
    all_legislators = []

    async with httpx.AsyncClient() as client:
        # Fetch in batches of 10 to be polite
        batch_size = 10
        for i in range(0, len(target_states), batch_size):
            batch = target_states[i:i + batch_size]
            tasks = [_fetch_state_csv(client, st) for st in batch]
            results = await asyncio.gather(*tasks)
            for state_legs in results:
                all_legislators.extend(state_legs)
            if i + batch_size < len(target_states):
                await asyncio.sleep(1)  # Be polite between batches

    print(f'  Found {len(all_legislators)} state legislators across {len(target_states)} jurisdictions')
    return all_legislators
