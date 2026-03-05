"""Simple file-based crawl cache to avoid re-crawling unchanged data."""

import json
import time
from pathlib import Path
from ..config import CACHE_DIR, LEGISLATOR_CACHE_HOURS, BILL_CACHE_HOURS, NEWS_CACHE_HOURS, ANALYSIS_CACHE_HOURS

CACHE_TTLS = {
    "congress_members": LEGISLATOR_CACHE_HOURS,
    "state_legislators": LEGISLATOR_CACHE_HOURS,
    "bills": BILL_CACHE_HOURS,
    "openstates_bills": BILL_CACHE_HOURS,  # legacy key
    "news": NEWS_CACHE_HOURS,
    "analysis": ANALYSIS_CACHE_HOURS,
}


def _timestamps_path() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / "timestamps.json"


def _load_timestamps() -> dict:
    path = _timestamps_path()
    if path.exists():
        return json.loads(path.read_text())
    return {}


def _save_timestamps(data: dict):
    _timestamps_path().write_text(json.dumps(data, indent=2))


def should_recrawl(key: str) -> bool:
    """Check if cached data for this key is stale."""
    timestamps = _load_timestamps()
    last = timestamps.get(key)
    if last is None:
        return True
    ttl_hours = CACHE_TTLS.get(key, 24)
    age_hours = (time.time() - last) / 3600
    return age_hours >= ttl_hours


def update_cache_timestamp(key: str):
    """Mark this key as freshly crawled."""
    timestamps = _load_timestamps()
    timestamps[key] = time.time()
    _save_timestamps(timestamps)


def save_cached_data(key: str, data: list | dict):
    """Save crawl results to cache file."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    path.write_text(json.dumps(data, indent=2, default=str))


def load_cached_data(key: str) -> list | dict | None:
    """Load previously cached crawl results."""
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None
