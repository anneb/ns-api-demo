import { writeFile, mkdir } from "node:fs/promises";
import { config } from "dotenv";

config();

const key = process.env.NS_API_SUBSCRIPTION_KEY;
if (!key) {
  throw new Error("NS_API_SUBSCRIPTION_KEY missing in .env");
}

const url = "https://gateway.apiportal.ns.nl/Spoorkaart-API/api/v1/spoorkaart";

const res = await fetch(url, {
  headers: {
    "Ocp-Apim-Subscription-Key": key,
    Accept: "application/geo+json",
  },
});

if (!res.ok) {
  throw new Error(`Request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
}

const body = await res.json();
const geojson = body.payload ?? body;

await mkdir("public/data", { recursive: true });
await writeFile("public/data/spoorkaart.geojson", JSON.stringify(geojson));

console.log(`Saved ${geojson.features?.length ?? 0} features to public/data/spoorkaart.geojson`);
