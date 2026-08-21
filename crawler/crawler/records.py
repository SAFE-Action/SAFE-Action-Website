"""Build data/records.json: every legislator's sponsorships of tracked bills.

This is a public, neutral legislative record. The one thing it must never do
is attribute a sponsorship to the wrong person, so matching is conservative:
a sponsorship is attached only when it resolves to exactly one legislator,
and everything else is written to the unmatched report for human review.

Match order, most to least specific:
  1. bioguide_id (federal, exact)
  2. state + chamber + district + last name
  3. state + chamber + last name, if exactly one legislator has it
     (tie-broken by first initial when that yields exactly one)
Anything still ambiguous is skipped.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
ROLE_CHAMBER = {
    "rep": "House", "representative": "House", "del": "House", "delegate": "House",
    "asm": "House", "assemblymember": "House", "assemblyman": "House", "assemblywoman": "House",
    "sen": "Senate", "senator": "Senate",
}
PREFIX_RE = re.compile(r"^(rep\.?|sen\.?|del\.?|hon\.?|dr\.?|mr\.?|mrs\.?|ms\.?|resident commissioner|delegate|senator|representative)\s+", re.I)
BRACKET_RE = re.compile(r"\[([A-Z]{1,2})-([A-Z]{2})(?:-(\w+))?\]")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9\- ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _last_name(name: str) -> str:
    """Last name from 'First Last', 'Last, First', or 'First M. Last Jr.'."""
    n = PREFIX_RE.sub("", (name or "").strip())
    n = re.sub(r"\[.*?\]", "", n).strip()
    if "," in n:
        n = n.split(",", 1)[0]
    toks = [t for t in _norm(n).split(" ") if t]
    while toks and toks[-1] in SUFFIXES:
        toks.pop()
    return toks[-1] if toks else ""


def _first_initial(name: str) -> str:
    n = PREFIX_RE.sub("", (name or "").strip())
    n = re.sub(r"\[.*?\]", "", n).strip()
    if "," in n:
        n = n.split(",", 1)[1]
    toks = [t for t in _norm(n).split(" ") if t]
    return toks[0][0] if toks else ""


def _district(d) -> str:
    if d is None:
        return ""
    s = str(d).strip().upper()
    if not s or s in ("AT-LARGE", "AL", "STATEWIDE"):
        return ""
    s = re.sub(r"^(HD|SD|LD|AD|H|S)[\- ]*", "", s)
    s = s.lstrip("0")
    return s


def _chamber_from_bill(bill_number: str, state: str) -> str:
    if state == "NE":
        return "Legislature"
    m = re.match(r"([A-Za-z]+)", bill_number or "")
    p = (m.group(1) if m else "").upper()
    if p.startswith("S"):
        return "Senate"
    if p.startswith(("H", "A")):
        return "House"
    return ""  # LD (Maine), J (NY joint) etc.: chamber unknown, resolve across chambers


COMMITTEE_WORDS = {"committee", "rules", "judiciary", "appropriations", "finance", "budget",
                   "services", "resources", "ways", "means", "affairs", "education", "health",
                   "commerce", "agriculture", "transportation", "energy", "labor", "government"}


def _looks_like_committee(name: str) -> bool:
    toks = set(_norm(name).split(" "))
    return bool(toks & COMMITTEE_WORDS) and "," not in name


def _entries_for_bill(bill: dict) -> list[dict]:
    """Normalise whatever sponsor data a bill carries into entries."""
    out = []
    structured = bill.get("sponsorships")
    if isinstance(structured, list) and structured:
        for s in structured:
            if not isinstance(s, dict) or not (s.get("name") or s.get("last_name")):
                continue
            out.append({
                "name": s.get("name", ""),
                "first_name": s.get("first_name", ""),
                "last_name": s.get("last_name", ""),
                "party": s.get("party", ""),
                "state": (s.get("state") or bill.get("state") or "").upper(),
                "district": s.get("district", ""),
                "chamber": ROLE_CHAMBER.get(str(s.get("role", "")).lower().rstrip("."), "") or s.get("chamber", ""),
                "bioguide_id": s.get("bioguide_id", ""),
                "people_id": s.get("people_id"),
                "role": s.get("type", "primary"),
            })
        return out
    legacy = bill.get("sponsors")
    if isinstance(legacy, list) and legacy:
        for s in legacy:
            if not isinstance(s, dict) or not s.get("name"):
                continue
            m = BRACKET_RE.search(s["name"])
            out.append({
                "name": s["name"], "first_name": "", "last_name": "",
                "party": s.get("party", ""),
                "state": (s.get("state") or (m.group(2) if m else "") or bill.get("state") or "").upper(),
                "district": (m.group(3) if m and m.group(3) else ""),
                "chamber": ROLE_CHAMBER.get(PREFIX_RE.match(s["name"]).group(1).lower().rstrip(".") if PREFIX_RE.match(s["name"]) else "", ""),
                "bioguide_id": s.get("bioguide_id", ""),
                "people_id": None,
                "role": s.get("type", "primary"),
            })
        return out
    text = bill.get("sponsor")
    if isinstance(text, str) and text.strip() and text.strip() != "N/A" and not _looks_like_committee(text):
        m = re.match(r"^(.*?)\s*(?:\(([A-Za-z]+)\))?\s*$", text.strip())
        out.append({
            "name": m.group(1) if m else text, "first_name": "", "last_name": "",
            "party": (m.group(2) if m and m.group(2) else ""),
            "state": (bill.get("state") or "").upper(),
            "district": "",
            "chamber": _chamber_from_bill(bill.get("billNumber", ""), (bill.get("state") or "").upper()),
            "bioguide_id": "", "people_id": None, "role": "primary",
        })
    return out


FED_TYPE_PATH = {"HR": "house-bill", "S": "senate-bill", "HJRES": "house-joint-resolution",
                 "SJRES": "senate-joint-resolution", "HCONRES": "house-concurrent-resolution",
                 "SCONRES": "senate-concurrent-resolution", "HRES": "house-resolution", "SRES": "senate-resolution"}
ORDINAL = {1: "st", 2: "nd", 3: "rd"}


def _source_url(bill: dict) -> str:
    u = bill.get("sourceUrl") or bill.get("url") or ""
    if u:
        return u
    # Federal bills from GovInfo sometimes carry no URL; congress.gov has a
    # stable, predictable address we can derive from the bill id.
    m = re.match(r"^US-(\d+)-([A-Z]+)(\d+)$", bill.get("billId") or "")
    if m:
        congress, btype, num = int(m.group(1)), m.group(2), m.group(3)
        path = FED_TYPE_PATH.get(btype)
        if path:
            suffix = "th" if 10 <= congress % 100 <= 20 else ORDINAL.get(congress % 10, "th")
            return f"https://www.congress.gov/bill/{congress}{suffix}-congress/{path}/{num}"
    return ""


PARTY_NORMAL = {"d": "Democratic", "democrat": "Democratic", "democratic": "Democratic",
                "r": "Republican", "republican": "Republican",
                "i": "Independent", "independent": "Independent", "id": "Independent",
                "l": "Libertarian", "libertarian": "Libertarian", "g": "Green", "green": "Green",
                "np": "Nonpartisan", "nonpartisan": "Nonpartisan", "n": "Nonpartisan"}


def _party(p) -> str:
    key = (p or "").strip().lower()
    return PARTY_NORMAL.get(key, (p or "").strip())


def _slug(legislator_id: str) -> str:
    s = re.sub(r"[^a-z0-9-]+", "-", (legislator_id or "").lower())
    return re.sub(r"-+", "-", s).strip("-")


def build_records(bills: list[dict], legislators: list[dict], seats: list[dict] | None = None):
    """Return (records_json_dict, unmatched_list)."""
    by_bioguide: dict[str, dict] = {}
    by_sdcl: dict[tuple, list] = defaultdict(list)   # state, chamber, district, last
    by_scl: dict[tuple, list] = defaultdict(list)    # state, chamber, last
    by_sl: dict[tuple, list] = defaultdict(list)     # state, last (any chamber)
    recs: dict[str, dict] = {}

    for leg in legislators:
        lid = leg.get("legislator_id") or ""
        if not lid:
            continue
        st = (leg.get("state") or "").upper()
        ch = leg.get("chamber") or ""
        ln = _last_name(leg.get("name", ""))
        rec = {
            "slug": _slug(lid), "legislator_id": lid,
            "name": leg.get("name", ""), "party": _party(leg.get("party", "")),
            "state": st, "chamber": ch, "district": _district(leg.get("district")),
            "level": leg.get("level", ""), "office": leg.get("office", ""),
            "bioguide_id": leg.get("bioguide_id", "") or "",
            "photo_url": leg.get("photo_url"),
            "up_in_2026": None,
            "counts": {"total": 0, "primary": 0, "cosponsor": 0, "anti": 0, "pro": 0, "monitor": 0},
            "sponsorships": [],
            "_seen": set(),
        }
        recs[lid] = rec
        if rec["bioguide_id"]:
            by_bioguide[rec["bioguide_id"]] = rec
        if ln:
            by_sdcl[(st, ch, rec["district"], ln)].append(rec)
            by_scl[(st, ch, ln)].append(rec)
            by_sl[(st, leg.get("level", ""), ln)].append(rec)

    # Seats: incumbent running in 2026
    for seat in seats or []:
        inc = seat.get("incumbent") or {}
        if not isinstance(inc, dict):
            continue
        target = None
        if inc.get("bioguideId") and inc["bioguideId"] in by_bioguide:
            target = by_bioguide[inc["bioguideId"]]
        else:
            st = (seat.get("state") or "").upper()
            body = (seat.get("body") or "").lower()
            ch = "Senate" if "senate" in body else ("Legislature" if "legislature" in body else "House")
            c = by_sdcl.get((st, ch, _district(seat.get("district")), _last_name(inc.get("name", ""))), [])
            if len(c) == 1:
                target = c[0]
        if target is not None:
            target["up_in_2026"] = bool(seat.get("upIn2026"))

    unmatched = []

    def resolve(e: dict, level: str):
        if e.get("bioguide_id") and e["bioguide_id"] in by_bioguide:
            return by_bioguide[e["bioguide_id"]]
        st, ch = e["state"], e["chamber"]
        if st == "NE" and level == "State":
            ch = "Legislature"  # unicameral; LegiScan still says "Sen"
        ln = _last_name(e.get("last_name") or e.get("name", ""))
        if not (st and ln):
            return None
        d = _district(e.get("district"))
        if d and ch:
            c = by_sdcl.get((st, ch, d, ln), [])
            if len(c) == 1:
                return c[0]
        if ch:
            c = by_scl.get((st, ch, ln), [])
            if len(c) == 1:
                return c[0]
            if len(c) > 1:
                fi = (e.get("first_name") or "")[:1].lower() or _first_initial(e.get("name", ""))
                c2 = [r for r in c if _first_initial(r["name"]) == fi] if fi else []
                if len(c2) == 1:
                    return c2[0]
        # Chamber unknown (or wrong): accept only a state-wide unique last name
        # within the same level, tie-broken by first initial.
        c = [r for r in by_sl.get((st, level, ln), []) if r["level"] == level]
        if len(c) == 1:
            return c[0]
        if len(c) > 1:
            fi = (e.get("first_name") or "")[:1].lower() or _first_initial(e.get("name", ""))
            c2 = [r for r in c if _first_initial(r["name"]) == fi] if fi else []
            if len(c2) == 1:
                return c2[0]
        return None

    for b in bills:
        entries = _entries_for_bill(b)
        if not entries:
            continue
        bt = b.get("billType", "monitor")
        level = b.get("level") or ("Federal" if (b.get("state") or "").upper() == "US" else "State")
        for e in entries:
            rec = resolve(e, level)
            if rec is None:
                unmatched.append({
                    "billId": b.get("billId"), "state": e["state"], "chamber": e["chamber"],
                    "district": e.get("district", ""), "name": e["name"], "role": e["role"],
                })
                continue
            key = b.get("billId")
            if key in rec["_seen"]:
                continue
            rec["_seen"].add(key)
            role = "primary" if e["role"] == "primary" else "cosponsor"
            rec["sponsorships"].append({
                "billId": key, "billNumber": b.get("billNumber", ""), "state": (b.get("state") or "").upper(),
                "level": b.get("level", ""), "title": b.get("title", ""), "billType": bt,
                "category": b.get("category", ""), "status": b.get("status", ""),
                "isActive": b.get("isActive", ""), "role": role,
                "sourceUrl": _source_url(b),
                "lastActionDate": b.get("lastActionDate", "") or "",
            })
            c = rec["counts"]
            c["total"] += 1
            c[role] += 1
            if bt in c:
                c[bt] += 1

    legislators_out = []
    with_records = 0
    total_sp = 0
    for rec in recs.values():
        rec.pop("_seen", None)
        rec["sponsorships"].sort(key=lambda s: s.get("lastActionDate") or "", reverse=True)
        if rec["counts"]["total"]:
            with_records += 1
            total_sp += rec["counts"]["total"]
        legislators_out.append(rec)
    legislators_out.sort(key=lambda r: (-r["counts"]["total"], r["name"]))

    return ({
        "summary": {
            "legislators": len(legislators_out), "with_records": with_records,
            "sponsorships": total_sp, "unmatched": len(unmatched),
        },
        "legislators": legislators_out,
    }, unmatched)
