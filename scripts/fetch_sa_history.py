"""Fetch, parse, cross-validate, and export South African moonsighting archives,
observation sites, and global moonsighting jurisdiction zones for whenIsEid.
"""

from __future__ import annotations

import concurrent.futures
import csv
import datetime as dt
import html as html_lib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) whenIsEid-research/1.0"

HIJRI_MONTHS = [
    (1, "muh", "Muharram"),
    (2, "sfr", "Safar"),
    (3, "rba", "Rabi al-Awwal"),
    (4, "rbt", "Rabi al-Thani"),
    (5, "jmo", "Jumada al-Ula"),
    (6, "jmt", "Jumada al-Akhirah"),
    (7, "rjb", "Rajab"),
    (8, "shb", "Shaban"),
    (9, "rmd", "Ramadan"),
    (10, "shw", "Shawwal"),
    (11, "zqd", "Dhul Qadah"),
    (12, "zhj", "Dhul Hijjah"),
]

MONTH_ALIASES: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"\bmuh[aā]rr?am\b", re.I), 1),
    (re.compile(r"\bsafar\b", re.I), 2),
    (re.compile(r"\brab[iī][\s\-’']*(?:ul|al)?[\s\-’']*(?:awwal|awal|i\b|1\b)", re.I), 3),
    (re.compile(r"\brab[iī][\s\-’']*(?:ul|al)?[\s\-’']*(?:[aā]{1,2}khir|th[aā]n[iī]|ii\b|2\b)", re.I), 4),
    (re.compile(r"\bjum[aā]{1,2}d[aā]?(?:l|[\s\-’']*al)?[\s\-’']*(?:[uū]l[aā]|awwal|i\b|1\b)", re.I), 5),
    (re.compile(r"\bjum[aā]{1,2}d[aā]?(?:l|[\s\-’']*al)?[\s\-’']*(?:[aā]{1,2}khir(?:ah)?|th[aā]ni(?:yah)?|ii\b|2\b)", re.I), 6),
    (re.compile(r"\brajab\b", re.I), 7),
    (re.compile(r"\bsha[’']?b[aā]{1,2}n\b", re.I), 8),
    (re.compile(r"\brama[dḍ]h?[aā]{1,2}n\b", re.I), 9),
    (re.compile(r"\bshaww?[aā]{1,2}l\b", re.I), 10),
    (re.compile(r"\b[dz]h?ul[\s\-’']*qa[’']?d(?:ah)?\b", re.I), 11),
    (re.compile(r"\b[dz]h?ul[\s\-’']*hijj?(?:ah)?\b", re.I), 12),
]

MONTH_NUM_TO_NAME = {num: name for num, _, name in HIJRI_MONTHS}
MONTH_NUM_TO_CODE = {num: code for num, code, _ in HIJRI_MONTHS}

GREG_MONTHS = (
    "January|February|March|April|May|June|July|August|September|Septmber|October|November|December|"
    "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"
)
GREG_DATE_RE = re.compile(
    rf"(?:(?P<d1>\d{{1,2}})(?:st|nd|rd|th)?\s+(?P<m1>{GREG_MONTHS})\.?\s*,?\s*(?P<y1>20\d{{2}})|"
    rf"(?P<m2>{GREG_MONTHS})\.?\s+(?P<d2>\d{{1,2}})(?:st|nd|rd|th)?\s*,?\s*(?P<y2>20\d{{2}}))",
    re.I,
)

SA_CITIES = [
    "Cape Town",
    "Three Anchor Bay",
    "Signal Hill",
    "Bakoven",
    "Lagoon Beach",
    "Parow",
    "Stellenbosch",
    "Grabouw",
    "Gordon's Bay",
    "Durban",
    "Johannesburg",
    "Pretoria",
    "Laudium",
    "Azaadville",
    "Randburg",
    "Gqeberha",
    "Port Elizabeth",
    "Malabar",
    "Witbank",
    "eMalahleni",
    "Rustenburg",
    "Makhado",
    "Louis Trichardt",
    "Zeerust",
    "Pietermaritzburg",
    "Lenasia",
    "Polokwane",
    "Bloemfontein",
    "Kimberley",
    "George",
    "Beaufort West",
]


def http_get(url: str, timeout: int = 20, retries: int = 1) -> tuple[bytes, dict[str, str]]:
    """Fetch URL with User-Agent and simple retry."""
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                headers = {k.lower(): v for k, v in resp.headers.items()}
                return resp.read(), headers
        except Exception as err:
            last_err = err
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Failed GET {url}: {last_err}")


def parse_greg_date(text: str) -> str | None:
    """Parse the first Gregorian date in text into ISO YYYY-MM-DD."""
    m = GREG_DATE_RE.search(text)
    if not m:
        return None
    if m.group("d1"):
        day_s, mon_s, yr_s = m.group("d1"), m.group("m1"), m.group("y1")
    else:
        day_s, mon_s, yr_s = m.group("d2"), m.group("m2"), m.group("y2")
    mon_norm = mon_s.rstrip(".").lower()
    if mon_norm in ("sept", "septmber"):
        mon_norm = "sep"
    for fmt in ("%d %B %Y", "%d %b %Y"):
        try:
            return dt.datetime.strptime(f"{int(day_s)} {mon_norm} {yr_s}", fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_hijri_month(text: str) -> int | None:
    """Normalize Hijri month name string to 1..12."""
    for pat, num in MONTH_ALIASES:
        if pat.search(text):
            return num
    return None


def extract_sa_cities(text: str) -> list[str]:
    """Extract mentioned South African city/station names."""
    found = []
    for city in SA_CITIES:
        if re.search(rf"\b{re.escape(city)}\b", text, re.I):
            found.append(city)
    return found


# ---------------------------------------------------------------------------
# 1. Wifaqul Ulama SA (wifaq.org.za)
# ---------------------------------------------------------------------------

def fetch_wifaq_sa() -> dict[tuple[int, int], dict[str, Any]]:
    """Fetch official South African Hilal announcements & calendars from wifaq.org.za."""
    records: dict[tuple[int, int], dict[str, Any]] = {}

    def fetch_wp_endpoint(base_url: str) -> list[dict[str, Any]]:
        all_posts: list[dict[str, Any]] = []
        page = 1
        while True:
            sep = "&" if "?" in base_url else "?"
            raw, hdrs = http_get(f"{base_url}{sep}per_page=100&page={page}", timeout=20, retries=1)
            batch = json.loads(raw.decode("utf-8", "ignore"))
            if not batch:
                break
            all_posts.extend(batch)
            total_pages = int(hdrs.get("x-wp-totalpages", "1"))
            if page >= total_pages:
                break
            page += 1
        return all_posts

    hilal_posts = fetch_wp_endpoint("https://wifaq.org.za/wp-json/wp/v2/posts?search=Hilal")
    cal_posts = fetch_wp_endpoint("https://wifaq.org.za/wp-json/wp/v2/posts?categories=162")

    # Process calendars first (baseline), then Hilal announcements (more detailed + Revised overrides)
    for source_kind, posts in [("calendar", cal_posts), ("announcement", hilal_posts)]:
        for p in posts:
            title = html_lib.unescape(p["title"]["rendered"])
            if source_kind == "announcement" and "hil" not in title.lower():
                continue
            if source_kind == "announcement" and "khilaal" in title.lower():
                continue
            body_html = p["content"]["rendered"]
            body = re.sub(r"\s+", " ", BeautifulSoup(body_html, "html.parser").get_text(" ")).strip()

            ym = re.search(r"\b(14\d{2})\b", title) or re.search(r"\b(14\d{2})\b", body)
            mnum = parse_hijri_month(title) or parse_hijri_month(body)
            if not ym or not mnum:
                continue
            hy = int(ym.group(1))
            key = (hy, mnum)
            post_date = p["date"][:10]
            is_revised = "revised" in title.lower()

            sighted: bool | None = None
            combined_w = title + " " + body
            if re.search(r"NOT\s+been\s+sighted|\(NS\)|NO\s+confirmed\s+reports|[—–\-]\s*NS\b|\b14\d{2}\s+NS\b", combined_w, re.I):
                sighted = False
            elif re.search(r"has\s+been\s+sighted|\(S\)|Subsequent\s+to\s+confirmed\s+reports|[—–\-]\s*S\b|\b14\d{2}\s+S\b", combined_w, re.I):
                sighted = True

            first_day: str | None = None
            m_start = re.search(
                r"(?:1st\s+of\s+.{3,40}?(?:will\s+be\s+on|to\s+be\s+on)\s+\w+\s*\(([^)]+)\)|"
                r"will\s+commence\s+on\s+\w+\s*,?\s*([^.;]+))",
                body,
                re.I,
            )
            if m_start:
                first_day = parse_greg_date(m_start.group(1) or m_start.group(2))
            date_estimated = False
            if not first_day and sighted is not None and source_kind == "announcement":
                # Decision evening is the 29th evening: +1 day if sighted, +2 days if not sighted
                d_ev = dt.date.fromisoformat(post_date)
                first_day = (d_ev + dt.timedelta(days=1 if sighted else 2)).isoformat()
                date_estimated = True

            existing = records.get(key)
            # Prefer revised announcements, or announcement over calendar
            should_replace = (
                existing is None
                or is_revised
                or (source_kind == "announcement" and not existing.get("is_revised") and existing.get("kind") == "calendar")
            )
            if should_replace:
                records[key] = {
                    "hijri_year": hy,
                    "hijri_month_num": mnum,
                    "hijri_month_name": MONTH_NUM_TO_NAME[mnum],
                    "decision_evening": post_date if source_kind == "announcement" else None,
                    "sighted_on_29th": sighted,
                    "first_of_month_gregorian": first_day,
                    "date_estimated": date_estimated,
                    "is_revised": is_revised,
                    "kind": source_kind,
                    "title": title,
                    "url": p["link"],
                    "body_excerpt": body[:350],
                }
    return records


# ---------------------------------------------------------------------------
# 2. HilalWatchZA (hilalwatch.org.za/hilal-data.json)
# ---------------------------------------------------------------------------

def fetch_hilalwatch_za() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Fetch HilalWatchZA overrides, SA sighting reports, and station metadata."""
    raw, _ = http_get("https://hilalwatch.org.za/hilal-data.json", timeout=25, retries=1)
    hw = json.loads(raw.decode("utf-8", "ignore"))
    cols = hw.get("collections", {})

    # Extract SA overrides (non-prefixed or zaz_-prefixed)
    len_overrides: dict[str, dict[str, Any]] = {}
    date_overrides: list[dict[str, Any]] = []
    for doc in cols.get("overrides", []):
        doc_id = doc["id"]
        data = doc["data"]
        if re.match(r"^(in|pk|weu|uk|eeu|me|tr|nam|sam|aus|caf|waf|eaf|naf)_", doc_id):
            continue
        clean_id = doc_id[4:] if doc_id.startswith("zaz_") else doc_id
        if clean_id.endswith("-len") and data.get("len") is not None:
            start_iso = clean_id[:-4]
            len_overrides[start_iso] = {
                "month_start_gregorian": start_iso,
                "month_length_days": int(data["len"]),
                "raw_id": doc_id,
            }
        elif not clean_id.endswith("-len"):
            date_overrides.append({"id": doc_id, "data": data})

    # Extract SA sightings & stations
    sa_reports: list[dict[str, Any]] = []
    for doc in cols.get("sightings", []):
        doc_id = doc["id"]
        d = doc["data"]
        items = d.get("reports", d.get("items", []))
        for item in items:
            if item.get("rg") in ("za", "zaz", None) or "South Africa" in str(item.get("loc", "")):
                entry = dict(item)
                entry["_collection_doc"] = doc_id
                sa_reports.append(entry)

    stations = []
    for doc in cols.get("sightmod", []):
        d = {k: v for k, v in doc["data"].items() if k != "asset"}
        d["id"] = doc["id"]
        stations.append(d)

    extra = {
        "exported": hw.get("exported"),
        "sa_len_overrides_count": len(len_overrides),
        "sa_date_overrides_count": len(date_overrides),
        "date_overrides": date_overrides,
        "sa_reports": sa_reports,
        "sightmod_stations": stations,
    }
    return len_overrides, extra


# ---------------------------------------------------------------------------
# 3. Moonsighting.com MCW Archives (1429 - 1445 AH)
# ---------------------------------------------------------------------------

def parse_mcw_month_page(hy: int, mnum: int, code: str) -> dict[str, Any]:
    """Fetch and parse a single moonsighting.com monthly report page for South Africa."""
    url = f"https://www.moonsighting.com/{hy}{code}.html"
    raw, _ = http_get(url, timeout=15, retries=1)
    html_str = raw.decode("utf-8", "ignore")
    soup = BeautifulSoup(html_str, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = re.sub(r"[ \t\r]+", " ", soup.get_text("\n"))
    text = re.sub(r"\n+", "\n", text)

    # Extract astronomical conjunction UTC
    conj_m = re.search(
        r"(?:Astronomical New Moon|conjunction)\s*(?:\(conjunction\))?\s*is on\s*([^\n.]+?UT)",
        text,
        re.I,
    )
    conjunction_utc = conj_m.group(1).strip() if conj_m else None

    # Walk lines tracking current date heading (e.g., "April 21, 2023 (Friday):" or "Friday, April 21, 2023:")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    current_date_iso: str | None = None
    first_day_date_iso: str | None = None
    sa_blocks: list[dict[str, Any]] = []

    date_heading_re = re.compile(
        rf"^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s*)?"
        rf"(?:(?:\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{GREG_MONTHS})|(?:{GREG_MONTHS})\s+\d{{1,2}}(?:st|nd|rd|th)?)\s*,?\s*20\d{{2}})"
        rf"(?:\s*\((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\))?\s*:?$",
        re.I,
    )

    i = 0
    while i < len(lines):
        ln = lines[i]
        if date_heading_re.match(ln) or (len(ln) < 55 and ln.endswith(":") and parse_greg_date(ln)):
            d_iso = parse_greg_date(ln)
            if d_iso:
                current_date_iso = d_iso
                if first_day_date_iso is None:
                    first_day_date_iso = d_iso
            i += 1
            continue

        if re.match(r"^South Africa\s*:", ln, re.I):
            block_lines = [ln]
            j = i + 1
            # Collect until the next country heading or next date heading
            while j < len(lines):
                nxt = lines[j]
                if date_heading_re.match(nxt) or (len(nxt) < 55 and nxt.endswith(":") and parse_greg_date(nxt)):
                    break
                # Next country heading: e.g. "Spain:" or "Tanzania:", excluding inner report labels like "Seen:" / "Not Seen:"
                if re.match(r"^[A-Z][A-Za-z &.\-()/]{1,40}:\s*$", nxt) and not re.match(
                    r"^(?:DATE|LOCATION|SKY|TIME|NO\.|ORIENTATION|REMARKS|AGE|COMMENTS|SEEN|NOT\s+SEEN|"
                    r"OFFICIALLY\s+ANNOUNCED|UNCONFIRMED|REPORT|OBSERVATION|RESULT|STATUS|WEATHER|"
                    r"NOTE|NOTES|LAG|ALTITUDE|AZIMUTH|ELONGATION|DURATION)\b",
                    nxt,
                    re.I,
                ):
                    break
                if re.match(r"^1st Day of\b", nxt, re.I):
                    break
                block_lines.append(nxt)
                j += 1
            block_text = " ".join(block_lines)
            sa_blocks.append({"date_heading": current_date_iso, "text": block_text})
            i = j
            continue
        i += 1

    # Also capture official "1st Day of ... in all Countries" line for South Africa if present
    country_line_m = re.search(r"([^\n]{0,40})\bSouth Africa\b[^\n]{0,60}", text, re.I)

    # Determine whether South Africa sighted on the 29th (first observation day) or not
    sighted_29th: bool | None = None
    first_of_month_greg: str | None = None
    decision_evening: str | None = None
    cities: list[str] = []

    for blk in sa_blocks:
        cities.extend(extract_sa_cities(blk["text"]))
    cities = sorted(set(cities))

    # Inspect blocks chronologically
    if sa_blocks:
        # Look for explicit official South Africa start-date statement in any block
        # Note: exclude Eid-ul-Adha references in month 12 (Dhul Hijjah), since Eid al-Adha is the 10th, not the 1st
        eid_clause = (
            r"|will\s+be\s+(?:celebrated|observed)\s+on|marks?\s+the\s+Day\s+of\s+Eid\s+in\s+South\s+Africa"
            if mnum == 10
            else ""
        )
        start_pat = re.compile(
            rf"(?:will\s+commence\s+on{eid_clause}|"
            r"(?:1st|first)\s+(?:day\s+of\s+)?(?:Ramad[aā]n|Shaww[aā]l|Dhul|Zul|Muharram|Safar|Rabi|Jumada|Jamad|Rajab|Sha['’]?b[aā]{1,2}n)[^.\n]{0,45}?\b(?:is|will\s+be|corresponds\s+with)\b)"
            r"\s*(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s*)?([^.;\n]{6,40})",
            re.I,
        )
        rev_start_pat = re.compile(
            rf"((?:\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{GREG_MONTHS})\.?\s*,?\s*20\d{{2}}|(?:{GREG_MONTHS})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?\s*,?\s*20\d{{2}}))\s+(?:is|will\s+be)\s+(?:the\s+)?(?:1st|first)\s+(?:day\s+of\s+)?(?:Ramad[aā]n|Shaww[aā]l|Dhul|Zul|Muharram|Safar|Rabi|Jumada|Jamad|Rajab|Sha['’]?b[aā]{{1,2}}n)",
            re.I,
        )
        for blk in sa_blocks:
            bt = blk["text"]
            m_comm = start_pat.search(bt) or rev_start_pat.search(bt)
            if m_comm:
                d_cand = parse_greg_date(m_comm.group(1))
                if d_cand and blk["date_heading"]:
                    gap_check = (dt.date.fromisoformat(d_cand) - dt.date.fromisoformat(blk["date_heading"])).days
                    if 0 <= gap_check <= 2:
                        first_of_month_greg = d_cand
                        break
                elif d_cand:
                    first_of_month_greg = d_cand
                    break

        b0 = sa_blocks[0]
        decision_evening = b0["date_heading"]
        t0 = b0["text"]
        has_seen = bool(re.search(r"(?<!Not\s)\bSeen\s*:|\bWAS\s+sighted\b|\bHilaal\s+(?:has\s+been|was)\s+sighted\b", t0, re.I))
        has_not_seen = bool(re.search(r"\bNot\s+Seen\s*:|\bwas\s+NOT\s+sighted\b|\bnot\s+sighted\b|\bno\s+confirmed\s+moonsighting\b|\bnegative\s+sighting\b|\bno\s+sighting\b", t0, re.I))

        if has_seen and not has_not_seen:
            sighted_29th = True
        elif has_not_seen and not has_seen:
            sighted_29th = False
        elif has_seen and has_not_seen:
            # Mixed reports on same evening: check explicit country-wide summary first
            if re.search(r"\bWAS\s+sighted\b|\bsighted\s+in\s+(?:many\s+locations|most|South\s+Africa)", t0, re.I):
                sighted_29th = True
            elif re.search(r"\bwas\s+NOT\s+sighted\b|\bnegative\s+sighting\b", t0, re.I):
                sighted_29th = False
            else:
                # Count individual Seen: vs Not Seen: entries
                n_seen = len(re.findall(r"(?<!Not\s)\bSeen\s*:", t0, re.I))
                n_not = len(re.findall(r"\bNot\s+Seen\s*:", t0, re.I))
                sighted_29th = n_seen >= n_not

        # Only let date gap override sighted_29th if text didn't already unambiguously state Not Seen / WAS NOT sighted
        if first_of_month_greg and decision_evening:
            gap = (dt.date.fromisoformat(first_of_month_greg) - dt.date.fromisoformat(decision_evening)).days
            if gap == 2 and sighted_29th is None:
                sighted_29th = False
            elif gap == 1 and sighted_29th is None:
                sighted_29th = True
            elif gap in (1, 2) and not (has_not_seen and not has_seen and gap == 1):
                # If MCW heading was posted 1 day late (e.g. 1441-08), trust explicit sighted_29th and keep first_of_month_greg
                pass
        elif not first_of_month_greg and decision_evening and sighted_29th is not None:
            d_ev = dt.date.fromisoformat(decision_evening)
            first_of_month_greg = (d_ev + dt.timedelta(days=1 if sighted_29th else 2)).isoformat()

    return {
        "hijri_year": hy,
        "hijri_month_num": mnum,
        "hijri_month_code": code,
        "hijri_month_name": MONTH_NUM_TO_NAME[mnum],
        "url": url,
        "conjunction_utc": conjunction_utc,
        "first_page_date": first_day_date_iso,
        "decision_evening": decision_evening,
        "sighted_on_29th": sighted_29th,
        "first_of_month_gregorian": first_of_month_greg,
        "observer_cities": cities,
        "sa_blocks": sa_blocks,
        "country_summary_line": country_line_m.group(0).strip() if country_line_m else None,
    }


def fetch_mcw_archives(start_yr: int = 1429, end_yr: int = 1445) -> dict[tuple[int, int], dict[str, Any]]:
    """Concurrently fetch and parse MCW monthly archives."""
    tasks = [(yr, mnum, code) for yr in range(start_yr, end_yr + 1) for mnum, code, _ in HIJRI_MONTHS]
    results: dict[tuple[int, int], dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(parse_mcw_month_page, yr, mnum, code): (yr, mnum) for yr, mnum, code in tasks}
        for fut in concurrent.futures.as_completed(futs):
            key = futs[fut]
            try:
                results[key] = fut.result()
            except Exception as err:
                results[key] = {
                    "hijri_year": key[0],
                    "hijri_month_num": key[1],
                    "hijri_month_name": MONTH_NUM_TO_NAME[key[1]],
                    "error": str(err),
                    "sa_blocks": [],
                }
    return results


# ---------------------------------------------------------------------------
# 4. Merge, Cross-Validate, and Export History
# ---------------------------------------------------------------------------

def build_master_history(
    wifaq: dict[tuple[int, int], dict[str, Any]],
    hw_lens: dict[str, dict[str, Any]],
    mcw: dict[tuple[int, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge MCW (1429-1445), Wifaqul Ulama SA (1442-1448), and HilalWatchZA overrides."""
    all_keys = sorted(set(mcw.keys()) | set(wifaq.keys()))
    rows: list[dict[str, Any]] = []

    for hy, mnum in all_keys:
        if hy < 1429 or (hy == 1448 and mnum > 6):
            continue
        w = wifaq.get((hy, mnum))
        m = mcw.get((hy, mnum))

        sources: list[str] = []
        if m and (m.get("sa_blocks") or m.get("conjunction_utc")):
            sources.append("mcw")
        if w:
            sources.append("wifaq_sa")

        # Precedence: Wifaqul Ulama SA (direct SA authority) > MCW SA reports
        first_day = (w or {}).get("first_of_month_gregorian") or (m or {}).get("first_of_month_gregorian")
        sighted = (w or {}).get("sighted_on_29th")
        if sighted is None and m:
            sighted = m.get("sighted_on_29th")
        decision_evening = (w or {}).get("decision_evening") or (m or {}).get("decision_evening")

        conflict = False
        conflict_note = ""
        if w and m and m.get("sighted_on_29th") is not None and w.get("sighted_on_29th") is not None:
            if w["sighted_on_29th"] != m["sighted_on_29th"]:
                conflict = True
                conflict_note = f"wifaq={w['sighted_on_29th']} ({w.get('first_of_month_gregorian')}) vs mcw={m['sighted_on_29th']} ({m.get('first_of_month_gregorian')})"
            elif w.get("first_of_month_gregorian") and m.get("first_of_month_gregorian") and w["first_of_month_gregorian"] != m["first_of_month_gregorian"]:
                conflict = True
                conflict_note = f"date mismatch: wifaq={w['first_of_month_gregorian']} vs mcw={m['first_of_month_gregorian']}"

        # Cross-check HilalWatchZA length override on the *previous* month
        # A 29-day previous month ends with a positive sighting on its 29th evening; 30-day = not sighted
        hw_match = None
        if first_day:
            fd = dt.date.fromisoformat(first_day)
            for delta in (29, 30):
                prev_start = (fd - dt.timedelta(days=delta)).isoformat()
                if prev_start in hw_lens:
                    hw_match = hw_lens[prev_start]
                    if "hilalwatch_za" not in sources:
                        sources.append("hilalwatch_za")
                    expected_len = 29 if sighted is True else (30 if sighted is False else None)
                    if expected_len and hw_match["month_length_days"] != expected_len:
                        conflict = True
                        conflict_note += f" | hw_prev_len={hw_match['month_length_days']} vs sighted={sighted}"
                    break

        prev_month_days = 29 if sighted is True else (30 if sighted is False else None)

        eid_date = None
        if first_day:
            if mnum == 10:  # Shawwal -> 1st Shawwal = Eid al-Fitr
                eid_date = first_day
            elif mnum == 12:  # Dhul Hijjah -> 10th Dhul Hijjah = Eid al-Adha
                eid_date = (dt.date.fromisoformat(first_day) + dt.timedelta(days=9)).isoformat()

        raw_note_parts = []
        if w:
            raw_note_parts.append(f"Wifaq: {w.get('body_excerpt', '')[:180]}")
        if m and m.get("sa_blocks"):
            raw_note_parts.append(f"MCW: {m['sa_blocks'][0]['text'][:180]}")

        rows.append({
            "hijri_year": hy,
            "hijri_month_num": mnum,
            "hijri_month_name": MONTH_NUM_TO_NAME[mnum],
            "conjunction_utc": (m or {}).get("conjunction_utc"),
            "decision_evening": decision_evening,
            "sighted_on_29th": sighted,
            "prev_month_days": prev_month_days,
            "first_of_month_gregorian": first_day,
            "eid_date_gregorian": eid_date,
            "observer_cities": (m or {}).get("observer_cities", []),
            "sources": sources,
            "cross_source_conflict": conflict,
            "conflict_note": conflict_note.strip(" |"),
            "raw_notes": " | ".join(raw_note_parts),
        })

    # Post-pass: compute exact days between consecutive known first_of_month_gregorian values
    for idx in range(1, len(rows)):
        prev_r = rows[idx - 1]
        cur_r = rows[idx]
        if prev_r["first_of_month_gregorian"] and cur_r["first_of_month_gregorian"]:
            # Only compare if strictly consecutive Hijri months
            py, pm = prev_r["hijri_year"], prev_r["hijri_month_num"]
            ey, em = (py + 1, 1) if pm == 12 else (py, pm + 1)
            if (cur_r["hijri_year"], cur_r["hijri_month_num"]) == (ey, em):
                diff = (
                    dt.date.fromisoformat(cur_r["first_of_month_gregorian"])
                    - dt.date.fromisoformat(prev_r["first_of_month_gregorian"])
                ).days
                prev_r["verified_month_days"] = diff
                if cur_r["prev_month_days"] is None and diff in (29, 30):
                    cur_r["prev_month_days"] = diff
                    cur_r["sighted_on_29th"] = (diff == 29)
    return rows


# ---------------------------------------------------------------------------
# 5. South African Observation Sites
# ---------------------------------------------------------------------------

def build_sa_observation_sites(hw_extra: dict[str, Any]) -> list[dict[str, Any]]:
    """Compile South African moonsighting stations from COSSA, MCW, and HilalWatchZA."""
    sites = [
        # COSSA Western Cape Stations (2024 Constitution §1.3.1 & cossa.co.za)
        {
            "name": "Signal Hill",
            "city": "Cape Town",
            "province": "Western Cape",
            "lat": -33.9178,
            "lon": 18.4028,
            "elevation_m": 340,
            "organization": "COSSA / MJC Hilaal Forum",
            "source": "COSSA Constitution §1.3.1 & cossa.co.za",
            "notes": "Historic elevated Cape Peninsula vantage point (340 m ASL); primary COSSA station.",
        },
        {
            "name": "Three Anchor Bay",
            "city": "Cape Town",
            "province": "Western Cape",
            "lat": -33.9065,
            "lon": 18.3967,
            "elevation_m": 5,
            "organization": "COSSA / MJC Hilaal Forum / VOC Broadcast",
            "source": "COSSA Constitution §1.3.1 & cossa.co.za",
            "notes": "Sea-level beachfront vantage point 4 km from CBD; primary Voice of the Cape (VOC) live outside-broadcast hub.",
        },
        {
            "name": "Bakoven",
            "city": "Cape Town",
            "province": "Western Cape",
            "lat": -33.9598,
            "lon": 18.3728,
            "elevation_m": 15,
            "organization": "COSSA",
            "source": "COSSA Constitution §1.3.1",
            "notes": "Atlantic seaboard coastal horizon station.",
        },
        {
            "name": "Lagoon Beach",
            "city": "Cape Town (Milnerton)",
            "province": "Western Cape",
            "lat": -33.8910,
            "lon": 18.4827,
            "elevation_m": 4,
            "organization": "MCW / COSSA",
            "source": "MCW Report 1435rmd (Abdullah Salie: S33°53.4585' E18°29.960')",
            "notes": "Coastal Table Bay beach horizon facing west over Robben Island.",
        },
        {
            "name": "Parow",
            "city": "Cape Town",
            "province": "Western Cape",
            "lat": -33.9068,
            "lon": 18.5800,
            "elevation_m": 42,
            "organization": "MCW South Africa",
            "source": "MCW South Africa Observer Network",
            "notes": "Northern suburbs Cape Town observer station.",
        },
        {
            "name": "Stellenbosch",
            "city": "Stellenbosch",
            "province": "Western Cape",
            "lat": -33.9321,
            "lon": 18.8602,
            "elevation_m": 136,
            "organization": "COSSA",
            "source": "COSSA Constitution §1.3.1",
            "notes": "Boland inland Western Cape station.",
        },
        {
            "name": "Gordon's Bay",
            "city": "Gordon's Bay",
            "province": "Western Cape",
            "lat": -34.1656,
            "lon": 18.8669,
            "elevation_m": 25,
            "organization": "COSSA",
            "source": "COSSA Constitution §1.3.1",
            "notes": "False Bay eastern coastal station.",
        },
        {
            "name": "Grabouw",
            "city": "Grabouw",
            "province": "Western Cape",
            "lat": -34.1514,
            "lon": 19.0156,
            "elevation_m": 315,
            "organization": "COSSA",
            "source": "COSSA Constitution §1.3.1",
            "notes": "Overberg high-elevation inland station.",
        },
        # Gauteng & North West & Limpopo (HilalWatchZA & MCW)
        {
            "name": "Laudium - Masjidus Salaam Minaret",
            "city": "Pretoria (Tshwane)",
            "province": "Gauteng",
            "lat": -25.77966,
            "lon": 28.1090,
            "elevation_m": 1380,
            "organization": "HilalWatchZA / MCW",
            "source": "hilal-data.json (sightmod hz-pmvjnz2oa)",
            "notes": "Highveld inland station with documented horizon profile (azimuth center 276.3°, FOV 69°).",
        },
        {
            "name": "Randburg Northcliff Tower",
            "city": "Johannesburg",
            "province": "Gauteng",
            "lat": -26.205994,
            "lon": 28.032063,
            "elevation_m": 1750,
            "organization": "HilalWatchZA / MCW",
            "source": "hilal-data.json (sightmod hz-pmvjobict)",
            "notes": "High-elevation Johannesburg ridge horizon station.",
        },
        {
            "name": "Azaadville",
            "city": "Krugersdorp",
            "province": "Gauteng",
            "lat": -26.1708,
            "lon": 27.7488,
            "elevation_m": 1650,
            "organization": "HilalWatchZA / Wifaqul Ulama SA",
            "source": "hilal-data.json (sightings)",
            "notes": "West Rand Gauteng observation station.",
        },
        {
            "name": "Rustenburg",
            "city": "Rustenburg",
            "province": "North West",
            "lat": -25.6672,
            "lon": 27.2421,
            "elevation_m": 1170,
            "organization": "MCW South Africa",
            "source": "MCW South Africa Observer Network & 1444shw",
            "notes": "Active MCW observer station (Tehseen Raza Hamdani).",
        },
        {
            "name": "Zeerust",
            "city": "Zeerust",
            "province": "North West",
            "lat": -25.5450,
            "lon": 26.0778,
            "elevation_m": 1190,
            "organization": "UUCSA / HilalWatchZA",
            "source": "hilal-data.json (sightings)",
            "notes": "Western North West dry-highveld observation point.",
        },
        {
            "name": "Makhado (Louis Trichardt)",
            "city": "Makhado",
            "province": "Limpopo",
            "lat": -23.0436,
            "lon": 29.9047,
            "elevation_m": 960,
            "organization": "UUCSA / HilalWatchZA",
            "source": "hilal-data.json (sightings)",
            "notes": "Northernmost South African station (~23°S), low latitude advantage.",
        },
        {
            "name": "eMalahleni (Witbank)",
            "city": "eMalahleni",
            "province": "Mpumalanga",
            "lat": -25.8728,
            "lon": 29.2553,
            "elevation_m": 1560,
            "organization": "MCW South Africa",
            "source": "MCW South Africa Observer Network",
            "notes": "Mpumalanga Highveld station (Shakil Vayani).",
        },
        # KwaZulu-Natal & Eastern Cape
        {
            "name": "Durban (JUKZN / MCW Hub)",
            "city": "Durban",
            "province": "KwaZulu-Natal",
            "lat": -29.8587,
            "lon": 31.0218,
            "elevation_m": 20,
            "organization": "Jamiatul Ulama KZN / MCW",
            "source": "MCW South Africa Observer Network & jamiat.org.za",
            "notes": "National coordination hub (Rashid Motala, Yusuf Essack) & KZN Hilaal committee.",
        },
        {
            "name": "Gqeberha (Malabar / Port Elizabeth)",
            "city": "Gqeberha",
            "province": "Eastern Cape",
            "lat": -33.9139,
            "lon": 25.5823,
            "elevation_m": 80,
            "organization": "UUCSA / MCW / HilalWatchZA",
            "source": "hilal-data.json & MCW 1435zhj",
            "notes": "Eastern Cape coastal observation station.",
        },
    ]
    return sites


# ---------------------------------------------------------------------------
# 6. Global Moonsighting Jurisdictions
# ---------------------------------------------------------------------------

def fetch_jurisdictions() -> dict[str, Any]:
    """Parse moonsighting.com/how-countries.html into structured jurisdiction zones."""
    raw, _ = http_get("https://www.moonsighting.com/how-countries.html", timeout=15, retries=1)
    soup = BeautifulSoup(raw.decode("utf-8", "ignore"), "html.parser")

    zone_map = {
        "Countries that follow Saudi Arabia": ("follow_saudi", "Follow Saudi Arabia Supreme Court announcements"),
        "Countries that follow Turkey": ("follow_turkey_diyanet", "Turkey Diyanet / ECFR 2016 global calculation (altitude > 5°, elongation > 8° anywhere)"),
        "Countries that follow Local Sighting": ("local_sighting", "Physical crescent sighting within national/regional horizon"),
        "Countries that follow their own criteria": ("regional_or_custom", "Country-specific calculation, official board, or mixed sub-community criteria"),
    }

    entries: list[dict[str, Any]] = []
    for span in soup.find_all("span", class_="red16"):
        heading = span.get_text(" ", strip=True)
        zone_id, zone_desc = zone_map.get(heading, ("other", heading))
        ol = span.find_next("ol")
        if not ol:
            continue
        for li in ol.find_all("li"):
            txt = re.sub(r"\s+", " ", li.get_text(" ", strip=True)).strip()
            if txt:
                entries.append({
                    "raw_label": txt,
                    "zone": zone_id,
                    "zone_heading": heading,
                    "zone_description": zone_desc,
                })

    return {
        "source": "https://www.moonsighting.com/how-countries.html",
        "extracted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "zone_definitions": [
            {
                "zone": "follow_saudi",
                "label": "Follows Saudi Arabia",
                "description": "Adopts Saudi Supreme Court announcements (often aligning with Umm al-Qura calendar).",
            },
            {
                "zone": "follow_turkey_diyanet",
                "label": "Follows Turkey / ECFR Global Calculation",
                "description": "2016 Istanbul Unified Calendar: moon altitude > 5° and elongation > 8° at local sunset anywhere on Earth.",
            },
            {
                "zone": "local_sighting",
                "label": "Local / Regional Physical Sighting",
                "description": "Requires verified physical crescent sighting within national or shared regional horizon (e.g., South Africa UUCSA/COSSA, Morocco, Pakistan, India).",
            },
            {
                "zone": "regional_or_custom",
                "label": "National Criteria / Mixed Sub-Communities",
                "description": "Uses custom astronomical rules (e.g., MABIMS 3°/6.4° in SE Asia, Egypt moonset >= 5m after sunset) or has split local/follower communities (UK, USA, Canada).",
            },
        ],
        "count": len(entries),
        "entries": entries,
    }


def main() -> None:
    live_only = "--live-only" in sys.argv
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("1/5 Fetching Wifaqul Ulama SA (wifaq.org.za)...")
    wifaq = fetch_wifaq_sa()
    print(f"    -> {len(wifaq)} Hijri months parsed from Wifaqul Ulama SA")

    print("2/5 Fetching HilalWatchZA (hilal-data.json)...")
    hw_lens, hw_extra = fetch_hilalwatch_za()
    with open(DATA_DIR / "hilalwatch_sa_reports.json", "w", encoding="utf-8") as f:
        json.dump(hw_extra, f, indent=2, ensure_ascii=False)
    print(f"    -> {len(hw_lens)} SA month-length overrides, {len(hw_extra['sa_reports'])} SA reports")

    mcw_cache_path = DATA_DIR / "mcw_sa_raw.json"
    if live_only and (DATA_DIR / "sa_moonsighting_history.json").exists():
        print("3/5 --live-only mode: loading cached MCW baseline from sa_moonsighting_history.json...")
        existing_hist = json.loads((DATA_DIR / "sa_moonsighting_history.json").read_text(encoding="utf-8"))
        mcw = {}
        for r in existing_hist:
            if "mcw" in r.get("sources", []) and r["hijri_year"] <= 1445:
                mcw[(r["hijri_year"], r["hijri_month_num"])] = {
                    "hijri_year": r["hijri_year"],
                    "hijri_month_num": r["hijri_month_num"],
                    "hijri_month_name": r["hijri_month_name"],
                    "conjunction_utc": r.get("conjunction_utc"),
                    "decision_evening": r.get("decision_evening"),
                    "sighted_on_29th": r.get("sighted_on_29th"),
                    "first_of_month_gregorian": r.get("first_of_month_gregorian"),
                    "observer_cities": r.get("observer_cities", []),
                    "sa_blocks": [{"date_heading": r.get("decision_evening"), "text": r.get("raw_notes", "")}],
                }
        print(f"    -> Loaded {len(mcw)} cached MCW months")
    else:
        print("3/5 Fetching MCW archives (1429-1445 AH, 204 pages)...")
        mcw = fetch_mcw_archives(1429, 1445)
        mcw_list = [mcw[k] for k in sorted(mcw.keys())]
        with open(mcw_cache_path, "w", encoding="utf-8") as f:
            json.dump(mcw_list, f, indent=2, ensure_ascii=False)
        sa_hit_months = sum(1 for v in mcw.values() if v.get("sa_blocks"))
        print(f"    -> {len(mcw)} pages processed, {sa_hit_months} months have South Africa sighting blocks")

    print("4/5 Merging & validating master South Africa history...")
    history = build_master_history(wifaq, hw_lens, mcw)
    with open(DATA_DIR / "sa_moonsighting_history.json", "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)

    csv_cols = [
        "hijri_year",
        "hijri_month_num",
        "hijri_month_name",
        "conjunction_utc",
        "decision_evening",
        "sighted_on_29th",
        "prev_month_days",
        "first_of_month_gregorian",
        "eid_date_gregorian",
        "observer_cities",
        "sources",
        "cross_source_conflict",
        "conflict_note",
    ]
    with open(DATA_DIR / "sa_moonsighting_history.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=csv_cols)
        writer.writeheader()
        for r in history:
            row_out = {k: r.get(k) for k in csv_cols}
            row_out["observer_cities"] = "; ".join(r.get("observer_cities", []))
            row_out["sources"] = "; ".join(r.get("sources", []))
            writer.writerow(row_out)

    eid_ram = [r for r in history if r["hijri_month_num"] in (9, 10, 12)]
    with open(DATA_DIR / "sa_eid_ramadan_history.json", "w", encoding="utf-8") as f:
        json.dump(eid_ram, f, indent=2, ensure_ascii=False)
    with open(DATA_DIR / "sa_eid_ramadan_history.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=csv_cols)
        writer.writeheader()
        for r in eid_ram:
            row_out = {k: r.get(k) for k in csv_cols}
            row_out["observer_cities"] = "; ".join(r.get("observer_cities", []))
            row_out["sources"] = "; ".join(r.get("sources", []))
            writer.writerow(row_out)

    print("5/5 Exporting SA observation sites & global jurisdictions...")
    sites = build_sa_observation_sites(hw_extra)
    with open(DATA_DIR / "sa_observation_sites.json", "w", encoding="utf-8") as f:
        json.dump(sites, f, indent=2, ensure_ascii=False)

    jurisdictions_path = DATA_DIR / "jurisdictions.json"
    if live_only and jurisdictions_path.exists():
        jurisdictions = json.loads(jurisdictions_path.read_text(encoding="utf-8"))
    else:
        jurisdictions = fetch_jurisdictions()
        with open(jurisdictions_path, "w", encoding="utf-8") as f:
            json.dump(jurisdictions, f, indent=2, ensure_ascii=False)

    # Validation summary
    keys = [(r["hijri_year"], r["hijri_month_num"]) for r in history]
    assert len(keys) == len(set(keys)), "Duplicate (hijri_year, hijri_month_num) found!"

    anomalies = []
    for idx in range(1, len(history)):
        p, c = history[idx - 1], history[idx]
        if p["first_of_month_gregorian"] and c["first_of_month_gregorian"]:
            py, pm = p["hijri_year"], p["hijri_month_num"]
            ey, em = (py + 1, 1) if pm == 12 else (py, pm + 1)
            if (c["hijri_year"], c["hijri_month_num"]) == (ey, em):
                diff = (dt.date.fromisoformat(c["first_of_month_gregorian"]) - dt.date.fromisoformat(p["first_of_month_gregorian"])).days
                if diff not in (29, 30):
                    anomalies.append((f"{py}-{pm:02d}", p["first_of_month_gregorian"], f"{ey}-{em:02d}", c["first_of_month_gregorian"], diff))

    conflicts = [r for r in history if r["cross_source_conflict"]]
    known_dates = sum(1 for r in history if r["first_of_month_gregorian"])
    sighted_cnt = sum(1 for r in history if r["sighted_on_29th"] is True)
    not_sighted_cnt = sum(1 for r in history if r["sighted_on_29th"] is False)

    print("\n=== VALIDATION SUMMARY ===")
    print(f"Total Hijri months tracked: {len(history)} (1429-01 to 1448-06)")
    print(f"Months with resolved SA start date: {known_dates}/{len(history)}")
    print(f"Sighted on 29th: {sighted_cnt}, Not sighted (30d prev): {not_sighted_cnt}")
    print(f"Cross-source conflicts: {len(conflicts)}")
    for c in conflicts:
        print(f"  CONFLICT {c['hijri_year']}-{c['hijri_month_num']:02d} ({c['hijri_month_name']}): {c['conflict_note']}")
    print(f"Consecutive-month day-gap anomalies (not 29 or 30): {len(anomalies)}")
    for a in anomalies:
        print(f"  ANOMALY {a}")
    print(f"SA observation sites: {len(sites)}")
    print(f"Global jurisdiction entries: {jurisdictions['count']}")


if __name__ == "__main__":
    main()
