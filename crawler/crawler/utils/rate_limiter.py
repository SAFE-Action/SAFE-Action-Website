"""Rate limiter for polite web crawling."""

import asyncio
import time
from collections import defaultdict
from urllib.parse import urlparse


class RateLimiter:
    """Per-domain rate limiter with configurable delay."""

    def __init__(self, default_delay: float = 2.0):
        self.default_delay = default_delay
        self._last_request: dict[str, float] = defaultdict(float)
        self._lock = asyncio.Lock()

    def _get_domain(self, url: str) -> str:
        return urlparse(url).netloc

    async def wait(self, url: str, delay: float | None = None):
        """Wait if needed to respect rate limits for this domain."""
        domain = self._get_domain(url)
        wait_time = delay if delay is not None else self.default_delay

        async with self._lock:
            elapsed = time.monotonic() - self._last_request[domain]
            if elapsed < wait_time:
                await asyncio.sleep(wait_time - elapsed)
            self._last_request[domain] = time.monotonic()
