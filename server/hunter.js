const HUNTER_ROOT = "https://api.hunter.io/v2";

export async function hunterDomainSearch({ apiKey, domain, department = "marketing", limit = 5 }) {
  if (!apiKey) throw new Error("Contact lookup is not configured.");
  const params = new URLSearchParams({
    domain,
    api_key: apiKey,
    department,
    limit: String(Math.min(Number(limit) || 5, 10)),
  });

  const response = await fetch(`${HUNTER_ROOT}/domain-search?${params.toString()}`, {
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.errors?.[0]?.details || data?.errors?.[0]?.id || "Contact lookup failed.";
    throw new Error(typeof message === "string" ? message : "Contact lookup failed.");
  }

  const emails = data?.data?.emails || [];
  return emails.map(normalizeHunterEmail);
}

export function pickMarketingContact(emails) {
  if (!emails?.length) return null;
  const scored = emails
    .filter((row) => row.email && row.type !== "generic")
    .map((row) => ({ row, score: scoreMarketingContact(row) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length) return scored[0].row;
  const generic = emails.find((row) => row.email);
  return generic || null;
}

function scoreMarketingContact(row) {
  let score = 0;
  const title = String(row.position || row.job_title || "").toLowerCase();
  const dept = String(row.department || "").toLowerCase();
  if (dept.includes("marketing") || dept.includes("communication")) score += 40;
  if (/marketing|content|seo|growth|brand|digital|communications|editor|partnership|outreach/.test(title)) {
    score += 35;
  }
  if (/head|director|vp|vice president|chief|lead|manager/.test(title)) score += 15;
  if (row.confidence != null) score += Math.min(Number(row.confidence) || 0, 30);
  if (row.type === "personal") score += 10;
  return score;
}

function normalizeHunterEmail(row) {
  return {
    email: row.value || row.email || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    position: row.position || "",
    department: row.department || "",
    type: row.type || "",
    confidence: row.confidence ?? null,
  };
}

export async function hunterDiscover({ apiKey, body }) {
  if (!apiKey) throw new Error("Contact lookup is not configured.");
  const params = new URLSearchParams({ api_key: apiKey });
  const response = await fetch(`${HUNTER_ROOT}/discover?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data?.errors?.[0]?.id || "";
    const details = data?.errors?.[0]?.details || "";
    if (code === "no_discover_access") {
      throw new Error("Company discovery is not enabled on your Hunter plan.");
    }
    throw new Error(typeof details === "string" && details ? details : "Company discovery failed.");
  }
  return {
    companies: Array.isArray(data?.data) ? data.data : [],
    meta: data?.meta || {},
  };
}

export async function hunterMultiDomainSearch({ apiKey, filters, limit = 25, searchAfter }) {
  if (!apiKey) throw new Error("Contact lookup is not configured.");
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(Math.min(Math.max(Number(limit) || 25, 1), 100)),
  });
  if (searchAfter) params.set("search_after", String(searchAfter));

  for (const [key, value] of Object.entries(filters || {})) {
    if (value == null || value === "") continue;
    if (typeof value === "boolean") {
      if (value) params.set(key, "true");
      continue;
    }
    params.set(key, String(value));
  }

  const response = await fetch(`${HUNTER_ROOT}/multi-domain-search?${params.toString()}`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.errors?.[0]?.details || data?.errors?.[0]?.id || "Lead search failed.";
    throw new Error(typeof details === "string" ? details : "Lead search failed.");
  }
  return {
    rows: Array.isArray(data?.data) ? data.data : [],
    meta: data?.meta || {},
  };
}

export async function hunterMultiDomainReveal({ apiKey, handles }) {
  if (!apiKey) throw new Error("Contact lookup is not configured.");
  const list = (handles || []).filter(Boolean).slice(0, 100);
  if (!list.length) return { rows: [], meta: {} };

  const params = new URLSearchParams({ api_key: apiKey });
  const response = await fetch(`${HUNTER_ROOT}/multi-domain-search/reveal?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handles: list }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.errors?.[0]?.details || data?.errors?.[0]?.id || "Email reveal failed.";
    throw new Error(typeof details === "string" ? details : "Email reveal failed.");
  }
  return {
    rows: Array.isArray(data?.data) ? data.data : [],
    meta: data?.meta || {},
  };
}

export function pickIcpLeadRows(rows, max = 18) {
  if (!rows?.length) return [];
  const scored = rows
    .map((row) => ({ row, score: scoreIcpLeadRow(row) }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const seenDomain = new Set();
  for (const { row } of scored) {
    const domain = String(row.domain || "").toLowerCase();
    if (domain && seenDomain.has(domain)) continue;
    if (domain) seenDomain.add(domain);
    picked.push(row);
    if (picked.length >= max) break;
  }
  return picked;
}

function scoreIcpLeadRow(row) {
  let score = 0;
  if (row.decision_maker) score += 40;
  if (row.seniority === "executive") score += 30;
  else if (row.seniority === "senior") score += 18;
  if (row.type === "personal") score += 25;
  if (row.provenance === "found") score += 10;
  const status = row.verification?.status;
  if (status === "valid") score += 15;
  else if (status === "accept_all") score += 5;
  if (row.full_name_exists) score += 5;
  if (row.linkedin_exists) score += 3;
  return score;
}
