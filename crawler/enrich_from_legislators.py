#!/usr/bin/env python3
"""Cross-reference Ballotpedia candidates with legislators.json to fill in emails."""

import sys
import json
import os

sys.stdout.reconfigure(encoding='utf-8')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CACHE_PATH = os.path.join(ROOT_DIR, 'data', 'ballotpedia_candidates_cache.json')
LEGISLATORS_PATH = os.path.join(ROOT_DIR, 'data', 'legislators.json')


def parse_cache_key(key):
    """Parse 'AL|Alabama House' -> (state_code='AL', chamber='House')."""
    parts = key.split('|', 1)
    if len(parts) != 2:
        return None, None
    state_code = parts[0]
    body = parts[1]  # e.g. "Alabama House", "Nebraska Legislature"
    # Chamber is the last word
    words = body.split()
    chamber = words[-1] if words else None  # "House", "Senate", or "Legislature"
    return state_code, chamber


def fuzzy_name_match(cand, legislator):
    """Match by last name exact + first name starts with same letter, or exact full name."""
    cand_name = cand.get('name', '').strip().lower()
    leg_name = legislator.get('name', '').strip().lower()
    if cand_name == leg_name:
        return True
    cand_last = cand.get('lastName', '').strip().lower()
    cand_first = cand.get('firstName', '').strip().lower()
    # Parse legislator name (may be "First Last" or "First Middle Last")
    leg_parts = leg_name.split()
    if not leg_parts:
        return False
    leg_last = leg_parts[-1]
    leg_first = leg_parts[0]
    if cand_last == leg_last and cand_first and leg_first and cand_first[0] == leg_first[0]:
        return True
    return False


def build_legislator_index(legislators):
    """Build lookup: (state, chamber, district) -> list of legislators."""
    index = {}
    for leg in legislators:
        if leg.get('level') != 'State':
            continue
        key = (leg['state'], leg['chamber'], leg.get('district', ''))
        index.setdefault(key, []).append(leg)
    return index


def main():
    with open(CACHE_PATH, 'r', encoding='utf-8') as f:
        cache = json.load(f)

    with open(LEGISLATORS_PATH, 'r', encoding='utf-8') as f:
        leg_data = json.load(f)

    index = build_legislator_index(leg_data['legislators'])

    total_candidates = 0
    matched = 0
    emails_added = 0
    websites_added = 0

    discovered = cache.get('discovered', {})
    for cache_key, candidates in discovered.items():
        state_code, chamber = parse_cache_key(cache_key)
        if not state_code or not chamber:
            continue

        for cand in candidates:
            total_candidates += 1
            district = cand.get('district', '')
            lookup_key = (state_code, chamber, district)
            possible = index.get(lookup_key, [])

            for leg in possible:
                if fuzzy_name_match(cand, leg):
                    matched += 1
                    contact = leg.get('contact', {})
                    leg_email = contact.get('email', '')
                    leg_website = contact.get('website', '')
                    if leg_email and not cand.get('email'):
                        cand['email'] = leg_email
                        emails_added += 1
                    if leg_website and not cand.get('website'):
                        cand['website'] = leg_website
                        websites_added += 1
                    break

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

    print(f'Total candidates: {total_candidates}')
    print(f'Matched to legislator: {matched}')
    print(f'Emails added: {emails_added}')
    print(f'Websites added: {websites_added}')


if __name__ == '__main__':
    main()
