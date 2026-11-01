import { readJson } from "./readJson.js";
import {
  hunterDiscover,
  hunterMultiDomainReveal,
  hunterMultiDomainSearch,
  pickIcpLeadRows,
} from "./hunter.js";
import { modelForEffortTier } from "./modelRouter.js";

const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const MIN_ICP_CHARS = 55;
const MAX_COMPANIES = 25;
const MAX_LEADS_REVEAL = 18;

export function attachB2bLeadFinder(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/b2b-lead-finder") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      if (!ctx?.hunterApiKey) throw new Error("Lead lookup is not available for this workspace yet.");
      if (!ctx?.apiKey) throw new Error("Lead analysis is not available for this workspace yet.");
      if (stream) {
        await streamB2bLeadJob(bodyFromReq(req), res, ctx);
        return;
      }
      const body = await readJson(req);
      const content = await runB2bLeadFinderJob(body, () => {}, ctx);
      sendJson(res, 200, { content });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: sanitizeError(error.message) });
        res.end();
        return;
      }
      sendJson(res, 500, { error: sanitizeError(error.message) });
    }
  });
}

async function streamB2bLeadJob(bodyPromise, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const body = await bodyPromise;
    const content = await runB2bLeadFinderJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

function bodyFromReq(req) {
  return readJson(req);
}

export async function runB2bLeadFinderJob(body, onProgress, ctx) {
  const icpText = parseIcpBrief(body.message);
  if (!icpText || icpText.length < MIN_ICP_CHARS) {
    throw new Error(
      `Describe your ideal customer in more detail (at least ${MIN_ICP_CHARS} characters): industry, geography, company size, target job titles, and buying signals.`,
    );
  }

  onProgress?.({
    type: "progress",
    phase: "b2b_lead_finder",
    stage: "icp",
    message: "Reading your ICP",
  });

  const icpPlan = await analyzeIcpWithClaude(icpText, ctx);
  if (!icpPlan?.quality_ok) {
    throw new Error(
      icpPlan?.quality_hint ||
        "Add more detail to your ICP: industry, regions, company size, who you sell to (titles/departments), and any tech or firmographic filters.",
    );
  }

  const discoverQuery =
    String(icpPlan.hunter_discover_query || icpText).trim().slice(0, 500) ||
    icpText.slice(0, 500);

  onProgress?.({
    type: "progress",
    phase: "b2b_lead_finder",
    stage: "discover",
    message: "Finding matching companies",
  });

  let companies = [];
  let discoverMeta = {};
  try {
    const discover = await hunterDiscover({
      apiKey: ctx.hunterApiKey,
      body: { query: discoverQuery, limit: MAX_COMPANIES },
    });
    companies = discover.companies;
    discoverMeta = discover.meta;
  } catch (error) {
    if (/not enabled|no_discover|discover/i.test(error.message)) throw error;
    throw new Error("Could not match companies to this ICP. Try adding clearer industry and location details.");
  }

  const domains = [
    ...new Set(
      companies
        .map((row) => String(row.domain || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_COMPANIES);

  if (!domains.length) {
    throw new Error(
      "No companies matched this ICP. Broaden geography or company size, or add alternative industries in your description.",
    );
  }

  onProgress?.({
    type: "progress",
    phase: "b2b_lead_finder",
    stage: "people",
    message: "Searching for decision-makers",
  });

  const filters = buildMultiDomainFilters(domains, icpPlan.contact_filters);
  let maskedRows = [];
  try {
    const search = await hunterMultiDomainSearch({
      apiKey: ctx.hunterApiKey,
      filters,
      limit: 40,
    });
    maskedRows = search.rows;
  } catch (error) {
    throw new Error(
      error.message?.includes("wrong_params")
        ? "Could not apply contact filters. Try naming specific job titles in your ICP."
        : error.message || "Lead search failed for these companies.",
    );
  }

  const candidates = pickIcpLeadRows(maskedRows, MAX_LEADS_REVEAL);
  if (!candidates.length) {
    return formatB2bLeadReply({
      icpSummary: icpPlan.icp_summary || icpText.slice(0, 120),
      discoverQuery,
      companyCount: domains.length,
      matchCount: discoverMeta?.results ?? domains.length,
      leads: [],
      note: "Companies matched your ICP, but no contacts matched your title filters. Add alternate job titles or seniority levels in your ICP and try again.",
    });
  }

  onProgress?.({
    type: "progress",
    phase: "b2b_lead_finder",
    stage: "reveal",
    message: "Revealing verified emails",
  });

  const handles = candidates.map((row) => row.reveal_handle).filter(Boolean);
  let revealed = [];
  try {
    const reveal = await hunterMultiDomainReveal({ apiKey: ctx.hunterApiKey, handles });
    revealed = reveal.rows;
  } catch (error) {
    if (/credit|429/i.test(error.message)) {
      throw new Error("Not enough Hunter credits to reveal emails for this batch. Reduce scope or top up credits.");
    }
    throw error;
  }

  const revealByHandle = new Map(
    revealed.map((row) => [row.reveal_handle, row]),
  );

  const leads = candidates.map((row) => {
    const unlocked = revealByHandle.get(row.reveal_handle);
    const first = unlocked?.first_name || "";
    const last = unlocked?.last_name || "";
    const name =
      [first, last].filter(Boolean).join(" ") ||
      String(row.name || "").trim() ||
      "—";
    return {
      company: row.company_name || row.domain || "—",
      domain: row.domain || "—",
      name,
      title: unlocked?.position || row.position || "—",
      email: unlocked?.email || "—",
      linkedin: unlocked?.linkedin_url || "—",
      seniority: row.seniority || "—",
      department: row.department || "—",
      verification: row.verification?.status || unlocked?.verification?.status || "—",
    };
  });

  return formatB2bLeadReply({
    icpSummary: icpPlan.icp_summary || icpText.slice(0, 120),
    discoverQuery,
    companyCount: domains.length,
    matchCount: discoverMeta?.results ?? domains.length,
    leads,
  });
}

function buildMultiDomainFilters(domains, contactFilters) {
  const filters = {
    domain: domains.join(","),
    type: "personal",
  };

  const titles = (contactFilters?.job_titles || [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 8);
  if (titles.length) filters.job_title = titles.join(",");

  const departments = (contactFilters?.departments || [])
    .map((d) => String(d).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
  if (departments.length) filters.department = departments.join(",");

  const seniority = (contactFilters?.seniority || [])
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => ["junior", "senior", "executive"].includes(s))
    .slice(0, 3);
  if (seniority.length) filters.seniority = seniority.join(",");

  if (contactFilters?.decision_maker) filters.decision_maker = true;

  const locations = (contactFilters?.countries || [])
    .map((c) => String(c).trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
    .slice(0, 5);
  if (locations.length) filters.location = locations.join(",");

  return filters;
}

async function analyzeIcpWithClaude(icpText, ctx) {
  const system = `You are Blazly's B2B Lead Finder. Parse the user's ideal customer profile (ICP) for Hunter.io company discovery and contact filters.

Return JSON only:
{
  "icp_summary": "one sentence summary",
  "hunter_discover_query": "natural language query for Hunter Discover, e.g. B2B SaaS companies in the United States with 51-200 employees in financial services selling marketing software",
  "contact_filters": {
    "job_titles": ["VP Sales","Head of Marketing"],
    "departments": ["sales","marketing","executive"],
    "seniority": ["executive","senior"],
    "decision_maker": true,
    "countries": ["US"]
  },
  "quality_ok": true,
  "quality_hint": ""
}

Set quality_ok to false if the ICP is too vague (missing industry AND geography AND who to contact). When false, quality_hint must tell the user what to add.
departments must use Hunter values when possible: executive, sales, marketing, finance, hr, operations, product, it, management, support, legal, communication, design, research, consulting, administrative, procurement, education, health.
seniority: junior, senior, executive.`;

  const parsed = await claudeJson(
    ctx,
    `ICP from user:\n\n${icpText.slice(0, 8000)}`,
    system,
  );
  if (!parsed || typeof parsed !== "object") {
    return {
      quality_ok: icpText.length >= MIN_ICP_CHARS,
      hunter_discover_query: icpText,
      contact_filters: defaultContactFilters(),
      icp_summary: icpText.slice(0, 160),
    };
  }
  return {
    icp_summary: String(parsed.icp_summary || "").trim(),
    hunter_discover_query: String(parsed.hunter_discover_query || icpText).trim(),
    contact_filters: {
      ...defaultContactFilters(),
      ...(parsed.contact_filters && typeof parsed.contact_filters === "object" ? parsed.contact_filters : {}),
    },
    quality_ok: parsed.quality_ok !== false,
    quality_hint: String(parsed.quality_hint || "").trim(),
  };
}

function defaultContactFilters() {
  return {
    job_titles: ["VP", "Director", "Head"],
    departments: ["sales", "marketing", "executive"],
    seniority: ["executive", "senior"],
    decision_maker: true,
    countries: [],
  };
}

async function claudeJson(ctx, userContent, systemOverride) {
  const model = modelForEffortTier("max").model || CLAUDE_MODEL();
  const system = systemOverride || "Reply with JSON only, no markdown fences.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ctx.apiKey,
      "anthropic-version": "2023-06-01",
      ...(ctx.workspaceId ? { "anthropic-workspace-id": ctx.workspaceId } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "ICP analysis failed.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return extractJson(text);
}

function formatB2bLeadReply({ icpSummary, discoverQuery, companyCount, matchCount, leads, note }) {
  const lines = [];
  lines.push(
    "B2B leads matched to your ICP via company discovery and verified business emails (Hunter). Use thoughtful, personalized outreach—reference their role and why your offer fits their stack.",
  );
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`ICP summary|${icpSummary.replace(/\|/g, "/")}`);
  lines.push(`Discovery query|${discoverQuery.replace(/\|/g, "/")}`);
  lines.push(`Companies in this batch|${companyCount}`);
  lines.push(`Total companies matching filters|${matchCount}`);
  lines.push(`Leads with email|${leads.filter((row) => row.email && row.email !== "—").length}`);
  lines.push("METRICS_END");
  lines.push("");
  if (note) {
    lines.push(note);
    lines.push("");
  }
  if (leads.length) {
    lines.push("TABLE_START");
    lines.push("Company|Domain|Contact|Title|Email|LinkedIn|Seniority");
    for (const row of leads) {
      lines.push(
        `${row.company.replace(/\|/g, "/")}|${row.domain}|${row.name.replace(/\|/g, "/")}|${row.title.replace(/\|/g, "/")}|${row.email}|${row.linkedin}|${row.seniority}`,
      );
    }
    lines.push("TABLE_END");
  }
  return lines.join("\n");
}

function parseIcpBrief(message) {
  const raw = String(message || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const labelRe = /^ideal customer profile\s*\(\s*icp\s*\)\s*:\s*/i;
  const shortLabelRe = /^icp\s*:\s*/i;

  if (labelRe.test(raw) || shortLabelRe.test(raw)) {
    const withoutLabel = raw
      .replace(labelRe, "")
      .replace(shortLabelRe, "")
      .trim();
    return withoutLabel.replace(/^\s*\n+/, "").trim();
  }

  const lines = raw.split("\n");
  let inIcp = false;
  const parts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^ideal customer profile\s*\(\s*icp\s*\)\s*:/i.test(trimmed) || /^icp\s*:/i.test(trimmed)) {
      inIcp = true;
      const rest = trimmed.replace(/^ideal customer profile\s*\(\s*icp\s*\)\s*:/i, "").replace(/^icp\s*:/i, "");
      if (rest.trim()) parts.push(rest.trim());
      continue;
    }
    if (inIcp) parts.push(line);
  }
  if (parts.length) return parts.join("\n").trim();

  return raw;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeError(message) {
  return String(message || "B2B lead finder failed.")
    .replace(/hunter\.io|hunter/gi, "provider")
    .replace(/anthropic|claude/gi, "assistant");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
