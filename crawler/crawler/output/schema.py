"""Pydantic models defining the JSON output schema."""

from pydantic import BaseModel
from typing import Optional


class PivotalFlags(BaseModel):
    is_committee_chair: bool = False
    is_health_committee: bool = False
    has_science_background: bool = False
    background_type: Optional[str] = None
    is_ranking_member: bool = False
    committee_relevance: Optional[str] = None


class PersuadabilityScore(BaseModel):
    score: int  # 0-10
    category: str  # champion / likely-win / fence-sitter / unlikely / opposed
    reasoning: str
    key_factors: list[str]
    confidence: float  # 0.0-1.0
    last_analyzed: str  # ISO datetime


class LegislatorProfile(BaseModel):
    legislator_id: str  # e.g. "TX-Senate-Cruz"
    name: str
    party: str
    state: str
    district: Optional[str] = None
    chamber: str  # House, Senate, Assembly
    level: str  # Federal, State
    office: str  # e.g. "U.S. Senate", "State Representative"
    committees: list[str] = []
    contact: dict = {}  # phone, email, website
    professional_background: Optional[str] = None
    photo_url: Optional[str] = None
    bio_summary: Optional[str] = None
    voting_record_summary: Optional[str] = None
    persuadability: Optional[PersuadabilityScore] = None
    pivotal: PivotalFlags = PivotalFlags()
    source_urls: list[str] = []
    last_crawled: str = ""


class NewsArticle(BaseModel):
    article_id: str
    title: str
    source: str
    url: str
    date: str
    summary: str
    sentiment: str  # positive, negative, neutral
    legislator_ids: list[str] = []
    topics: list[str] = []
    last_crawled: str = ""


class PivotalTarget(BaseModel):
    legislator_id: str
    name: str
    state: str
    party: str
    reason: str
    persuadability_category: str
    outreach_priority: int  # 1-5, 1 = highest
    recommended_approach: str


class AnalysisOutput(BaseModel):
    generated_at: str
    total_legislators: int
    by_category: dict[str, int]
    top_outreach_targets: list[str]  # ordered legislator_ids
    state_summaries: dict[str, dict]
