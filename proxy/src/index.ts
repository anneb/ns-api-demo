export interface Env {
  NS_API_SUBSCRIPTION_KEY: string;
}

const ROUTES: Record<string, { upstream: string; cacheTtlSeconds: number }> = {
  "/": { upstream: "https://gateway.apiportal.ns.nl/virtual-train-api/vehicle", cacheTtlSeconds: 5 },
  "/vehicle": { upstream: "https://gateway.apiportal.ns.nl/virtual-train-api/vehicle", cacheTtlSeconds: 5 },
  // route rarely changes mid-trip, safe to cache longer than live position data
  "/journey": { upstream: "https://gateway.apiportal.ns.nl/reisinformatie-api/api/v2/journey", cacheTtlSeconds: 300 },
  // track geometry for a given station list, effectively static, cache generously
  "/traject": { upstream: "https://gateway.apiportal.ns.nl/Spoorkaart-API/api/v1/traject.geojson", cacheTtlSeconds: 3600 },
};

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const inUrl = new URL(request.url);
    const route = ROUTES[inUrl.pathname];
    if (!route) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }
    const CACHE_TTL_SECONDS = route.cacheTtlSeconds;
    const upstreamUrl = new URL(route.upstream);
    upstreamUrl.search = inUrl.search;

    const cache = caches.default;
    const cacheKey = new Request(upstreamUrl.toString(), request);

    const cached = await cache.match(cacheKey);
    if (cached) {
      const res = new Response(cached.body, cached);
      for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
      return res;
    }

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: {
        "Ocp-Apim-Subscription-Key": env.NS_API_SUBSCRIPTION_KEY,
        Accept: "application/json",
      },
    });

    if (!upstreamRes.ok) {
      return new Response(await upstreamRes.text(), {
        status: upstreamRes.status,
        headers: corsHeaders(),
      });
    }

    const body = await upstreamRes.text();
    const res = new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        ...corsHeaders(),
      },
    });

    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};
