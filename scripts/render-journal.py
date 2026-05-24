#!/usr/bin/env python3
"""Regenerate the 'Live from the trail' block in journal.html and rss.xml,
then email new dispatches to confirmed subscribers via Resend.

Reads every JSON file in journal-entries/, sorts by received_at descending,
rewrites the HTML between the two markers in journal.html, and regenerates rss.xml.

Subscriber management:
  subscribers.json  — list of confirmed email addresses (gitignored, local only)
  sent_dispatches.json — GUIDs already emailed (gitignored, local only)

Both files live at the repo root and are never committed.

Usage:
    python3 scripts/render-journal.py [--check] [--no-email]

--check       exits non-zero if the file would change (useful as a CI guard)
--no-email    skip email dispatch (still regenerates HTML + RSS)
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOURNAL_HTML = ROOT / "journal.html"
RSS_PATH = ROOT / "rss.xml"
ENTRIES_DIR = ROOT / "journal-entries"
SUBSCRIBERS_PATH = ROOT / "subscribers.json"
SENT_PATH = ROOT / "sent_dispatches.json"
SITE_URL = "https://canoe-verendrye.berteloot.org"

START_MARKER = "<!-- LIVE_DISPATCHES:START -->"
END_MARKER = "<!-- LIVE_DISPATCHES:END -->"


def load_entries() -> list[dict]:
    entries = []
    for p in sorted(ENTRIES_DIR.glob("*.json")):
        try:
            entries.append(json.loads(p.read_text()))
        except Exception as e:
            print(f"skip {p.name}: {e}", file=sys.stderr)
    entries.sort(key=lambda e: e.get("received_at", ""), reverse=True)
    return entries


def format_date(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).strftime("%b %d, %Y · %H:%M UTC")
    except Exception:
        return iso


def render(entries: list[dict]) -> str:
    if not entries:
        return (
            '\n      <p class="dispatches__empty">'
            "No dispatches yet. The trip starts June 17, 2026."
            "</p>\n    "
        )
    parts = ['\n      <ol class="dispatches">']
    for e in entries:
        body = html.escape(e.get("body", ""))
        date = format_date(e.get("received_at", ""))
        loc_html = ""
        lat, lon = e.get("lat"), e.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            href = f"https://www.google.com/maps/?q={lat},{lon}"
            loc_html = (
                f'        <a class="dispatch__loc" href="{href}" '
                f'target="_blank" rel="noopener">'
                f"📍 {lat:.4f}, {lon:.4f}</a>\n"
            )
        parts.append(
            "      <li class=\"dispatch\">\n"
            f'        <time class="dispatch__date" datetime="{html.escape(e.get("received_at",""))}">{date}</time>\n'
            f'        <p class="dispatch__body">{body}</p>\n'
            f"{loc_html}"
            "      </li>"
        )
    parts.append("      </ol>\n    ")
    return "\n".join(parts)


def splice(html_text: str, new_block: str) -> str:
    pattern = re.compile(
        re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER),
        re.DOTALL,
    )
    if not pattern.search(html_text):
        raise SystemExit(
            f"markers {START_MARKER} / {END_MARKER} not found in {JOURNAL_HTML}"
        )
    return pattern.sub(START_MARKER + new_block + END_MARKER, html_text)


def render_rss(entries: list[dict]) -> str:
    items = ""
    for e in entries:
        body = html.escape(e.get("body", ""))
        received = e.get("received_at", "")
        lat, lon = e.get("lat"), e.get("lon")
        loc = f" · 📍 {lat:.4f}, {lon:.4f}" if isinstance(lat, (int, float)) else ""
        try:
            dt = datetime.fromisoformat(received.replace("Z", "+00:00"))
            pub_date = dt.strftime("%a, %d %b %Y %H:%M:%S +0000")
            slug = dt.strftime("%Y%m%dT%H%MZ")
        except Exception:
            pub_date = ""
            slug = received
        items += (
            f"  <item>\n"
            f"    <title>{body}{loc}</title>\n"
            f"    <link>{SITE_URL}/journal.html</link>\n"
            f"    <guid isPermaLink=\"false\">{SITE_URL}/dispatches/{slug}</guid>\n"
            f"    <pubDate>{pub_date}</pubDate>\n"
            f"    <description>{body}{html.escape(loc)}</description>\n"
            f"  </item>\n"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "<channel>\n"
        "  <title>The Red Canoe · Live Dispatches</title>\n"
        f"  <link>{SITE_URL}/journal.html</link>\n"
        f"  <atom:link href=\"{SITE_URL}/rss.xml\" rel=\"self\" type=\"application/rss+xml\"/>\n"
        "  <description>Satellite messages from Violette, Stan and Charlie — La Vérendrye canoe expedition, June 2026.</description>\n"
        "  <language>en</language>\n"
        f"{items}"
        "</channel>\n"
        "</rss>\n"
    )


def _load_env_key() -> str:
    """Walk up from repo root to find .env with RESEND-ALL_API key."""
    search = [ROOT, ROOT.parent, ROOT.parent.parent]
    for d in search:
        env_path = d / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("RESEND-ALL_API="):
                    return line.split("=", 1)[1].strip()
    return ""


def send_dispatch_emails(entries: list[dict]) -> int:
    """Send emails for any dispatches not yet emailed. Returns count sent."""
    api_key = (
        os.environ.get("RESEND_API_KEY")
        or os.environ.get("RESEND-ALL_API")
        or _load_env_key()
    )
    if not api_key:
        print("  no RESEND key found, skipping email dispatch", file=sys.stderr)
        return 0

    if not SUBSCRIBERS_PATH.exists():
        print("  no subscribers.json, skipping email dispatch")
        return 0
    subscribers = json.loads(SUBSCRIBERS_PATH.read_text())
    if not subscribers:
        return 0

    sent_ids: set[str] = set()
    if SENT_PATH.exists():
        sent_ids = set(json.loads(SENT_PATH.read_text()))

    emailed = 0
    new_sent: list[str] = []

    for entry in reversed(entries):  # oldest first so inbox order is chronological
        received = entry.get("received_at", "")
        try:
            dt = datetime.fromisoformat(received.replace("Z", "+00:00"))
            slug = dt.strftime("%Y%m%dT%H%MZ")
            date_str = format_date(received)
        except Exception:
            slug = received
            date_str = received

        guid = f"{SITE_URL}/dispatches/{slug}"
        if guid in sent_ids:
            continue

        body_raw = entry.get("body", "")
        lat, lon = entry.get("lat"), entry.get("lon")
        has_loc = isinstance(lat, (int, float)) and isinstance(lon, (int, float))
        maps_url = f"https://www.google.com/maps/?q={lat},{lon}" if has_loc else ""
        loc_html = (
            f'<p style="margin:12px 0 0;font-size:14px;">'
            f'<a href="{maps_url}" style="color:#C8392E;">📍 {lat:.4f}, {lon:.4f}</a></p>'
        ) if has_loc else ""

        email_html = f"""<!doctype html>
<html><body style="font-family:Georgia,serif;max-width:560px;margin:32px auto;padding:0 20px;color:#222;">
  <p style="font-size:12px;color:#888;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;">
    The Red Canoe &middot; Live Dispatch</p>
  <p style="font-size:12px;color:#888;margin:0 0 16px;">{date_str}</p>
  <p style="font-size:18px;line-height:1.65;margin:0;">{html.escape(body_raw)}</p>
  {loc_html}
  <hr style="margin:28px 0;border:none;border-top:1px solid #e8e0d4;">
  <p style="font-size:12px;color:#aaa;">
    <a href="{SITE_URL}/journal.html" style="color:#aaa;">All dispatches</a> &nbsp;&middot;&nbsp;
    <a href="{SITE_URL}/tracking.html" style="color:#aaa;">Live map</a>
  </p>
</body></html>"""

        subject = body_raw if len(body_raw) <= 80 else body_raw[:77] + "..."

        payload = json.dumps({
            "from": "The Red Canoe <noreply@berteloot.org>",
            "to": subscribers,
            "subject": subject,
            "html": email_html,
        }).encode()

        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "python-resend/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read())
            print(f"  ✉  dispatched '{body_raw[:50]}' → {len(subscribers)} subscriber(s) (id: {result.get('id','')})")
            emailed += 1
            new_sent.append(guid)
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"  ✗ Resend error {e.code}: {err}", file=sys.stderr)
        except Exception as e:
            print(f"  ✗ email error: {e}", file=sys.stderr)

    if new_sent:
        sent_ids.update(new_sent)
        SENT_PATH.write_text(json.dumps(sorted(sent_ids), indent=2))

    return emailed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if journal.html would change")
    ap.add_argument("--no-email", action="store_true",
                    help="skip Resend email dispatch")
    args = ap.parse_args()

    entries = load_entries()
    old = JOURNAL_HTML.read_text()
    new = splice(old, render(entries))
    rss_new = render_rss(entries)
    rss_old = RSS_PATH.read_text() if RSS_PATH.exists() else ""

    html_changed = new != old
    rss_changed = rss_new != rss_old

    if not html_changed and not rss_changed:
        print(f"no change ({len(entries)} entries)")
        if not args.no_email:
            send_dispatch_emails(entries)
        return 0

    if args.check:
        print("would change", file=sys.stderr)
        return 1

    if html_changed:
        JOURNAL_HTML.write_text(new)
    if rss_changed:
        RSS_PATH.write_text(rss_new)

    print(f"updated ({len(entries)} entries, html={'yes' if html_changed else 'no'}, rss={'yes' if rss_changed else 'no'})")

    if not args.no_email:
        send_dispatch_emails(entries)

    return 0


if __name__ == "__main__":
    sys.exit(main())
