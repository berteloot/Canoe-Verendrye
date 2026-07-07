# scripts/

Three scripts. The renderer is safe to run anywhere; the other two are
Lightsail-side operations.

## `render-journal.py`

Reads every JSON file in `journal-entries/`, regenerates the
`Live from the trail` block in `journal.html` between the
`<!-- LIVE_DISPATCHES:START -->` / `:END -->` markers. Idempotent.

```bash
python3 scripts/render-journal.py        # apply
python3 scripts/render-journal.py --check # exit 1 if it would change
```

No env vars. Useful as a local sanity check after editing a JSON file
by hand.

## `pull_dispatches.py`

Pierre's polling loop. Pulls new messages from `pierre@agentmail.to`,
filters to inReach dispatches, writes a JSON entry per message, runs
the renderer, then `git commit && git push`. Render auto-deploys.

Designed to run on **AWS Lightsail** under cron, every 2 hours during the trip:

```cron
0 */2 * * *  cd /opt/Canoe-Verendrye && /usr/bin/python3 scripts/pull_dispatches.py >> /var/log/canoe-pierre.log 2>&1
```

Polling more often does not cost anything: AgentMail's inbound is free,
and the Lightsail box is a flat monthly bill. The cost is on the inReach
side and depends on how many messages you *send*, not on how often Pierre
polls. Every 2 hours is plenty for a trail journal.

### Env vars

| Name | Required | Notes |
|------|----------|-------|
| `AGENTMAIL_API_KEY` | yes | Pierre's existing key, already in NYTRO_AI/.env |
| `AGENTMAIL_PIERRE_INBOX_ID` | no | Defaults to `pierre@agentmail.to` |
| `CANOE_AUTOCOMMIT` | no | Set to `0` for dry-run (no git push) |
| `CANOE_GIT_USER_NAME` / `_EMAIL` | no | Author for the commits |

### Detection rules

A message is treated as a dispatch if **either**:
- The sender contains `@garmin.com` or `no.reply@garmin.com`, **or**
- The subject starts with `DISPATCH:` (manual override, useful for tests)

### Garmin parsing

The script strips Garmin's standard signature
(`<name> sent this message from: Lat ... Lon ...` and the share URL)
and extracts the lat/lon into the JSON entry. Body keeps just the prose.

### Test flow (no inReach needed)

1. Send an email to `pierre@agentmail.to` from any client with subject
   `DISPATCH: day 1` and a one-line body.
2. Run `python3 scripts/pull_dispatches.py` locally.
3. Verify a JSON file appears in `journal-entries/` and `journal.html`
   was updated. Don't push — set `CANOE_AUTOCOMMIT=0` for the local test.

## `canoe_watchdog.py`

Runs on **Lightsail** every 30 minutes (cron). Keeps the journal pipeline
healthy:

- Syncs `GITHUB_CANOE_TOKEN` from `/home/ec2-user/pierre/.env` (canonical)
  into `/home/ec2-user/n8n/.env` and recreates the n8n container on change.
- Probes GitHub write access so an expired PAT is caught before the hourly
  n8n workflow fails at Create Tree.
- Alerts via Telegram if the dispatch workflow is stale, errored, or n8n is
  unreachable.

```cron
20,50 * * * * cd /home/ec2-user/pierre && /usr/bin/python3 clients/Canoe/scripts/canoe_watchdog.py >> logs/canoe_watchdog.log 2>&1
```

When rotating the GitHub PAT, update `GITHUB_CANOE_TOKEN` in NYTRO `.env`
and `/home/ec2-user/pierre/.env` only. Requires `N8N_API_KEY`,
`TELEGRAM_BOT_TOKEN`, and `GITHUB_CANOE_TOKEN` in pierre `.env`.
