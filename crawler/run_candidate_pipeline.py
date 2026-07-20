#!/usr/bin/env python3
"""
Orchestrated runner for the candidate/seats data pipeline.

Why this exists: the 11 candidate scripts were never wired together or
scheduled, so data/seats.json silently went stale (last refreshed 2026-03-06).
This runner encodes the correct order (previously tribal knowledge) and splits
the pipeline into a CI-safe tier and a heavy local-only tier.

Tiers
-----
--tier1 (default, CI-safe): API + local-file steps only. Fast, deterministic.
    populate_candidates -> enrich_candidates -> populate_incumbents
    -> enrich_from_legislators -> enrich_openstates -> merge_enrichment
    -> validate_emails
--full (local, hours): tier1 plus the heavy scrapers (Ballotpedia, DuckDuckGo).
    Capped with --bp-limit / --state so it is bounded. Run on the Mac Mini,
    NOT in CI (scrape_ballotpedia alone is 5k-10k pages).
--rebuild: prepend build_seats (DESTRUCTIVE: resets every seat to empty).
    Only for structural changes (redistricting/reapportionment).
--fix-districts: run the heuristic fix_district_mismatches gap-fill after merge.
    Off by default (it is approximate, not precise).

Guardrail: several underlying scripts swallow errors and exit 0 with near-zero
data. So exit codes are not trusted alone; this runner compares the
candidate+incumbent count in seats.json before vs after and fails loudly if the
data collapses (default: reject a drop below 50% of the prior count).

Requires (env, no hardcoded keys): CONGRESS_API_KEY, FEC_API_KEY,
OPENSTATES_API_KEY. data/legislators.json must be present and fresh (produced
by the bills crawler); populate_incumbents / enrich_from_legislators need it.
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "data"))
SEATS = os.path.join(DATA_DIR, "seats.json")
LEGISLATORS = os.path.join(DATA_DIR, "legislators.json")

# (label, script, extra_args) executed in order.
TIER1 = [
    ("federal candidates (Congress/FEC)", "populate_candidates.py", []),
    ("enrich federal candidates (FEC)", "enrich_candidates.py", []),
    ("state incumbents (legislators.json)", "populate_incumbents.py", []),
    ("backfill from legislators (local)", "enrich_from_legislators.py", []),
    ("enrich via OpenStates API", "enrich_openstates.py", []),
    ("merge enrichment into seats", "merge_enrichment.py", []),
    ("validate/clean emails", "validate_emails.py", []),
]
# Heavy scrapers, inserted before the merge step for --full.
TIER2_SCRAPERS = [
    ("scrape Ballotpedia (SLOW)", "scrape_ballotpedia.py", []),
    ("enrich via web search (SLOW)", "enrich_google_search.py", []),
]

REQUIRED_ENV = ["CONGRESS_API_KEY", "FEC_API_KEY", "OPENSTATES_API_KEY"]


def seats_population():
    """Total candidates + incumbents currently in seats.json (0 if absent)."""
    if not os.path.exists(SEATS):
        return 0
    try:
        seats = json.load(open(SEATS, encoding="utf-8"))
    except Exception:
        return 0
    rows = seats.get("seats", seats) if isinstance(seats, dict) else seats
    n = 0
    for s in rows:
        if not isinstance(s, dict):
            continue
        if s.get("incumbent"):
            n += 1
        n += len(s.get("incumbents", []) or [])
        n += len(s.get("candidates", []) or [])
    return n


def run_step(label, script, extra_args, dry_run):
    path = os.path.join(HERE, script)
    if not os.path.exists(path):
        print(f"  ! SKIP (missing): {script}")
        return
    cmd = [sys.executable, path, *extra_args]
    print(f"\n== {label} :: {' '.join(cmd[1:])}")
    if dry_run:
        print("   (dry-run, not executed)")
        return
    t0 = time.time()
    r = subprocess.run(cmd, cwd=HERE)
    dt = int(time.time() - t0)
    if r.returncode != 0:
        raise SystemExit(f"FAILED ({r.returncode}) after {dt}s: {script}")
    print(f"   ok ({dt}s)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--tier1", action="store_true", help="CI-safe API/local steps (default)")
    mode.add_argument("--full", action="store_true", help="tier1 + heavy scrapers (local, hours)")
    ap.add_argument("--rebuild", action="store_true", help="prepend build_seats (DESTRUCTIVE)")
    ap.add_argument("--fix-districts", action="store_true", help="run heuristic district gap-fill after merge")
    ap.add_argument("--state", help="limit heavy scrapers to one state (e.g. CA)")
    ap.add_argument("--bp-limit", type=int, help="cap web-search enrichment volume")
    ap.add_argument("--min-fraction", type=float, default=0.5,
                    help="fail if post-run population drops below this fraction of pre-run (default 0.5)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, run nothing")
    args = ap.parse_args()

    # legislators.json is an external prerequisite for the state steps.
    if not args.dry_run and not os.path.exists(LEGISLATORS):
        raise SystemExit(f"MISSING PREREQUISITE: {LEGISLATORS} (run the bills crawler first)")
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing and not args.dry_run:
        raise SystemExit(f"MISSING ENV: {', '.join(missing)} (set as env vars / CI secrets)")

    # Build the ordered plan.
    plan = []
    if args.rebuild:
        plan.append(("REBUILD seat skeleton (DESTRUCTIVE)", "build_seats.py", []))
    scrapers = []
    if args.full:
        for label, script, _ in TIER2_SCRAPERS:
            a = []
            if args.state:
                a += ["--state", args.state]
            if args.bp_limit and script == "enrich_google_search.py":
                a += ["--limit", str(args.bp_limit)]
            scrapers.append((label, script, a))
    # Assemble: tier1 up to the merge, then scrapers, then merge+validate.
    pre_merge = TIER1[:-2]      # through enrich_openstates
    merge_step = TIER1[-2]      # merge_enrichment
    validate_step = TIER1[-1]   # validate_emails
    plan += pre_merge + scrapers + [merge_step]
    if args.fix_districts:
        plan.append(("fix district mismatches (heuristic)", "fix_district_mismatches.py", []))
    plan.append(validate_step)

    before = seats_population()
    print(f"seats.json population before: {before}")
    print("PLAN:")
    for i, (label, script, a) in enumerate(plan, 1):
        print(f"  {i:2d}. {label}  [{script} {' '.join(a)}]".rstrip())

    for label, script, a in plan:
        run_step(label, script, a, args.dry_run)

    if args.dry_run:
        return

    after = seats_population()
    print(f"\nseats.json population after: {after} (was {before})")
    if before > 0 and after < before * args.min_fraction:
        raise SystemExit(
            f"GUARDRAIL FAILED: population collapsed {before} -> {after} "
            f"(< {int(args.min_fraction*100)}% of prior). Not trusting this run."
        )
    print("OK: candidate pipeline complete, guardrail passed.")


if __name__ == "__main__":
    main()
