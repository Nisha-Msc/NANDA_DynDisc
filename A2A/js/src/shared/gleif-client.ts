// ================= GLEIF API CLIENT =================
// Thin wrapper around the public GLEIF Global LEI Index API.
// Public, no auth required. Rate limit: 60 requests / minute.

const GLEIF_BASE_URL = "https://api.gleif.org/api/v1";

export interface GleifLookupResult {
  found:        boolean;
  http_status:  number;
  source:       "GLEIF Global LEI Index";
  citation:     string;
  fetched_at:   string;
  response:     any;
  error?:       string;
}

function nowISO(): string {
  return new Date().toISOString();
}

async function gleifGET(url: string, timeoutMs = 8000): Promise<{
  http_status: number;
  body:        any;
  error?:      string;
}> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "Accept": "application/vnd.api+json" },
      signal:  controller.signal,
    });
    clearTimeout(tid);
    const status = resp.status;
    let body: any = null;
    try { body = await resp.json(); } catch { body = null; }
    return { http_status: status, body };
  } catch (err: any) {
    clearTimeout(tid);
    return {
      http_status: 0,
      body:        null,
      error:       err?.name === "AbortError" ? "GLEIF request timed out" : (err?.message ?? String(err)),
    };
  }
}

export async function lookupByLEI(lei: string): Promise<GleifLookupResult> {
  const url = `${GLEIF_BASE_URL}/lei-records/${encodeURIComponent(lei)}`;
  const { http_status, body, error } = await gleifGET(url);
  return {
    found:       http_status === 200 && body?.data != null,
    http_status,
    source:      "GLEIF Global LEI Index",
    citation:    url,
    fetched_at:  nowISO(),
    response:    body,
    ...(error ? { error } : {}),
  };
}

export async function searchByName(
  legalName: string,
  country?:  string
): Promise<GleifLookupResult> {
  const params = new URLSearchParams();
  params.set("filter[entity.legalName]", legalName);
  if (country) params.set("filter[entity.legalAddress.country]", country.toUpperCase());
  params.set("page[size]", "5");
  const url = `${GLEIF_BASE_URL}/lei-records?${params.toString()}`;
  const { http_status, body, error } = await gleifGET(url);
  const recordCount = Array.isArray(body?.data) ? body.data.length : 0;
  return {
    found:       http_status === 200 && recordCount > 0,
    http_status,
    source:      "GLEIF Global LEI Index",
    citation:    url,
    fetched_at:  nowISO(),
    response:    body,
    ...(error ? { error } : {}),
  };
}