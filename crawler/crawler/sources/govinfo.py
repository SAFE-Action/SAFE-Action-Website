"""Fetch federal bill data from GovInfo BILLSTATUS (free, no API key).

Uses the GovInfo Bulk Data Repository for XML bill status.
  https://www.govinfo.gov/bulkdata/BILLSTATUS/119
"""

import asyncio
import xml.etree.ElementTree as ET

import httpx

CONGRESS = 119
GOVINFO_BASE = "https://www.govinfo.gov/bulkdata"
BILL_TYPES = ["hr", "s"]
# Focused on vaccines, raw milk, fluoride + closely related terms
BILL_KEYWORDS = [
    "vaccine", "immunization", "vaccination", "immunize",
    "fluoride", "fluoridation",
    "raw milk", "unpasteurized",
    "medical freedom", "informed consent",
    "exemption", "mandate", "religious exemption",
    "school immunization", "childhood vaccination",
    "public health emergency", "communicable disease",
    "quarantine", "pandemic preparedness",
    "mrna", "gene therapy",
]


def _matches_keywords(text):
    lower = text.lower()
    return any(kw in lower for kw in BILL_KEYWORDS)


def _parse_bill_xml(xml_text):
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    bill = root.find("bill")
    if bill is None:
        return None
    # Direct children only: BILLSTATUS nests amendments (each with its own
    # title/actions/sponsors) under <bill>, and a descendant search (".//")
    # silently merges amendment sponsors into the bill's sponsor list.
    title_el = bill.find("title")
    title = title_el.text if title_el is not None else ""
    policy_area_el = bill.find(".//policyArea/name")
    policy_area = policy_area_el.text if policy_area_el is not None else ""
    subjects = []
    for subj_el in bill.findall(".//subjects/legislativeSubjects/item/name"):
        if subj_el.text:
            subjects.append(subj_el.text)
    searchable = title + " " + policy_area + " " + " ".join(subjects)
    if not _matches_keywords(searchable):
        return None
    number = bill.findtext("number", "")
    bill_type = bill.findtext("type", "")
    congress = bill.findtext("congress", "")
    url = bill.findtext("legislationUrl", "")
    actions_el = bill.find("actions")
    actions = actions_el.findall("item") if actions_el is not None else []
    last_action = ""
    last_action_date = ""
    status = "Introduced"
    if actions:
        last = actions[-1]
        last_action = last.findtext("text", "")
        last_action_date = last.findtext("actionDate", "")
        for action in reversed(actions):
            atext = (action.findtext("text", "") or "").lower()
            if "signed" in atext or "became law" in atext:
                status = "Signed into Law"
                break
            elif "passed senate" in atext:
                status = "Passed Senate"
                break
            elif "passed house" in atext:
                status = "Passed House"
                break
            elif "committee" in atext and "referred" in atext:
                status = "In Committee"
            elif "introduced" in atext:
                status = "Introduced"
    sponsors = []
    sponsorships = []
    seen_people = set()
    sponsors_el = bill.find("sponsors")
    cosponsors_el = bill.find("cosponsors")
    for sp in (sponsors_el.findall("item") if sponsors_el is not None else []):
        if not (sp.findtext("fullName", "") or "").strip():
            continue
        key = sp.findtext("bioguideId", "") or sp.findtext("fullName", "")
        if key in seen_people:
            continue
        seen_people.add(key)
        sponsors.append({
            "name": sp.findtext("fullName", ""),
            "party": sp.findtext("party", ""),
            "state": sp.findtext("state", ""),
            "bioguide_id": sp.findtext("bioguideId", ""),
        })
        sponsorships.append({
            "bioguide_id": sp.findtext("bioguideId", ""),
            "name": sp.findtext("fullName", ""),
            "first_name": sp.findtext("firstName", ""),
            "last_name": sp.findtext("lastName", ""),
            "party": sp.findtext("party", ""),
            "state": sp.findtext("state", ""),
            "district": sp.findtext("district", ""),
            "chamber": "Senate" if bill_type.lower().startswith("s") else "House",
            "type": "primary",
        })
    for sp in (cosponsors_el.findall("item") if cosponsors_el is not None else []):
        if not (sp.findtext("fullName", "") or "").strip():
            continue
        key = sp.findtext("bioguideId", "") or sp.findtext("fullName", "")
        if key in seen_people:
            continue
        seen_people.add(key)
        sponsorships.append({
            "bioguide_id": sp.findtext("bioguideId", ""),
            "name": sp.findtext("fullName", ""),
            "first_name": sp.findtext("firstName", ""),
            "last_name": sp.findtext("lastName", ""),
            "party": sp.findtext("party", ""),
            "state": sp.findtext("state", ""),
            "district": sp.findtext("district", ""),
            "chamber": "Senate" if bill_type.lower().startswith("s") else "House",
            "type": "cosponsor",
        })
    committees = []
    for cm in bill.findall(".//committees/item"):
        cname = cm.findtext("name", "")
        if cname:
            committees.append(cname)
    roll_calls = _parse_recorded_votes(bill)
    stance = _classify_stance(title, policy_area, subjects)
    return {
        "billId": "US-" + str(congress) + "-" + bill_type + number,
        "billNumber": bill_type + " " + number,
        "title": title,
        "state": "US",
        "level": "Federal",
        "billType": stance,
        "status": status,
        "isActive": "Yes" if status != "Signed into Law" else "No",
        "impact": _assess_impact(status, len(sponsors)),
        "category": policy_area or "General",
        "summary": title,
        "lastAction": last_action,
        "lastActionDate": last_action_date,
        "stance": stance,
        "committee": committees[0] if committees else "",
        "sponsors": sponsors,
        "sponsorships": sponsorships,
        "subjects": subjects,
        "url": url,
        "rollCalls": roll_calls,
    }


def _parse_recorded_votes(bill):
    """Roll-call pointers from the bill's own <actions>, direct children only.

    BILLSTATUS nests every amendment (each with its own <actions> and
    <recordedVotes>) under <bill>, so a descendant search (".//") would
    attach amendment votes to the bill. Only
    <bill><actions><item><recordedVotes><recordedVote> counts here.

    The same roll call is usually listed twice (the action and its
    "Passed/agreed to" summary item), so pointers are deduplicated on
    chamber + congress + session + roll number; the first action text wins.
    A pointer is emitted only when every identifying field parses. A bad
    pointer would become a wrong vote downstream, so anything doubtful is
    logged and dropped.
    """
    pointers = []
    seen = set()
    actions_el = bill.find("actions")
    if actions_el is None:
        return pointers
    for item in actions_el.findall("item"):
        votes_el = item.find("recordedVotes")
        if votes_el is None:
            continue
        action_text = (item.findtext("text", "") or "").strip()
        for rv in votes_el.findall("recordedVote"):
            chamber = (rv.findtext("chamber", "") or "").strip()
            raw_ids = {
                "congress": rv.findtext("congress", ""),
                "sessionNumber": rv.findtext("sessionNumber", ""),
                "rollNumber": rv.findtext("rollNumber", ""),
            }
            if chamber not in ("House", "Senate"):
                print("  Warning: recordedVote with unknown chamber " + repr(chamber) + " skipped: " + str(raw_ids))
                continue
            try:
                congress = int(raw_ids["congress"])
                session = int(raw_ids["sessionNumber"])
                roll = int(raw_ids["rollNumber"])
            except (TypeError, ValueError):
                print("  Warning: recordedVote with unparseable ids skipped: " + str(raw_ids))
                continue
            key = "US-" + str(congress) + "-" + chamber[0] + "-" + str(session) + "-" + str(roll)
            if key in seen:
                continue
            seen.add(key)
            pointers.append({
                "key": key,
                "chamber": chamber,
                "congress": congress,
                "session": session,
                "rollNumber": roll,
                "date": (rv.findtext("date", "") or "").strip(),
                "sourceUrl": (rv.findtext("url", "") or "").strip(),
                "desc": action_text,
            })
    return pointers


def _classify_stance(title, policy_area, subjects):
    """Classify federal bill stance with strict core-topic gating.

    Only bills about vaccines, raw milk, or fluoride get anti/pro labels.
    Everything else is classified as 'monitor'.
    """
    combined = (title + " " + policy_area + " " + " ".join(subjects)).lower()

    # Gate: only classify if about core science topics
    core_topics = [
        "vaccine", "vaccination", "immunization",
        "raw milk", "unpasteurized",
        "fluoride", "fluoridation",
        "mrna",
    ]
    # NOTE: "informed consent" is deliberately NOT a gate topic, on its own it
    # matches unrelated bills (e.g. "Ultrasound Informed Consent Act", "Nuclear
    # Waste Informed Consent Act"). It stays in anti_kw below, so it only tips a
    # bill anti-science once real vaccine/fluoride/etc. context has gated it in.
    is_core = any(kw in combined for kw in core_topics)

    if not is_core:
        return "monitor"

    pro_kw = ["fund research", "protect public health", "strengthen immunization",
              "require vaccination", "vaccine access", "limit exemption",
              "remove exemption", "fluoridation program", "pasteurization",
              "fund vaccine", "vaccine program", "vaccination program",
              "immunization program", "vaccination strategy",
              "vaccine strategy", "vaccine transportation"]
    anti_kw = ["ban mandate", "prohibit mandate", "repeal", "eliminate requirement",
               "exemption", "opt out", "freedom from", "medical freedom",
               "informed consent", "parental rights", "personal belief",
               "right to refuse", "bodily autonomy", "health freedom",
               "vaccine injury", "vaccine harm", "gene therapy",
               "weapons of mass destruction", "biological agent",
               "ban fluoride", "prohibit fluoride", "fluoride choice",
               "raw milk sales", "discrimination against unvaccinated",
               "vaccine status", "personal liberty",
               "vaccine passport", "vaccination passport",
               "vaccination status", "no mandate", "prohibition",
               "unprofessional conduct", "vaccine injured",
               "harmful vaccine", "vaccine carveout",
               "non-discrimination", "no vaccine mandate",
               "no vaccination mandate", "no immunization mandate"]
    pro = sum(1 for kw in pro_kw if kw in combined)
    anti = sum(1 for kw in anti_kw if kw in combined)
    if pro > anti:
        return "pro"
    elif anti > 0:
        return "anti"
    return "monitor"


def _assess_impact(status, sponsor_count):
    if status in ("Signed into Law", "Sent to President"):
        return "High"
    if status in ("Passed House", "Passed Senate"):
        return "High"
    if sponsor_count > 5 or status == "In Committee":
        return "Medium"
    return "Low"


async def fetch_federal_bills():
    """Fetch science/health-related federal bills from GovInfo."""
    all_bills = []
    async with httpx.AsyncClient() as client:
        for bill_type in BILL_TYPES:
            print("  Fetching " + bill_type.upper() + " bills from GovInfo...")
            dir_url = GOVINFO_BASE + "/json/BILLSTATUS/" + str(CONGRESS) + "/" + bill_type
            try:
                resp = await client.get(
                    dir_url,
                    headers={"Accept": "application/json"},
                    timeout=30.0,
                    follow_redirects=True,
                )
                resp.raise_for_status()
                dir_data = resp.json()
            except Exception as e:
                print("  Warning: Failed to fetch " + bill_type + ": " + str(e))
                continue
            files = dir_data.get("files", [])
            xml_files = [f for f in files if f.get("name", "").endswith(".xml")]
            print("    Found " + str(len(xml_files)) + " " + bill_type.upper() + " bills")
            batch_size = 20
            matched = 0
            for i in range(0, len(xml_files), batch_size):
                batch = xml_files[i:i + batch_size]
                tasks = []
                for f in batch:
                    xml_url = (GOVINFO_BASE + "/BILLSTATUS/" + str(CONGRESS) +
                               "/" + bill_type + "/" + f["name"])
                    tasks.append(_fetch_and_parse_bill(client, xml_url))
                results = await asyncio.gather(*tasks)
                for bill_dict in results:
                    if bill_dict is not None:
                        all_bills.append(bill_dict)
                        matched += 1
                await asyncio.sleep(0.5)
                scanned = min(i + batch_size, len(xml_files))
                if scanned % 200 < batch_size:
                    print("    Scanned " + str(scanned) + "/" + str(len(xml_files)) + ", matched " + str(matched))
            print("    " + bill_type.upper() + ": " + str(matched) + " matched")
    print("  Total federal bills: " + str(len(all_bills)))
    return all_bills


async def _fetch_and_parse_bill(client, url):
    try:
        resp = await client.get(url, timeout=15.0, follow_redirects=True)
        resp.raise_for_status()
        return _parse_bill_xml(resp.text)
    except Exception:
        return None
