#!/usr/bin/env python3
"""
Wait for Phase 2 enrichment to complete, then:
1. Run merge_enrichment.py
2. Print final stats
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_PATH = os.path.join(ROOT, 'data', 'ballotpedia_candidates_cache.json')
LOG_PATH = '/tmp/phase2_enrichment.log'


def get_progress():
    with open(CACHE_PATH, 'r', encoding='utf-8') as f:
        cache = json.load(f)
    enriched = len(cache.get('enriched', {}))
    total = sum(1 for k, v in cache.get('discovered', {}).items()
                for c in v if isinstance(c, dict) and c.get('ballotpediaUrl'))
    emails = sum(1 for v in cache.get('enriched', {}).values() if v.get('email'))
    return enriched, total, emails


def is_process_running():
    """Check if scrape_ballotpedia is still running."""
    try:
        result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
        return 'scrape_ballotpedia' in result.stdout
    except Exception:
        return False


def main():
    print("Waiting for Phase 2 enrichment to complete...")
    print("Checking every 60 seconds.\n")

    last_enriched = 0
    stall_count = 0

    while True:
        enriched, total, emails = get_progress()
        pct = 100 * enriched / total if total else 0
        running = is_process_running()

        print(f"  {enriched}/{total} ({pct:.1f}%) | {emails} emails | process: {'running' if running else 'STOPPED'}")

        if not running:
            # Process stopped — check if it finished or died
            if enriched >= total * 0.98:
                print("\nPhase 2 appears complete!")
                break
            else:
                print("\nProcess died! Restarting...")
                log_file = open(LOG_PATH, 'a') if os.path.exists(os.path.dirname(LOG_PATH) or '/') else open(os.path.join(ROOT, 'phase2.log'), 'a')
                subprocess.Popen(
                    [sys.executable, os.path.join(ROOT, 'crawler', 'scrape_ballotpedia.py'), '--enrich-only'],
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                    env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                    start_new_session=True
                )
                time.sleep(10)
                continue

        if enriched == last_enriched:
            stall_count += 1
            if stall_count > 10:
                print("\nStalled for 10 minutes — breaking.")
                break
        else:
            stall_count = 0

        last_enriched = enriched
        time.sleep(60)

    # Run merge
    print("\n" + "=" * 60)
    print("Running merge_enrichment.py...")
    print("=" * 60)
    merge_script = os.path.join(ROOT, 'crawler', 'merge_enrichment.py')
    subprocess.run([sys.executable, merge_script], cwd=ROOT)

    # Final stats
    enriched, total, emails = get_progress()
    print(f"\nFinal enrichment: {enriched}/{total} ({100*enriched/total:.1f}%)")
    print(f"Final emails in cache: {emails}")
    print("\nDone! Ready for deploy.")


if __name__ == '__main__':
    main()
