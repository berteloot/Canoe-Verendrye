#!/usr/bin/env python3
"""Canoe dispatch watchdog — catches silence and GitHub auth drift.

Runs on the Lightsail box (same host as n8n). Every 30 minutes it:

1. Syncs GITHUB_CANOE_TOKEN from pierre/.env (canonical) into n8n/.env and
   recreates the n8n container when the token changes.
2. Probes GitHub write access (POST /git/trees) so an expired PAT is caught
   before the hourly journal workflow hits Create Tree.
3. Checks the n8n dispatch workflow for stale or failed executions.

Alert throttle: one Telegram per distinct problem, re-sent at most every 6 h.
Sends a recovery message when healthy again.

Cron (Lightsail, ET box):
  20,50 * * * * cd /home/ec2-user/pierre && /usr/bin/python3 clients/Canoe/scripts/canoe_watchdog.py >> logs/canoe_watchdog.log 2>&1

Reads N8N_API_KEY, TELEGRAM_BOT_TOKEN, GITHUB_CANOE_TOKEN from
/home/ec2-user/pierre/.env. Runs until 2026-07-20, then exits silently.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

PIERRE_ENV = "/home/ec2-user/pierre/.env"
N8N_ENV = "/home/ec2-user/n8n/.env"
N8N_DIR = "/home/ec2-user/n8n"
STATE = pathlib.Path("/home/ec2-user/pierre/data/canoe_watchdog_state.json")
WID = "ca000001-0000-0000-0000-000000000001"
REPO = "berteloot/Canoe-Verendrye"
CHAT_ID = "1576920275"
MAX_AGE_S = 75 * 60
REALERT_S = 6 * 3600
EXPIRES = datetime(2026, 7, 20, tzinfo=timezone.utc)


def load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env.setdefault(key, value.strip().strip('"').strip("'"))
    return env


def save_env(path: str, env: dict[str, str]) -> None:
    lines: list[str] = []
    seen: set[str] = set()
    if pathlib.Path(path).exists():
        with open(path) as fh:
            for line in fh:
                raw = line.rstrip("\n")
                if raw and not raw.startswith("#") and "=" in raw:
                    key = raw.split("=", 1)[0]
                    if key in env:
                        lines.append(f"{key}={env[key]}")
                        seen.add(key)
                    else:
                        lines.append(raw)
                else:
                    lines.append(raw)
    for key, value in env.items():
        if key not in seen:
            lines.append(f"{key}={value}")
    pathlib.Path(path).write_text("\n".join(lines) + "\n")


def telegram(token: str, text: str) -> None:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps({"chat_id": CHAT_ID, "text": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=20)


def github_request(token: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict | str]:
    url = f"https://api.github.com{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload: dict | str = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw
        return exc.code, payload


def probe_github_write(token: str) -> str | None:
    status, ref = github_request(token, "GET", f"/repos/{REPO}/git/refs/heads/main")
    if status != 200:
        msg = ref.get("message", ref) if isinstance(ref, dict) else ref
        return f"GitHub read failed ({status}): {msg}"

    commit_sha = ref["object"]["sha"]
    status, commit = github_request(token, "GET", f"/repos/{REPO}/git/commits/{commit_sha}")
    if status != 200:
        msg = commit.get("message", commit) if isinstance(commit, dict) else commit
        return f"GitHub commit fetch failed ({status}): {msg}"

    base_tree = commit["tree"]["sha"]
    status, tree = github_request(
        token,
        "POST",
        f"/repos/{REPO}/git/trees",
        {
            "base_tree": base_tree,
            "tree": [
                {
                    "path": ".canoe-watchdog-probe",
                    "mode": "100644",
                    "type": "blob",
                    "content": "probe\n",
                }
            ],
        },
    )
    if status == 201:
        return None
    msg = tree.get("message", tree) if isinstance(tree, dict) else tree
    return f"GitHub write probe failed ({status}): {msg}"


def sync_github_token(canonical: str) -> bool:
    """Copy token into n8n/.env. Return True if n8n was restarted."""
    n8n_env = load_env(N8N_ENV)
    if n8n_env.get("GITHUB_CANOE_TOKEN") == canonical:
        return False
    n8n_env["GITHUB_CANOE_TOKEN"] = canonical
    save_env(N8N_ENV, n8n_env)
    subprocess.run(
        ["sudo", "docker", "compose", "up", "-d"],
        cwd=N8N_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return True


def check_n8n_executions(n8n_key: str) -> str | None:
    req = urllib.request.Request(
        f"https://n8n.altilead.com/api/v1/executions?workflowId={WID}&limit=1",
        headers={"X-N8N-API-KEY": n8n_key},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read())
    execs = data.get("data") or []
    if not execs:
        return "no executions found for the dispatch workflow"
    execution = execs[0]
    started = datetime.fromisoformat(execution["startedAt"].replace("Z", "+00:00"))
    age = (datetime.now(timezone.utc) - started).total_seconds()
    if age > MAX_AGE_S:
        return f"last run was {int(age / 60)} min ago — hourly schedule looks dead"
    if execution.get("status") == "error":
        return "last run errored (see the error-alert Telegram for detail)"
    return None


def main() -> int:
    if datetime.now(timezone.utc) > EXPIRES:
        print("past expiry (2026-07-20), doing nothing; remove the cron line")
        return 0

    env = load_env(PIERRE_ENV)
    n8n_key = env.get("N8N_API_KEY")
    tg = env.get("TELEGRAM_BOT_TOKEN")
    github_token = env.get("GITHUB_CANOE_TOKEN")
    if not n8n_key or not tg:
        print("missing N8N_API_KEY or TELEGRAM_BOT_TOKEN in pierre .env", file=sys.stderr)
        return 1

    problems: list[str] = []

    if not github_token:
        problems.append(
            "GITHUB_CANOE_TOKEN missing from /home/ec2-user/pierre/.env — "
            "add the Canoe PAT there (canonical source for n8n)"
        )
    else:
        try:
            if sync_github_token(github_token):
                print("synced GITHUB_CANOE_TOKEN to n8n/.env and recreated container")
            write_problem = probe_github_write(github_token)
            if write_problem:
                problems.append(
                    f"{write_problem} — rotate the fine-grained PAT (Contents: Read and write "
                    f"on {REPO}) and update GITHUB_CANOE_TOKEN in pierre .env"
                )
        except subprocess.CalledProcessError as exc:
            problems.append(f"n8n container restart failed after token sync: {exc.stderr or exc}")

    try:
        execution_problem = check_n8n_executions(n8n_key)
        if execution_problem:
            problems.append(execution_problem)
    except Exception as exc:
        problems.append(f"n8n API unreachable: {type(exc).__name__}: {exc}")

    problem = "; ".join(problems) if problems else None

    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    now = time.time()
    if problem:
        changed = state.get("problem") != problem
        stale = now - state.get("last_alert", 0) > REALERT_S
        if changed or stale:
            telegram(tg, f"\U0001f6f6\u26a0\ufe0f Canoe dispatch watchdog: {problem}")
            state = {"problem": problem, "last_alert": now}
    else:
        if state.get("problem"):
            telegram(tg, "\U0001f6f6\u2705 Canoe dispatch watchdog: recovered, token + schedule healthy")
        state = {}

    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(state))
    print(problem or "healthy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
