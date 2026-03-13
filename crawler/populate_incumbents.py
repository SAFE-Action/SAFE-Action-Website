#!/usr/bin/env python3
"""
Populate seats.json with incumbent data from legislators.json
and candidate data from ballotpedia_candidates_cache.json.
"""

import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEATS_PATH = os.path.join(BASE_DIR, 'data', 'seats.json')
LEGISLATORS_PATH = os.path.join(BASE_DIR, 'data', 'legislators.json')
BALLOTPEDIA_CACHE_PATH = os.path.join(BASE_DIR, 'data', 'ballotpedia_candidates_cache.json')

# State name to 2-letter code mapping
STATE_CODES = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY',
}

# Body chamber word -> legislator chamber for matching
# "Assembly" bodies match legislators with chamber "House"
CHAMBER_MAP = {
    'House': 'House',
    'Senate': 'Senate',
    'Assembly': 'House',
    'Legislature': 'Legislature',
}

# Full party name -> abbreviation
PARTY_ABBREV = {
    'Democratic': 'D',
    'Democrat': 'D',
    'Republican': 'R',
    'Independent': 'I',
    'Nonpartisan': 'NP',
    'Libertarian': 'L',
    'Green': 'G',
    'Forward': 'F',
    'Democratic-Farmer-Labor': 'D',
    'Democratic/Working Families': 'D',
    'Democratic/Independence/Working Families': 'D',
    'Democratic/Progressive': 'D',
    'Republican/Conservative': 'R',
    'Republican/Conservative/Independence': 'R',
    'Republican/Conservative/Independence/Reform': 'R',
    'Republican/Conservative/Independence/Libertarian': 'R',
}


def abbreviate_party(party_str):
    """Convert full party name to abbreviation."""
    if not party_str:
        return ''
    if party_str in PARTY_ABBREV:
        return PARTY_ABBREV[party_str]
    # Already abbreviated?
    if len(party_str) <= 3:
        return party_str
    # Fallback
    return party_str[0].upper()


def parse_body_name(body):
    """Parse body name like 'Texas House' -> (state_code, chamber).
    Returns (None, None) for unparseable bodies like 'Governor'.
    """
    if body == 'Governor':
        return None, None

    # Find the chamber word (last word)
    parts = body.rsplit(' ', 1)
    if len(parts) != 2:
        return None, None

    state_name = parts[0]
    chamber_word = parts[1]

    state_code = STATE_CODES.get(state_name)
    if not state_code:
        # Try multi-word state names by checking all known states
        for sn, sc in STATE_CODES.items():
            if body.startswith(sn + ' '):
                state_code = sc
                chamber_word = body[len(sn) + 1:]
                break

    if not state_code:
        return None, None

    chamber = CHAMBER_MAP.get(chamber_word)
    if not chamber:
        return None, None

    return state_code, chamber


def normalize_name(name):
    """Normalize name for dedup comparison."""
    return ' '.join(name.lower().split())


def main():
    # Load data
    with open(SEATS_PATH, 'r', encoding='utf-8') as f:
        seats_data = json.load(f)

    with open(LEGISLATORS_PATH, 'r', encoding='utf-8') as f:
        legislators_data = json.load(f)

    bp_cache = {}
    if os.path.exists(BALLOTPEDIA_CACHE_PATH):
        with open(BALLOTPEDIA_CACHE_PATH, 'r', encoding='utf-8') as f:
            bp_cache = json.load(f)

    seats = seats_data['seats']
    legislators = legislators_data['legislators']
    bp_discovered = bp_cache.get('discovered', {})
    bp_enriched = bp_cache.get('enriched', {})

    # Build lookup: (state_code, chamber, district) -> legislator
    # Some seats may have multiple legislators (e.g. multi-member districts)
    leg_lookup = {}
    state_legs = [l for l in legislators if l.get('level') == 'State']
    print(f"State legislators loaded: {len(state_legs)}")

    for leg in state_legs:
        key = (leg['state'], leg['chamber'], str(leg['district']))
        if key not in leg_lookup:
            leg_lookup[key] = []
        leg_lookup[key].append(leg)

    # Build BP lookup: body_name -> {district: [candidates]}
    bp_lookup = {}
    for cache_key, candidates in bp_discovered.items():
        # cache_key format: "TX|Texas House"
        parts = cache_key.split('|', 1)
        if len(parts) != 2:
            continue
        body_name = parts[1]
        if body_name not in bp_lookup:
            bp_lookup[body_name] = {}
        for cand in candidates:
            dist = str(cand.get('district', ''))
            if dist not in bp_lookup[body_name]:
                bp_lookup[body_name][dist] = []
            bp_lookup[body_name][dist].append(cand)

    # Stats
    seats_with_incumbent = 0
    seats_with_bp_candidates = 0
    total_incumbents = 0
    total_candidates = 0
    seats_still_empty = 0
    state_seat_count = 0
    skipped_bodies = set()

    for seat in seats:
        if seat.get('level') != 'State':
            continue
        if seat.get('body') == 'Governor':
            continue

        state_seat_count += 1
        body = seat['body']
        district = str(seat.get('district', ''))

        state_code, chamber = parse_body_name(body)
        if not state_code:
            skipped_bodies.add(body)
            continue

        # Ensure incumbents array exists
        if 'incumbents' not in seat:
            seat['incumbents'] = []
        if 'candidates' not in seat:
            seat['candidates'] = []

        existing_names = set(normalize_name(c.get('name', '')) for c in seat['candidates'])
        existing_inc_names = set(normalize_name(i.get('name', '')) for i in seat['incumbents'])

        # 1) Match legislator -> incumbent
        # For Assembly bodies, we match against chamber "House" in legislators
        leg_key = (state_code, chamber, district)
        matched_legs = leg_lookup.get(leg_key, [])

        if matched_legs:
            seats_with_incumbent += 1
            for leg in matched_legs:
                name_norm = normalize_name(leg['name'])
                if name_norm in existing_inc_names:
                    continue
                existing_inc_names.add(name_norm)

                contact = leg.get('contact', {})
                inc_entry = {
                    'name': leg['name'],
                    'party': abbreviate_party(leg.get('party', '')),
                    'email': contact.get('email', ''),
                    'website': contact.get('website', ''),
                    'phone': contact.get('phone', ''),
                    'photo_url': leg.get('photo_url', ''),
                    'source': 'legislators',
                }
                seat['incumbents'].append(inc_entry)
                total_incumbents += 1

        # 2) Merge Ballotpedia candidates
        bp_cands = bp_lookup.get(body, {}).get(district, [])
        if bp_cands:
            seats_with_bp_candidates += 1
            for cand in bp_cands:
                name_norm = normalize_name(cand.get('name', ''))
                if name_norm in existing_names or name_norm in existing_inc_names:
                    continue
                existing_names.add(name_norm)

                # Check enriched data
                bp_url = cand.get('ballotpediaUrl', '')
                enriched = bp_enriched.get(bp_url, {}) if bp_url else {}

                email = enriched.get('email', '') or cand.get('email', '')
                website = enriched.get('website', '') or cand.get('website', '')

                # Skip sentry/junk emails
                if email and 'sentry' in email.lower():
                    email = ''

                cand_entry = {
                    'name': cand['name'],
                    'party': abbreviate_party(cand.get('party', '')),
                    'email': email,
                    'website': website,
                    'phone': '',
                    'ballotpediaUrl': bp_url,
                    'source': 'ballotpedia',
                }
                seat['candidates'].append(cand_entry)
                total_candidates += 1

        # Check if seat is still empty
        if not seat['incumbents'] and not seat['candidates']:
            seats_still_empty += 1

    # Write updated seats.json
    with open(SEATS_PATH, 'w', encoding='utf-8') as f:
        json.dump(seats_data, f, indent=2, ensure_ascii=False)

    print(f"\n=== Population Results ===")
    print(f"State legislative seats processed: {state_seat_count}")
    print(f"Seats matched to incumbent:        {seats_with_incumbent}")
    print(f"Seats with Ballotpedia candidates:  {seats_with_bp_candidates}")
    print(f"Total incumbents added:             {total_incumbents}")
    print(f"Total BP candidates added:          {total_candidates}")
    print(f"Total people across all seats:       {total_incumbents + total_candidates}")
    print(f"Seats still empty (no data):        {seats_still_empty}")
    if skipped_bodies:
        print(f"Skipped bodies: {skipped_bodies}")


if __name__ == '__main__':
    main()
