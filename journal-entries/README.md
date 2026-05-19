# Live dispatches

One JSON file per inReach message received during the trip. Pierre (on
AWS Lightsail) polls AgentMail, detects Garmin-pattern emails, writes a
file here, runs `scripts/render-journal.py` to update `journal.html`, then
commits + pushes. Render auto-deploys.

## Schema

```json
{
  "id": "20260617T1430Z",
  "received_at": "2026-06-17T14:30:00Z",
  "lat": 47.31234,
  "lon": -76.84221,
  "body": "Off the put-in. P110 done. Charlie cried for two minutes then settled.",
  "source": "inreach",
  "raw_message_id": "agentmail-message-id-for-audit"
}
```

- `id`: filename stem, UTC-compact timestamp
- `body`: prose with Garmin signature already stripped
- `lat`/`lon`: optional, present if Garmin appended a location
- `raw_message_id`: AgentMail message id, kept for traceability
