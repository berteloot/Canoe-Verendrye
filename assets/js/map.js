/* ============================================================
   Route map — Petite boucle Chochocouane n° 61
   ------------------------------------------------------------
   Réserve faunique La Vérendrye · SEPAQ canoe-camping circuit
   The interactive map below uses the OFFICIAL SEPAQ topographic
   map as a georeferenced overlay on OpenStreetMap. The route,
   portages, campsites and kilometre markers visible on the
   overlay are the real published SEPAQ data.

   Image bounds were derived from the GeoPDF by GDAL:
     gdal_translate → GeoTIFF (UTM zone 18N, NAD83)
     gdalwarp -t_srs EPSG:4326 → reproject + crop to NEATLINE
     gdal_translate -of PNG → image overlay
   The image is in EPSG:4326 (lat/lon) so Leaflet's
   L.imageOverlay aligns it pixel-accurate on the OSM tiles.
   ============================================================ */

(function () {
  const el = document.getElementById('map');
  if (!el || typeof L === 'undefined') return;

  // Bounds of the SEPAQ overlay in WGS84
  // (extracted from the georeferenced PDF NEATLINE via GDAL)
  const overlayBounds = [
    [47.6289795, -77.2065843], // SW
    [47.8286717, -76.9550771], // NE
  ];

  const center = [
    (overlayBounds[0][0] + overlayBounds[1][0]) / 2,
    (overlayBounds[0][1] + overlayBounds[1][1]) / 2,
  ];

  const map = L.map('map', {
    center,
    zoom: 12,
    scrollWheelZoom: false,
  });

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Imagery © Esri · Source: Esri, Maxar, GeoEye, Earthstar Geographics',
    }
  );

  // Start on satellite
  satellite.addTo(map);

  L.control.layers(
    { 'Satellite': satellite, 'Street map': osm },
    null,
    { collapsed: false, position: 'topright' }
  ).addTo(map);

  // Fit to the map area
  map.fitBounds(overlayBounds, { padding: [10, 10] });

  // Real SEPAQ GPX route
  new L.GPX('assets/gpx/route.gpx', {
    async: true,
    polyline_options: {
      color: '#C8392E',
      weight: 3,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    },
    marker_options: {
      startIconUrl: null,
      endIconUrl: null,
      shadowUrl: null,
      wptIconUrls: { '': null },
    },
  }).addTo(map);

  // Put-in marker
  const putIn = [47.718, -77.140];
  L.marker(putIn, {
    icon: L.divIcon({
      className: 'wp wp--start',
      html: '<div style="background:#C8392E;color:#fff;font:600 11px/24px Inter,sans-serif;width:24px;height:24px;border-radius:50%;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">★</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
  })
    .addTo(map)
    .bindPopup('<strong>Départ / Arrivée — Lac Rousine</strong><br>Put-in and take-out parking lot');
})();
