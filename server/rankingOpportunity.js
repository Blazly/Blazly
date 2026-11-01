import { readJson } from "./readJson.js";
import {
  executeDataForSeoTool,
  normalizeDomain,
} from "./dataforseo.js";
import { modelForEffortTier } from "./modelRouter.js";

const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";

export function attachRankingOpportunityFinder(server, { apiKey, workspaceId, dataForSeo }) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/ranking-opportunities") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!apiKey) throw new Error("The assistant is not configured.");
      if (!dataForSeo?.login || !dataForSeo?.password) {
        throw new Error("Keyword research is not available for this workspace yet.");
      }
      if (stream) {
        await streamRankingJob(body, res, { apiKey, workspaceId, dataForSeo });
        return;
      }
      const content = await runRankingOpportunityJob(body, () => {}, { apiKey, workspaceId, dataForSeo });
      sendJson(res, 200, { content });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: error.message || "Ranking analysis failed." });
        res.end();
        return;
      }
      sendJson(res, 500, { error: error.message || "Ranking analysis failed." });
    }
  });
}

async function streamRankingJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runRankingOpportunityJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: error.message || "Ranking analysis failed." });
    res.end();
  }
}

export async function runRankingOpportunityJob(body, onProgress, { apiKey, workspaceId, dataForSeo }) {
  const parsed = parseRankingFinderBrief(body.message);
  const website = String(body.website || parsed.website || "").trim();
  const targetKeyword = String(body.targetKeyword || parsed.targetKeyword || "").trim();
  const domain = normalizeDomain(website);
  const knowledge = body.knowledge && typeof body.knowledge === "object" ? body.knowledge : null;
  const userMessage = String(body.message || "").trim();
  const brandName =
    knowledge?.companyName || body.brandName || (domain ? domain.replace(/\..*$/, "") : "Your site");

  if (!domain) {
    throw new Error("Enter your website URL in the composer (Website URL:) so we can score winnable keywords.");
  }

  if (!targetKeyword) {
    throw new Error("Enter a target keyword in the composer (Target keyword:) to seed opportunity research.");
  }

  onProgress?.({
    type: "progress",
    phase: "ranking",
    stage: "seeds",
    message: `Building ideas around “${targetKeyword.slice(0, 48)}”`,
  });

  const seeds = deriveSeeds(knowledge, userMessage, domain, targetKeyword);
  if (!seeds.length) {
    throw new Error("Could not build keyword seeds from your target keyword. Try a more specific phrase.");
  }

  onProgress?.({
    type: "progress",
    phase: "ranking",
    stage: "backlinks",
    message: `Checking authority for ${domain}`,
  });

  let domainProfile = { target: domain, rank: null, referring_domains: null };
  try {
    const backlinkRaw = await executeDataForSeoTool(
      "dataforseo_backlinks_summary_live",
      { target: domain },
      dataForSeo,
    );
    domainProfile = { ...domainProfile, ...JSON.parse(backlinkRaw) };
  } catch {
    domainProfile.note = "Backlink summary unavailable; using conservative winnability estimates.";
  }

  const candidates = new Map();

  for (const seed of seeds) {
    onProgress?.({
      type: "progress",
      phase: "ranking",
      stage: "keywords",
      message: `Finding long-tail ideas for “${seed.slice(0, 48)}”`,
    });
    try {
      const raw = await executeDataForSeoTool(
        "dataforseo_labs_keyword_suggestions_live",
        { keyword: seed, limit: 40 },
        dataForSeo,
      );
      const parsed = JSON.parse(raw);
      for (const item of parsed.suggestions || []) {
        const keyword = String(item.keyword || "").trim();
        if (!keyword || keyword.length < 4) continue;
        const key = keyword.toLowerCase();
        if (candidates.has(key)) continue;
        candidates.set(key, {
          keyword,
          search_volume: item.search_volume ?? null,
          competition: item.competition ?? null,
          seed,
        });
      }
    } catch {
      // continue other seeds
    }
  }

  if (!candidates.size) {
    throw new Error("No keyword ideas came back for your topics. Try a more specific niche in your message.");
  }

  const keywordList = [...candidates.values()].slice(0, 45);
  const needsVolume = keywordList.filter((k) => k.search_volume == null).map((k) => k.keyword);

  if (needsVolume.length) {
    onProgress?.({
      type: "progress",
      phase: "ranking",
      stage: "volume",
      message: "Pulling search volume and competition",
    });
    try {
      const volRaw = await executeDataForSeoTool(
        "dataforseo_keywords_search_volume_live",
        { keywords: needsVolume.slice(0, 20) },
        dataForSeo,
      );
      const volParsed = JSON.parse(volRaw);
      for (const row of volParsed.keywords || []) {
        const key = String(row.keyword || "").toLowerCase();
        const entry = candidates.get(key);
        if (!entry) continue;
        entry.search_volume = row.search_volume ?? entry.search_volume;
        entry.competition_index = row.competition_index;
        entry.competition = row.competition ?? entry.competition;
        entry.cpc = row.cpc;
      }
    } catch {
      // proceed with partial data
    }
  }

  const scored = keywordList
    .map((k) => ({ ...k, opportunity_score: scoreKeywordOpportunity(k, domainProfile.rank) }))
    .filter((k) => (k.search_volume || 0) >= 20 || k.opportunity_score > 0)
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 24);

  const serpInsights = [];
  for (const item of scored.slice(0, 6)) {
    onProgress?.({
      type: "progress",
      phase: "ranking",
      stage: "serp",
      message: `Reviewing SERP difficulty for “${item.keyword.slice(0, 40)}”`,
    });
    try {
      const serpRaw = await executeDataForSeoTool(
        "dataforseo_serp_google_organic_live",
        { keyword: item.keyword, depth: 10, target: domain },
        dataForSeo,
      );
      const serp = JSON.parse(serpRaw);
      serpInsights.push({
        keyword: item.keyword,
        weakness: serpWeakness(serp),
        site_already_ranks: Boolean(
          (serp.organic || []).some((row) => normalizeDomain(row.domain) === domain),
        ),
        top_domains: (serp.organic || []).slice(0, 5).map((row) => row.domain),
      });
    } catch {
      serpInsights.push({ keyword: item.keyword, weakness: "unknown" });
    }
  }

  onProgress?.({
    type: "progress",
    phase: "ranking",
    stage: "synthesis",
    message: "Building your opportunity list",
  });

  const reply = await synthesizeWithClaude(
    {
      brandName,
      domain,
      website,
      userMessage,
      targetKeyword,
      knowledge,
      seeds,
      domainProfile,
      keywords: scored,
      serpInsights,
    },
    { apiKey, workspaceId },
  );

  return reply;
}

function parseRankingFinderBrief(text) {
  const raw = String(text || "").trim();
  let website = "";
  let targetKeyword = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const urlMatch = trimmed.match(/^website\s*url\s*:\s*(.*)$/i);
    if (urlMatch) {
      website = urlMatch[1].trim();
      continue;
    }
    const kwMatch =
      trimmed.match(/^target\s*keyword\s*:\s*(.+)$/i) ||
      trimmed.match(/^keyword\s*:\s*(.+)$/i);
    if (kwMatch) targetKeyword = kwMatch[1].trim();
  }
  if (!website) {
    const urlInText = raw.match(/https?:\/\/[^\s<>"']+/i);
    if (urlInText) website = urlInText[0];
  }
  return { website, targetKeyword };
}

function isRankingBriefMessage(text) {
  return /^website\s*url\s*:/im.test(String(text || "")) || /^target\s*keyword\s*:/im.test(String(text || ""));
}

function deriveSeeds(knowledge, userMessage, domain, targetKeyword) {
  const seeds = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (text.length < 3 || text.length > 80) return;
    seeds.add(text);
  };

  if (targetKeyword) add(targetKeyword);

  if (
    userMessage &&
    userMessage.length > 8 &&
    !/^https?:\/\//i.test(userMessage) &&
    !isRankingBriefMessage(userMessage)
  ) {
    const focus = userMessage.split("\n")[0].trim().slice(0, 80);
    add(focus);
  }

  if (knowledge) {
    add(knowledge.industry);
    add(knowledge.companyName);
    if (Array.isArray(knowledge.services)) knowledge.services.slice(0, 4).forEach(add);
    if (Array.isArray(knowledge.products)) knowledge.products.slice(0, 3).forEach(add);
    if (Array.isArray(knowledge.targetAudiences)) knowledge.targetAudiences.slice(0, 2).forEach(add);
    const desc = String(knowledge.description || "")
      .split(/[.!?]/)
      .map((s) => s.trim())
      .find((s) => s.length > 12 && s.length < 70);
    if (desc) add(desc);
  }

  if (!seeds.size && domain) {
    const base = domain.replace(/^www\./, "").split(".")[0];
    if (base.length > 2) add(base.replace(/-/g, " "));
  }

  return [...seeds].slice(0, 5);
}

function scoreKeywordOpportunity(keyword, domainRank) {
  const volume = Number(keyword.search_volume) || 0;
  const compIndex =
    keyword.competition_index != null
      ? Number(keyword.competition_index)
      : competitionToIndex(keyword.competition);
  const ease = Math.max(0.15, (100 - Math.min(compIndex, 100)) / 100);
  const rank = Number(domainRank) || 0;
  const authorityFactor = rank <= 0 ? 0.85 : rank < 250 ? 0.75 : rank < 450 ? 1 : rank < 650 ? 1.15 : 1.3;
  const longTailBonus = keyword.keyword.split(/\s+/).length >= 4 ? 1.2 : 1;
  return Math.round(volume * ease * authorityFactor * longTailBonus);
}

function competitionToIndex(label) {
  const value = String(label || "").toUpperCase();
  if (value === "LOW") return 25;
  if (value === "MEDIUM") return 55;
  if (value === "HIGH") return 85;
  return 50;
}

function serpWeakness(serp) {
  const organic = serp?.organic || [];
  if (!organic.length) return "unknown";
  const weakHosts =
    /reddit\.|quora\.|youtube\.|facebook\.|pinterest\.|medium\.com|linkedin\.com\/pulse|wordpress\.com|blogspot|tiktok\.|instagram\./i;
  const weakCount = organic.filter((row) => weakHosts.test(row.url || row.domain || "")).length;
  if (weakCount >= 3) return "high";
  if (weakCount >= 1) return "medium";
  return "low";
}

async function synthesizeWithClaude(payload, { apiKey, workspaceId }) {
  const route = modelForEffortTier("max");
  const model = route.model || CLAUDE_MODEL();

  const system = `You are Blazly's Ranking Opportunity Finder. You combine live keyword and SERP data with the brand's subject-matter expertise to recommend keywords they can realistically rank for soon.

Never mention DataForSEO, Claude, Anthropic, or other vendors in user-facing text.

Rules:
- Only recommend keywords that appear in the provided keyword dataset OR are tight long-tail variants of those seeds (do not invent high-volume keywords without data).
- Prioritize conversational, long-tail, question-style queries aligned with the brand's expertise.
- Suggested blog titles must be specific, click-worthy, and match search intent.
- Do not include estimated traffic or click forecasts; only show monthly search volume from the data.
- Include 8–15 rows in the table (best opportunities first).
- Winability: Low / Medium / Medium-high based on competition, SERP weakness, and domain authority data.

Output format (exactly):
1) Short intro paragraph (2–3 sentences).
2) METRICS_START block with: Website|domain, Domain rank|value or "unknown", Seeds used|comma list METRICS_END
3) TABLE_START with header row:
Keyword|Suggested blog title|Monthly searches|Winability
Then one row per opportunity. TABLE_END
4) One short closing paragraph on what to publish first.

No markdown tables. Use the TABLE_START/TABLE_END pipe format only.`;

  const userContent = JSON.stringify(payload, null, 2).slice(0, 48000);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(300_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "Could not analyze ranking opportunities.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Ranking analysis returned empty results.");
  return text;
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
