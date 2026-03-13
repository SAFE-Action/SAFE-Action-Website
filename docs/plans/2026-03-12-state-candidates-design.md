# State Legislative + Gubernatorial Candidate Scraper

## Goal
Populate seats.json with candidates for all 2026 state legislative races and gubernatorial races by scraping Ballotpedia election pages, then enrich with emails from campaign websites.

## Scope
- ~6,200 state legislative seats (all 50 states + DC, 2026 cycle only)
- 36 gubernatorial races
- Estimated ~8,000-12,000 candidates total

## Architecture

**New file:** `crawler/scrape_ballotpedia.py`

Two-phase approach:

### Phase 1: Discover candidates from election listing pages (~100 requests)
- Scrape `ballotpedia.org/{State}_{Chamber}_elections,_2026` for each state+chamber
- Scrape `ballotpedia.org/Gubernatorial_elections,_2026` for governors
- Parse HTML tables (`.candidateListTablePartisan`) for: name, party, district, incumbent status, profile URL
- Match to existing seats in seats.json by state + body + district
- Save progress to cache file for resumability

### Phase 2: Enrich from profile pages + campaign websites (~5,000-10,000 requests)
- For each candidate, fetch their Ballotpedia profile page
- Extract campaign website URL from profile sidebar
- Scrape campaign website for email (reuse `enrich_candidates.py` email extraction logic)
- Rate limit: 1.5s between Ballotpedia requests, 1.0s between website scrapes
- Estimated runtime: ~3-4 hours

## URL Mapping

Body names in seats.json → Ballotpedia URL patterns:

| seats.json body | Ballotpedia URL |
|---|---|
| Alabama House | Alabama_House_of_Representatives_elections,_2026 |
| Alabama Senate | Alabama_State_Senate_elections,_2026 |
| California Assembly | California_State_Assembly_elections,_2026 |
| Nebraska Legislature | Nebraska_State_Senate_elections,_2026 |
| Nevada Assembly | Nevada_State_Assembly_elections,_2026 |
| New York Assembly | New_York_State_Assembly_elections,_2026 |
| Wisconsin Assembly | Wisconsin_State_Assembly_elections,_2026 |

General pattern: `{State}_House_of_Representatives_elections,_2026` or `{State}_State_Senate_elections,_2026`

Special cases: Assembly states (CA, NV, NY, WI), Nebraska unicameral

## Output
- Updates seats.json candidates[] arrays with: firstName, lastName, party, name, ballotpediaUrl, website, email, source: "ballotpedia"
- Adds incumbent data where available
- Cache file for resumability: `data/ballotpedia_candidates_cache.json`

## Verification
- Run on one state first (TX) to validate parsing
- Compare candidate counts against Ballotpedia's listed totals
- Spot-check emails match real campaign addresses
