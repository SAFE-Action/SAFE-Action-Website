"""Roll-call votes for tracked state bills via LegiScan.

Budgeted (default 60 calls/run) and persistent: roll calls never change once
recorded, so each is fetched once and kept in data/rollcalls.json. Two call
types, in priority order:

  getSessionPeople(session_id)  one call per legislative session; gives the
                                people_id -> person map needed to read votes
  getRollCall(roll_call_id)     individual votes for one roll call

Priority: anti/pro bills first, then by recency. Nothing here attributes a
vote to a legislator; that join happens in records.py with the same
conservative matching used for sponsorships.
"""

from __future__ import annotations

import httpx

from .legiscan import _api_call, LEGISCAN_API_KEY

VOTE_TEXT = {1: "Yea", 2: "Nay", 3: "NV", 4: "Absent"}


def _priority(bill: dict) -> tuple:
    stance = 0 if bill.get("billType") in ("anti", "pro") else 1
    active = 0 if bill.get("isActive") == "Yes" else 1
    return (stance, active, bill.get("lastActionDate") or "")


async def fetch_state_votes(bills: list[dict], store: dict, budget: int = 60) -> dict:
    """Fill store['people'] and store['rollcalls'] within budget. Returns store."""
    store.setdefault("rollcalls", {})
    store.setdefault("people", {})
    store.setdefault("sessions_fetched", [])
    if not LEGISCAN_API_KEY or budget <= 0:
        return store

    # Recent first, then a stable sort by (anti/pro first, active first).
    ordered = [b for b in bills if b.get("legiscan_bill_id") and b.get("rollCalls")]
    ordered.sort(key=lambda b: b.get("lastActionDate") or "", reverse=True)
    ordered.sort(key=lambda b: (_priority(b)[0], _priority(b)[1]))

    used = 0
    fetched_sessions = set(str(s) for s in store["sessions_fetched"])
    new_people = 0
    new_rollcalls = 0

    async with httpx.AsyncClient() as client:
        # Phase 1: session people for sessions we have not mapped yet.
        for b in ordered:
            if used >= budget:
                break
            sid = b.get("session_id")
            if not sid or str(sid) in fetched_sessions:
                continue
            data = await _api_call(client, "getSessionPeople", id=sid)
            used += 1
            fetched_sessions.add(str(sid))
            people = ((data or {}).get("sessionpeople") or {}).get("people") or []
            state = (b.get("state") or "").upper()
            for p in people:
                if not isinstance(p, dict) or not p.get("people_id"):
                    continue
                store["people"][str(p["people_id"])] = {
                    "name": p.get("name", ""),
                    "first_name": p.get("first_name", ""),
                    "last_name": p.get("last_name", ""),
                    "party": p.get("party", ""),
                    "role": p.get("role", ""),
                    "district": p.get("district", ""),
                    "state": state,
                }
                new_people += 1

        # Phase 2: individual votes for roll calls we have not fetched.
        for b in ordered:
            if used >= budget:
                break
            for rc in b.get("rollCalls", []) or []:
                if used >= budget:
                    break
                key = rc.get("key")
                rcid = rc.get("legiscan_roll_call_id")
                if not key or not rcid or key in store["rollcalls"]:
                    continue
                data = await _api_call(client, "getRollCall", id=rcid)
                used += 1
                roll = (data or {}).get("roll_call") or {}
                if not roll:
                    continue
                votes = []
                for v in roll.get("votes", []) or []:
                    if not isinstance(v, dict) or not v.get("people_id"):
                        continue
                    vt = VOTE_TEXT.get(v.get("vote_id")) or (v.get("vote_text") or "").strip()
                    if vt not in ("Yea", "Nay", "NV", "Absent"):
                        continue  # unknown vote text: skip rather than guess
                    votes.append({"people_id": v["people_id"], "vote": vt})
                chamber = (roll.get("chamber") or rc.get("chamber") or "").upper()
                store["rollcalls"][key] = {
                    "key": key, "billId": b.get("billId"), "state": (b.get("state") or "").upper(),
                    "level": "State", "chamber": "Senate" if chamber.startswith("S") else ("House" if chamber.startswith("H") else rc.get("chamber", "")),
                    "date": roll.get("date") or rc.get("date", ""),
                    "desc": roll.get("desc") or rc.get("desc", ""),
                    "yea": roll.get("yea", rc.get("yea", 0)), "nay": roll.get("nay", rc.get("nay", 0)),
                    "nv": roll.get("nv", rc.get("nv", 0)), "absent": roll.get("absent", rc.get("absent", 0)),
                    "total": roll.get("total", rc.get("total", 0)), "passed": bool(roll.get("passed", rc.get("passed"))),
                    "sourceUrl": rc.get("sourceUrl") or roll.get("url") or "",
                    "votes": votes,
                }
                new_rollcalls += 1

    store["sessions_fetched"] = sorted(fetched_sessions)
    print(f"  LegiScan votes: {used} calls, {new_people} people mapped, {new_rollcalls} roll calls fetched "
          f"({len(store['rollcalls'])} total on file)")
    return store
