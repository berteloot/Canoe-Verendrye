# The Red Canoe — Violette & Stan · La Vérendrye 2026

A static brochure + tracking site for Violette, Stan, and Charlie (Australian
Shepherd, 7 months old at put-in) on the **Petite boucle Chochocouane n° 61**, a
69 km canoe-camping loop in the Chochocouane sector of Réserve faunique La
Vérendrye, Québec. Paddled June 17 to 21, 2026, taking out on the summer solstice.

Canoe: Mad River Explorer 17 in Royalex (Jim Henry design).

Route facts (distance, portage lengths, lake names, site numbers) are sourced
from the SEPAQ official topo: `lvy_carte_petite_boucle_chochocouane_no61.pdf`.

Built to deploy on GitHub + Netlify, with a Cloudflare-Turnstile-ready
comments form.

## Stack

- Plain HTML / CSS / JS — no build step.
- [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles for the route map.
- Google Fonts: Fraunces (serif) + Inter (sans).
- Netlify Forms for comments (with hidden honeypot).
- Cloudflare Turnstile slot ready to switch on.

## Project layout

```
.
├── index.html           Landing — hero, stats, feature grid
├── itinerary.html       Interactive route map + day-by-day
├── equipment.html       Full gear list grouped by function
├── preparation.html     How we planned, trained, packed
├── journal.html         Photo/blog post grid (placeholders)
├── tracking.html        Garmin MapShare embed + comments form
├── assets/
│   ├── css/main.css     Brand palette + all styles
│   └── js/
│       ├── main.js      Nav toggle + active link
│       ├── map.js       Leaflet route + waypoints (placeholder coords)
│       └── comments.js  Comments form behavior + local dev fallback
├── netlify.toml         Static publish + security headers
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

### 2. Connect Netlify

1. New site → Import from Git → pick the repo.
2. Build command: *(empty)* — Publish directory: `.`
3. Deploy.

That's it. The `netlify.toml` in the root handles the rest.

## Wiring the live tracker

The tracking page (`tracking.html`) ships with a placeholder. To embed
your real Garmin MapShare:

1. In Garmin Explore (web), enable **MapShare** on the inReach device.
2. Copy the share URL, looks like `https://share.garmin.com/share/<your-handle>`.
3. Open [tracking.html](tracking.html), find the comment block inside
   `<div id="tracker-embed">`, and replace the placeholder with:

```html
<iframe
  title="Garmin MapShare"
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

## Comments — current setup

The form is wired for **Netlify Forms** out of the box:

- `data-netlify="true"` on the form element.
- Hidden honeypot field (`bot-field`) — bots that fill it get silently dropped.
- Submissions show up in your Netlify dashboard under **Forms** → `canoe-comments`.

While developing locally (or before connecting Netlify) the form gracefully
falls back to localStorage so you can see the UX. As soon as the site runs
under a `*.netlify.app` host (or you set `data-netlify="live"` on `<body>`),
Netlify takes over.

## Comments — adding Cloudflare Turnstile

When you're ready to layer Turnstile on top of Netlify Forms:

1. Create a Turnstile site in your Cloudflare dashboard, get the **site key**
   and **secret key**.
2. In [tracking.html](tracking.html):
   - Uncomment the Turnstile `<script>` tag in `<head>`.
   - Uncomment the `<div class="cf-turnstile" data-sitekey="...">` slot inside
     the form, and paste your site key.
3. To verify server-side, create a Netlify Function (e.g.
   `netlify/functions/verify-comment.js`) that:
   - Reads the `cf-turnstile-response` field from the form payload.
   - POSTs it to `https://challenges.cloudflare.com/turnstile/v0/siteverify`
     with the secret key.
   - Rejects the submission if `success !== true`.

(Netlify's built-in submission handling can also be paired with hCaptcha if
you'd rather not run a Function — see Netlify docs for `data-netlify-recaptcha`.)

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
- [ ] Wire the Garmin MapShare iframe in `tracking.html`.
- [ ] Swap journal placeholder covers for real photos.
- [ ] Add the Cloudflare Turnstile site key to `tracking.html` (and the
      Netlify Function for server-side verification).
- [ ] Add an `og:image` to each page's `<head>` (1200×630 PNG).
- [ ] Add a `favicon.svg` derived from the canoe mark.
