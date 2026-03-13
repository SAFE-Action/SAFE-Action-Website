#!/usr/bin/env python3
"""
Merge enriched emails/websites from Ballotpedia cache into seats.json.

Handles:
1. Updating existing candidates' emails/websites
2. Updating incumbents' emails if enrichment found campaign emails
3. Adding missing candidates from Ballotpedia discovered list

Matching: name + state (last name exact + first initial)
"""

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEATS_PATH = os.path.join(ROOT, 'data', 'seats.json')
CACHE_PATH = os.path.join(ROOT, 'data', 'ballotpedia_candidates_cache.json')

JUNK_EMAIL_DOMAINS = [
    'wixpress.com', 'squarespace.com', 'weebly.com', 'godaddy.com',
    'wordpress.com', 'shopify.com', 'sentry.io', 'mailchimp.com',
    'constantcontact.com', 'hubspot.com', 'example.com', 'test.com',
    'localhost', 'herokuapp.com', 'netlify.app', 'vercel.app',
    'amazonaws.com', 'googleusercontent.com'
]


def is_junk_email(email):
    if not email or '@' not in email:
        return True
    local, domain = email.rsplit('@', 1)
    domain = domain.lower()
    for junk in JUNK_EMAIL_DOMAINS:
        if domain == junk or domain.endswith('.' + junk):
            return True
    if len(local) > 16 and all(c in '0123456789abcdef' for c in local.lower()):
        return True
    return False


def normalize_name(name):
    if not name:
        return ''
    name = name.lower().strip()
    for suffix in [' jr', ' sr', ' ii', ' iii', ' iv', ', jr', ', sr', '.']:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
    return name


def name_match(name1, name2):
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if not n1 or not n2:
        return False
    if n1 == n2:
        return True
    parts1 = n1.split()
    parts2 = n2.split()
    if len(parts1) < 2 or len(parts2) < 2:
        return n1 == n2
    # Last name exact + first initial
    if parts1[-1] != parts2[-1]:
        return False
    return parts1[0][0] == parts2[0][0]


# Map Ballotpedia body names to seats.json body names
BODY_MAP = {
    'Alaska House': 'Alaska House',
    'Alaska Senate': 'Alaska Senate',
    'Alabama House': 'Alabama House',
    'Alabama Senate': 'Alabama Senate',
    # Generic pattern: "{State} House/Senate/Assembly"
}


def body_matches(bp_body, seat_body):
    """Check if a Ballotpedia body name matches a seats.json body name."""
    if not bp_body or not seat_body:
        return False
    bp = bp_body.lower()
    sb = seat_body.lower()
    if bp == sb:
        return True
    # Both contain "house" or both contain "senate"
    bp_chamber = 'upper' if 'senate' in bp else 'lower' if any(x in bp for x in ['house', 'assembly', 'delegates']) else ''
    sb_chamber = 'upper' if 'senate' in sb else 'lower' if any(x in sb for x in ['house', 'assembly', 'delegates']) else ''
    return bp_chamber and bp_chamber == sb_chamber


def main():
    dry_run = '--dry-run' in sys.argv

    with open(SEATS_PATH, 'r', encoding='utf-8') as f:
        seats_data = json.load(f)
    with open(CACHE_PATH, 'r', encoding='utf-8') as f:
        cache = json.load(f)

    enriched = cache.get('enriched', {})
    discovered = cache.get('discovered', {})
    seat_list = seats_data['seats']

    # Build complete candidate info from discovered + enriched
    all_bp_candidates = []  # [{name, state, body, district, party, email, website, url}]
    for key, candidates in discovered.items():
        parts = key.split('|')
        state = parts[0]
        body = parts[1] if len(parts) > 1 else ''
        for c in candidates:
            if not isinstance(c, dict):
                continue
            url = c.get('ballotpediaUrl', '')
            enrich = enriched.get(url, {})
            email = enrich.get('email', '') or c.get('email', '')
            website = enrich.get('website', '') or c.get('website', '')
            if website == 'none':
                website = ''
            if is_junk_email(email):
                email = ''
            all_bp_candidates.append({
                'name': c.get('name', ''),
                'state': state,
                'body': body,
                'district': str(c.get('district', '')),
                'party': c.get('party', ''),
                'email': email,
                'website': website,
                'isIncumbent': c.get('isIncumbent', False),
                'ballotpediaUrl': url,
            })

    print(f"Ballotpedia candidates total: {len(all_bp_candidates)}")
    print(f"  With email: {sum(1 for c in all_bp_candidates if c['email'])}")

    # Index seats.json for matching
    # (state, last_name_lower) -> [(seat_idx, 'candidate'|'incumbent', list_idx, person_dict)]
    person_index = {}

    def index_person(state, name, seat_idx, ptype, list_idx, person):
        n = normalize_name(name)
        parts = n.split()
        if parts:
            key = (state, parts[-1])
            if key not in person_index:
                person_index[key] = []
            person_index[key].append((seat_idx, ptype, list_idx, person))

    for si, seat in enumerate(seat_list):
        state = seat.get('state', '')
        for ci, cand in enumerate(seat.get('candidates', [])):
            index_person(state, cand.get('name', ''), si, 'candidate', ci, cand)
        for ii, inc in enumerate(seat.get('incumbents', [])):
            index_person(state, inc.get('name', ''), si, 'incumbent', ii, inc)
        # Also index singular incumbent
        inc = seat.get('incumbent')
        if isinstance(inc, dict) and inc.get('name'):
            index_person(state, inc['name'], si, 'incumbent_singular', 0, inc)

    stats = {
        'candidate_email_added': 0,
        'candidate_website_added': 0,
        'incumbent_email_added': 0,
        'incumbent_website_added': 0,
        'candidate_added_to_seat': 0,
        'matched_existing': 0,
        'no_seat_match': 0,
        'already_has_email': 0,
    }

    # Process each Ballotpedia candidate
    for bp in all_bp_candidates:
        name = bp['name']
        state = bp['state']
        n = normalize_name(name)
        nparts = n.split()
        if not nparts:
            continue

        last = nparts[-1]
        key = (state, last)
        matches = person_index.get(key, [])

        best_match = None
        for si, ptype, li, person in matches:
            if name_match(name, person.get('name', '')):
                # Prefer candidate match over incumbent
                seat = seat_list[si]
                # Also check body/district match if possible
                seat_body = seat.get('body', '')
                if bp['body'] and not body_matches(bp['body'], seat_body):
                    continue
                best_match = (si, ptype, li, person)
                break

        if best_match:
            si, ptype, li, person = best_match
            stats['matched_existing'] += 1

            # Update email
            if bp['email']:
                existing = person.get('email', '')
                if not existing or is_junk_email(existing):
                    if not dry_run:
                        person['email'] = bp['email']
                    if ptype == 'candidate':
                        stats['candidate_email_added'] += 1
                    else:
                        stats['incumbent_email_added'] += 1
                else:
                    stats['already_has_email'] += 1

            # Update website
            if bp['website']:
                existing = person.get('website', '')
                if not existing:
                    if not dry_run:
                        person['website'] = bp['website']
                    if ptype == 'candidate':
                        stats['candidate_website_added'] += 1
                    else:
                        stats['incumbent_website_added'] += 1
        else:
            # No match in seats.json — try to find the right seat and add as candidate
            # Only add non-incumbents
            if bp['isIncumbent']:
                stats['no_seat_match'] += 1
                continue

            # Find the seat by state + body + district
            target_si = None
            for si, seat in enumerate(seat_list):
                if seat.get('state') != state:
                    continue
                if not body_matches(bp['body'], seat.get('body', '')):
                    continue
                if str(seat.get('district', '')) == bp['district']:
                    target_si = si
                    break

            if target_si is not None:
                new_cand = {
                    'name': bp['name'],
                    'party': bp['party'],
                    'email': bp['email'],
                    'website': bp['website'],
                    'source': 'ballotpedia',
                    'ballotpediaUrl': bp['ballotpediaUrl'],
                }
                if not dry_run:
                    if 'candidates' not in seat_list[target_si]:
                        seat_list[target_si]['candidates'] = []
                    seat_list[target_si]['candidates'].append(new_cand)
                stats['candidate_added_to_seat'] += 1
            else:
                stats['no_seat_match'] += 1

    # Print results
    print(f"\n=== Merge {'(DRY RUN) ' if dry_run else ''}Results ===")
    print(f"Matched existing person: {stats['matched_existing']}")
    print(f"Candidate emails added: {stats['candidate_email_added']}")
    print(f"Candidate websites added: {stats['candidate_website_added']}")
    print(f"Incumbent emails added: {stats['incumbent_email_added']}")
    print(f"Incumbent websites added: {stats['incumbent_website_added']}")
    print(f"Already had good email: {stats['already_has_email']}")
    print(f"New candidates added to seats: {stats['candidate_added_to_seat']}")
    print(f"No seat match: {stats['no_seat_match']}")

    # Final count
    total_cands = 0
    total_with_email = 0
    total_incs = 0
    inc_with_email = 0
    for seat in seat_list:
        for c in seat.get('candidates', []):
            total_cands += 1
            if c.get('email') and not is_junk_email(c.get('email', '')):
                total_with_email += 1
        for i in seat.get('incumbents', []):
            total_incs += 1
            if i.get('email') and not is_junk_email(i.get('email', '')):
                inc_with_email += 1

    print(f"\n--- Post-merge totals ---")
    print(f"Candidates: {total_cands} ({total_with_email} with email, {100*total_with_email/max(total_cands,1):.1f}%)")
    print(f"Incumbents: {total_incs} ({inc_with_email} with email, {100*inc_with_email/max(total_incs,1):.1f}%)")
    print(f"Total people: {total_cands + total_incs}")
    print(f"Total emails: {total_with_email + inc_with_email}")

    if not dry_run:
        with open(SEATS_PATH, 'w', encoding='utf-8') as f:
            json.dump(seats_data, f, ensure_ascii=False)
        print(f"\nWrote seats.json ({os.path.getsize(SEATS_PATH)/1024/1024:.1f} MB)")
    else:
        print("\nDry run — no changes written.")


if __name__ == '__main__':
    main()
