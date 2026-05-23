#!/usr/bin/env python3
"""Regenerate the 'Live from the trail' block in journal.html.

Reads every JSON file in journal-entries/, sorts by received_at descending,
and rewrites the HTML between the two markers in journal.html.

Idempotent: running twice in a row with no new entries produces no diff.

Usage:
    python3 scripts/render-journal.py [--check]

--check exits non-zero if the file would change (useful as a CI guard).
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOURNAL_HTML = ROOT / "journal.html"
RSS_PATH = ROOT / "rss.xml"
ENTRIES_DIR = ROOT / "journal-entries"
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
            f"    <title>{body[:60]}{loc}</title>\n"
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if journal.html would change",
    )
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
        return 0
    if args.check:
        print("would change", file=sys.stderr)
        return 1
    if html_changed:
        JOURNAL_HTML.write_text(new)
    if rss_changed:
        RSS_PATH.write_text(rss_new)
    print(f"updated ({len(entries)} entries, html={'yes' if html_changed else 'no'}, rss={'yes' if rss_changed else 'no'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
