"""Main orchestrator — runs the full crawl and analysis pipeline."""

import asyncio
import sys
from datetime import datetime, timezone

from .config import DATA_DIR, CACHE_DIR, PRIORITY_STATES, GROQ_API_KEY, OPENSTATES_API_KEY, LEGISCAN_API_KEY
from .sources.congress import crawl_congress_members
from .sources.state_legislatures import crawl_all_state_legislators
from .sources.govinfo import fetch_federal_bills
from .sources.openstates import fetch_all_priority_legislators, fetch_all_science_bills as openstates_fetch_bills
from .sources.legiscan import fetch_all_science_bills as legiscan_fetch_bills, refresh_tracked_bills as legiscan_refresh_bills
from .sources.news import crawl_news_articles
from .analysis.scoring import score_legislators_batch
from .analysis.pivotal import identify_pivotal_legislators
from .analysis.bill_verification import verify_all_bills
from .utils.cache import (
    should_recrawl, update_cache_timestamp,
    save_cached_data, load_cached_data,
)
from .output.writer import write_json_output


async def run_full_crawl(news_only: bool = False):
    """Main entry point. Run the complete crawl and analysis pipeline."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc).isoformat()
    all_legislators = []

    if not GROQ_API_KEY:
        print("WARNING: GROQ_API_KEY not set. Scoring/analysis will be skipped.")
        print("  Get a free key at https://console.groq.com")

    # ── Step 1: Federal legislators ───────────────────
    if not news_only:
        if should_recrawl("congress_members"):
            print("[1/5] Fetching federal legislators from unitedstates.io...")
            federal = await crawl_congress_members()
            save_cached_data("congress_members", federal)
            update_cache_timestamp("congress_members")
            all_legislators.extend(federal)
        else:
            print("[1/5] Federal legislators cache fresh, loading cached...")
            cached = load_cached_data("congress_members")
            if cached:
                all_legislators.extend(cached)

        # ── Step 2: State legislators (free CSV, all 50 states) ─────
        if should_recrawl("state_legislators"):
            print("[2/5] Fetching state legislators from Open States CSV (all 50 states)...")
            state_legs = await crawl_all_state_legislators()
            if state_legs:
                save_cached_data("state_legislators", state_legs)
                update_cache_timestamp("state_legislators")
            all_legislators.extend(state_legs)
        else:
            print("[2/5] State legislators cache fresh, loading cached...")
            cached = load_cached_data("state_legislators")
            if cached:
                all_legislators.extend(cached)
    else:
        # News-only mode: load cached legislators
        print("[1/5] News-only mode, loading cached legislators...")
        for key in ["congress_members", "state_legislators"]:
            cached = load_cached_data(key)
            if cached:
                all_legislators.extend(cached)
        print(f"  Loaded {len(all_legislators)} cached legislators")
        print("[2/5] Skipped (news-only mode)")

    # ── Step 2b: Bill data (LegiScan primary, Open States fallback) ──
    all_bills: list[dict] = []
    bill_source = "none"
    if not news_only:
        if should_recrawl("bills"):
            # GovInfo: free federal bills (no API key needed)
            print("[2b/5] Fetching federal bills from GovInfo (free)...")
            all_bills = await fetch_federal_bills()
            bill_source = "govinfo"

            # Also try LegiScan for state bills if key available
            if LEGISCAN_API_KEY:
                print("[2b/5] Also fetching state bills via LegiScan...")
                state_bills = await legiscan_fetch_bills()
                all_bills.extend(state_bills)
                bill_source = "govinfo+legiscan"

            # Fall back to Open States for state bills if no LegiScan
            elif OPENSTATES_API_KEY:
                print("[2b/5] Also fetching state bills via Open States...")
                state_bills = await openstates_fetch_bills()
                all_bills.extend(state_bills)
                bill_source = "govinfo+openstates"

            if all_bills:
                save_cached_data("bills", all_bills)
                update_cache_timestamp("bills")
                print(f"  Fetched {len(all_bills)} bills via {bill_source}")
            else:
                print("[2b/5] No bills found")
        else:
            print("[2b/5] Bills cache fresh, loading cached...")
            cached = load_cached_data("bills")
            if cached:
                all_bills = cached
                bill_source = "cache"
    else:
        # News-only mode: load cached bills
        cached = load_cached_data("bills")
        if cached:
            all_bills = cached
            bill_source = "cache"
            print(f"  Loaded {len(all_bills)} cached bills")

    # ── Step 2c: Refresh tracked bills with latest status ──
    if not news_only and all_bills and LEGISCAN_API_KEY and bill_source != "cache":
        print("[2c/5] Refreshing tracked bill statuses via LegiScan...")
        all_bills = await legiscan_refresh_bills(all_bills)

    # ── Step 2d: LLM verification of bill classifications ──
    if not news_only and all_bills and GROQ_API_KEY:
        print("[2d/5] Running LLM secondary verification on bill classifications...")
        all_bills = await verify_all_bills(all_bills)
        if all_bills:
            save_cached_data("bills", all_bills)

    # ── Step 3: News crawl ────────────────────────────
    print("[3/5] Fetching news from Google News RSS...")
    legislator_names = [leg.get("name", "") for leg in all_legislators if leg.get("name")]
    news_articles = await crawl_news_articles(legislator_names)
    save_cached_data("news", news_articles)
    update_cache_timestamp("news")

    # ── Step 4: Claude analysis ───────────────────────
    if not news_only and GROQ_API_KEY and should_recrawl("analysis"):
        print(f"[4/5] Running persuadability analysis on {len(all_legislators)} legislators...")
        scores = await score_legislators_batch(all_legislators, news_articles)

        # Merge scores back into legislator data
        score_map = {s["legislator_id"]: s for s in scores}
        for leg in all_legislators:
            lid = leg.get("legislator_id", "")
            if lid in score_map:
                leg["persuadability"] = score_map[lid]

        # Update cached legislator data with scores
        federal = [l for l in all_legislators if l.get("level") == "Federal"]
        state = [l for l in all_legislators if l.get("level") == "State"]
        if federal:
            save_cached_data("congress_members", federal)
        if state:
            save_cached_data("state_legislators", state)

        update_cache_timestamp("analysis")
    else:
        reason = "no GROQ_API_KEY" if not GROQ_API_KEY else "cache fresh or news-only"
        print(f"[4/5] Skipping analysis ({reason})")

    # ── Step 5: Identify pivotal targets & write output ──
    print("[5/5] Identifying pivotal targets and writing output...")
    pivotal = identify_pivotal_legislators(all_legislators)
    analysis = _build_analysis_summary(all_legislators, now)

    output_files = {
        "news.json": {
            "generated_at": now,
            "articles": news_articles,
        },
    }

    # Only write legislator/analysis/pivotal data if we actually have legislators
    # (news-only mode on CI has no cache, so all_legislators would be empty)
    if all_legislators:
        output_files["legislators.json"] = {
            "generated_at": now,
            "legislators": [_serialize_legislator(l) for l in all_legislators],
        }
        output_files["analysis.json"] = analysis
        output_files["pivotal.json"] = {
            "generated_at": now,
            "targets": pivotal,
        }
    elif not news_only:
        print("WARNING: No legislators found during full crawl — skipping legislators.json write")
    else:
        print("INFO: News-only mode — preserving existing legislators.json")

    # Include bill data if available
    if all_bills:
        output_files["bills.json"] = {
            "generated_at": now,
            "source": bill_source,
            "total": len(all_bills),
            "bills": all_bills,
        }

    write_json_output(DATA_DIR, output_files)

    bill_msg = f", {len(all_bills)} bills" if all_bills else ""
    print(f"\nDone! {len(all_legislators)} legislators, {len(news_articles)} articles{bill_msg}, {len(pivotal)} pivotal targets")
    print(f"Output: {DATA_DIR}")


def _serialize_legislator(leg: dict) -> dict:
    """Ensure legislator dict is JSON-serializable with all expected keys."""
    return {
        "legislator_id": leg.get("legislator_id", ""),
        "bioguide_id": leg.get("bioguide_id", ""),
        "name": leg.get("name", ""),
        "party": leg.get("party", ""),
        "state": leg.get("state", ""),
        "district": leg.get("district"),
        "chamber": leg.get("chamber", ""),
        "level": leg.get("level", ""),
        "office": leg.get("office", ""),
        "committees": leg.get("committees", []),
        "contact": leg.get("contact", {}),
        "professional_background": leg.get("professional_background"),
        "photo_url": leg.get("photo_url"),
        "bio_summary": leg.get("bio_summary"),
        "voting_record_summary": leg.get("voting_record_summary"),
        "persuadability": leg.get("persuadability"),
        "pivotal": leg.get("pivotal", {
            "is_committee_chair": False,
            "is_health_committee": False,
            "has_science_background": False,
            "background_type": None,
            "is_ranking_member": False,
            "committee_relevance": None,
        }),
        "source_urls": leg.get("source_urls", []),
        "last_crawled": leg.get("last_crawled", ""),
    }


def _build_analysis_summary(legislators: list[dict], now: str) -> dict:
    """Build the analysis summary with category counts and state breakdowns."""
    by_category = {
        "champion": 0, "likely-win": 0, "fence-sitter": 0,
        "unlikely": 0, "opposed": 0, "unscored": 0,
    }
    state_data: dict[str, dict] = {}

    for leg in legislators:
        cat = (leg.get("persuadability") or {}).get("category", "unscored")
        by_category[cat] = by_category.get(cat, 0) + 1

        state = leg.get("state", "XX")
        if state not in state_data:
            state_data[state] = {"total": 0, "fence_sitters": 0, "champions": 0, "opposed": 0}
        state_data[state]["total"] += 1
        if cat == "fence-sitter":
            state_data[state]["fence_sitters"] += 1
        elif cat == "champion":
            state_data[state]["champions"] += 1
        elif cat == "opposed":
            state_data[state]["opposed"] += 1

    # Top outreach targets: fence-sitters sorted by score descending
    fence_sitters = [
        l for l in legislators
        if (l.get("persuadability") or {}).get("category") == "fence-sitter"
    ]
    fence_sitters.sort(
        key=lambda l: (l.get("persuadability") or {}).get("score", 0),
        reverse=True,
    )
    top_targets = [l.get("legislator_id", "") for l in fence_sitters[:20]]

    return {
        "generated_at": now,
        "total_legislators": len(legislators),
        "by_category": by_category,
        "top_outreach_targets": top_targets,
        "state_summaries": state_data,
    }


def cli():
    """CLI entry point."""
    news_only = "--news-only" in sys.argv
    if news_only:
        print("Running in NEWS-ONLY mode (skipping legislator crawl and analysis)")
    asyncio.run(run_full_crawl(news_only=news_only))


if __name__ == "__main__":
    cli()
