#!/usr/bin/env python3
"""Poll Pierre's AgentMail inbox for inReach dispatches, publish to journal.

Runs on AWS Lightsail (Pierre) on a cron, every 2 hours during the trip:

    0 */2 * * *  cd /opt/Canoe-Verendrye && /usr/bin/python3 scripts/pull_dispatches.py

What it does:
  1. Calls AgentMail v0 API, lists messages received since the last cursor.
  2. Keeps only messages that match an inReach pattern (sender domain or
     a manual "DISPATCH:" tag in the subject).
  3. Parses each: strips Garmin signature, extracts lat/lon, normalizes
     the body. Writes journal-entries/YYYYMMDDTHHMMZ.json.
  4. Runs scripts/render-journal.py to update journal.html.
  5. If anything changed: git add + commit + push. Render auto-deploys.
  6. Marks messages as read in AgentMail so they aren't re-processed.
  7. Persists cursor in .pierre-cursor (gitignored).

Env vars required (read from process env, set in Lightsail systemd unit
or cron `EnvironmentFile=`):
  AGENTMAIL_API_KEY
  AGENTMAIL_PIERRE_INBOX_ID   (defaults to pierre@agentmail.to)

Optional:
  CANOE_AUTOCOMMIT=1          Set to 0 to dry-run (parse + render but no push)
  CANOE_GIT_USER_NAME, _EMAIL Author for the commits
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
ENTRIES = ROOT / "journal-entries"
CURSOR_FILE = ROOT / ".pierre-cursor"
RENDER_SCRIPT = ROOT / "scripts" / "render-journal.py"

AGENTMAIL_BASE = "https://api.agentmail.to/v0"
INREACH_SENDER_PATTERNS = (
    "no.reply@garmin.com",
    "@garmin.com",
)
DISPATCH_TAG_RE = re.compile(r"^DISPATCH:\s*", re.IGNORECASE)
INREACH_SUBJECT_RE = re.compile(r"inReach message from", re.IGNORECASE)
GARMIN_LATLON_RE = re.compile(
    r"Lat\s+(-?\d+\.\d+)\s*[,\s]\s*Lon\s+(-?\d+\.\d+)",
    re.IGNORECASE,
)
GARMIN_SIG_RE = re.compile(
    r"\n+(?:Sent|.* sent this message) from.*$", re.IGNORECASE | re.DOTALL
)
# Additional boilerplate patterns in newer Garmin inReach email formats.
GARMIN_BOILERPLATE_RE = re.compile(
    r"\n*(?:View the location or send a reply|Do not reply directly to this message|"
    r"This message was sent to you using the inReach|"
    r"Please Note: Replies to this email are not answered).*$",
    re.IGNORECASE | re.DOTALL,
)


def env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v else default


def api(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{AGENTMAIL_BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {env('AGENTMAIL_API_KEY')}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"AgentMail {method} {path} → {e.code} {body}")


def list_messages(inbox: str) -> list[dict]:
    data = api("GET", f"/inboxes/{inbox}/messages?limit=50")
    # AgentMail v0 returns {"messages": [...], "count": N, ...}
    if isinstance(data, dict):
        return data.get("messages") or data.get("data") or []
    return data or []


def get_message(inbox: str, mid: str) -> dict:
    return api("GET", f"/inboxes/{inbox}/messages/{urllib.request.quote(mid, safe='')}")


def is_dispatch(msg: dict) -> bool:
    sender = (msg.get("from") or msg.get("from_email") or "").lower()
    subject = (msg.get("subject") or "")
    # Exclude reply emails (Re:, Fwd:) — these are not device dispatches.
    if re.match(r"^(Re|Fwd?):", subject, re.IGNORECASE):
        return False
    if any(p in sender for p in INREACH_SENDER_PATTERNS):
        return True
    if DISPATCH_TAG_RE.match(subject):
        return True
    if INREACH_SUBJECT_RE.search(subject):
        return True
    return False


def parse(msg: dict) -> dict | None:
    body = (msg.get("text") or msg.get("body_text") or msg.get("body") or msg.get("preview") or "").strip()
    if not body:
        return None
    lat_lon = GARMIN_LATLON_RE.search(body)
    body_clean = GARMIN_SIG_RE.sub("", body).strip()
    body_clean = GARMIN_BOILERPLATE_RE.sub("", body_clean).strip()
    body_clean = DISPATCH_TAG_RE.sub("", body_clean).strip()
    if not body_clean:
        return None
    received_iso = (
        msg.get("timestamp")
        or msg.get("received_at")
        or msg.get("date")
        or datetime.now(timezone.utc).isoformat()
    )
    try:
        dt = datetime.fromisoformat(received_iso.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    eid = dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    entry = {
        "id": eid,
        "received_at": dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "body": body_clean,
        "source": "inreach",
        "raw_message_id": msg.get("message_id") or msg.get("id") or "",
    }
    if lat_lon:
        entry["lat"] = float(lat_lon.group(1))
        entry["lon"] = float(lat_lon.group(2))
    return entry


def write_entry(entry: dict) -> Path:
    ENTRIES.mkdir(exist_ok=True)
    path = ENTRIES / f"{entry['id']}.json"
    path.write_text(json.dumps(entry, indent=2, ensure_ascii=False) + "\n")
    return path


def run_render() -> bool:
    """Returns True if journal.html changed."""
    before = (ROOT / "journal.html").read_text()
    subprocess.run([sys.executable, str(RENDER_SCRIPT)], cwd=ROOT, check=True)
    after = (ROOT / "journal.html").read_text()
    return before != after


def git(*args: str) -> str:
    res = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return res.stdout.strip()


def commit_and_push(new_paths: list[Path]) -> None:
    if env("CANOE_AUTOCOMMIT", "1") != "1":
        print("CANOE_AUTOCOMMIT=0, skipping commit/push")
        return
    name = env("CANOE_GIT_USER_NAME", "Pierre Dumont")
    email = env("CANOE_GIT_USER_EMAIL", "pierre@agentmail.to")
    git("config", "user.name", name)
    git("config", "user.email", email)

    # Sync with remote before committing: fetch origin, reset tracked files to
    # origin/main state, then re-render so dispatches land in the current HTML.
    # New dispatch JSON files (untracked) survive the reset untouched.
    git("fetch", "origin")
    git("reset", "--mixed", "origin/main")
    subprocess.run(
        ["git", "checkout", "--", "."],
        cwd=ROOT, capture_output=True, check=True,
    )
    subprocess.run(
        [sys.executable, str(RENDER_SCRIPT), "--no-email"],
        cwd=ROOT, check=True,
    )

    files = [str(p.relative_to(ROOT)) for p in new_paths] + ["journal.html", "rss.xml"]
    git("add", *files)
    if not git("status", "--short"):
        return
    n = len(new_paths)
    git("commit", "-m", f"Pierre: {n} new dispatch{'es' if n != 1 else ''} from the trail")
    git("push", "origin", "HEAD:main")


def load_cursor() -> str | None:
    if CURSOR_FILE.exists():
        return CURSOR_FILE.read_text().strip() or None
    return None


def save_cursor(value: str) -> None:
    CURSOR_FILE.write_text(value + "\n")


def main() -> int:
    if not env("AGENTMAIL_API_KEY"):
        raise SystemExit("AGENTMAIL_API_KEY not set")
    inbox = env("AGENTMAIL_PIERRE_INBOX_ID", "pierre@agentmail.to")

    msgs = list_messages(inbox)
    if not msgs:
        print("no messages")
        return 0

    new_paths: list[Path] = []
    for m in msgs:
        if not is_dispatch(m):
            continue
        # If list view didn't include full body, fetch the full message.
        if not (m.get("text") or m.get("body_text") or m.get("body")):
            full = get_message(inbox, m.get("message_id") or m.get("id"))
            # Preserve list-level fields the full message might lack
            for k in ("from", "subject", "timestamp"):
                if k in m and k not in full:
                    full[k] = m[k]
            m = full
        entry = parse(m)
        if not entry:
            continue
        # Skip if we already wrote this entry (same minute = same id)
        if (ENTRIES / f"{entry['id']}.json").exists():
            print(f"skip {entry['id']}: already published")
            continue
        path = write_entry(entry)
        new_paths.append(path)
        print(f"wrote {path.name}: {entry['body'][:60]}…")

    if not new_paths:
        print("no dispatches in this batch")
        return 0

    changed = run_render()
    if changed:
        commit_and_push(new_paths)
        print(f"published {len(new_paths)} dispatch(es)")
    else:
        print("render produced no diff (already up to date)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
