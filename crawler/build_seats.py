"""Build the complete 2026 US election seat map.

Generates data/seats.json with every federal and state seat up for election.
This is the structural data — candidate population is done separately.

Usage: python crawler/build_seats.py
"""

import json
from datetime import datetime, timezone
from pathlib import Path

# ── US House: 435 districts, ALL up in 2026 ──────────────────────────────

# Post-2020 Census apportionment (district counts per state)
HOUSE_DISTRICTS = {
    "AL": 7, "AK": 1, "AZ": 9, "AR": 4, "CA": 52, "CO": 8, "CT": 5,
    "DE": 1, "FL": 28, "GA": 14, "HI": 2, "ID": 2, "IL": 17, "IN": 9,
    "IA": 4, "KS": 4, "KY": 6, "LA": 6, "ME": 2, "MD": 8, "MA": 9,
    "MI": 13, "MN": 8, "MS": 4, "MO": 8, "MT": 2, "NE": 3, "NV": 4,
    "NH": 2, "NJ": 12, "NM": 3, "NY": 26, "NC": 14, "ND": 1, "OH": 15,
    "OK": 5, "OR": 6, "PA": 17, "RI": 2, "SC": 7, "SD": 1, "TN": 9,
    "TX": 38, "UT": 4, "VT": 1, "VA": 11, "WA": 10, "WV": 2, "WI": 8,
    "WY": 1,
}

# ── US Senate Class II: 33 seats up in 2026 ──────────────────────────────

SENATE_CLASS_II = {
    "AL": {"incumbent": "Katie Britt", "party": "R"},
    "AK": {"incumbent": "Dan Sullivan", "party": "R"},
    "AR": {"incumbent": "Tom Cotton", "party": "R"},
    "CO": {"incumbent": "John Hickenlooper", "party": "D"},
    "DE": {"incumbent": "Chris Coons", "party": "D"},
    "GA": {"incumbent": "Jon Ossoff", "party": "D"},
    "ID": {"incumbent": "Jim Risch", "party": "R"},
    "IL": {"incumbent": "Dick Durbin", "party": "D"},
    "IA": {"incumbent": "Joni Ernst", "party": "R"},
    "KS": {"incumbent": "Roger Marshall", "party": "R"},
    "KY": {"incumbent": "Mitch McConnell", "party": "R"},
    "LA": {"incumbent": "Bill Cassidy", "party": "R"},
    "ME": {"incumbent": "Susan Collins", "party": "R"},
    "MA": {"incumbent": "Ed Markey", "party": "D"},
    "MI": {"incumbent": "Gary Peters", "party": "D"},
    "MN": {"incumbent": "Tina Smith", "party": "D"},
    "MS": {"incumbent": "Cindy Hyde-Smith", "party": "R"},
    "MT": {"incumbent": "Steve Daines", "party": "R"},
    "NE": {"incumbent": "Pete Ricketts", "party": "R"},
    "NH": {"incumbent": "Jeanne Shaheen", "party": "D"},
    "NJ": {"incumbent": "Cory Booker", "party": "D", "note": "Resigned 2025, may have appointed successor"},
    "NM": {"incumbent": "Ben Ray Luján", "party": "D"},
    "NC": {"incumbent": "Thom Tillis", "party": "R"},
    "OK": {"incumbent": "Markwayne Mullin", "party": "R"},
    "OR": {"incumbent": "Jeff Merkley", "party": "D"},
    "RI": {"incumbent": "Jack Reed", "party": "D"},
    "SC": {"incumbent": "Lindsey Graham", "party": "R"},
    "SD": {"incumbent": "Mike Rounds", "party": "R"},
    "TN": {"incumbent": "Bill Hagerty", "party": "R"},
    "TX": {"incumbent": "John Cornyn", "party": "R"},
    "VA": {"incumbent": "Mark Warner", "party": "D"},
    "WV": {"incumbent": "Jim Justice", "party": "R"},
    "WY": {"incumbent": "Cynthia Lummis", "party": "R"},
}

# ── Governors up in 2026 (36 races) ──────────────────────────────────────

GOVERNORS_2026 = {
    "AL": {"incumbent": "Kay Ivey", "party": "R", "term_limited": True},
    "AK": {"incumbent": "Mike Dunleavy", "party": "R", "term_limited": False},
    "AZ": {"incumbent": "Katie Hobbs", "party": "D", "term_limited": False},
    "AR": {"incumbent": "Sarah Huckabee Sanders", "party": "R", "term_limited": False},
    "CA": {"incumbent": "Gavin Newsom", "party": "D", "term_limited": True},
    "CO": {"incumbent": "Jared Polis", "party": "D", "term_limited": True},
    "CT": {"incumbent": "Ned Lamont", "party": "D", "term_limited": False},
    "FL": {"incumbent": "Ron DeSantis", "party": "R", "term_limited": True},
    "GA": {"incumbent": "Brian Kemp", "party": "R", "term_limited": True},
    "HI": {"incumbent": "Josh Green", "party": "D", "term_limited": False},
    "ID": {"incumbent": "Brad Little", "party": "R", "term_limited": False},
    "IL": {"incumbent": "JB Pritzker", "party": "D", "term_limited": False},
    "IA": {"incumbent": "Kim Reynolds", "party": "R", "term_limited": False},
    "KS": {"incumbent": "Laura Kelly", "party": "D", "term_limited": True},
    "ME": {"incumbent": "Janet Mills", "party": "D", "term_limited": True},
    "MD": {"incumbent": "Wes Moore", "party": "D", "term_limited": False},
    "MA": {"incumbent": "Maura Healey", "party": "D", "term_limited": False},
    "MI": {"incumbent": "Gretchen Whitmer", "party": "D", "term_limited": True},
    "MN": {"incumbent": "Peggy Flanagan", "party": "D", "term_limited": False, "note": "Succeeded Tim Walz (VP)"},
    "NE": {"incumbent": "Jim Pillen", "party": "R", "term_limited": False},
    "NV": {"incumbent": "Joe Lombardo", "party": "R", "term_limited": False},
    "NH": {"incumbent": "Kelly Ayotte", "party": "R", "term_limited": False},
    "NM": {"incumbent": "Michelle Lujan Grisham", "party": "D", "term_limited": True},
    "NY": {"incumbent": "Kathy Hochul", "party": "D", "term_limited": False},
    "OH": {"incumbent": "Mike DeWine", "party": "R", "term_limited": True},
    "OK": {"incumbent": "Kevin Stitt", "party": "R", "term_limited": True},
    "OR": {"incumbent": "Tina Kotek", "party": "D", "term_limited": False},
    "PA": {"incumbent": "Josh Shapiro", "party": "D", "term_limited": False},
    "RI": {"incumbent": "Dan McKee", "party": "D", "term_limited": False},
    "SC": {"incumbent": "Henry McMaster", "party": "R", "term_limited": True},
    "SD": {"incumbent": "Larry Rhoden", "party": "R", "term_limited": False, "note": "Succeeded Kristi Noem (DHS)"},
    "TN": {"incumbent": "Bill Lee", "party": "R", "term_limited": True},
    "TX": {"incumbent": "Greg Abbott", "party": "R", "term_limited": False},
    "VT": {"incumbent": "Phil Scott", "party": "R", "term_limited": False},
    "WI": {"incumbent": "Tony Evers", "party": "D", "term_limited": False},
    "WY": {"incumbent": "Mark Gordon", "party": "R", "term_limited": True},
}

# ── State legislatures ────────────────────────────────────────────────────
# Structure: (lower_name, lower_seats, lower_term, lower_up_2026,
#             upper_name, upper_seats, upper_term, upper_up_2026_mode)
# upper_up_2026_mode: "all" = all seats, "half" = ~half, "none" = not up

STATE_LEGISLATURES = {
    "AL": ("House", 105, 4, True,  "Senate", 35, 4, "all"),
    "AK": ("House", 40, 2, True,   "Senate", 20, 4, "half"),
    "AZ": ("House", 60, 2, True,   "Senate", 30, 2, "all"),
    "AR": ("House", 100, 2, True,  "Senate", 35, 4, "half"),
    "CA": ("Assembly", 80, 2, True, "Senate", 40, 4, "half"),
    "CO": ("House", 65, 2, True,   "Senate", 35, 4, "half"),
    "CT": ("House", 151, 2, True,  "Senate", 36, 2, "all"),
    "DE": ("House", 41, 2, True,   "Senate", 21, 4, "half"),
    "FL": ("House", 120, 2, True,  "Senate", 40, 4, "half"),
    "GA": ("House", 180, 2, True,  "Senate", 56, 2, "all"),
    "HI": ("House", 51, 2, True,   "Senate", 25, 4, "half"),
    "ID": ("House", 70, 2, True,   "Senate", 35, 2, "all"),
    "IL": ("House", 118, 2, True,  "Senate", 59, 4, "half"),  # unusual 2-4-4 rotation
    "IN": ("House", 100, 2, True,  "Senate", 50, 4, "half"),
    "IA": ("House", 100, 2, True,  "Senate", 50, 4, "half"),
    "KS": ("House", 125, 2, True,  "Senate", 40, 4, "half"),
    "KY": ("House", 100, 2, True,  "Senate", 38, 4, "half"),
    "LA": ("House", 105, 4, False, "Senate", 39, 4, "none"),  # odd-year
    "ME": ("House", 151, 2, True,  "Senate", 35, 2, "all"),
    "MD": ("House", 141, 4, True,  "Senate", 47, 4, "all"),
    "MA": ("House", 160, 2, True,  "Senate", 40, 2, "all"),
    "MI": ("House", 110, 2, True,  "Senate", 38, 4, "half"),
    "MN": ("House", 134, 2, True,  "Senate", 67, 4, "half"),
    "MS": ("House", 122, 4, False, "Senate", 52, 4, "none"),  # odd-year
    "MO": ("House", 163, 2, True,  "Senate", 34, 4, "half"),
    "MT": ("House", 100, 2, True,  "Senate", 50, 4, "half"),
    "NE": (None, 0, 0, False,      "Legislature", 49, 4, "half"),  # unicameral
    "NV": ("Assembly", 42, 2, True, "Senate", 21, 4, "half"),
    "NH": ("House", 400, 2, True,  "Senate", 24, 2, "all"),
    "NJ": ("Assembly", 80, 2, False, "Senate", 40, 4, "none"),  # odd-year
    "NM": ("House", 70, 2, True,   "Senate", 42, 4, "half"),
    "NY": ("Assembly", 150, 2, True, "Senate", 63, 2, "all"),
    "NC": ("House", 120, 2, True,  "Senate", 50, 2, "all"),
    "ND": ("House", 94, 4, True,   "Senate", 47, 4, "all"),
    "OH": ("House", 99, 2, True,   "Senate", 33, 4, "half"),
    "OK": ("House", 101, 2, True,  "Senate", 48, 4, "half"),
    "OR": ("House", 60, 2, True,   "Senate", 30, 4, "half"),
    "PA": ("House", 203, 2, True,  "Senate", 50, 4, "half"),
    "RI": ("House", 75, 2, True,   "Senate", 38, 2, "all"),
    "SC": ("House", 124, 2, True,  "Senate", 46, 4, "half"),
    "SD": ("House", 70, 2, True,   "Senate", 35, 2, "all"),
    "TN": ("House", 99, 2, True,   "Senate", 33, 4, "half"),
    "TX": ("House", 150, 2, True,  "Senate", 31, 4, "half"),
    "UT": ("House", 75, 2, True,   "Senate", 29, 4, "half"),
    "VT": ("House", 150, 2, True,  "Senate", 30, 2, "all"),
    "VA": ("House", 100, 2, False, "Senate", 40, 4, "none"),  # odd-year
    "WA": ("House", 98, 2, True,   "Senate", 49, 4, "half"),
    "WV": ("House", 100, 2, True,  "Senate", 34, 4, "half"),
    "WI": ("Assembly", 99, 2, True, "Senate", 33, 4, "half"),
    "WY": ("House", 62, 2, True,   "Senate", 30, 4, "half"),
}

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}


def build_seats():
    seats = []

    # ── US House seats ────────────────────────────────────
    for state, count in HOUSE_DISTRICTS.items():
        for district in range(1, count + 1):
            dist_label = str(district) if count > 1 else "At-Large"
            seats.append({
                "seatId": f"US-HOUSE-{state}-{district:02d}" if count > 1 else f"US-HOUSE-{state}-AL",
                "level": "Federal",
                "body": "US House",
                "state": state,
                "district": dist_label,
                "upIn2026": True,
                "termYears": 2,
                "incumbent": None,  # to be populated by crawler
                "candidates": [],
            })

    # ── US Senate seats ───────────────────────────────────
    for state, info in SENATE_CLASS_II.items():
        seat = {
            "seatId": f"US-SENATE-{state}-II",
            "level": "Federal",
            "body": "US Senate",
            "state": state,
            "district": "Class II",
            "upIn2026": True,
            "termYears": 6,
            "incumbent": {
                "name": info["incumbent"],
                "party": info["party"],
            },
            "candidates": [],
        }
        if "note" in info:
            seat["note"] = info["note"]
        seats.append(seat)

    # ── Governor seats ────────────────────────────────────
    for state, info in GOVERNORS_2026.items():
        seat = {
            "seatId": f"GOV-{state}",
            "level": "State",
            "body": "Governor",
            "state": state,
            "district": "Statewide",
            "upIn2026": True,
            "termYears": 4 if state not in ("NH", "VT") else 2,
            "incumbent": {
                "name": info["incumbent"],
                "party": info["party"],
                "termLimited": info["term_limited"],
            },
            "candidates": [],
        }
        if "note" in info:
            seat["note"] = info["note"]
        seats.append(seat)

    # ── State legislature seats ───────────────────────────
    for state, leg_info in STATE_LEGISLATURES.items():
        lower_name, lower_seats, lower_term, lower_up, upper_name, upper_seats, upper_term, upper_mode = leg_info

        # Lower chamber
        if lower_name and lower_up and lower_seats > 0:
            for d in range(1, lower_seats + 1):
                seats.append({
                    "seatId": f"STATE-{lower_name.upper().replace(' ', '')}-{state}-{d:03d}",
                    "level": "State",
                    "body": f"{STATE_NAMES[state]} {lower_name}",
                    "state": state,
                    "district": str(d),
                    "upIn2026": True,
                    "termYears": lower_term,
                    "incumbent": None,
                    "candidates": [],
                })

        # Upper chamber
        if upper_name and upper_seats > 0:
            if upper_mode == "all":
                up_count = upper_seats
            elif upper_mode == "half":
                up_count = (upper_seats + 1) // 2  # approximate
            else:
                up_count = 0  # "none"

            for d in range(1, up_count + 1):
                seats.append({
                    "seatId": f"STATE-{upper_name.upper().replace(' ', '')}-{state}-{d:03d}",
                    "level": "State",
                    "body": f"{STATE_NAMES[state]} {upper_name}",
                    "state": state,
                    "district": str(d),
                    "upIn2026": True,
                    "termYears": upper_term,
                    "incumbent": None,
                    "candidates": [],
                })

    return seats


def main():
    seats = build_seats()
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    # Stats
    federal_house = sum(1 for s in seats if s["body"] == "US House")
    federal_senate = sum(1 for s in seats if s["body"] == "US Senate")
    governors = sum(1 for s in seats if s["body"] == "Governor")
    state_lower = sum(1 for s in seats if s["level"] == "State" and s["body"] != "Governor" and "Senate" not in s["body"] and "Legislature" not in s["body"])
    state_upper = sum(1 for s in seats if s["level"] == "State" and ("Senate" in s["body"] or "Legislature" in s["body"]))

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "election_year": 2026,
        "total_seats": len(seats),
        "summary": {
            "us_house": federal_house,
            "us_senate": federal_senate,
            "governors": governors,
            "state_lower_chambers": state_lower,
            "state_upper_chambers": state_upper,
        },
        "seats": seats,
    }

    out_path = data_dir / "seats.json"
    out_path.write_text(json.dumps(output, indent=2))

    print(f"2026 Election Seat Map Generated")
    print(f"  US House:           {federal_house:,}")
    print(f"  US Senate:          {federal_senate:,}")
    print(f"  Governors:          {governors:,}")
    print(f"  State Lower:        {state_lower:,}")
    print(f"  State Upper:        {state_upper:,}")
    print(f"  -------------------------")
    print(f"  TOTAL SEATS:        {len(seats):,}")
    print(f"\nWrote to {out_path}")


if __name__ == "__main__":
    main()
