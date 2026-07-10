import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const PROXY_BASE_URL = (import.meta.env.VITE_VEHICLE_PROXY_URL as string).replace(/\/$/, "");
const VEHICLE_PROXY_URL = `${PROXY_BASE_URL}/vehicle`;
const POLL_INTERVAL_MS = 10_000;

interface JourneyStop {
  stop: { uicCode?: string; name?: string };
  status?: string;
  arrivals?: { actualTime?: string; plannedTime?: string }[];
}

interface Journey {
  stops: JourneyStop[];
}

const uicToStationCode = new Map<string, string>();

async function loadStationCodeLookup() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/stations.geojson`);
  const geojson = (await res.json()) as GeoJSON.FeatureCollection;
  for (const f of geojson.features) {
    const p = f.properties as { code: string; uicCode: string };
    if (p.uicCode && p.code) uicToStationCode.set(p.uicCode, p.code);
  }
}

interface Trein {
  treinNummer: number;
  ritId: string;
  lat: number;
  lng: number;
  snelheid: number;
  richting: number;
  type: string;
}

interface TrainFix {
  lat: number;
  lng: number;
  speedKmh: number;
  headingDeg: number;
  fixTime: number;
  fixWallClockIso: string;
  type: string;
  treinNummer: number;
}

const trainFixes = new Map<string, TrainFix>();
let selectedRitId: string | null = null;
let openPopup: maplibregl.Popup | null = null;

const map = new maplibregl.Map({
  container: "app",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [5.2, 52.1],
  zoom: 7,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] as GeoJSON.Feature[] };
}

map.on("load", async () => {
  map.addSource("tracks", { type: "geojson", data: `${import.meta.env.BASE_URL}data/spoorkaart.geojson` });
  map.addLayer({
    id: "tracks-line",
    type: "line",
    source: "tracks",
    paint: { "line-color": "#888", "line-width": 1 },
  });

  map.addSource("stations", { type: "geojson", data: `${import.meta.env.BASE_URL}data/stations.geojson` });
  map.addLayer({
    id: "stations-point",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": 3,
      "circle-color": "#333",
    },
  });

  map.addSource("trains", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer({
    id: "trains-point",
    type: "circle",
    source: "trains",
    paint: {
      "circle-radius": ["case", ["get", "selected"], 9, 6],
      "circle-color": ["match", ["get", "type"], "IC", "#d0021b", "SPR", "#f5a623", "#0074d9"],
      "circle-stroke-color": ["case", ["get", "selected"], "#ffe100", "#fff"],
      "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
    },
  });

  map.addSource("route-highlight", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer(
    {
      id: "route-highlight-line",
      type: "line",
      source: "route-highlight",
      paint: { "line-color": "#0074d9", "line-width": 4, "line-opacity": 0.8 },
    },
    "trains-point",
  );

  map.on("click", (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: ["trains-point"] });
    const f = hits[0];
    if (!f) {
      selectedRitId = null;
      openPopup = null;
      (map.getSource("route-highlight") as maplibregl.GeoJSONSource | undefined)?.setData(
        emptyFeatureCollection(),
      );
      return;
    }
    const p = f.properties as { treinNummer: number; type: string; ritId: string };
    selectedRitId = p.ritId;
    const speedHtml = speedLabel(trainFixes.get(p.ritId));
    const popup = new maplibregl.Popup()
      .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
      .setHTML(`<strong>${p.type} ${p.treinNummer}<span id="popup-speed">${speedHtml}</span></strong>`)
      .addTo(map);
    popup.on("close", () => {
      if (openPopup === popup) openPopup = null;
    });
    openPopup = popup;
    showRouteForTrain(p.treinNummer, p.ritId, popup);
  });

  loadStationCodeLookup();
  pollTrains();
  setInterval(pollTrains, POLL_INTERVAL_MS);
  requestAnimationFrame(animateTrains);
});

// upstream position fixes update slower than our poll rate (speed/heading stay
// live, but lat/lng can be identical across several polls) — so we dead-reckon
// from the last known fix using speed+heading every animation frame, instead of
// lerping between two fixes (which froze, then jumped once a new fix arrived)
// keep this modest — it's a "trust the last known speed/heading for a brief GPS
// gap" allowance, not "assume constant motion indefinitely". A long freeze often
// means the train actually stopped (e.g. underground platforms like Schiphol),
// so extrapolating for too long overshoots past the real, stationary position
const MAX_DEAD_RECKON_SECONDS = 15;
const MIN_DEAD_RECKON_SPEED_KMH = 5;
const NO_SIGNAL_THRESHOLD_SECONDS = 20;
const EARTH_DEG_PER_KM_LAT = 1 / 111.32;

function speedLabel(fix: TrainFix | undefined): string {
  if (!fix) return "";
  const staleSeconds = (Date.now() - new Date(fix.fixWallClockIso).getTime()) / 1000;
  if (staleSeconds > NO_SIGNAL_THRESHOLD_SECONDS) return " — geen signaal";
  return ` — ${Math.round(fix.speedKmh)} km/h`;
}

async function showRouteForTrain(treinNummer: number, ritId: string, popup: maplibregl.Popup) {
  const routeSource = map.getSource("route-highlight") as maplibregl.GeoJSONSource | undefined;
  routeSource?.setData(emptyFeatureCollection());

  // pin the journey lookup to the moment we actually saw this train, rather than
  // "now" — around midnight a train number can be ambiguous between today's
  // finished run and tomorrow's first one, and the API defaults dateTime to "now"
  const fix = trainFixes.get(ritId);
  const dateTimeParam = fix ? `&dateTime=${encodeURIComponent(fix.fixWallClockIso)}` : "";

  const journeyRes = await fetch(`${PROXY_BASE_URL}/journey?train=${treinNummer}${dateTimeParam}`, {
    cache: "no-store",
  });
  if (!journeyRes.ok) return;
  const journeyBody = (await journeyRes.json()) as { payload: Journey };
  const journey = journeyBody.payload;

  const origin = journey.stops[0]?.stop.name;
  const destination = journey.stops[journey.stops.length - 1]?.stop.name;

  const referenceTime = fix ? new Date(fix.fixWallClockIso).getTime() : Date.now();
  const upcoming = journey.stops
    .filter((s) => s.status !== "PASSING")
    .map((s) => {
      const timeIso = s.arrivals?.[0]?.actualTime ?? s.arrivals?.[0]?.plannedTime;
      return { name: s.stop.name, timeIso };
    })
    .filter((s): s is { name: string; timeIso: string } => !!s.name && !!s.timeIso)
    .filter((s) => new Date(s.timeIso).getTime() >= referenceTime);

  if (selectedRitId === ritId && origin && destination) {
    const type = (trainFixes.get(ritId)?.type ?? "").trim();
    const speedHtml = speedLabel(trainFixes.get(ritId));
    const stopsHtml = upcoming
      .map((s) => {
        const time = new Date(s.timeIso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
        return `<li>${s.name}: ${time}</li>`;
      })
      .join("");
    popup.setHTML(
      `<strong>${type} ${treinNummer}<span id="popup-speed">${speedHtml}</span></strong><br>van: ${origin}<br>naar: ${destination}` +
        (stopsHtml ? `<ul style="margin:4px 0 0 0;padding-left:16px;">${stopsHtml}</ul>` : ""),
    );
  }

  const stationCodes = journey.stops
    .map((s) => (s.stop.uicCode ? uicToStationCode.get(s.stop.uicCode) : undefined))
    .filter((c): c is string => !!c);
  if (stationCodes.length < 2) return;

  const trajectRes = await fetch(`${PROXY_BASE_URL}/traject?stations=${stationCodes.join(",")}`, {
    cache: "no-store",
  });
  if (!trajectRes.ok) return;
  const trajectGeojson = await trajectRes.json();
  routeSource?.setData(trajectGeojson);
}

async function pollTrains() {
  const res = await fetch(VEHICLE_PROXY_URL, { cache: "no-store" });
  if (!res.ok) return;
  const body = (await res.json()) as { payload: { treinen: Trein[] } };
  const now = performance.now();
  const nowIso = new Date().toISOString();

  for (const t of body.payload.treinen) {
    const existing = trainFixes.get(t.ritId);
    // upstream can repeat the exact same fix verbatim (e.g. GPS lost in a tunnel)
    // while still claiming nonzero speed — if we reset fixTime on every poll
    // regardless, dead reckoning restarts its extrapolation from that frozen
    // point each cycle, creeping forward then snapping back on the next poll.
    // Only restart the clock when the position actually changed.
    const positionUnchanged = existing && existing.lat === t.lat && existing.lng === t.lng;
    trainFixes.set(t.ritId, {
      lat: t.lat,
      lng: t.lng,
      speedKmh: t.snelheid,
      headingDeg: t.richting,
      fixTime: positionUnchanged ? existing.fixTime : now,
      fixWallClockIso: positionUnchanged ? existing.fixWallClockIso : nowIso,
      type: t.type,
      treinNummer: t.treinNummer,
    });
  }
}

function animateTrains() {
  const now = performance.now();
  const features: GeoJSON.Feature[] = [];
  let selectedLngLat: [number, number] | null = null;

  for (const [ritId, f] of trainFixes) {
    let lat = f.lat;
    let lng = f.lng;

    // heading is unreliable/noisy at low speed (GPS heading needs actual movement
    // to be meaningful) — extrapolating with a near-random heading is what caused
    // stopped/crawling trains to visibly dart backward then correct; only dead-reckon
    // when genuinely moving
    if (f.speedKmh >= MIN_DEAD_RECKON_SPEED_KMH) {
      const dtSeconds = Math.min(MAX_DEAD_RECKON_SECONDS, (now - f.fixTime) / 1000);
      const distanceKm = f.speedKmh * (dtSeconds / 3600);
      const headingRad = (f.headingDeg * Math.PI) / 180;
      lat += distanceKm * EARTH_DEG_PER_KM_LAT * Math.cos(headingRad);
      lng += (distanceKm * EARTH_DEG_PER_KM_LAT * Math.sin(headingRad)) / Math.cos((f.lat * Math.PI) / 180);
    }

    if (ritId === selectedRitId) selectedLngLat = [lng, lat];

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { ritId, type: f.type, treinNummer: f.treinNummer, selected: ritId === selectedRitId },
    });
  }

  const source = map.getSource("trains") as maplibregl.GeoJSONSource | undefined;
  source?.setData({ type: "FeatureCollection", features });

  if (openPopup && selectedRitId) {
    const speedEl = openPopup.getElement()?.querySelector("#popup-speed");
    if (speedEl) speedEl.textContent = speedLabel(trainFixes.get(selectedRitId));
    if (selectedLngLat) openPopup.setLngLat(selectedLngLat);
  }

  requestAnimationFrame(animateTrains);
}
