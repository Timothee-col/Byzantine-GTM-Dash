#!/usr/bin/env python3
"""Byzantine Dashboard — daily sync script.

Fetches data from 4 sources (Attio, Fireflies, Gmail, Google Calendar),
assembles public/data.json for the static war-room dashboard.
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

import anthropic
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DATA_JSON = Path(__file__).resolve().parent.parent / "public" / "data.json"


def slugify(name: str) -> str:
    """Lowercase, strip accents, spaces → hyphens."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\w\s-]", "", ascii_only).strip().lower()
    return re.sub(r"[\s_]+", "-", slug)


def extract_json_from_response(response) -> list:
    """Extract the largest valid JSON array from a Claude MCP response."""
    full_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            full_text += block.text
    matches = re.findall(r"\[[\s\S]*?\]", full_text)
    for candidate in sorted(matches, key=len, reverse=True):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return []


def fuzzy_match(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def parse_date(d: str | None) -> datetime | None:
    if not d:
        return None
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Source 1 — Attio (via Anthropic MCP)
# ---------------------------------------------------------------------------

ATTIO_PROMPT = """Use the Attio MCP tools to fetch all deal data. Steps:
1. Call list-lists to find the list containing "pipeline" or "gaia" in the name
2. Call list-records-in-list with that list's slug, limit 500
3. For each entry extract: company name, deal stage, last interaction date, notes, next steps, champion contact name

Return ONLY a JSON array, no markdown, no explanation:
[{
  "company": "...",
  "stage": "...",
  "lastContactDate": "YYYY-MM-DD" or null,
  "notes": "...",
  "nextSteps": "...",
  "contact": "..." or null
}]

Map stages to exactly these values: Qualification, Contacted, Meeting, Proposal / Negotiation, Testing."""


def fetch_attio() -> list:
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8000,
        messages=[{"role": "user", "content": ATTIO_PROMPT}],
        mcp_servers=[
            {"type": "url", "url": "https://mcp.attio.com/mcp", "name": "attio"}
        ],
    )
    return extract_json_from_response(response)


# ---------------------------------------------------------------------------
# Source 2 — Fireflies (via Anthropic MCP)
# ---------------------------------------------------------------------------

FIREFLIES_PROMPT = """Use the Fireflies MCP tools to fetch all transcripts from the last 30 days.

Return ONLY a JSON array, no markdown, no explanation:
[{
  "date": "YYYY-MM-DD",
  "title": "...",
  "participants": ["..."],
  "summary": "..." (max 200 chars),
  "actionItems": ["...", "..."],
  "company": "..." (infer from title/participants, or "" if unclear)
}]"""


def fetch_fireflies() -> list:
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        messages=[{"role": "user", "content": FIREFLIES_PROMPT}],
        mcp_servers=[
            {
                "type": "url",
                "url": "https://api.fireflies.ai/mcp",
                "name": "fireflies",
            }
        ],
    )
    return extract_json_from_response(response)


# ---------------------------------------------------------------------------
# Google Auth helper
# ---------------------------------------------------------------------------

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]


def _get_google_creds():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = None
    token_json = os.environ.get("GOOGLE_TOKEN_JSON")
    if token_json:
        token_data = json.loads(base64.b64decode(token_json))
        creds = Credentials.from_authorized_user_info(token_data, SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


# ---------------------------------------------------------------------------
# Source 3 — Gmail (Google API)
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
# Source 4 — Google Calendar (Google API)
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
    today = now.strftime("%Y-%m-%d")

    # Index emails by company (fuzzy)
    email_index: dict[str, list] = {}
    for entry in emails_raw:
        email_index[entry["company"].lower()] = entry["emails"]

    # Index transcripts by company (fuzzy)
    transcript_index: dict[str, list] = {}
    for t in transcripts_raw:
        co = (t.get("company") or "").lower()
        if co:
            transcript_index.setdefault(co, []).append(t)

    all_activities: list[dict] = []
    deals = []

    for raw in deals_raw:
        company = raw.get("company", "Unknown")
        deal_id = slugify(company)
        stage = raw.get("stage", "Qualification")
        notes = raw.get("notes", "") or ""
        next_steps = raw.get("nextSteps", "") or ""
        contact = raw.get("contact") or None
        attio_date = parse_date(raw.get("lastContactDate"))

        # Match emails
        matched_emails: list = []
        for key, em_list in email_index.items():
            if fuzzy_match(company, key) > 0.6:
                matched_emails = em_list
                break

        # Match transcripts
        matched_transcripts: list = []
        for key, tr_list in transcript_index.items():
            if fuzzy_match(company, key) > 0.6:
                matched_transcripts = tr_list
                break

        # Match meetings
        matched_meetings = [
            m for m in gcal_raw if fuzzy_match(company, m.get("company", "")) > 0.6
        ]

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
                "confidence": None,
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
        futures = [pool.submit(fn) for fn in [run_attio, run_fireflies, run_gcal]]
        for future in as_completed(futures):
            try:
                key, data = future.result()
                results[key] = data
                sources_status[key] = {"status": "ok", "count": len(data)}
                print(f"[OK] {key}: {len(data)} records")
            except Exception as exc:
                # Identify which source failed
                err_str = str(exc)
                for k in ("attio", "fireflies", "gcal"):
                    if k not in results and k not in sources_status:
                        sources_status[k] = {"status": "error", "error": err_str[:200]}
                        results[k] = []
                        print(f"[ERROR] {k}: {exc}")
                        break

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
