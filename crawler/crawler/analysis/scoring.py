"""Persuadability scoring using Claude via Anthropic API."""

import asyncio
import json
from datetime import datetime, timezone
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential
from ..config import ANTHROPIC_API_KEY, REASONING_MODEL, MAX_LEGISLATORS_PER_BATCH

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

SCORING_SYSTEM_PROMPT = """You are an expert political analyst assessing legislators' persuadability on science and public health policy -- specifically regarding vaccine safety, informed consent, and evidence-based medicine.

Score each legislator from 0-10:
- 9-10 (champion): Active pro-science advocate, sponsors pro-science bills
- 7-8 (likely-win): Leans positive, history of supporting science/health policy
- 4-6 (fence-sitter): Mixed signals, undecided, or no clear record -- KEY outreach target
- 2-3 (unlikely): Leans anti-science but not firmly committed
- 0-1 (opposed): Actively pushes anti-science legislation

Key factors to weigh:
1. Committee memberships (health/science committees = higher engagement & influence)
2. Professional background (physicians/nurses/scientists are more persuadable on evidence)
3. Party affiliation and district demographics
4. Voting record on science/health bills
5. Public statements and news coverage about vaccines/science
6. Whether they've co-sponsored pro or anti-science bills

Return ONLY valid JSON -- an array of objects."""

# Rate limit delay between batches (seconds).
# Claude API has generous limits; 5s is plenty.
INTER_BATCH_DELAY = 5


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=3, min=5, max=60))
async def _call_llm(user_prompt: str) -> str:
    """Call Claude via Anthropic API with retry logic."""
    response = client.messages.create(
        model=REASONING_MODEL,
        max_tokens=4096,
        system=SCORING_SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.content[0].text


async def score_legislators_batch(
    legislators: list[dict],
    news_context: list[dict] | None = None,
) -> list[dict]:
    """
    Batch-analyze legislators for persuadability.
    Processes in batches of MAX_LEGISLATORS_PER_BATCH with rate-limit delays.
    """
    now = datetime.now(timezone.utc).isoformat()
    results = []
    news_context = news_context or []
    total_batches = (len(legislators) + MAX_LEGISLATORS_PER_BATCH - 1) // MAX_LEGISLATORS_PER_BATCH

    for i in range(0, len(legislators), MAX_LEGISLATORS_PER_BATCH):
        batch = legislators[i : i + MAX_LEGISLATORS_PER_BATCH]
        batch_num = (i // MAX_LEGISLATORS_PER_BATCH) + 1

        # Rate limit: wait between batches (skip first)
        if i > 0:
            print(f"    Waiting {INTER_BATCH_DELAY}s for rate limit cooldown...")
            await asyncio.sleep(INTER_BATCH_DELAY)

        print(f"    Scoring batch {batch_num}/{total_batches} ({len(batch)} legislators)...")

        # Build concise legislator summaries for the prompt
        leg_summaries = []
        batch_names = set()
        for leg in batch:
            batch_names.add(leg.get("name", ""))
            committees = leg.get("committees", [])
            # Flatten committee list for compact representation
            if committees and isinstance(committees[0], dict):
                committees = [c.get("name", "") for c in committees]
            leg_summaries.append({
                "legislator_id": leg.get("legislator_id", ""),
                "name": leg.get("name", ""),
                "party": leg.get("party", ""),
                "state": leg.get("state", ""),
                "chamber": leg.get("chamber", ""),
                "office": leg.get("office", ""),
                "committees": committees[:5],  # limit to reduce tokens
                "professional_background": leg.get("professional_background"),
                "bio_summary": leg.get("bio_summary"),
                "voting_record_summary": leg.get("voting_record_summary"),
            })

        # Find relevant news for this batch
        relevant_news = []
        for article in news_context[:50]:
            text = f"{article.get('title', '')} {article.get('summary', '')}"
            if any(name.lower() in text.lower() for name in batch_names if name):
                relevant_news.append({
                    "title": article.get("title", ""),
                    "summary": article.get("summary", ""),
                    "sentiment": article.get("sentiment", "neutral"),
                    "date": article.get("date", ""),
                })
            if len(relevant_news) >= 10:
                break

        user_prompt = (
            f"Analyze these {len(batch)} legislators for science policy persuadability.\n\n"
            f"LEGISLATORS:\n{json.dumps(leg_summaries, indent=2)}\n\n"
        )
        if relevant_news:
            user_prompt += f"RELEVANT NEWS:\n{json.dumps(relevant_news, indent=2)}\n\n"

        user_prompt += (
            "Return a JSON array. Each object must have:\n"
            '- "legislator_id": matching the input\n'
            '- "score": integer 0-10\n'
            '- "category": one of "champion", "likely-win", "fence-sitter", "unlikely", "opposed"\n'
            '- "reasoning": 1-2 sentences\n'
            '- "key_factors": array of 2-4 strings\n'
            '- "confidence": float 0.0-1.0\n'
        )

        try:
            response_text = await _call_llm(user_prompt)
            # Extract JSON from response (handle markdown code blocks)
            json_text = response_text.strip()
            if json_text.startswith("```"):
                json_text = json_text.split("\n", 1)[1].rsplit("```", 1)[0]
            parsed = json.loads(json_text)

            if isinstance(parsed, dict):
                parsed = parsed.get("legislators", parsed.get("results", []))
            if isinstance(parsed, list):
                for item in parsed:
                    item["last_analyzed"] = now
                results.extend(parsed)
                print(f"    Scored {len(parsed)} legislators in batch {batch_num}")
        except (json.JSONDecodeError, Exception) as e:
            print(f"    Warning: Failed to parse batch {batch_num}: {e}")

    return results
