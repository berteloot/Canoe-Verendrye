/* ============================================================
   Route map — Petite boucle Chochocouane n° 61
   ------------------------------------------------------------
   The REAL paddled route: four daily GPS tracks from Stan's
   Garmin (window.TRIP_TRACK, see assets/js/trip-track.js),
   drawn over Esri satellite / OSM, one colour per day, with
   the three wilderness camps numbered and matched to their
   SEPAQ site.
   ============================================================ */

(function () {
  const el = document.getElementById('map');
  if (!el || typeof L === 'undefined' || !window.TRIP_TRACK) return;

  const T = window.TRIP_TRACK;
  const DAY_COLORS = ['#C8392E', '#E08A1E', '#2E7D5B', '#2C6E9E'];

  const map = L.map('map', { scrollWheelZoom: false });

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }
  ).addTo(map);

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  // Draw each day's track, collect for bounds + layer toggle
  const overlays = {};
  const allLatLngs = [];
  T.days.forEach((d, i) => {
    const color = DAY_COLORS[i % DAY_COLORS.length];
    const np = (T.portages || []).filter((p) => p.day === d.day).length;
    const line = L.polyline(d.coords, {
      color, weight: 3.5, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
    }).bindPopup(
      `<strong>Day ${d.day} · ${d.date}</strong><br>` +
      `${d.km} km · ${np} portage${np === 1 ? '' : 's'}<br>` +
      `moving ${d.moving} of ${d.elapsed}<br>` +
      `avg ${d.avg} km/h · max ${d.max} km/h`
    );
    line.addTo(map);
    overlays[`<span style="color:${color};font-weight:700">■</span> Day ${d.day} · ${d.km} km`] = line;
    allLatLngs.push(...d.coords);
  });

  map.fitBounds(L.latLngBounds(allLatLngs), { padding: [20, 20] });

  // Official SEPAQ published route, dashed grey, off by default (toggle to compare)
  if (T.sepaqRoute && T.sepaqRoute.length) {
    const sepaq = L.polyline(T.sepaqRoute, {
      color: '#555', weight: 2, opacity: 0.8, dashArray: '4 6', lineCap: 'round',
    }).bindPopup('<strong>Official SEPAQ route</strong><br>The published loop (69 km). Toggle against our GPS track.');
    overlays['<span style="color:#555;font-weight:700">┈</span> SEPAQ official route'] = sepaq;
  }

  L.control.layers(
    { 'Satellite': satellite, 'Street map': osm },
    overlays,
    { collapsed: false, position: 'topright' }
  ).addTo(map);

  // Put-in / take-out star
  L.marker(T.putin.coords, {
    icon: L.divIcon({
      className: 'wp wp--start',
      html: '<div style="background:#C8392E;color:#fff;font:600 13px/26px Inter,sans-serif;width:26px;height:26px;border-radius:50%;text-align:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)">★</div>',
      iconSize: [26, 26], iconAnchor: [13, 13],
    }),
    zIndexOffset: 1000,
  }).addTo(map).bindPopup(
    `<strong>${T.putin.label}</strong><br>Put-in and take-out, near Lac Rousine`
  );

  // Portage markers (detected from the GPS carries), coloured by day
  const portsByDay = {};
  (T.portages || []).forEach((p) => {
    portsByDay[p.day] = (portsByDay[p.day] || 0) + 1;
    const color = DAY_COLORS[(p.day - 1) % DAY_COLORS.length];
    L.marker(p.coords, {
      icon: L.divIcon({
        className: 'wp wp--portage',
        html: `<div title="Portage" style="width:12px;height:12px;background:#6a4a2a;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      }),
      zIndexOffset: 800,
    }).addTo(map).bindPopup(
      `<strong>Portage · Day ${p.day}</strong><br>≈ ${p.len} m carry`
    );
  });

  // Numbered camp markers
  T.camps.forEach((c) => {
    L.marker(c.coords, {
      icon: L.divIcon({
        className: 'wp wp--camp',
        html: `<div style="background:#1E3A2B;color:#fff;font:700 13px/26px Inter,sans-serif;width:26px;height:26px;border-radius:50% 50% 50% 2px;text-align:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)">${c.n}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 26],
      }),
      zIndexOffset: 900,
    }).addTo(map).bindPopup(
      `<strong>Camp ${c.n} · ${c.date}</strong><br>SEPAQ site ${c.sepaq}<br><span style="color:#666">${c.area}</span>`
    );
  });

  // Small legend
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend-box');
    div.innerHTML =
      '<div style="background:rgba(255,255,255,.92);padding:8px 10px;border-radius:4px;font:12px/1.5 Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.2)">' +
      T.days.map((d, i) => {
        const np = portsByDay[d.day] || 0;
        return `<div><span style="color:${DAY_COLORS[i]};font-weight:700">━</span> Day ${d.day} (${d.date.replace(/^[A-Za-z]+ /, '')}) · ${d.km} km · ${np} portage${np === 1 ? '' : 's'}</div>`;
      }).join('') +
      '<div style="margin-top:4px"><span style="color:#C8392E">★</span> put-in / take-out &nbsp; <span style="color:#1E3A2B;font-weight:700">●</span> camp &nbsp; <span style="color:#6a4a2a;font-weight:700">◆</span> portage</div>' +
      '</div>';
    return div;
  };
  legend.addTo(map);
})();
