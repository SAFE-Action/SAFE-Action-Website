"""Fetch news articles via Google News RSS feeds.

No API key or LLM required. Uses RSS for structured data extraction
with simple keyword-based sentiment and topic detection.
"""

import hashlib
from xml.etree import ElementTree

import httpx

from ..config import NEWS_SEARCH_TERMS, NEWS_CRAWL_DELAY
from ..utils.rate_limiter import RateLimiter

rate_limiter = RateLimiter(NEWS_CRAWL_DELAY)

# Simple keyword lists for sentiment detection
_POSITIVE = ["supports", "approves", "passes", "funds", "protects", "evidence-based", "bipartisan", "pro-science"]
_NEGATIVE = ["bans", "blocks", "opposes", "anti-vaccine", "anti-science", "exemption", "refuses", "rejects", "misinformation"]

_TOPICS = {
    "vaccine": ["vaccine", "vaccination", "immunization", "immunize"],
    "public health": ["public health", "health department", "cdc", "nih"],
    "mandate": ["mandate", "requirement", "compulsory", "mandatory"],
    "exemption": ["exemption", "exempt", "opt-out", "waiver"],
    "education": ["education", "school", "curriculum", "teaching"],
    "legislation": ["bill", "legislation", "law", "statute", "act"],
    "funding": ["funding", "budget", "appropriation", "grant"],
    "research": ["research", "study", "clinical", "trial"],
}


async def crawl_news_articles(legislator_names: list[str] | None = None) -> list[dict]:
    """Search Google News RSS for vaccine/science legislation articles."""
    all_articles: list[dict] = []
    seen_urls: set[str] = set()

    async with httpx.AsyncClient() as client:
        for term in NEWS_SEARCH_TERMS:
            encoded = term.replace(" ", "+").replace("&", "%26")
            url = f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"
            await rate_limiter.wait(url)

            try:
                resp = await client.get(url, timeout=30.0, follow_redirects=True)
                resp.raise_for_status()
            except (httpx.HTTPError, Exception) as e:
                print(f"  Warning: Failed to fetch news for '{term}': {e}")
                continue

            try:
                root = ElementTree.fromstring(resp.content)
            except ElementTree.ParseError:
                continue

            for item in root.iter("item"):
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                pub_date = (item.findtext("pubDate") or "").strip()
                description = (item.findtext("description") or "").strip()
                source_el = item.find("source")
                source_name = source_el.text.strip() if source_el is not None and source_el.text else ""

                if not link or link in seen_urls:
                    continue
                seen_urls.add(link)

                text = f"{title} {description}".lower()

                # Sentiment
                pos = sum(1 for kw in _POSITIVE if kw in text)
                neg = sum(1 for kw in _NEGATIVE if kw in text)
                sentiment = "positive" if pos > neg else ("negative" if neg > pos else "neutral")

                # Topics
                topics = [t for t, kws in _TOPICS.items() if any(kw in text for kw in kws)]

                # Match mentioned legislators
                mentioned = []
                if legislator_names:
                    mentioned = [n for n in legislator_names if n.lower() in text]

                all_articles.append({
                    "article_id": hashlib.md5(link.encode()).hexdigest(),
                    "title": title,
                    "url": link,
                    "source": source_name,
                    "date": pub_date,
                    "summary": description[:500],
                    "sentiment": sentiment,
                    "topics": topics,
                    "mentioned_names": mentioned,
                    "legislator_ids": [],
                })

    print(f"  Found {len(all_articles)} unique news articles")
    return all_articles
