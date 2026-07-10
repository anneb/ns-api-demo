# NS API Project

Working with the Nederlandse Spoorwegen (NS) public API: train locations, timetables, routes/stations, disruptions/delays.

## Auth / how to get access (from Starter's Guide)

1. Register at portal login/register page (choose "NS Medewerker" or "Externe bezoeker") — confirmation email follows, may take up to 5 min before APIs visible.
2. Access is granted per **product** (bundle of one or more APIs), not per API directly. Find product via Products page, or via API page's "Related Products" link.
3. On product page, under "your subscriptions" (jouw subscriptions), click **Subscribe** — accept terms if shown, give subscription a name (advice: product name).
4. Request goes to product owner if approval required; confirmation email sent either way.
5. Once approved, subscription key appears on your **profile page**. Send this key with every request as header `Ocp-Apim-Subscription-Key: <key>` (confirmed via SpoorKaart OpenAPI spec). Alt: query param `subscription-key=<key>`.
6. Some APIs may need extra security beyond the key — check API page/definition or ask API owner.
7. Product/API-specific questions: use form at bottom of product page.

## Portal

- Dev portal: https://apiportal.ns.nl/ (Azure API Management based)
- Requires registration/login to view docs and get subscription key
- Portal is a JS SPA (Knockout-based widgets: `product-details-runtime`, `product-apis-runtime`, etc.) — static HTML fetch gives no doc content, must be logged in and JS-rendered
- Auth: subscription key passed as header `Ocp-Apim-Subscription-Key` (typical Azure APIM pattern) — confirm exact header name once portal accessed

## Products (portal groups APIs into "products", each needs own subscription)

| Product | Description |
|---|---|
| Ns-App | External Mlab product — APIs that feed NS extra mobile app. **Contains Reisinformatie/Disruptions/Places/SpoorKaart/Virtual Train/NS-APP Stations APIs (see table below)** |
| Energy Meter Reading | Meter readings from metering points |
| External Contractors Work Order Feedback | Feedback API for external contractors |
| FRAME | SOAP+REST for FRAME backend — bike parking / OV-fiets rental registration (Reseller service etc.) |
| KOSMOS | REST APIs for KOSMOS backend |
| KOSMOS Agents | REST APIs for KOSMOS agents |
| OV-fiets - Online Service | Reseller-facing API for OV-fiets online service (rental info, user info) |
| OV-fiets - Online Service - Reseller notifications | Webhook registration for OV-fiets Online Service notifications |
| Public-Travel-Information | Only contains NS.nl-Public-Price-Information API — deprecated, no new subscriptions approved |
| Stationsdata (Extern) | NS Stations geographic data (limited so far) |

Not all relevant to train location/timetable/disruption use case — focus on **Ns-App** product.

## APIs in the "Ns-App" product (confirmed via portal, 2026-07-10)

| API | Purpose |
|---|---|
| Reisinformatie API | Main travel info source for NS App: timetables, disruptions, stations, etc. Rate limit for external non-paying users: 300 req/5min |
| Disruptions API | Disruptions/delays |
| NS-APP Stations API | Station data (used by NS App) |
| Places API | Location data — addresses, POIs, bus/tram stops, stations + facilities |
| SpoorKaart API | Track geometry for map plotting — returns GeoJSON or similar |
| Virtual Train API | (purpose TBD — likely live train position/simulation) |

Each API needs individual subscription/click "Subscribe" in portal to get key + see its own docs/OpenAPI spec page.

## TODO

- [ ] Log in to https://apiportal.ns.nl/, get subscription key
- [ ] Check if OpenAPI/Swagger JSON export available per product (Azure APIM often exposes `/subscriptions` or export endpoint even without full docs)
- [ ] Paste/save relevant endpoint docs here as we go, since agents can't browse portal directly
- [ ] Pick language/stack for project

## Endpoint reference

### Disruptions API

Base: `https://gateway.apiportal.ns.nl/disruptions/v3`
Portal: `/api-details#api=disruptions-api&operation=getDisruptions_v3`

**GET /disruptions/v3** — list calamities/disruptions/maintenance

Query params:
| Name | Required | Type | Description |
|---|---|---|---|
| isActive | false | boolean | filter to only active items (happening now) |
| type | false | string | disruption type filter; omit for all types |

Headers: `Accept-Language` (optional, string)

Response 200 `application/json`:
```json
[{
    "id": "string",
    "type": "CALAMITY",
    "isActive": true,
    "title": "string",
    "topic": "string"
}]
```

Response 400 `application/json`:
```json
{ "message": "string" }
```

### SpoorKaart API

Base: `https://gateway.apiportal.ns.nl/Spoorkaart-API`
Auth: header `Ocp-Apim-Subscription-Key` or query `subscription-key`

| Method/Path | Description | Key params |
|---|---|---|
| GET /api/v1/spoorkaart | GeoJSON for all rail tracks in NL | — |
| GET /api/v1/traject (+ .json / .geojson) | Map line between connected stations | `stations` (required, array of station codes, must be directly connected e.g. `RM,WT,MZ`) |
| GET /api/v1/storingen/{id} | Disruption/maintenance geojson feature by ID | `id` (path, required), `extension` (query, use `.geojson` for geojson) |
| GET /api/v1/storingen (+ .json / .geojson) | Disruptions/maintenance geojson features (IDs from Reisinformatie API `reisinfo/v3/disruptions`) | `startDate`, `endDate` (ISO datetime), `actual` (bool, default true) |

Response content types: `application/json` (wrapped w/ Representation) or `application/geo+json` / `.geojson` variants (plain FeatureCollection) — prefer `.geojson` suffix or `Accept: application/geo+json` for clean GeoJSON without wrapper.

Track geometry: GeoJSON `LineString`/`MultiLineString`, standard `[longitude, latitude, altitude?]` coords.

**For map project: use `/api/v1/spoorkaart` (all tracks) as base layer.**

Gotcha found in practice: `application/json` response is wrapped — actual FeatureCollection sits under `body.payload`, not top-level (despite `allOf` schema suggesting flat merge). Unwrap with `body.payload ?? body`. Result: 740 LineString features, each with `properties.from`/`properties.to` (station codes).

## Project setup (Vite + TS)

- `npm install` — installs deps
- `npm run fetch:tracks` — runs `scripts/fetch-spoorkaart.ts`, saves track geojson to `public/data/spoorkaart.geojson` (gitignored, regenerate as needed; needs `.env` with `NS_API_SUBSCRIPTION_KEY`)
- `npm run fetch:stations` — runs `scripts/fetch-stations.ts`, saves station points to `public/data/stations.geojson` for NL + neighboring/connected countries (`countryCodes=nl,d,b,f,a,ch,cz,gb` — 729 stations: NL 397, D 218, B 55, A 26, F 16, CH 9, GB 4, CZ 4). Each feature's properties include all station code variants: `code`, `uicCode`, `uicCdCode`, `evaCode`, `cdCode`, plus names/synonyms/tracks/country. Edit `countryCodes` in the script to change scope.
- `npm run dev` — starts Vite dev server, `src/main.ts` loads the local geojson file
- Key stays server-side (fetch script runs in Node via `tsx`, never bundled into browser JS)
- `src/main.ts` — MapLibre GL map: track/station geojson as static layers, live trains polled from the Cloudflare proxy every 10s. Positions are dead-reckoned client-side every `requestAnimationFrame` tick using each train's live `snelheid`/`richting` (speed/heading) from its last known fix — not lerped between two polled positions, because upstream `lat`/`lng` updates slower than the poll rate (can be identical across several polls) while speed/heading stay live; lerping between stale fixes caused a visible freeze-then-jump pattern. Dead reckoning capped at 60s since last real fix (`MAX_DEAD_RECKON_SECONDS`) so a train with stale data doesn't fly off indefinitely.
- Needs `VITE_VEHICLE_PROXY_URL` in `.env` (your deployed Worker URL — public, not secret, safe in browser bundle)
- Base tiles: OpenFreeMap `liberty` style (free, no key needed)
- Click a train → popup with train number + type, and its full route highlighted (via proxy `/journey` for stop list → `/traject` for the geojson line)

### NS-APP Stations API

Base: `https://gateway.apiportal.ns.nl/nsapp-stations`
Auth: header `Ocp-Apim-Subscription-Key` or query `subscription-key`

**Use this to resolve place names → station codes (e.g. for SpoorKaart `/traject` or Reisinformatie trip planning).**

| Method/Path | Description | Key params |
|---|---|---|
| GET /v3 | Search stations by name (recommended, newer schema) | `q` (min 2 chars, name search), `includeNonPlannableStations` (bool), `countryCodes` (array, e.g. `nl,d,b`), `limit` (default 10) |
| GET /v3/nearest | Nearest stations to coords | `lat`, `lng` (required), `limit` (default 2), `includeNonPlannableStations` |
| GET /v1/station | Single station lookup by known ID | `uicCode` or `uicCdCode` |
| GET /v2, /v2/nearest | Older schema versions, same shape as v3 but flat/Dutch field names | same as v3 |

V3 response shape (`payload: StationV3[]`):
```json
{
  "id": { "uicCode": "string", "uicCdCode": "string", "evaCode": "string", "cdCode": 0, "code": "string" },
  "stationType": "INTERCITY_STATION",
  "names": { "long": "string", "medium": "string", "short": "string", "synonyms": ["string"] },
  "location": { "lat": 0, "lng": 0 },
  "tracks": ["string"],
  "country": "string"
}
```

`id.code` = short station code (e.g. `UT` for Utrecht Centraal) — this is what SpoorKaart `/traject?stations=` expects.

Example: search "Utrecht" → `GET /v3?q=Utrecht&limit=5` → grab `payload[0].id.code`.

### Virtual Train API

Base: `https://gateway.apiportal.ns.nl/virtual-train-api`
Auth: header `Ocp-Apim-Subscription-Key` (assume same pattern as other APIs; not explicit in spec excerpt seen)

**Live train positions — this is the one for "trains moving on a map."**

| Method/Path | Description | Key params |
|---|---|---|
| GET /vehicle | Live info for all vehicles (trains/buses) | `lat`, `lng`, `radius` (meters), `limit`, `route` (int), `features` (`bus`/`materieel`/`trein`) — all optional; omit lat/lng/radius to get everything |
| GET /v1/trein | Info about all trains (richer, station-context data) | `ids`, `stations` (e.g. `UT,AH`), `features` (`zitplaats`,`platformitems`,`cta`,`drukte`,`druktev2`), `dateTime`, `all` |
| GET /v1/trein/{ritnummer} | Info about one train by rit number | `features`, `dateTime` |
| GET /v1/trein/{ritnummer}/{stationscode} | Info about one train at one station | `features`, `dateTime` |
| GET /v1/ritnummer/{materieelnummer} | Convert materieel number → rit number | — |
| GET /v1/prognose/{ritnummer} | Crowd forecast for a train | — |
| GET /v1/platform/{station}/{platform} | Platform layout info (5 stations only: EHV, HT, UT, ASA/ASD?, SHL) | — |
| GET /v1/images/{image}, /v1/images/{materieel}/{image} | Train/rolling-stock images (PNG) | — |
| GET /v1/status | Health check | — |

**GET /vehicle response** (confirmed live, 2026-07-10): `{"payload":{"treinen":[Trein, ...]}}` — note `payload` wrapper again (same Representation pattern as SpoorKaart API).
```json
{
  "treinNummer": 6691,
  "ritId": "6691",
  "lat": 51.691395,
  "lng": 5.2935467,
  "snelheid": 0.0,
  "richting": 20.72,
  "horizontaleNauwkeurigheid": 280388.9,
  "type": "SPR",
  "bron": "OBIS"
}
```
`snelheid` = speed (km/h), `richting` = heading/bearing (degrees) — enough to dead-reckon/interpolate position between polls for smooth animation, not just snap between fixes. `type` = train category (SPR=Sprinter, IC=Intercity). `bron` = data source.

**For animated map: poll `/vehicle` (no filter = all trains, or bbox via lat/lng/radius) every N seconds server-side (see proxy discussion), interpolate client-side using `snelheid`+`richting` between polls for smooth motion.**

## Proxy for live train data (proxy/)

Cloudflare Worker, holds the subscription key server-side, adds CORS, caches per-route at the edge. Browser never sees the key. Routes:

| Proxy path | Upstream | Cache TTL |
|---|---|---|
| `/` or `/vehicle` | Virtual Train API `/vehicle` | 5s (shorter than the 10s client poll interval so polls always get fresh data — equal TTLs caused visible stutter from occasional stale hits) |
| `/journey` | Reisinformatie API `/api/v2/journey` | 300s (route rarely changes mid-trip) |
| `/traject` | SpoorKaart API `/api/v1/traject.geojson` | 3600s (effectively static per station pair) |

- `cd proxy && npm install`
- `npm run secret` — sets `NS_API_SUBSCRIPTION_KEY` as a Cloudflare secret (prompts for value, paste primary key; not stored in any file)
- `npm run dev` — local dev via `wrangler dev`
- `npm run deploy` — deploys to Cloudflare (needs `wrangler login` first, free tier)

Once deployed, browser map calls `https://<your-worker>.workers.dev/?lat=..&lng=..&radius=..` instead of NS directly — same query params as `/vehicle` (`lat`, `lng`, `radius`, `limit`, `route`, `features`).

### Reisinformatie API (journey/route lookup)

Base: `https://gateway.apiportal.ns.nl/reisinformatie-api` (confirmed via spec `servers`)
Auth: header `Ocp-Apim-Subscription-Key` (standard pattern)

**GET /api/v2/journey** — full stop list for a train, used to draw its route.

| Param | Required | Description |
|---|---|---|
| `train` | one of train/id required | train number (ritnummer) — e.g. `6952` |
| `id` | one of train/id required | journey identifier (alt to `train`) |
| `dateTime` | no | defaults to now |
| `omitCrowdForecast` | no | skip crowd data, smaller response |

Response (confirmed live, 2026-07-11): `{"payload": { stops: JourneyStop[], ... }}` — wrapped, same Representation pattern as other APIs. Each `JourneyStop.stop` only has `uicCode` in practice (no `code` field despite it being in the schema) — resolve to short station code via `stations.geojson`'s `uicCode`→`code` mapping (already fetched locally, see `uicToStationCode` in `src/main.ts`).

**Route highlight on train click** (implemented): `GET /journey?train={ritnummer}` (via proxy) → map `stops[].stop.uicCode` through local `stations.geojson` lookup → short codes → `GET /traject?stations=CODE1,CODE2,...` (via proxy, SpoorKaart API) → geojson line → `route-highlight` source.

## Notes

- Because docs are login-gated, capture endpoint specs (paths, params, response shapes) into this repo as discovered — don't rely on re-fetching portal each session.
