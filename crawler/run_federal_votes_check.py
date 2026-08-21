"""Runnable check for the federal roll-call pipeline against real data.

No pytest. Run from anywhere with Python 3.10+ and httpx installed:

    python3 crawler/run_federal_votes_check.py

What it does, end to end:
  1. downloads GovInfo BILLSTATUS for H.R. 1 and S. 5 (119th Congress) and
     builds roll-call pointers with govinfo._parse_recorded_votes, the same
     direct-child parser the crawler uses;
  2. runs federal_votes.fetch_federal_roll_calls over every pointer;
  3. for each fetched roll call, re-downloads the official XML with its own
     minimal parser and asserts the document's stated totals equal the
     count of parsed rows per vote value;
  4. checks named members against the official HTML vote page (House Clerk
     / Senate LIS), plus a few hard-coded expectations from the public
     record;
  5. confirms `existing` keys are skipped and a bad roll number is dropped.

Exit status is non-zero when any assertion fails.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from crawler.sources.federal_votes import USER_AGENT, fetch_federal_roll_calls  # noqa: E402
from crawler.sources.govinfo import _parse_recorded_votes  # noqa: E402

BILLS = [("hr", 1), ("s", 5)]
GOVINFO = "https://www.govinfo.gov/bulkdata/BILLSTATUS/119/{btype}/BILLSTATUS-119{btype}{num}.xml"

# Hard-coded expectations from the public record (official pages linked in
# the output). Keyed by roll-call key; House members by bioguide id, Senate
# members by member_full.
KNOWN = {
    "US-119-H-1-190": {"M001184": "Nay", "F000466": "Nay"},     # Massie, Fitzpatrick: the two R noes, 3 Jul 2025
    "US-119-S-1-372": {"Paul (R-KY)": "Nay", "Collins (R-ME)": "Nay", "Tillis (R-NC)": "Nay"},
}

VOTE_WORDS = "Aye|No|Yea|Nay|Present|Not Voting"
FAILURES: list[str] = []


def check(ok: bool, msg: str):
    print(("  PASS  " if ok else "  FAIL  ") + msg)
    if not ok:
        FAILURES.append(msg)


async def get(client: httpx.AsyncClient, url: str) -> bytes | None:
    try:
        r = await client.get(url)
    except httpx.HTTPError as e:
        print("  (fetch failed: " + url + ": " + str(e) + ")")
        return None
    if r.status_code != 200:
        print("  (HTTP " + str(r.status_code) + ": " + url + ")")
        return None
    return r.content


def stated_totals(chamber: str, root: ET.Element) -> dict:
    """Independent read of the totals the official document states."""
    if chamber == "House":
        t = root.find("vote-metadata/vote-totals/totals-by-vote")
        return {"Yea": int(t.findtext("yea-total")), "Nay": int(t.findtext("nay-total")),
                "Present": int(t.findtext("present-total")), "NV": int(t.findtext("not-voting-total"))}
    c = root.find("count")
    return {"Yea": int(c.findtext("yeas")), "Nay": int(c.findtext("nays")),
            "Present": int(c.findtext("present") or 0), "NV": int(c.findtext("absent") or 0)}


def raw_row_count(chamber: str, root: ET.Element) -> int:
    if chamber == "House":
        return len(root.findall("vote-data/recorded-vote"))
    return len(root.findall("members/member"))


def page_text(raw: bytes) -> str:
    t = raw.decode("utf-8", errors="ignore")
    t = re.sub(r"<script.*?</script>", " ", t, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t)


def official_page_url(rc: dict) -> str:
    if rc["chamber"] == "House":
        year = rc["date"][:4]
        roll = rc["key"].rsplit("-", 1)[1]
        return "https://clerk.house.gov/Votes/" + year + roll
    return rc["sourceUrl"][:-4] + ".htm"


def page_vote(rc: dict, row: dict, text: str) -> str | None:
    """The vote the official HTML page shows for this member, or None."""
    if rc["chamber"] == "House":
        pat = (r"\b" + re.escape(row["last_name"]) + r"\b(?:\s+\S+){0,8}?\s+" + re.escape(row["state"]) +
               r"\s+(" + VOTE_WORDS + r")\b")
    else:
        pat = re.escape(row["name"]) + r",\s*(" + VOTE_WORDS + r")\b"
    m = re.search(pat, text)
    if not m:
        return None
    word = m.group(1)
    return {"Aye": "Yea", "No": "Nay", "Not Voting": "NV"}.get(word, word)


async def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(headers=headers, timeout=30.0, follow_redirects=True) as client:
        # 1. pointers from BILLSTATUS
        pointers = []
        for btype, num in BILLS:
            url = GOVINFO.format(btype=btype, num=num)
            raw = await get(client, url)
            if raw is None:
                check(False, "could not download " + url)
                continue
            bill = ET.fromstring(raw).find("bill")
            bill_id = "US-119-" + btype.upper() + str(num)
            descendants = len(bill.findall(".//recordedVote"))
            found = _parse_recorded_votes(bill)
            print("\n" + bill_id + ": " + (bill.findtext("title") or "") + "")
            print("  recordedVote elements anywhere under <bill>: " + str(descendants) +
                  "; direct-child pointers after dedupe: " + str(len(found)))
            for p in found:
                print("   " + p["key"] + "  " + p["date"][:10] + "  " + p["desc"][:70])
                pointers.append(dict(p, billId=bill_id))
            check(bool(found), bill_id + " yields at least one pointer")
            check(all(p["key"].startswith("US-119-") for p in found), bill_id + " pointer keys are well formed")

        # 2. fetch
        print("\nFetching " + str(len(pointers)) + " roll calls...")
        fetched = await fetch_federal_roll_calls(pointers, {})
        print("Fetched keys: " + ", ".join(sorted(fetched)))
        house = [rc for rc in fetched.values() if rc["chamber"] == "House"]
        senate = [rc for rc in fetched.values() if rc["chamber"] == "Senate"]
        check(len(house) >= 1, "at least one House roll call fetched (" + str(len(house)) + ")")
        check(len(senate) >= 1, "at least one Senate roll call fetched (" + str(len(senate)) + ")")

        # 3. totals vs parsed rows, independently re-read from the official XML
        print("\nTotals check (document totals vs parsed rows):")
        for key in sorted(fetched):
            rc = fetched[key]
            raw = await get(client, rc["sourceUrl"])
            if raw is None:
                check(False, key + " official XML unavailable for cross-check")
                continue
            root = ET.fromstring(raw)
            stated = stated_totals(rc["chamber"], root)
            parsed = {"Yea": rc["yea"], "Nay": rc["nay"], "Present": rc["present"], "NV": rc["nv"]}
            from_rows = {"Yea": 0, "Nay": 0, "Present": 0, "NV": 0}
            for v in rc["votes"]:
                from_rows[v["vote"]] += 1
            print("  " + key + "  " + rc["date"][:10] + "  " + rc["desc"][:48])
            print("    document totals " + str(stated))
            print("    parsed summary  " + str(parsed) + "  total=" + str(rc["total"]) +
                  "  passed=" + str(rc["passed"]) + "  result=" + repr(rc["result"][:40]))
            check(stated == parsed == from_rows, key + " totals == summary == row counts")
            check(rc["total"] == len(rc["votes"]) == raw_row_count(rc["chamber"], root),
                  key + " total == rows emitted == rows in document (" + str(rc["total"]) + ")")
            check(rc["total"] == rc["yea"] + rc["nay"] + rc["nv"] + rc["present"] + rc["absent"],
                  key + " buckets sum to total")
            if rc["chamber"] == "House":
                check(all(v["bioguide_id"] for v in rc["votes"]), key + " every House row has a bioguide id")
            else:
                check(all(v["last_name"] and v["state"] and v["party"] for v in rc["votes"]),
                      key + " every Senate row has last name, state, party")
            check(len({(v["bioguide_id"] or v["name"]) for v in rc["votes"]}) == len(rc["votes"]),
                  key + " no duplicate members")

        # 4. named members vs the official HTML page
        print("\nMember check against the official vote pages:")
        for key in sorted(fetched):
            rc = fetched[key]
            url = official_page_url(rc)
            raw = await get(client, url)
            if raw is None:
                print("  " + key + ": official page not retrievable, skipping page comparison")
                continue
            text = page_text(raw)
            rows = rc["votes"]
            sample = [rows[0], rows[len(rows) // 2], rows[-1]]
            for expected_key, expected_vote in KNOWN.get(key, {}).items():
                match = [r for r in rows if r["bioguide_id"] == expected_key or r["name"] == expected_key]
                check(len(match) == 1 and match[0]["vote"] == expected_vote,
                      key + " " + expected_key + " parsed as " + (match[0]["vote"] if match else "MISSING") +
                      ", public record says " + expected_vote)
                sample.extend(match)
            compared = 0
            for r in sample:
                shown = page_vote(rc, r, text)
                if shown is None:
                    print("    (could not locate " + r["name"] + " on " + url + ")")
                    continue
                compared += 1
                check(shown == r["vote"], key + " " + r["name"] + " [" + (r["bioguide_id"] or r["lis_id"]) +
                      "] parsed " + r["vote"] + ", official page shows " + shown)
            check(compared >= 3, key + " compared " + str(compared) + " members against " + url)

        # 5. existing keys are skipped; a bad roll number is dropped, not invented
        print("\nSkip behaviour:")
        again = await fetch_federal_roll_calls(pointers, fetched)
        check(again == {}, "pointers already in `existing` are skipped (" + str(len(again)) + " returned)")
        bogus = [dict(pointers[0], key="US-119-H-1-999", rollNumber=999, sourceUrl=""),
                 dict(pointers[-1], key="US-119-S-1-9999", rollNumber=9999, sourceUrl=""),
                 dict(pointers[0], key="US-119-H-1-190x", billId="US-119-HR9999")]
        dropped = await fetch_federal_roll_calls(bogus, {})
        check(dropped == {}, "unknown roll numbers and a wrong-bill pointer are dropped, not invented")

    print("\n" + ("ALL CHECKS PASSED" if not FAILURES else str(len(FAILURES)) + " CHECK(S) FAILED"))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
