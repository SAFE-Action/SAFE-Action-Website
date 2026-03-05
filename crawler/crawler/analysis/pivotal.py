"""Identify pivotal legislators for outreach prioritization."""

from ..config import HEALTH_COMMITTEE_KEYWORDS, SCIENCE_BACKGROUND_KEYWORDS


def identify_pivotal_legislators(legislators: list[dict]) -> list[dict]:
    """
    Flag and rank legislators who are pivotal outreach targets:
    - Health/science committee chairs and ranking members
    - Republican physicians, nurses, scientists (high-value persuadables)
    - Fence-sitters on any relevant committee
    """
    pivotal = []

    for leg in legislators:
        flags = _build_flags(leg)
        score = (leg.get("persuadability") or {}).get("score", 5)
        category = (leg.get("persuadability") or {}).get("category", "unknown")
        priority = _calculate_priority(leg, flags, score)

        if priority > 4:
            continue  # Not a meaningful outreach target

        pivotal.append({
            "legislator_id": leg.get("legislator_id", ""),
            "name": leg.get("name", ""),
            "state": leg.get("state", ""),
            "party": leg.get("party", ""),
            "reason": _build_reason(flags, score, leg),
            "persuadability_category": category,
            "outreach_priority": priority,
            "recommended_approach": _recommend_approach(flags, leg, score),
            "flags": flags,
        })

    pivotal.sort(key=lambda x: (x["outreach_priority"], -(
        (legislators[0].get("persuadability") or {}).get("score", 0)
        if legislators else 0
    )))
    return pivotal


def _build_flags(leg: dict) -> dict:
    """Determine pivotal flags from legislator data."""
    flags = {
        "is_committee_chair": False,
        "is_health_committee": False,
        "has_science_background": False,
        "background_type": None,
        "is_ranking_member": False,
        "committee_relevance": None,
    }

    for committee in leg.get("committees", []):
        cl = committee.lower()
        if any(kw in cl for kw in HEALTH_COMMITTEE_KEYWORDS):
            flags["is_health_committee"] = True
            flags["committee_relevance"] = committee
        if "chair" in cl:
            flags["is_committee_chair"] = True
        if "ranking" in cl:
            flags["is_ranking_member"] = True

    bg = (leg.get("professional_background") or "").lower()
    bio = (leg.get("bio_summary") or "").lower()
    combined = f"{bg} {bio}"
    for term in SCIENCE_BACKGROUND_KEYWORDS:
        if term.lower() in combined:
            flags["has_science_background"] = True
            flags["background_type"] = term
            break

    return flags


def _calculate_priority(leg: dict, flags: dict, score: int) -> int:
    """
    Calculate outreach priority (1 = highest, 5 = lowest).

    Priority 1: Republican physicians/scientists who are fence-sitters,
                health committee chairs
    Priority 2: Health committee members who are fence-sitters
    Priority 3: Any fence-sitter with science background, or key committee role
    Priority 4: Likely-wins to reinforce, or unlikely with science background
    Priority 5: Not a meaningful target
    """
    is_fence = 4 <= score <= 6
    is_persuadable = 3 <= score <= 7
    is_republican = leg.get("party", "").lower() in ("republican", "r")

    # Top priority: Republican doctors/scientists who are persuadable
    if is_republican and flags["has_science_background"] and is_persuadable:
        return 1

    # Top priority: Health committee chairs (regardless of party)
    if flags["is_committee_chair"] and flags["is_health_committee"]:
        return 1

    # Priority 2: Health committee fence-sitters
    if flags["is_health_committee"] and is_fence:
        return 2

    # Priority 2: Science-background fence-sitters
    if flags["has_science_background"] and is_fence:
        return 2

    # Priority 3: Any fence-sitter on relevant committee
    if flags["is_health_committee"] and is_persuadable:
        return 3

    # Priority 3: Any fence-sitter
    if is_fence:
        return 3

    # Priority 4: Likely wins to reinforce
    if score >= 7:
        return 4

    return 5


def _build_reason(flags: dict, score: int, leg: dict) -> str:
    """Generate a human-readable reason for why this person is pivotal."""
    parts = []
    if flags["is_committee_chair"] and flags["is_health_committee"]:
        parts.append(f"Health committee chair ({flags['committee_relevance']})")
    elif flags["is_health_committee"]:
        parts.append(f"Health committee member ({flags['committee_relevance']})")
    if flags["has_science_background"]:
        parts.append(f"Professional background: {flags['background_type']}")
    if leg.get("party", "").lower() in ("republican", "r"):
        parts.append("Republican — cross-aisle potential")
    if 4 <= score <= 6:
        parts.append("Fence-sitter — persuadable")
    elif score >= 7:
        parts.append("Likely ally — reinforce support")
    return " + ".join(parts) if parts else "General outreach target"


def _recommend_approach(flags: dict, leg: dict, score: int) -> str:
    """Generate a recommended outreach approach."""
    if flags["has_science_background"]:
        return (
            "Appeal to their scientific/medical training. Share peer-reviewed data "
            "and emphasize evidence-based policy. Frame as protecting professional integrity."
        )
    if flags["is_health_committee"]:
        return (
            "Focus on their committee influence. Provide constituent health data "
            "for their district. Emphasize the committee's role in protecting public health."
        )
    if leg.get("party", "").lower() in ("republican", "r") and 4 <= score <= 6:
        return (
            "Frame science policy as individual liberty and parental rights. "
            "Emphasize informed consent and government transparency over mandates."
        )
    if score >= 7:
        return (
            "Thank them for their support. Ask them to co-sponsor pro-science bills "
            "and use their influence to bring colleagues on board."
        )
    return (
        "Share constituent stories and local health data. "
        "Focus on common ground and the practical impact on their district."
    )
