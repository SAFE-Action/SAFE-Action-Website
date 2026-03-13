#!/usr/bin/env python3
"""
Email Validation & Cleanup for seats.json

Removes emails that are NOT actual candidate contact emails:
1. Junk/placeholder emails (user@domain.com, sentry hashes, wixpress, etc.)
2. FEC compliance firm emails (treasurers, compliance consultants — not the candidate)
3. Emails that don't match the candidate name AND come from a known compliance domain
4. Generic template emails from website scrapers

KEEPS:
- Emails that match the candidate's name (in local part or domain)
- Official government emails (.gov)
- Campaign domain emails that match candidate name
- FEC emails that DO match the candidate name (they filed it themselves)
"""

import json
import re
import sys
from pathlib import Path
from collections import Counter

DATA_DIR = Path(__file__).parent.parent / "data"
SEATS_FILE = DATA_DIR / "seats.json"

# ── Junk patterns: always remove ──────────────────────────────────
JUNK_EMAILS = {
    'user@domain.com',
    'email@example.com',
    'example@example.com',
    'test@test.com',
    'info@example.com',
    'contact@example.com',
}

JUNK_DOMAINS = {
    # Sentry error tracking (scraped from JS on campaign sites)
    'sentry.wixpress.com',
    'sentry-next.wixpress.com',
    'o37417.ingest.sentry.io',
    'ingest.sentry.io',
    # Wix internal
    'wixpress.com',
    # Placeholder/parked
    'domain.com',
    'example.com',
    'domainmarket.com',
    # Hosting junk
    'herokuapp.com',
    'netlify.app',
    'vercel.app',
    'amazonaws.com',
    'googleusercontent.com',
}

# FEC compliance/treasurer firms — these are committee contacts, not candidate emails
FEC_COMPLIANCE_DOMAINS = {
    'pcmsllc.com',
    'hdlfec.com',
    'hdafec.com',
    'capcompliance.com',
    'mbacg.com',
    'thekalgroup.com',
    'abconsultingdc.com',
    'tmwcompliance.com',
    'commoncentsconsulting.net',
    'katzcompliance.com',
    'fecinfusion.org',
    'tabularius.pro',
    'bluewavepolitics.com',
    'campaignfinancial.com',
    'campaigncompliance.net',
    'incomplianceaz.com',
    'incompliance.net',
    'lizcurtisassociates.com',
    'harrisongammons.com',
    'crosbyott.com',
    'bisonstrategies.net',
    'jct3law.com',
    'eyebytes.com',
    '100squaredfinancial.com',
    'compliancecounselors.com',
    'sievertlarsen.com',
    'gfreedmancpa.com',
    'olsonremcho.com',
    'politicalcfo.com',
    'campbellpetersen.com',
    'fecfilingsolutions.com',
    'ctacgroup.com',
    'accountabilitypartner.com',
    'votecompliance.com',
}


def name_tokens(name):
    """Extract meaningful name parts for matching."""
    name = re.sub(r'\b(Jr\.?|Sr\.?|III?|IV|V|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\b', '', name, flags=re.I)
    parts = re.sub(r'[^a-z\s]', '', name.lower()).split()
    return [p for p in parts if len(p) > 2]


def email_matches_name(email, name):
    """Check if email has any connection to the candidate's name."""
    tokens = name_tokens(name)
    if not tokens:
        return True  # Can't verify — keep it
    local = email.split('@')[0].lower()
    domain = email.split('@')[1].lower() if '@' in email else ''
    # Remove domain TLD for matching
    domain_name = domain.rsplit('.', 1)[0] if '.' in domain else domain

    for t in tokens:
        if t in local or t in domain_name:
            return True

    # Check for nickname/abbreviation patterns
    # e.g., "abeforaz.com" for "Abraham", "aq4congress" for "Abrar Qadir"
    all_parts = [p for p in re.sub(r'[^a-z\s]', '', name.lower()).split() if len(p) > 1]
    combined = local + domain_name  # check against both
    if all_parts:
        # Check initials in domain (e.g., "aq" for "Abrar Qadir")
        initials = ''.join(n[0] for n in all_parts[:2])
        if len(initials) >= 2 and initials in domain_name:
            return True
        # Check first 3+ chars of any name part as abbreviation
        for part in all_parts:
            if len(part) > 3 and part[:4] in combined:
                return True
            if len(part) > 3 and part[:3] in domain_name:
                return True
        # Check last name partial (5+ chars) — e.g., "griff" for "griffitts"
        last = all_parts[-1]
        if len(last) >= 5 and last[:5] in combined:
            return True

    return False


def is_hex_hash(local_part):
    """Check if local part is a hex hash (Sentry, tracking pixels, etc.)."""
    clean = local_part.replace('-', '')
    return len(clean) >= 16 and all(c in '0123456789abcdef' for c in clean.lower())


def is_junk_domain(domain):
    """Check if domain is junk (exact or subdomain match)."""
    domain = domain.lower()
    if domain in JUNK_DOMAINS:
        return True
    for junk in JUNK_DOMAINS:
        if domain.endswith('.' + junk):
            return True
    return False


def validate_email(email, name, source):
    """
    Returns (keep, reason) tuple.
    keep=True means the email is valid for outreach.
    """
    if not email or not email.strip():
        return False, 'empty'

    email = email.strip().lower()

    # 1. Known junk emails
    if email in JUNK_EMAILS:
        return False, 'placeholder'

    # 2. Parse parts
    if '@' not in email:
        return False, 'invalid_format'
    local, domain = email.rsplit('@', 1)

    # 3. Junk domains
    if is_junk_domain(domain):
        return False, 'junk_domain'

    # 4. Hex hash local parts (Sentry IDs, tracking)
    if is_hex_hash(local):
        return False, 'hex_hash'

    # 5. Government emails — always keep
    if domain.endswith('.gov'):
        return True, 'gov_email'

    # 6. FEC compliance firm domains — remove unless name matches
    if domain in FEC_COMPLIANCE_DOMAINS:
        return False, 'compliance_firm'

    # 7. For FEC source: if name doesn't match, check for compliance patterns
    if source == 'fec' and not email_matches_name(email, name):
        # Domains with compliance/fec/filing in the name — definitely not the candidate
        compliance_words = ('compliance', 'fec', 'filing', 'treasurer', 'political', 'campaign')
        if any(w in domain for w in compliance_words):
            return False, 'fec_compliance_pattern'
        # Generic gmail/yahoo with no name connection — usually treasurers
        if domain in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
                       'comcast.net', 'icloud.com', 'proton.me', 'protonmail.com'):
            return False, 'fec_generic_no_match'
        # Domains with "consulting", "advisory", "group", "solutions", "law" — likely firms
        firm_words = ('consulting', 'advisory', 'solutions', 'legal', 'law', 'cpa', 'group', 'associates')
        if any(w in domain for w in firm_words):
            return False, 'fec_firm_domain'
        # Keep other FEC emails — may be legit campaign domains
        # (e.g., info@abeforaz.com even if name matching fails)

    # 8. For Ballotpedia source: if name doesn't match, check domain
    if source == 'ballotpedia' and not email_matches_name(email, name):
        # Generic contact@ or info@ on random domains
        if local in ('contact', 'info', 'hello', 'admin', 'support', 'help', 'office'):
            return False, 'scraped_generic'
        # Random gmail/yahoo with no name connection
        if domain in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'):
            return False, 'scraped_generic_no_match'
        return False, 'scraped_no_match'

    # 9. Passes all checks
    return True, 'valid'


def main():
    print("Loading seats.json...")
    with open(SEATS_FILE, 'r', encoding='utf-8') as f:
        seats_data = json.load(f)

    stats = Counter()
    removed = []
    kept = []

    for seat in seats_data['seats']:
        for person_list_key in ['candidates', 'incumbents']:
            for person in seat.get(person_list_key, []):
                email = person.get('email', '')
                if not email:
                    continue

                name = person.get('name', '')
                source = person.get('source', 'unknown')
                keep, reason = validate_email(email, name, source)
                stats[reason] += 1

                if not keep:
                    removed.append({
                        'name': name,
                        'email': email,
                        'source': source,
                        'reason': reason,
                        'seat': seat.get('seatId', ''),
                    })
                    person['email'] = ''  # Clear the bad email
                else:
                    kept.append(email)

        # Also check singular incumbent
        inc = seat.get('incumbent')
        if inc and not seat.get('incumbents') and inc.get('email'):
            name = inc.get('name', '')
            source = inc.get('source', 'unknown')
            keep, reason = validate_email(inc['email'], name, source)
            stats[reason] += 1
            if not keep:
                removed.append({
                    'name': name,
                    'email': inc['email'],
                    'source': source,
                    'reason': reason,
                    'seat': seat.get('seatId', ''),
                })
                inc['email'] = ''

    # Print results
    print(f"\n{'='*60}")
    print(f"EMAIL VALIDATION RESULTS")
    print(f"{'='*60}")
    print(f"\nKept: {len(kept)}")
    print(f"Removed: {len(removed)}")

    print(f"\nRemoval reasons:")
    for reason, count in stats.most_common():
        if reason == 'valid' or reason == 'gov_email':
            continue
        print(f"  {reason:30s} {count:5d}")

    print(f"\nKept reasons:")
    for reason in ['valid', 'gov_email']:
        if reason in stats:
            print(f"  {reason:30s} {stats[reason]:5d}")

    print(f"\n--- Sample removals ---")
    for r in removed[:25]:
        print(f"  [{r['reason']:25s}] {r['name']:30s} | {r['email']}")

    if '--dry-run' in sys.argv:
        print(f"\n[DRY RUN] No changes written.")
        # Save removed list for review
        with open(DATA_DIR / 'removed_emails_audit.json', 'w', encoding='utf-8') as f:
            json.dump(removed, f, indent=2, ensure_ascii=False)
        print(f"Full removal list saved to data/removed_emails_audit.json")
        return

    # Write cleaned seats.json
    print(f"\nWriting cleaned seats.json...")
    with open(SEATS_FILE, 'w', encoding='utf-8') as f:
        json.dump(seats_data, f, ensure_ascii=False)

    # Save audit log
    with open(DATA_DIR / 'removed_emails_audit.json', 'w', encoding='utf-8') as f:
        json.dump(removed, f, indent=2, ensure_ascii=False)

    print(f"Done! Removed {len(removed)} bad emails, kept {len(kept)}.")
    print(f"Audit log: data/removed_emails_audit.json")


if __name__ == '__main__':
    main()
