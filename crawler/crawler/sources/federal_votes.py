"""Federal roll-call votes from the official record.

House votes come from the Clerk's Electronic Voting System XML
(https://clerk.house.gov/evs/{year}/roll{NNN}.xml) and Senate votes from
the Senate LIS XML
(https://www.senate.gov/legislative/LIS/roll_call_votes/vote{C}{S}/vote_{C}_{S}_{NNNNN}.xml).
Pointers come from GovInfo BILLSTATUS (see govinfo._parse_recorded_votes);
each pointer becomes one roll-call record carrying every member's vote.

The failure this module must never have is attributing a vote to the wrong
member of Congress, so it is conservative by design:

  * a document is used only when its own metadata (congress, session, roll
    number, date, and the measure voted on) agrees with the pointer that
    led to it;
  * a vote row is emitted only when its vote text is one of the known
    values; anything else is logged and dropped;
  * the per-value counts derived from the rows must equal the totals the
    document itself states, or the whole roll call is dropped;
  * HTTP errors, redirects, and parse errors are logged and skipped.

Nothing is written to disk here; the caller persists the returned dict.

Vote values are normalised to Yea / Nay / NV / Present. Neither chamber
records an "absent" category distinct from "Not Voting" (the Senate's
<absent> count is the number of "Not Voting" rows), so "absent" is always 0
and yea + nay + nv + present == total, the same shape the state (LegiScan)
entries use.

House rows carry the bioguide id (name-id) and a last name only. Senate rows
carry no bioguide id; they carry first/last name, party, state, and the
Senate's own lis_member_id, and the join matches them conservatively.
"""

from __future__ import annotations

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime

import httpx

log = logging.getLogger(__name__)

USER_AGENT = "SAFE-Action-crawler/0.1 (+https://scienceandfreedom.com; legislative records)"
TIMEOUT_SECONDS = 20.0
MAX_CONCURRENT = 4
PAUSE_SECONDS = 0.25  # small gap after each request so bursts stay polite

HOUSE_XML_PREFIX = "https://clerk.house.gov/evs/"
SENATE_XML_PREFIX = "https://www.senate.gov/legislative/LIS/roll_call_votes/"

VOTE_MAP = {
    "yea": "Yea",
    "aye": "Yea",
    "nay": "Nay",
    "no": "Nay",
    "not voting": "NV",
    "present": "Present",
}

_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")
_MEASURE_RE = re.compile(r"[^A-Z0-9]")
_BILL_ID_RE = re.compile(r"^US-\d+-([A-Za-z]+\d+)$")
_SENATE_DATE_RE = re.compile(r"\s*([A-Za-z]+ \d{1,2}, \d{4})")


# ── small parsers ──────────────────────────────────────────────────────────

def _int(text) -> int | None:
    try:
        return int(str(text).strip())
    except (TypeError, ValueError):
        return None


def _leading_int(text) -> int | None:
    """'1st' -> 1, '2nd' -> 2. None when there is no leading integer."""
    m = re.match(r"\s*(\d+)", text or "")
    return int(m.group(1)) if m else None


def _measure_key(text) -> str:
    """'H R 1', 'H.R. 1', 'HR1', 'S.J.Res. 3' -> 'HR1' / 'SJRES3'."""
    return _MEASURE_RE.sub("", (text or "").upper())


def _bill_measure(bill_id) -> str:
    m = _BILL_ID_RE.match(bill_id or "")
    return _measure_key(m.group(1)) if m else ""


def _pointer_date(pointer: dict) -> date | None:
    """BILLSTATUS gives an ISO timestamp (UTC); keep the calendar date."""
    try:
        return date.fromisoformat((pointer.get("date") or "")[:10])
    except ValueError:
        return None


def _house_date(text) -> date | None:
    """'3-Jul-2025' -> date."""
    try:
        return datetime.strptime((text or "").strip(), "%d-%b-%Y").date()
    except ValueError:
        return None


def _senate_date(text) -> date | None:
    """'July 1, 2025,  01:56 AM' -> date."""
    m = _SENATE_DATE_RE.match(text or "")
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%B %d, %Y").date()
    except ValueError:
        return None


def _dates_agree(doc_date: date | None, pointer_date: date | None) -> bool:
    """Same day, allowing one day of slack: BILLSTATUS timestamps are UTC and
    the chambers record the Washington calendar date."""
    if doc_date is None or pointer_date is None:
        return False
    return abs((doc_date - pointer_date).days) <= 1


def _passed(result_text: str) -> bool:
    r = (result_text or "").strip().lower()
    if not r:
        return False
    if r.startswith("not ") or "not agreed" in r or "not passed" in r:
        return False
    if "rejected" in r or "failed" in r:
        return False
    return "passed" in r or "agreed to" in r


# ── URLs ───────────────────────────────────────────────────────────────────

def _house_url(pointer: dict) -> str:
    given = pointer.get("sourceUrl") or ""
    if given.startswith(HOUSE_XML_PREFIX) and given.endswith(".xml"):
        return given
    d = _pointer_date(pointer)
    if d is None:
        return ""
    return HOUSE_XML_PREFIX + str(d.year) + "/roll" + ("%03d" % pointer["rollNumber"]) + ".xml"


def _senate_url(pointer: dict) -> str:
    given = pointer.get("sourceUrl") or ""
    if given.startswith(SENATE_XML_PREFIX) and given.endswith(".xml"):
        return given
    c, s, n = pointer["congress"], pointer["session"], pointer["rollNumber"]
    return SENATE_XML_PREFIX + "vote" + str(c) + str(s) + "/vote_" + str(c) + "_" + str(s) + "_" + ("%05d" % n) + ".xml"


# ── document parsers: return (record, reason); record is None when skipped ─

def _count_rows(rows: list[dict]) -> dict:
    counts = {"Yea": 0, "Nay": 0, "NV": 0, "Present": 0}
    for r in rows:
        counts[r["vote"]] += 1
    return counts


def _check_totals(stated: dict, counts: dict, dropped: int) -> str:
    """Empty string when the document's stated totals equal the row counts."""
    for k in ("Yea", "Nay", "NV", "Present"):
        if stated.get(k) is None:
            return "document states no total for " + k
        if stated[k] != counts[k]:
            return ("count mismatch for " + k + ": document says " + str(stated[k]) +
                    ", rows give " + str(counts[k]) + " (" + str(dropped) + " rows dropped)")
    return ""


def _record(pointer: dict, url: str, question: str, result: str, rows: list[dict]) -> dict:
    counts = _count_rows(rows)
    return {
        "key": pointer["key"],
        "billId": pointer.get("billId", ""),
        "state": "US",
        "level": "Federal",
        "chamber": pointer["chamber"],
        "date": pointer.get("date", ""),
        "desc": question,
        "result": result,
        "yea": counts["Yea"],
        "nay": counts["Nay"],
        "nv": counts["NV"],
        "absent": 0,
        "present": counts["Present"],
        "total": len(rows),
        "passed": _passed(result),
        "sourceUrl": url,
        "votes": rows,
    }


def _parse_house(root: ET.Element, pointer: dict, url: str):
    if root.tag != "rollcall-vote":
        return None, "unexpected root element <" + root.tag + ">"
    meta = root.find("vote-metadata")
    data = root.find("vote-data")
    if meta is None or data is None:
        return None, "missing <vote-metadata> or <vote-data>"

    congress = _int(meta.findtext("congress"))
    session = _leading_int(meta.findtext("session"))
    roll = _int(meta.findtext("rollcall-num"))
    if congress != pointer["congress"] or roll != pointer["rollNumber"]:
        return None, ("metadata mismatch: document is congress " + str(congress) + " roll " + str(roll) +
                      ", pointer is congress " + str(pointer["congress"]) + " roll " + str(pointer["rollNumber"]))
    if session is not None and session != pointer["session"]:
        return None, "session mismatch: document says " + str(session) + ", pointer says " + str(pointer["session"])

    doc_date = _house_date(meta.findtext("action-date"))
    if not _dates_agree(doc_date, _pointer_date(pointer)):
        return None, ("date mismatch: document says " + repr(meta.findtext("action-date")) +
                      ", pointer says " + repr(pointer.get("date")))

    measure = _measure_key(meta.findtext("legis-num"))
    expected = _bill_measure(pointer.get("billId"))
    if not measure or not expected or measure != expected:
        return None, ("measure mismatch: document is for " + repr(meta.findtext("legis-num")) +
                      ", pointer bill is " + repr(pointer.get("billId")))

    rows = []
    dropped = 0
    for rv in data.findall("recorded-vote"):
        leg = rv.find("legislator")
        vote_text = (rv.findtext("vote", "") or "").strip()
        if leg is None:
            dropped += 1
            log.warning("federal votes: %s row without <legislator> dropped (vote=%r)", pointer["key"], vote_text)
            continue
        vote = VOTE_MAP.get(vote_text.lower())
        name = (leg.text or "").strip()
        if vote is None:
            dropped += 1
            log.warning("federal votes: %s unknown vote text %r for %s (%s) dropped",
                        pointer["key"], vote_text, name, leg.get("name-id", ""))
            continue
        rows.append({
            "bioguide_id": leg.get("name-id", "") or "",
            "name": name,
            "first_name": "",
            "last_name": _PAREN_RE.sub("", name).strip(),
            "party": leg.get("party", "") or "",
            "state": leg.get("state", "") or "",
            "district": "",
            "lis_id": "",
            "vote": vote,
        })

    totals = meta.find("vote-totals/totals-by-vote")
    if totals is None:
        return None, "document states no <totals-by-vote>"
    stated = {
        "Yea": _int(totals.findtext("yea-total")),
        "Nay": _int(totals.findtext("nay-total")),
        "Present": _int(totals.findtext("present-total")),
        "NV": _int(totals.findtext("not-voting-total")),
    }
    problem = _check_totals(stated, _count_rows(rows), dropped)
    if problem:
        return None, problem
    if not rows:
        return None, "document has no vote rows"

    question = (meta.findtext("vote-question", "") or "").strip()
    result = (meta.findtext("vote-result", "") or "").strip()
    return _record(pointer, url, question, result, rows), ""


def _senate_measure(root: ET.Element) -> tuple[str, str]:
    """(normalised measure key, human-readable source) for the measure voted on.

    Votes on a bill carry it in <document>; votes on an amendment carry an
    empty <document_number> and name the bill in
    <amendment><amendment_to_document_number>.
    """
    doc = root.find("document")
    if doc is not None and (doc.findtext("document_number", "") or "").strip():
        raw = (doc.findtext("document_type", "") or "") + (doc.findtext("document_number", "") or "")
        return _measure_key(raw), raw.strip()
    amend = root.find("amendment")
    if amend is not None:
        raw = (amend.findtext("amendment_to_document_number", "") or "").strip()
        if raw:
            return _measure_key(raw), raw
    return "", ""


def _parse_senate(root: ET.Element, pointer: dict, url: str):
    if root.tag != "roll_call_vote":
        return None, "unexpected root element <" + root.tag + ">"

    congress = _int(root.findtext("congress"))
    session = _int(root.findtext("session"))
    roll = _int(root.findtext("vote_number"))
    if congress != pointer["congress"] or session != pointer["session"] or roll != pointer["rollNumber"]:
        return None, ("metadata mismatch: document is congress " + str(congress) + " session " + str(session) +
                      " vote " + str(roll) + ", pointer is congress " + str(pointer["congress"]) +
                      " session " + str(pointer["session"]) + " vote " + str(pointer["rollNumber"]))

    doc_date = _senate_date(root.findtext("vote_date"))
    if not _dates_agree(doc_date, _pointer_date(pointer)):
        return None, ("date mismatch: document says " + repr(root.findtext("vote_date")) +
                      ", pointer says " + repr(pointer.get("date")))

    measure, measure_text = _senate_measure(root)
    expected = _bill_measure(pointer.get("billId"))
    if not measure or not expected or measure != expected:
        return None, ("measure mismatch: document is for " + repr(measure_text) +
                      ", pointer bill is " + repr(pointer.get("billId")))

    members = root.find("members")
    if members is None:
        return None, "missing <members>"
    rows = []
    dropped = 0
    for m in members.findall("member"):
        vote_text = (m.findtext("vote_cast", "") or "").strip()
        full = (m.findtext("member_full", "") or "").strip()
        vote = VOTE_MAP.get(vote_text.lower())
        if vote is None:
            dropped += 1
            log.warning("federal votes: %s unknown vote text %r for %s dropped", pointer["key"], vote_text, full)
            continue
        rows.append({
            "bioguide_id": "",
            "name": full,
            "first_name": (m.findtext("first_name", "") or "").strip(),
            "last_name": (m.findtext("last_name", "") or "").strip(),
            "party": (m.findtext("party", "") or "").strip(),
            "state": (m.findtext("state", "") or "").strip(),
            "district": "",
            "lis_id": (m.findtext("lis_member_id", "") or "").strip(),
            "vote": vote,
        })

    count = root.find("count")
    if count is None:
        return None, "document states no <count>"
    # <present/> and <absent/> are empty elements when zero.
    stated = {
        "Yea": _int(count.findtext("yeas")),
        "Nay": _int(count.findtext("nays")),
        "Present": _int(count.findtext("present") or "0"),
        "NV": _int(count.findtext("absent") or "0"),
    }
    problem = _check_totals(stated, _count_rows(rows), dropped)
    if problem:
        return None, problem
    if not rows:
        return None, "document has no vote rows"

    question = (root.findtext("vote_question_text", "") or root.findtext("question", "") or "").strip()
    result = (root.findtext("vote_result_text", "") or root.findtext("vote_result", "") or "").strip()
    return _record(pointer, url, question, result, rows), ""


# ── fetching ───────────────────────────────────────────────────────────────

async def _fetch_xml(client: httpx.AsyncClient, sem: asyncio.Semaphore, url: str):
    """Return (root, reason). root is None when the document is unusable."""
    resp = None
    for attempt in (1, 2):
        try:
            async with sem:
                resp = await client.get(url)
                await asyncio.sleep(PAUSE_SECONDS)
        except httpx.HTTPError as e:
            if attempt == 2:
                return None, "network error: " + e.__class__.__name__ + ": " + str(e)
            await asyncio.sleep(1.5)
            continue
        if resp.status_code == 200:
            break
        if resp.status_code >= 500 and attempt == 1:
            await asyncio.sleep(1.5)
            continue
        # The Senate answers unknown vote numbers with a 301 to a "not
        # available" page, so redirects count as missing, never as data.
        location = resp.headers.get("location", "")
        return None, "HTTP " + str(resp.status_code) + (" -> " + location if location else "")
    if resp is None or resp.status_code != 200:
        return None, "HTTP " + (str(resp.status_code) if resp is not None else "no response")
    try:
        return ET.fromstring(resp.content), ""
    except ET.ParseError as e:
        return None, "XML parse error: " + str(e)


async def _fetch_one(client: httpx.AsyncClient, sem: asyncio.Semaphore, pointer: dict):
    chamber = pointer["chamber"]
    url = _house_url(pointer) if chamber == "House" else _senate_url(pointer)
    if not url:
        return None, "could not build a source URL (no usable sourceUrl and no date)"
    root, reason = await _fetch_xml(client, sem, url)
    if root is None:
        return None, reason + " [" + url + "]"
    try:
        if chamber == "House":
            return _parse_house(root, pointer, url)
        return _parse_senate(root, pointer, url)
    except Exception as e:  # a malformed document must never take the crawl down
        return None, "parse failure: " + e.__class__.__name__ + ": " + str(e) + " [" + url + "]"


def _valid_pointer(p: dict) -> str:
    """Empty string when the pointer carries everything needed, else the problem."""
    if not isinstance(p, dict):
        return "not a dict"
    if not p.get("key"):
        return "missing key"
    if p.get("chamber") not in ("House", "Senate"):
        return "chamber must be House or Senate, got " + repr(p.get("chamber"))
    for field in ("congress", "session", "rollNumber"):
        if _int(p.get(field)) is None:
            return "missing or non-integer " + field
    if _pointer_date(p) is None:
        return "missing or non-ISO date " + repr(p.get("date"))
    if not p.get("billId"):
        return "missing billId"
    return ""


async def fetch_federal_roll_calls(roll_call_pointers: list[dict], existing: dict) -> dict:
    """Fetch every roll call the pointers name that is not already in `existing`.

    Each pointer is one of the bill["rollCalls"] dicts from govinfo plus
    "billId". Returns {key: roll_call_record} for the roll calls that were
    fetched and verified; everything else is logged and left out.
    """
    existing = existing or {}
    todo: dict[str, dict] = {}
    for p in roll_call_pointers or []:
        problem = _valid_pointer(p)
        if problem:
            log.warning("federal votes: pointer skipped (%s): %r", problem, p)
            continue
        key = p["key"]
        if key in existing:
            continue
        if key in todo:
            if todo[key].get("billId") != p.get("billId"):
                log.warning("federal votes: %s is claimed by both %s and %s; keeping the first",
                            key, todo[key].get("billId"), p.get("billId"))
            continue
        todo[key] = dict(p, congress=_int(p["congress"]), session=_int(p["session"]),
                         rollNumber=_int(p["rollNumber"]))
    if not todo:
        return {}

    sem = asyncio.Semaphore(MAX_CONCURRENT)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/xml, text/xml;q=0.9, */*;q=0.1"}
    async with httpx.AsyncClient(headers=headers, timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        outcomes = await asyncio.gather(*(_fetch_one(client, sem, p) for p in todo.values()))

    results: dict[str, dict] = {}
    skipped = 0
    for p, (record, reason) in zip(todo.values(), outcomes):
        if record is None:
            skipped += 1
            log.warning("federal votes: skipped %s (%s)", p["key"], reason)
            continue
        results[p["key"]] = record
    print("  Federal votes: " + str(len(results)) + " roll calls fetched, " + str(skipped) +
          " skipped, " + str(len(existing)) + " already on file")
    return results
