"""
Fix empty state seats in seats.json by matching legislators from legislators.json.

Strategy:
1. EXACT MATCH: Match by state + district (handles most states with numeric districts)
2. BODY MATCH: For states where districts don't match (named vs numeric),
   assign legislators to empty seats sequentially by body
"""

import json
import sys
import os
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

def load_data():
    with open(os.path.join(DATA_DIR, 'seats.json'), encoding='utf-8') as f:
        seats_data = json.load(f)
    with open(os.path.join(DATA_DIR, 'legislators.json'), encoding='utf-8') as f:
        legs_data = json.load(f)
    return seats_data, legs_data['legislators']


def body_to_chamber(body_name):
    """Map seat body name to legislator chamber."""
    if 'Assembly' in body_name:
        return 'Assembly'
    if 'House' in body_name:
        return 'House'
    if 'Senate' in body_name:
        return 'Senate'
    if 'Legislature' in body_name:
        return 'Legislature'
    if 'Delegates' in body_name:
        return 'House'  # e.g. "House of Delegates"
    return None


def leg_to_chamber_normalized(chamber):
    """Normalize legislator chamber to match body_to_chamber output."""
    # Legislators use House, Senate, Legislature
    # Seats use House, Senate, Assembly, Legislature
    # California Assembly legislators have chamber='House' but body='California Assembly'
    return chamber


def make_incumbent(leg):
    """Build incumbent dict from legislator data."""
    contact = leg.get('contact', {})
    inc = {
        'name': leg['name'],
        'party': leg['party'][0] if leg['party'] else '',
        'email': contact.get('email', ''),
        'website': contact.get('website', ''),
        'phone': '',
        'source': 'legislators',
    }
    if leg.get('photo_url'):
        inc['photo_url'] = leg['photo_url']
    return inc


def fix_seats():
    seats_data, legislators = load_data()
    seats = seats_data['seats']

    # Only work with state-level seats
    state_seats = [s for s in seats if s.get('level') == 'State']
    state_legs = [l for l in legislators if l.get('level') == 'State']

    print(f"Total state seats: {len(state_seats)}")
    print(f"Total state legislators: {len(state_legs)}")

    # Count initially empty
    def is_empty(seat):
        incs = seat.get('incumbents', [])
        cands = seat.get('candidates', [])
        return len(incs) == 0 and len(cands) == 0

    initially_empty = sum(1 for s in state_seats if is_empty(s))
    print(f"Initially empty state seats: {initially_empty}")

    # Build state->body mapping from seats
    # And body->state mapping
    body_to_state = {}
    for s in state_seats:
        body_to_state[s['body']] = s['state']

    # PHASE 1: Exact district match (state + district)
    # Build legislator lookup by (state, chamber, district)
    leg_by_key = defaultdict(list)
    for l in state_legs:
        key = (l['state'], l['chamber'], l.get('district', ''))
        leg_by_key[key].append(l)

    phase1_filled = 0
    used_leg_ids = set()

    for s in state_seats:
        if not is_empty(s):
            continue

        chamber = body_to_chamber(s['body'])
        if not chamber:
            continue

        # Try exact match
        # Seats use House/Senate/Assembly, legislators use House/Senate/Legislature
        # For Assembly states (CA, NY, WI), legislators might have chamber='House'
        chambers_to_try = [chamber]
        if chamber == 'Assembly':
            chambers_to_try.append('House')
        elif chamber == 'House':
            chambers_to_try.append('Assembly')

        for ch in chambers_to_try:
            key = (s['state'], ch, s['district'])
            candidates = leg_by_key.get(key, [])
            for leg in candidates:
                if leg['legislator_id'] not in used_leg_ids:
                    s.setdefault('incumbents', []).append(make_incumbent(leg))
                    used_leg_ids.add(leg['legislator_id'])
                    phase1_filled += 1
                    break
            if not is_empty(s):
                break

    print(f"\nPhase 1 (exact district match): {phase1_filled} seats filled")

    # PHASE 2: Body-level match for remaining empty seats
    # Group empty seats by body, and unmatched legislators by (state, chamber)
    remaining_empty_by_body = defaultdict(list)
    for s in state_seats:
        if is_empty(s):
            remaining_empty_by_body[s['body']].append(s)

    unmatched_legs_by_state_chamber = defaultdict(list)
    for l in state_legs:
        if l['legislator_id'] not in used_leg_ids:
            unmatched_legs_by_state_chamber[(l['state'], l['chamber'])].append(l)

    phase2_filled = 0
    phase2_details = []

    for body, empty_seats in remaining_empty_by_body.items():
        state = body_to_state.get(body)
        chamber = body_to_chamber(body)
        if not state or not chamber:
            continue

        # Try matching chambers
        chambers_to_try = [chamber]
        if chamber == 'Assembly':
            chambers_to_try.append('House')
        elif chamber == 'House':
            chambers_to_try.append('Assembly')

        available = []
        for ch in chambers_to_try:
            key = (state, ch)
            available = unmatched_legs_by_state_chamber.get(key, [])
            if available:
                break

        if not available:
            continue

        # Assign sequentially
        count = 0
        for seat in empty_seats:
            if not available:
                break
            leg = available.pop(0)
            seat.setdefault('incumbents', []).append(make_incumbent(leg))
            used_leg_ids.add(leg['legislator_id'])
            count += 1

        if count > 0:
            phase2_filled += count
            phase2_details.append(f"  {body}: {count} filled ({len(empty_seats) - count} still empty)")
            # Update the remaining list
            unmatched_legs_by_state_chamber[(state, chamber)] = available

    print(f"Phase 2 (body-level match): {phase2_filled} seats filled")
    for detail in sorted(phase2_details):
        print(detail)

    # Final stats
    final_empty = sum(1 for s in state_seats if is_empty(s))
    total_filled = initially_empty - final_empty
    print(f"\n=== SUMMARY ===")
    print(f"Initially empty: {initially_empty}")
    print(f"Total filled: {total_filled}")
    print(f"  Phase 1 (exact district): {phase1_filled}")
    print(f"  Phase 2 (body match): {phase2_filled}")
    print(f"Still empty: {final_empty}")

    # Show remaining empty by body
    remaining = defaultdict(int)
    for s in state_seats:
        if is_empty(s):
            remaining[s['body']] += 1
    if remaining:
        print(f"\nRemaining empty seats by body:")
        for body, count in sorted(remaining.items(), key=lambda x: -x[1])[:20]:
            st = body_to_state.get(body, '?')
            # Check how many unmatched legs for this state/chamber
            ch = body_to_chamber(body)
            avail = len(unmatched_legs_by_state_chamber.get((st, ch), []))
            print(f"  {count:4d}  {body} (unmatched legs: {avail})")

    # Also show unmatched legislators
    total_unmatched = sum(1 for l in state_legs if l['legislator_id'] not in used_leg_ids)
    print(f"\nUnmatched legislators remaining: {total_unmatched}")

    # Save
    seats_data['seats'] = seats  # seats list was modified in-place
    out_path = os.path.join(DATA_DIR, 'seats.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(seats_data, f, ensure_ascii=False, indent=2)
    print(f"\nSaved to {out_path}")


if __name__ == '__main__':
    fix_seats()
