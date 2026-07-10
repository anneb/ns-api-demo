import { writeFile, mkdir } from "node:fs/promises";
import { config } from "dotenv";

config();

const key = process.env.NS_API_SUBSCRIPTION_KEY;
if (!key) {
  throw new Error("NS_API_SUBSCRIPTION_KEY missing in .env");
}

interface StationV3 {
  id: {
    uicCode: string;
    uicCdCode?: string;
    evaCode?: string;
    cdCode?: number;
    code: string;
  };
  stationType: string;
  names: {
    long: string;
    medium: string;
    short: string;
    festive?: string;
    synonyms: string[];
  };
  location?: { lat: number; lng: number };
  tracks: string[];
  country: string;
  [key: string]: unknown;
}

const countryCodes = "nl,d,b,f,a,ch,cz,gb";
const url = `https://gateway.apiportal.ns.nl/nsapp-stations/v3?countryCodes=${countryCodes}`;

const res = await fetch(url, {
  headers: {
    "Ocp-Apim-Subscription-Key": key,
    Accept: "application/json",
  },
});

if (!res.ok) {
  throw new Error(`Request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
}

const body = (await res.json()) as { payload: StationV3[] };
const stations = body.payload;

const geojson = {
  type: "FeatureCollection",
  features: stations
    .filter((s) => s.location)
    .map((s) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [s.location!.lng, s.location!.lat],
      },
      properties: {
        code: s.id.code,
        uicCode: s.id.uicCode,
        uicCdCode: s.id.uicCdCode,
        evaCode: s.id.evaCode,
        cdCode: s.id.cdCode,
        stationType: s.stationType,
        nameLong: s.names.long,
        nameMedium: s.names.medium,
        nameShort: s.names.short,
        synonyms: s.names.synonyms,
        tracks: s.tracks,
        country: s.country,
      },
    })),
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/stations.geojson", JSON.stringify(geojson));

console.log(`Saved ${geojson.features.length} stations to public/data/stations.geojson`);
