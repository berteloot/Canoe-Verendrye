# The Red Canoe — Violette & Stan · La Vérendrye 2026

A static brochure + tracking site for Violette and Stan on the **Petite boucle
Chochocouane n° 61**, a 69 km canoe-camping loop in the Chochocouane sector of
Réserve faunique La Vérendrye, Québec. Paddled July 7 to 11, 2026, taking out at
the Lac Lavis take-out.

Canoe: Mad River Explorer 17 in Royalex (Jim Henry design).

Route facts (distance, portage lengths, lake names, site numbers) are sourced
from the SEPAQ official topo: `lvy_carte_petite_boucle_chochocouane_no61.pdf`.

Built to deploy on GitHub + Render, with a Cloudflare-Turnstile-ready
comments form.

## Stack

- Plain HTML / CSS / JS — no build step.
- [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles for the route map.
- Google Fonts: Fraunces (serif) + Inter (sans).
- Cloudflare Worker (`worker/`) for comments — verifies Turnstile token, emails
  Stan via Resend.

## Project layout

```
.
├── index.html           Landing — hero, stats, feature grid
├── itinerary.html       Interactive route map + day-by-day
├── equipment.html       Full gear list grouped by function
├── preparation.html     How we planned, trained, packed
├── journal.html         Live dispatches + photo/blog post grid
├── tracking.html        Garmin LiveTrack embed + comments form
├── assets/
│   ├── css/main.css     Brand palette + all styles
│   └── js/
│       ├── main.js      Nav toggle + active link
│       ├── map.js       Leaflet route + waypoints (placeholder coords)
│       └── comments.js  Comments form — posts to Cloudflare Worker
├── worker/
│   ├── index.js         Cloudflare Worker: Turnstile verify + Resend email
│   └── wrangler.toml    Worker deploy config
├── scripts/
│   ├── pull_dispatches.py   Pierre's polling loop (runs on Lightsail)
│   └── render-journal.py    Regenerates the Live dispatches block
├── render.yaml          Render static site config + security headers
└── README.md
```

## Local preview

It's pure static — open `index.html` in a browser, or:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin git@github.com:<you>/verendrye.git
git push -u origin main
```

### 2. Connect Render

1. New Static Site → connect the GitHub repo.
2. Build command: *(leave empty)*
3. Publish directory: `.`
4. Deploy.

`render.yaml` in the root handles security headers and asset caching automatically.

## Wiring the live tracker

The tracking page (`tracking.html`) ships with a placeholder. To embed
your real Garmin LiveTrack:

1. In Garmin Explore (web), enable **LiveTrack** on the inReach device.
2. Copy the share URL, looks like `https://share.garmin.com/share/<your-handle>`.
3. Open [tracking.html](tracking.html), find the comment block inside
   `<div id="tracker-embed">`, and replace the placeholder with:

```html
<iframe
  title="Garmin LiveTrack"
  src="https://share.garmin.com/share/YOUR-USER"
  allowfullscreen
  loading="lazy"></iframe>
```

The CSS already sizes the iframe to fill the 16:10 panel.

## Wiring real route coordinates

The Leaflet map currently shows a hand-drawn placeholder loop. When you
have the real GPX:

1. Export GPX from Garmin BaseCamp / Caltopo / wherever.
2. Convert to a JS array of `[lat, lng]` pairs (or load it with a
   tiny GPX parser — [`leaflet-gpx`](https://github.com/mpetazzoni/leaflet-gpx)
   is one line of code if you'd rather keep the .gpx file as-is).
3. Replace the `route` array and `waypoints` array in [assets/js/map.js](assets/js/map.js).

## Comments

Comments post to the Cloudflare Worker at `https://comments-api.berteloot.org/`.
The Worker verifies the Cloudflare Turnstile token and forwards the message to
Stan via Resend. See `worker/index.js` for the implementation.

**To activate Turnstile on the live site:**

1. Create a Turnstile site in your Cloudflare dashboard, get the **site key**
   and **secret key**.
2. In [tracking.html](tracking.html):
   - Uncomment the Turnstile `<script>` tag in `<head>`.
   - Uncomment the `<div class="cf-turnstile" data-sitekey="...">` slot inside
     the form, and paste your site key.
3. Add the secret key as `TURNSTILE_SECRET` in the Worker's environment
   (Cloudflare dashboard → Workers → Settings → Environment Variables).

While developing locally, the form falls back to localStorage so the UX
is visible without a live Worker.

## Live dispatches (Garmin inReach)

Trail updates flow automatically from the inReach device to the site:

1. Add `pierre@agentmail.to` as a contact in **Garmin Explore** and sync to
   the device before the trip.
2. On the trail, compose a message on the inReach and send it to that contact.
   Garmin delivers it via satellite as email from `no.reply.inreach@garmin.com`.
3. The **n8n workflow "Canoe: Garmin Dispatch → Journal"** (on the n8n
   Lightsail instance, `n8n.altilead.com`) runs **hourly**. It polls Pierre's
   AgentMail inbox, filters and parses inReach messages, and commits the new
   dispatch JSON + re-rendered `journal.html` + `rss.xml` to GitHub in one
   atomic commit via the GitHub git Data API. Render auto-deploys. It then
   Telegrams Stan a confirmation.

**Max delay from send to live: 1 hour.**

The canonical workflow export lives in `n8n-workflow-garmin-dispatch.json`.

### How re-publication is prevented (two layers)

- `journal-entries/published-ids.json` — the workflow's dedup store. It is
  fetched from this repo at the start of every run and re-committed with new
  message IDs after each publish. **Do not delete it.** If the fetch errors,
  the workflow aborts rather than risk re-publishing (fail-closed); if the
  file is missing (404) the dedup set is empty, which is why layer 2 exists.
- `TRIP_CUTOFF` (July 1, 2026) in the workflow's filter node and in
  `scripts/pull_dispatches.py` — messages received before the cutoff are
  never dispatches, so pre-trip test traffic stays inert regardless of the
  dedup file's state.

### GitHub auth

The workflow authenticates with `GITHUB_CANOE_TOKEN` from
`/home/ec2-user/n8n/.env` on the Lightsail box. The container bakes env at
start: after changing it, run `cd /home/ec2-user/n8n && sudo docker compose
up -d` to recreate. Fine-grained PATs expire — the July 2026 outage was an
expired 30-day PAT. Use a long-lived token and calendar the renewal.

### Trigger a run manually

`curl https://n8n.altilead.com/webhook/canoe-dispatch` — starts a production
execution immediately (same path the hourly schedule takes).

### `scripts/pull_dispatches.py`

A standalone Python fallback for the same pipeline (same filters, same
cutoff). Not deployed anywhere; run it locally if n8n is down:

```bash
cd clients/Canoe && CANOE_AUTOCOMMIT=0 python3 scripts/pull_dispatches.py
```

`CANOE_AUTOCOMMIT=0` skips the git push so nothing goes live.

## Brand notes

| Token            | Value      | Usage                          |
| ---------------- | ---------- | ------------------------------ |
| `--canoe-red`    | `#C8392E`  | Primary brand — accents, CTA   |
| `--forest`       | `#1E3A2B`  | Headings, dark surfaces        |
| `--forest-dark`  | `#122017`  | Hero, footer                   |
| `--lake`         | `#2C5F7C`  | Cool accents, post covers      |
| `--birch`        | `#F5EFE0`  | Soft background sections       |
| `--paper`        | `#FBF8F1`  | Body background                |
| `--charcoal`     | `#1C1C1C`  | Body text                      |

Headings: **Fraunces**. Body: **Inter**. Both loaded from Google Fonts in
each page's `<head>`.

## TODO before launch

- [ ] Replace placeholder route in `assets/js/map.js` with the real GPX.
- [ ] Wire the Garmin LiveTrack iframe in `tracking.html`.
- [ ] Swap journal placeholder covers for real photos.
- [ ] Add the Cloudflare Turnstile site key to `tracking.html` and `TURNSTILE_SECRET`
      to the Worker's environment variables.
- [ ] Add an `og:image` to each page's `<head>` (1200×630 PNG).
- [ ] Add a `favicon.svg` derived from the canoe mark.
