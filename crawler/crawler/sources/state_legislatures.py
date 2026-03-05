"""Crawl state legislature sites for state-level legislators."""

import json
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from ..config import (
    STATE_LEGISLATURE_URLS, ANTHROPIC_API_KEY, CLAUDE_MODEL,
    CRAWL_DELAY_SECONDS, PRIORITY_STATES,
)
from ..utils.rate_limiter import RateLimiter

rate_limiter = RateLimiter(CRAWL_DELAY_SECONDS)

STATE_EXTRACTION_INSTRUCTION = (
    "Extract all state legislators listed on this page. For each, provide: "
    "full name, party (Republican/Democrat/Independent/etc.), district number, "
    "chamber (Senate/House/Assembly), committee assignments if visible, "
    "and any link to their individual profile page. "
    "Also note any professional background mentioned (especially medical, "
    "nursing, science, or healthcare careers)."
)


async def crawl_state_legislators(state: str) -> list[dict]:
    """Crawl a single state's legislature site for legislator data."""
    url = STATE_LEGISLATURE_URLS.get(state)
    if not url:
        print(f"  No URL configured for state {state}, skipping")
        return []

    extraction = LLMExtractionStrategy(
        provider=f"anthropic/{CLAUDE_MODEL}",
        api_token=ANTHROPIC_API_KEY,
        instruction=STATE_EXTRACTION_INSTRUCTION,
    )

    browser_config = BrowserConfig(headless=True)
    await rate_limiter.wait(url)

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(
            url=url,
            config=CrawlerRunConfig(
                extraction_strategy=extraction,
                delay_before_return_html=3.0,
            ),
        )

        if not result.success or not result.extracted_content:
            print(f"  Warning: Failed to crawl {state} legislature")
            return []

        try:
            data = json.loads(result.extracted_content)
            members = data.get("members", data) if isinstance(data, dict) else data
            if not isinstance(members, list):
                members = [members]
        except json.JSONDecodeError:
            print(f"  Warning: Failed to parse {state} legislature data")
            return []

    legislators = []
    for m in members:
        if not isinstance(m, dict):
            continue
        m["state"] = state
        m["level"] = "State"
        chamber = m.get("chamber", "House")
        m["office"] = f"State {chamber}"
        m["legislator_id"] = f"{state}-State-{chamber}-{m.get('name', 'Unknown').split()[-1]}"
        if m.get("district"):
            m["legislator_id"] += f"-{m['district']}"
        legislators.append(m)

    print(f"  Found {len(legislators)} legislators for {state}")
    return legislators


async def crawl_all_priority_states() -> list[dict]:
    """Crawl all priority states sequentially (rate-limited)."""
    all_legislators = []
    for state in PRIORITY_STATES:
        print(f"  Crawling {state}...")
        state_legs = await crawl_state_legislators(state)
        all_legislators.extend(state_legs)
    return all_legislators
