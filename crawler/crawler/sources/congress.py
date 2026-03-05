"""Crawl congress.gov for federal legislator profiles."""

import json
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from ..config import CONGRESS_GOV_BASE, ANTHROPIC_API_KEY, CLAUDE_MODEL, CRAWL_DELAY_SECONDS
from ..utils.rate_limiter import RateLimiter

rate_limiter = RateLimiter(CRAWL_DELAY_SECONDS)

MEMBER_LIST_SCHEMA = {
    "type": "object",
    "properties": {
        "members": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "party": {"type": "string"},
                    "state": {"type": "string"},
                    "district": {"type": "string"},
                    "chamber": {"type": "string"},
                    "profile_url": {"type": "string"},
                },
            },
        }
    },
}

MEMBER_DETAIL_INSTRUCTION = (
    "Extract this Congress member's full details: "
    "committee assignments with role (chair, ranking member, member), "
    "professional background (especially medical, nursing, or science careers/degrees), "
    "biographical summary, contact information (phone, email, website), "
    "and any notable positions on health or science policy."
)


async def crawl_congress_members() -> list[dict]:
    """Crawl congress.gov member listing for both chambers."""
    browser_config = BrowserConfig(headless=True)
    extraction = LLMExtractionStrategy(
        provider=f"anthropic/{CLAUDE_MODEL}",
        api_token=ANTHROPIC_API_KEY,
        schema=MEMBER_LIST_SCHEMA,
        instruction=(
            "Extract all listed Congress members with their name, party affiliation, "
            "state, district (if applicable), chamber (House or Senate), "
            "and the URL to their individual profile page."
        ),
    )

    members = []
    async with AsyncWebCrawler(config=browser_config) as crawler:
        for chamber in ["Senate", "House"]:
            url = f"{CONGRESS_GOV_BASE}/members?q=%7B%22congress%22%3A119%2C%22chamber%22%3A%22{chamber}%22%7D"
            await rate_limiter.wait(url)

            result = await crawler.arun(
                url=url,
                config=CrawlerRunConfig(
                    extraction_strategy=extraction,
                    delay_before_return_html=3.0,
                ),
            )

            if result.success and result.extracted_content:
                try:
                    data = json.loads(result.extracted_content)
                    batch = data.get("members", []) if isinstance(data, dict) else data
                    for m in batch:
                        m["chamber"] = chamber
                        m["level"] = "Federal"
                        m["office"] = f"U.S. {chamber}"
                        m["legislator_id"] = _make_id(m)
                    members.extend(batch)
                except json.JSONDecodeError:
                    print(f"  Warning: Failed to parse {chamber} members")

    print(f"  Found {len(members)} federal legislators")
    return members


async def crawl_member_detail(member: dict) -> dict | None:
    """Crawl an individual member's profile page for detailed info."""
    profile_url = member.get("profile_url")
    if not profile_url:
        return None

    if not profile_url.startswith("http"):
        profile_url = f"{CONGRESS_GOV_BASE}{profile_url}"

    extraction = LLMExtractionStrategy(
        provider=f"anthropic/{CLAUDE_MODEL}",
        api_token=ANTHROPIC_API_KEY,
        instruction=MEMBER_DETAIL_INSTRUCTION,
    )

    await rate_limiter.wait(profile_url)

    async with AsyncWebCrawler(config=BrowserConfig(headless=True)) as crawler:
        result = await crawler.arun(
            url=profile_url,
            config=CrawlerRunConfig(
                extraction_strategy=extraction,
                delay_before_return_html=2.0,
            ),
        )

        if result.success and result.extracted_content:
            try:
                detail = json.loads(result.extracted_content)
                return detail if isinstance(detail, dict) else detail[0] if detail else None
            except json.JSONDecodeError:
                pass

    return None


def _make_id(member: dict) -> str:
    """Generate a stable legislator ID."""
    state = member.get("state", "XX")
    chamber = member.get("chamber", "Unknown")
    name = member.get("name", "Unknown").split()[-1]  # last name
    district = member.get("district", "")
    parts = [state, chamber, name]
    if district:
        parts.append(district)
    return "-".join(parts).replace(" ", "-")
