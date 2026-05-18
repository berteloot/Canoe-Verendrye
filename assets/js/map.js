/* ============================================================
   Route map — Petite boucle Chochocouane n° 61
   ------------------------------------------------------------
   Réserve faunique La Vérendrye · SEPAQ canoe-camping circuit
   Source: SEPAQ official map (lvy_carte_petite_boucle_chochocouane_no61.pdf).
   Length: 69 km · 21 portages · longest 575 m.

   Put-in / take-out is on the western edge of the loop near
   Lac Rousine, accessed from a tertiary road off Highway 117.
   Coordinates below are hand-traced from the SEPAQ topo — they
   approximate the real route but should be replaced with the
   GPS track once Stan brings it back on the inReach.
   ============================================================ */

(function () {
  const el = document.getElementById('map');
  if (!el || typeof L === 'undefined') return;

  // Loop center, between the western put-in and the eastern Lac Quenza
  const center = [47.745, -77.090];

  const map = L.map('map', {
    center,
    zoom: 12,
    scrollWheelZoom: false,
  });

  // OSM is fine for now; consider OpenTopoMap for contours later.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Route: SEPAQ n° 61',
  }).addTo(map);

  // ---- Route (counter-clockwise from put-in) ----
  // Hand-traced from the SEPAQ map; replace with the actual GPX after the trip.
  const route = [
    [47.718, -77.140], // 0 km  · Put-in (Lac Rousine, Départ/Arrivée)
    [47.728, -77.143],
    [47.738, -77.150], // 5 km  · Lac Linard / Lac Obreck
    [47.748, -77.160],
    [47.760, -77.170], // Lac Elbow / Lac Pécy area
    [47.770, -77.165],
    [47.778, -77.150], // 10 km · Lac Rivard area — P480 m
    [47.785, -77.130],
    [47.790, -77.110], // 15 km · Lac Bastude / Lac Laspron (north reach)
    [47.788, -77.085],
    [47.782, -77.065], // Lac Discal / Lac Mélar
    [47.770, -77.055],
    [47.758, -77.050], // 20 km · Lac Donne / Lac Sayon
    [47.748, -77.045],
    [47.738, -77.040], // 25 km · Lac Capitan / Lac Nostoc
    [47.730, -77.030],
    [47.725, -77.015], // 30 km · Rivière Denain — P575 m portage chain
    [47.722, -77.000],
    [47.720, -76.985], // 35 km · Lac Padozel / Lac Quenza
    [47.712, -76.985],
    [47.700, -76.995], // 40 km · Lac Boisrault
    [47.690, -77.005],
    [47.683, -77.025], // 45 km · Lac Ferrade / Lac Étain
    [47.682, -77.050],
    [47.685, -77.075], // 50 km · Lac Salival / Lac Lavis
    [47.692, -77.095],
    [47.700, -77.110], // 55 km · Lac Suzie
    [47.705, -77.125],
    [47.712, -77.135], // 60 km · Lac Halloy
    [47.715, -77.140],
    [47.718, -77.140], // 65–69 km · back to put-in
  ];

  const polyline = L.polyline(route, {
    color: '#C8392E',
    weight: 4,
    opacity: 0.9,
    lineJoin: 'round',
  }).addTo(map);

  map.fitBounds(polyline.getBounds(), { padding: [40, 40] });

  // ---- Waypoints — major portages and planned camps ----
  // Camp choices are tentative; SEPAQ permits will lock them in.
  const waypoints = [
    { coords: [47.718, -77.140], type: 'start',   label: 'Départ / Arrivée. Lac Rousine (P110 m put-in)' },
    { coords: [47.778, -77.150], type: 'portage', label: 'P480 m, north of Lac Rivard (day 1)' },
    { coords: [47.785, -77.135], type: 'camp',    label: 'Night 1. Lac Rivard (site 61-08)' },
    { coords: [47.790, -77.110], type: 'camp',    label: 'Night 2. Lac Laspron (site 63-03)' },
    { coords: [47.725, -77.015], type: 'portage', label: 'P575 m on Rivière Denain (longest of the trip, day 3)' },
    { coords: [47.720, -76.985], type: 'camp',    label: 'Night 3. Lac Quenza (site 60-73)' },
    { coords: [47.690, -77.005], type: 'portage', label: 'P340 m + P230 m, south of Lac Boisrault (day 4)' },
    { coords: [47.685, -77.075], type: 'camp',    label: 'Night 4. Lac Lavis (site 60-76)' },
  ];

  const icons = {
    start: L.divIcon({
      className: 'wp wp--start',
      html: '<div style="background:#C8392E;color:#fff;font:600 11px/24px Inter,sans-serif;width:24px;height:24px;border-radius:50%;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">★</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
    camp: L.divIcon({
      className: 'wp wp--camp',
      html: '<div style="background:#1E3A2B;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    }),
    portage: L.divIcon({
      className: 'wp wp--portage',
      html: '<div style="background:#6a4a2a;width:12px;height:12px;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    }),
  };

  waypoints.forEach(wp => {
    L.marker(wp.coords, { icon: icons[wp.type] })
      .addTo(map)
      .bindPopup(`<strong>${wp.label}</strong>`);
  });
})();
