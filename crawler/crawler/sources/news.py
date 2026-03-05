"""Crawl news sources for legislator mentions related to science/vaccine topics."""

import hashlib
import json
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from ..config import ANTHROPIC_API_KEY, CLAUDE_MODEL, NEWS_SEARCH_TERMS, NEWS_CRAWL_DELAY
from ..utils.rate_limiter import RateLimiter

rate_limiter = RateLimiter(NEWS_CRAWL_DELAY)

NEWS_EXTRACTION_INSTRUCTION = (
    "Extract news articles from this page about vaccine or science legislation. "
    "For each article provide: title, source publication name, URL to the article, "
    "publication date (ISO format if possible), a 2-3 sentence summary, "
    "the overall sentiment toward science/vaccines (positive, negative, or neutral), "
    "names of any legislators or politicians mentioned, "
    "and key topics covered (e.g. vaccine, public health, education, mandate, exemption)."
)


async def crawl_news_articles(legislator_names: list[str] | None = None) -> list[dict]:
    """Search news sites for vaccine/science legislation articles."""
    extraction = LLMExtractionStrategy(
        provider=f"anthropic/{CLAUDE_MODEL}",
        api_token=ANTHROPIC_API_KEY,
        instruction=NEWS_EXTRACTION_INSTRUCTION,
    )

    browser_config = BrowserConfig(headless=True)
    all_articles = []
    seen_urls = set()

    async with AsyncWebCrawler(config=browser_config) as crawler:
        for term in NEWS_SEARCH_TERMS:
            url = f"https://news.google.com/search?q={_url_encode(term)}&hl=en-US&gl=US&ceid=US:en"
            await rate_limiter.wait(url)

            result = await crawler.arun(
                url=url,
                config=CrawlerRunConfig(
                    extraction_strategy=extraction,
                    delay_before_return_html=3.0,
                ),
            )

            if not result.success or not result.extracted_content:
                continue

            try:
                data = json.loads(result.extracted_content)
                articles = data.get("articles", data) if isinstance(data, dict) else data
                if not isinstance(articles, list):
                    continue
            except json.JSONDecodeError:
                continue

            for article in articles:
                if not isinstance(article, dict):
                    continue
                article_url = article.get("url", "")
                if article_url in seen_urls:
                    continue
                seen_urls.add(article_url)

                article["article_id"] = hashlib.md5(article_url.encode()).hexdigest()
                article.setdefault("sentiment", "neutral")
                article.setdefault("legislator_ids", [])
                article.setdefault("topics", [])

                # Match mentioned legislators to known IDs
                if legislator_names:
                    text = f"{article.get('title', '')} {article.get('summary', '')}"
                    article["mentioned_names"] = [
                        name for name in legislator_names
                        if name.lower() in text.lower()
                    ]

                all_articles.append(article)

    print(f"  Found {len(all_articles)} unique news articles")
    return all_articles


def _url_encode(text: str) -> str:
    """Simple URL encoding for search terms."""
    return text.replace(" ", "+").replace("&", "%26")
