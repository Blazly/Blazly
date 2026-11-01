const SEARCHAPI_ROOT = "https://www.searchapi.io/api/v1/search";

export async function searchApiGet(apiKey, params) {
  const query = new URLSearchParams({ api_key: apiKey });
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  const response = await fetch(`${SEARCHAPI_ROOT}?${query.toString()}`, {
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || `Search failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : "Search failed.");
  }
  return data;
}

export function parseGoogleMapsUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return {};
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }

  let place_id =
    decoded.match(/[?&]q=place_id:([A-Za-z0-9_-]+)/i)?.[1] ||
    decoded.match(/place_id[=:]([A-Za-z0-9_-]+)/i)?.[1] ||
    null;

  let data_id =
    decoded.match(/!1s(0x[a-f0-9]+:0x[a-f0-9]+)/i)?.[1] ||
    decoded.match(/[?&]data_id=(0x[a-f0-9]+:0x[a-f0-9]+)/i)?.[1] ||
    decoded.match(/ftid=(0x[a-f0-9]+:0x[a-f0-9]+)/i)?.[1] ||
    null;

  const coordMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const lat = coordMatch ? Number(coordMatch[1]) : null;
  const lng = coordMatch ? Number(coordMatch[2]) : null;
  const zoomMatch = decoded.match(/@-?\d+\.\d+,-?\d+\.\d+,(\d+(?:\.\d+)?)(z|m)/i);
  const zoom = zoomMatch ? zoomMatch[1] + zoomMatch[2].toLowerCase() : "14z";

  return { place_id, data_id, lat, lng, ll: lat != null && lng != null ? `@${lat},${lng},${zoom}` : null };
}

export async function resolveGoogleMapsUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return url;
  if (!/goo\.gl|maps\.app\.google|share\.google/i.test(url)) return url;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    return response.url || url;
  } catch {
    return url;
  }
}

export async function fetchGoogleMapsPlace({ apiKey, place_id, data_id, hl = "en", gl = "us" }) {
  const params = { engine: "google_maps_place", hl, gl };
  if (place_id) params.place_id = place_id;
  else if (data_id) params.data_id = data_id;
  else throw new Error("Could not read a place ID from this Google Maps link.");

  const data = await searchApiGet(apiKey, params);
  return data.place_result || null;
}

export async function fetchGoogleMapsLocalSearch({ apiKey, q, ll, hl = "en", gl = "us", page = 1 }) {
  const params = { engine: "google_maps", q, hl, gl, page: String(page) };
  if (ll) params.ll = ll;
  const data = await searchApiGet(apiKey, params);
  return data.local_results || [];
}

export async function fetchGoogleRankTrackingSerp({
  apiKey,
  query,
  location = "United States",
  num = 100,
}) {
  const params = new URLSearchParams({
    engine: "google_rank_tracking",
    q: query,
    api_key: apiKey,
    num: String(Math.min(Number(num) || 100, 100)),
    gl: "us",
    hl: "en",
  });
  if (location) params.set("location", location);

  const response = await fetch(`${SEARCHAPI_ROOT}?${params.toString()}`, {
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || `Search failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : "Search failed.");
  }

  return (data.organic_results || []).map((row) => ({
    position: row.position ?? null,
    title: String(row.title || "").trim(),
    link: String(row.link || "").trim(),
    domain: String(row.domain || "").trim(),
    snippet: String(row.snippet || "").trim().slice(0, 280),
    source: String(row.source || "").trim(),
  }));
}
