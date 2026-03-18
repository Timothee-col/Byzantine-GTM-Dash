#!/usr/bin/env python3
"""Byzantine Dashboard — daily sync script.

Fetches data from 4 sources (Attio, Fireflies, Gmail, Google Calendar),
assembles public/data.json for the static war-room dashboard.
All sources use direct REST APIs — no MCP.
"""

import base64
import json
import os
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DATA_JSON = Path(__file__).resolve().parent.parent / "public" / "data.json"

STAGE_MAP = {
    "qualification": "Qualification",
    "contacted": "Contacted",
    "meeting": "Meeting",
    "proposal": "Proposal / Negotiation",
    "proposal / negotiation": "Proposal / Negotiation",
    "negotiation": "Proposal / Negotiation",
    "testing": "Testing",
}
VALID_STAGES = {"Qualification", "Contacted", "Meeting", "Proposal / Negotiation", "Testing"}
# Stages to exclude from the dashboard (closed deals)
EXCLUDED_STAGES = {"Won", "Lost", "Paused"}


def slugify(name: str) -> str:
    """Lowercase, strip accents, spaces → hyphens."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\w\s-]", "", ascii_only).strip().lower()
    return re.sub(r"[\s_]+", "-", slug)


def fuzzy_match(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def parse_date(d: str | None) -> datetime | None:
    if not d:
        return None
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def normalize_stage(raw: str) -> str:
    """Map a raw stage string to one of the 5 canonical stages."""
    if raw in VALID_STAGES:
        return raw
    low = raw.strip().lower()
    for key, val in STAGE_MAP.items():
        if key in low:
            return val
    return "Qualification"


def attio_api(method: str, path: str, body: dict | None = None) -> dict:
    """Call the Attio REST API v2."""
    api_key = os.environ["ATTIO_API_KEY"]
    url = f"https://api.attio.com/v2{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")
    with urlopen(req) as resp:
        return json.loads(resp.read())


def fireflies_gql(query: str, variables: dict | None = None) -> dict:
    """Call the Fireflies GraphQL API."""
    api_key = os.environ["FIREFLIES_API_KEY"]
    url = "https://api.fireflies.ai/graphql"
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    data = json.dumps(payload).encode()
    req = Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")
    with urlopen(req) as resp:
        return json.loads(resp.read())


# ---------------------------------------------------------------------------
# Source 1 — Attio (REST API v2)
# ---------------------------------------------------------------------------


def _resolve_company_records(record_ids: list[str]) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Batch-fetch company names and domains from Attio by record IDs.

    Returns (names_by_rid, domains_by_rid).
    """
    names: dict[str, str] = {}
    domains: dict[str, list[str]] = {}
    for rid in record_ids:
        try:
            resp = attio_api("GET", f"/objects/companies/records/{rid}")
            vals = resp.get("data", {}).get("values", {})
            name_list = vals.get("name", [])
            if name_list:
                names[rid] = name_list[0].get("value", "")
            dom_list = vals.get("domains", [])
            if dom_list:
                domains[rid] = [d.get("domain", "") for d in dom_list if d.get("domain")]
        except Exception:
            pass
    return names, domains


def _resolve_person_names(record_ids: list[str]) -> dict[str, str]:
    """Fetch person names from Attio by record IDs."""
    names: dict[str, str] = {}
    for rid in record_ids:
        try:
            resp = attio_api("GET", f"/objects/people/records/{rid}")
            vals = resp.get("data", {}).get("values", {})
            parts = []
            for key in ("first_name", "last_name"):
                v = vals.get(key, [])
                if v:
                    parts.append(v[0].get("value", ""))
            if parts:
                names[rid] = " ".join(p for p in parts if p)
        except Exception:
            pass
    return names


def fetch_attio() -> list:
    # Step 1: find the Sales list (prefer "Sales", fall back to first list)
    lists_resp = attio_api("GET", "/lists")
    pipeline_list = None
    for lst in lists_resp.get("data", []):
        name = (lst.get("name") or "").lower()
        if name == "sales":
            pipeline_list = lst
            break
    if not pipeline_list:
        for lst in lists_resp.get("data", []):
            name = (lst.get("name") or "").lower()
            slug = (lst.get("api_slug") or "").lower()
            if "pipeline" in name or "sales" in name or "pipeline" in slug:
                pipeline_list = lst
                break
    if not pipeline_list:
        if lists_resp.get("data"):
            pipeline_list = lists_resp["data"][0]
        else:
            raise RuntimeError("No lists found in Attio")

    list_slug = pipeline_list["api_slug"]
    print(f"  Using Attio list: {pipeline_list['name']} ({list_slug})")

    # Step 2: fetch all entries from that list
    entries = []
    offset = None
    while True:
        body = {"limit": 500}
        if offset:
            body["offset"] = offset
        resp = attio_api("POST", f"/lists/{list_slug}/entries/query", body)
        entries.extend(resp.get("data", []))
        next_offset = resp.get("next_cursor")
        if not next_offset or len(resp.get("data", [])) < 500:
            break
        offset = next_offset

    # Step 3: resolve company names + domains via parent_record_id
    company_rids = list({e["parent_record_id"] for e in entries if e.get("parent_record_id")})
    company_names, company_domains = _resolve_company_records(company_rids)

    # Step 4: collect person record IDs for main_point_of_contact
    person_rids = set()
    for entry in entries:
        mpc = entry.get("entry_values", {}).get("main_point_of_contact", [])
        if mpc:
            rid = mpc[0].get("target_record_id")
            if rid:
                person_rids.add(rid)
    person_names = _resolve_person_names(list(person_rids))

    # Step 5: extract deal data from each entry
    deals = []
    for entry in entries:
        values = entry.get("entry_values", {})

        # Company name and domains from parent record
        parent_rid = entry.get("parent_record_id", "")
        company = company_names.get(parent_rid, "")
        if not company:
            continue
        domains = company_domains.get(parent_rid, [])

        # Stage
        stage_raw = ""
        stage_vals = values.get("stage", [])
        if stage_vals:
            stage_raw = stage_vals[0].get("status", {}).get("title", "")

        # Skip closed/paused deals
        if stage_raw in EXCLUDED_STAGES:
            continue

        # Notes
        notes = ""
        notes_vals = values.get("notes", [])
        if notes_vals:
            notes = notes_vals[0].get("value", "") or ""

        # Main point of contact
        contact = None
        mpc = values.get("main_point_of_contact", [])
        if mpc:
            rid = mpc[0].get("target_record_id")
            if rid:
                contact = person_names.get(rid)

        # Close confidence (rating 1-5)
        confidence = None
        cc = values.get("close_confidence", [])
        if cc:
            confidence = cc[0].get("value")

        deals.append({
            "company": str(company),
            "domains": domains,
            "stage": normalize_stage(stage_raw),
            "lastContactDate": None,  # will be enriched from Gmail/GCal/Fireflies
            "notes": str(notes),
            "nextSteps": "",  # Attio doesn't have this field; derived from transcripts
            "contact": str(contact) if contact else None,
            "confidence": confidence,
        })

    return deals


# ---------------------------------------------------------------------------
# Source 2 — Fireflies (GraphQL API)
# ---------------------------------------------------------------------------

FIREFLIES_QUERY = """
query RecentTranscripts($limit: Int, $fromDate: DateTime) {
  transcripts(limit: $limit, fromDate: $fromDate) {
    id
    title
    date
    participants
    summary {
      overview
      action_items
    }
    organizer_email
  }
}
"""


def fetch_fireflies() -> list:
    from_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
    resp = fireflies_gql(FIREFLIES_QUERY, {"limit": 100, "fromDate": from_date})

    transcripts = []
    for t in resp.get("data", {}).get("transcripts", []) or []:
        # Parse date (epoch ms or ISO string)
        raw_date = t.get("date")
        if raw_date:
            try:
                if isinstance(raw_date, (int, float)):
                    dt = datetime.fromtimestamp(raw_date / 1000 if raw_date > 1e12 else raw_date, tz=timezone.utc)
                else:
                    dt = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
                date_str = dt.strftime("%Y-%m-%d")
            except (ValueError, TypeError, OSError):
                date_str = ""
        else:
            date_str = ""

        summary_obj = t.get("summary") or {}
        overview = summary_obj.get("overview") or ""
        action_items = summary_obj.get("action_items") or []
        if isinstance(action_items, str):
            action_items = [s.strip() for s in action_items.split("\n") if s.strip()]

        participants = t.get("participants") or []
        if isinstance(participants, str):
            participants = [p.strip() for p in participants.split(",") if p.strip()]

        title = t.get("title") or ""

        # Extract external participant email domains (exclude byzantine/gaia)
        external_domains = set()
        external_emails = []
        for p in participants:
            if isinstance(p, str) and "@" in p:
                domain = p.split("@")[1].lower()
                if "byzantine" not in domain and "gaia" not in domain and "gmail" not in domain and "google" not in domain:
                    external_domains.add(domain)
                    external_emails.append(p)

        # Infer company from title ("Meet – X and Gaia" pattern)
        company = ""
        if "<>" in title:
            parts = title.split("<>")
            for part in parts:
                part = part.strip()
                if "byzantine" not in part.lower() and "gaia" not in part.lower():
                    company = part
                    break

        transcripts.append({
            "date": date_str,
            "title": title,
            "participants": participants[:10],
            "summary": overview[:200],
            "actionItems": action_items[:5],
            "company": company,
            "external_domains": list(external_domains),
        })

    return transcripts


# ---------------------------------------------------------------------------
# Google Auth helper
# ---------------------------------------------------------------------------

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]


def _get_google_creds():
    from google.auth.transport.requests import Request as GRequest
    from google.oauth2.credentials import Credentials

    creds = None
    token_json = os.environ.get("GOOGLE_TOKEN_JSON")
    if token_json:
        token_data = json.loads(base64.b64decode(token_json))
        creds = Credentials.from_authorized_user_info(token_data, SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(GRequest())
    return creds


# ---------------------------------------------------------------------------
# Source 3 — Gmail (Google REST API)
# ---------------------------------------------------------------------------


def fetch_gmail(company_names: list[str]) -> list:
    from googleapiclient.discovery import build

    creds = _get_google_creds()
    if not creds:
        raise RuntimeError("Google credentials not available")
    service = build("gmail", "v1", credentials=creds)

    results = []
    for company in company_names:
        query = f"from:*@{company.lower().replace(' ', '')}.com OR to:*@{company.lower().replace(' ', '')}.com OR subject:{company}"
        try:
            resp = (
                service.users()
                .messages()
                .list(userId="me", q=query, maxResults=10)
                .execute()
            )
        except Exception:
            continue

        messages = resp.get("messages", [])
        emails = []
        for msg_meta in messages[:3]:
            try:
                msg = (
                    service.users()
                    .messages()
                    .get(
                        userId="me",
                        id=msg_meta["id"],
                        format="metadata",
                        metadataHeaders=["From", "Subject", "Date"],
                    )
                    .execute()
                )
            except Exception:
                continue

            headers = {
                h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])
            }
            from_addr = headers.get("From", "")
            direction = (
                "sent"
                if "byzantine" in from_addr.lower() or "gaia" in from_addr.lower()
                else "received"
            )
            date_raw = headers.get("Date", "")
            try:
                dt = datetime.strptime(
                    re.sub(r"\s*\(.*\)", "", date_raw).strip(),
                    "%a, %d %b %Y %H:%M:%S %z",
                )
                date_str = dt.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                date_str = ""

            emails.append(
                {
                    "date": date_str,
                    "subject": headers.get("Subject", ""),
                    "direction": direction,
                    "snippet": msg.get("snippet", "")[:200],
                }
            )

        if emails:
            results.append({"company": company, "emails": emails})

    return results


# ---------------------------------------------------------------------------
# Source 4 — Google Calendar (Google REST API)
# ---------------------------------------------------------------------------


def fetch_gcal() -> list:
    from googleapiclient.discovery import build

    creds = _get_google_creds()
    if not creds:
        raise RuntimeError("Google credentials not available")
    service = build("calendar", "v3", credentials=creds)

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=7)).isoformat()

    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            maxResults=50,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    meetings = []
    for event in events_result.get("items", []):
        start = event.get("start", {})
        dt_str = start.get("dateTime", start.get("date", ""))
        try:
            dt = datetime.fromisoformat(dt_str)
            date_str = dt.strftime("%Y-%m-%d")
            time_str = dt.strftime("%H:%M")
        except (ValueError, TypeError):
            date_str = dt_str[:10] if dt_str else ""
            time_str = ""

        attendees = []
        for a in event.get("attendees", []):
            name = a.get("displayName", a.get("email", ""))
            attendees.append(name)

        description = event.get("description", "") or ""
        title = event.get("summary", "")

        # Infer company from title
        company = ""
        if "<>" in title:
            parts = title.split("<>")
            company = parts[1].strip() if len(parts) > 1 else ""

        meetings.append(
            {
                "date": date_str,
                "time": time_str,
                "title": title,
                "attendees": attendees,
                "description": description,
                "company": company,
            }
        )
    return meetings


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def build_data(
    deals_raw: list,
    emails_raw: list,
    gcal_raw: list,
    transcripts_raw: list,
    sources_status: dict,
) -> dict:
    now = datetime.now(timezone.utc)

    # Index emails by company (fuzzy)
    email_index: dict[str, list] = {}
    for entry in emails_raw:
        email_index[entry["company"].lower()] = entry["emails"]

    all_activities: list[dict] = []
    deals = []

    for raw in deals_raw:
        company = raw.get("company", "Unknown")
        deal_domains = raw.get("domains", [])
        deal_id = slugify(company)
        stage = raw.get("stage", "Qualification")
        notes = raw.get("notes", "") or ""
        next_steps = raw.get("nextSteps", "") or ""
        contact = raw.get("contact") or None
        confidence = raw.get("confidence")
        attio_date = parse_date(raw.get("lastContactDate"))

        # Match emails (fuzzy by company name)
        matched_emails: list = []
        for key, em_list in email_index.items():
            if fuzzy_match(company, key) > 0.6:
                matched_emails = em_list
                break

        # Match transcripts by domain or fuzzy company name
        matched_transcripts: list = []
        for t in transcripts_raw:
            # Match by email domain
            t_domains = t.get("external_domains", [])
            if deal_domains and t_domains:
                # Check if any transcript domain matches any deal domain (root domain)
                for dd in deal_domains:
                    dd_root = ".".join(dd.split(".")[-2:])
                    for td in t_domains:
                        td_root = ".".join(td.split(".")[-2:])
                        if dd_root == td_root:
                            matched_transcripts.append(t)
                            break
                    if matched_transcripts and matched_transcripts[-1] is t:
                        break
                if matched_transcripts and matched_transcripts[-1] is t:
                    continue
            # Fallback: fuzzy match on company name in title
            t_company = t.get("company", "")
            if t_company and fuzzy_match(company, t_company) > 0.6:
                matched_transcripts.append(t)
                continue
            # Also try matching company name in transcript title
            t_title = t.get("title", "")
            if company.lower() in t_title.lower():
                matched_transcripts.append(t)

        # Match meetings by domain or fuzzy
        matched_meetings = [
            m for m in gcal_raw if fuzzy_match(company, m.get("company", "")) > 0.6
        ]

        # Enrich next_steps from latest transcript action items
        if not next_steps and matched_transcripts:
            latest_tr = max(matched_transcripts, key=lambda x: x.get("date", ""))
            ai = latest_tr.get("actionItems", [])
            if ai:
                next_steps = ai[0] if isinstance(ai[0], str) else str(ai[0])

        # Compute lastDays & lastContactType
        candidates: list[tuple[datetime, str]] = []
        if attio_date:
            candidates.append((attio_date, "attio"))
        for em in matched_emails:
            d = parse_date(em.get("date"))
            if d:
                t = "email_sent" if em.get("direction") == "sent" else "email_received"
                candidates.append((d, t))
        for mt in matched_meetings:
            d = parse_date(mt.get("date"))
            if d:
                candidates.append((d, "meeting"))
        for tr in matched_transcripts:
            d = parse_date(tr.get("date"))
            if d:
                candidates.append((d, "transcript"))

        if candidates:
            latest_dt, latest_type = max(candidates, key=lambda x: x[0])
            last_days = (now - latest_dt).days
            last_contact_date = latest_dt.strftime("%Y-%m-%d")
            last_contact_type = latest_type
        else:
            last_days = None
            last_contact_date = None
            last_contact_type = None

        # Priority
        priority = (
            "High"
            if stage in ("Proposal / Negotiation", "Testing")
            else "Med"
        )

        deals.append(
            {
                "id": deal_id,
                "company": company,
                "stage": stage,
                "lastDays": last_days,
                "lastContactDate": last_contact_date,
                "lastContactType": last_contact_type,
                "priority": priority,
                "notes": notes,
                "nextSteps": next_steps,
                "contact": contact,
                "confidence": confidence,
                "emails": matched_emails,
                "transcripts": matched_transcripts,
            }
        )

        # Build activities from this deal's data
        for em in matched_emails:
            t = "email_sent" if em.get("direction") == "sent" else "email_received"
            all_activities.append(
                {
                    "date": em.get("date", ""),
                    "type": t,
                    "company": company,
                    "summary": f"{'Sent' if t == 'email_sent' else 'Received'}: {em.get('subject', '')}",
                }
            )
        for mt in matched_meetings:
            all_activities.append(
                {
                    "date": mt.get("date", ""),
                    "type": "meeting",
                    "company": company,
                    "summary": mt.get("title", ""),
                }
            )
        for tr in matched_transcripts:
            all_activities.append(
                {
                    "date": tr.get("date", ""),
                    "type": "transcript",
                    "company": company,
                    "summary": tr.get("summary", "")[:200],
                }
            )

    # Sort activities by date desc, keep 15
    all_activities.sort(key=lambda x: x.get("date", ""), reverse=True)
    activity_feed = all_activities[:15]

    # Meetings with prepNeeded
    meetings_out = []
    for m in gcal_raw:
        meetings_out.append(
            {
                "date": m["date"],
                "time": m.get("time", ""),
                "title": m.get("title", ""),
                "company": m.get("company", ""),
                "attendees": m.get("attendees", []),
                "prepNeeded": not (m.get("description") or "").strip(),
            }
        )

    return {
        "sync_time": now.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "sources": sources_status,
        "deals": deals,
        "meetings": meetings_out,
        "activity_feed": activity_feed,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    sources_status = {}
    results = {}

    # Phase 1 — Attio + Fireflies + GCal in parallel (Gmail needs company names from Attio)
    def run_attio():
        return "attio", fetch_attio()

    def run_fireflies():
        return "fireflies", fetch_fireflies()

    def run_gcal():
        return "gcal", fetch_gcal()

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fn): fn.__name__ for fn in [run_attio, run_fireflies, run_gcal]}
        for future in as_completed(futures):
            try:
                key, data = future.result()
                results[key] = data
                sources_status[key] = {"status": "ok", "count": len(data)}
                print(f"[OK] {key}: {len(data)} records")
            except Exception as exc:
                # Identify which source by function name
                fn_name = futures[future]
                key = fn_name.replace("run_", "")
                sources_status[key] = {"status": "error", "error": str(exc)[:200]}
                results[key] = []
                print(f"[ERROR] {key}: {exc}")

    # Abort if Attio failed
    if sources_status.get("attio", {}).get("status") != "ok":
        print("FATAL: Attio fetch failed — aborting.")
        sys.exit(1)

    # Phase 2 — Gmail (needs company names)
    company_names = [d.get("company", "") for d in results.get("attio", []) if d.get("company")]
    try:
        gmail_data = fetch_gmail(company_names)
        results["gmail"] = gmail_data
        sources_status["gmail"] = {"status": "ok", "count": len(gmail_data)}
        print(f"[OK] gmail: {len(gmail_data)} companies with emails")
    except Exception as exc:
        results["gmail"] = []
        sources_status["gmail"] = {"status": "error", "error": str(exc)[:200]}
        print(f"[ERROR] gmail: {exc}")

    # Assemble
    data = build_data(
        deals_raw=results.get("attio", []),
        emails_raw=results.get("gmail", []),
        gcal_raw=results.get("gcal", []),
        transcripts_raw=results.get("fireflies", []),
        sources_status=sources_status,
    )

    DATA_JSON.parent.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"Wrote {DATA_JSON} ({len(data['deals'])} deals, {len(data['meetings'])} meetings)")


if __name__ == "__main__":
    main()
