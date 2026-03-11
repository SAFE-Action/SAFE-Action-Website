"""State legislature data -- delegates to Open States API.

The Open States API is the preferred (and free) source for state legislator
data.  When no API key is configured, this module prints guidance and
returns an empty list rather than attempting LLM-based web scraping,
which is impractical on free-tier LLM providers.
"""

from ..config import PRIORITY_STATES


async def crawl_state_legislators(state: str) -> list[dict]:
    """Placeholder -- use Open States API via openstates.py instead."""
    return []


async def crawl_all_priority_states() -> list[dict]:
    """Fallback when no Open States API key is configured.

    Returns an empty list with a helpful message about obtaining a key.
    """
    print("  No Open States API key -- skipping state legislators.")
    print("  Get a free key at https://openstates.org/accounts/signup/")
    print("  Then add OPENSTATES_API_KEY=... to crawler/.env")
    return []
