const API_ROOT = "https://api.dataforseo.com";

export const DATAFORSEO_TOOL_DEFINITIONS = [
  {
    name: "dataforseo_serp_google_organic_live",
    description:
      "Live Google organic SERP (POST /v3/serp/google/organic/live/advanced). Use for rankings, SERP features, competitors, and who ranks for a keyword.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Search query (required)." },
        location_code: { type: "integer", description: "DataForSEO location_code (e.g. 2356)." },
        language_code: { type: "string", description: "Language code (e.g. en)." },
        depth: { type: "integer", description: "Number of organic results (default 10, max 200)." },
        device: { type: "string", enum: ["desktop", "mobile"] },
        target: { type: "string", description: "Optional domain to highlight in results (no https/www)." },
      },
      required: ["keyword"],
    },
  },
  {
    name: "dataforseo_keywords_search_volume_live",
    description:
      "Google Ads search volume live (POST /v3/keywords_data/google_ads/search_volume/live). Use for volume, CPC, competition.",
    input_schema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Up to 1000 keywords.",
        },
        location_code: { type: "integer" },
        language_code: { type: "string" },
      },
      required: ["keywords"],
    },
  },
  {
    name: "dataforseo_labs_keyword_suggestions_live",
    description:
      "Keyword suggestions live (POST /v3/dataforseo_labs/google/keyword_suggestions/live). Use for related/long-tail keyword ideas.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Seed keyword." },
        location_code: { type: "integer" },
        language_code: { type: "string" },
        limit: { type: "integer", description: "Max suggestions (default 25)." },
      },
      required: ["keyword"],
    },
  },
  {
    name: "dataforseo_backlinks_summary_live",
    description:
      "Backlinks summary (POST /v3/backlinks/summary/live). Domain rank (0-1000 scale), backlink counts, referring domains, spam scores.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Domain or URL (domain without https/www)." },
        include_subdomains: { type: "boolean" },
        backlinks_status_type: { type: "string", enum: ["live", "all", "lost"] },
      },
      required: ["target"],
    },
  },
  {
    name: "dataforseo_backlinks_referring_domains_live",
    description:
      "Referring domains list (POST /v3/backlinks/referring_domains/live). Top domains linking to target with ranks and backlink counts.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Domain or URL." },
        limit: { type: "integer", description: "Max domains (default 20)." },
        order_by: { type: "array", items: { type: "string" } },
      },
      required: ["target"],
    },
  },
  {
    name: "dataforseo_ai_llm_mentions_live",
    description:
      "AI Optimization LLM mentions (POST /v3/ai_optimization/llm_mentions/search_mentions/live). AI search volume, ChatGPT/Google AI mentions, citations, GEO/AEO visibility.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Keyword entity to search in AI answers." },
        domain: { type: "string", description: "Optional domain entity (include/exclude brand citations)." },
        platform: { type: "string", enum: ["google", "chat_gpt"] },
        location_code: { type: "integer" },
        language_code: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
  },
];

const TOOL_ROUTES = {
  dataforseo_serp_google_organic_live: "/v3/serp/google/organic/live/advanced",
  dataforseo_keywords_search_volume_live: "/v3/keywords_data/google_ads/search_volume/live",
  dataforseo_labs_keyword_suggestions_live: "/v3/dataforseo_labs/google/keyword_suggestions/live",
  dataforseo_backlinks_summary_live: "/v3/backlinks/summary/live",
  dataforseo_backlinks_referring_domains_live: "/v3/backlinks/referring_domains/live",
  dataforseo_ai_llm_mentions_live: "/v3/ai_optimization/llm_mentions/search_mentions/live",
};

export function needsSeoData(text) {
  const source = String(text || "");
  return /seo|geo|aeo|serp|search\s+volu?m|volu?mne|traffic\s+volu?m|search\s+traffic|monthly\s+traffic|keyword|ranking|rank for|google results|organic results|competition|cpc|people also ask|featured snippet|long.?tail|backlink|referring domain|domain authority|domain rank|who ranks|competitor|search volume|keyword research|keyword difficulty|domain rating|monthly searches|how many searches|how much traffic|traffic for|discoverability|ai discoverability|llm mention|ai overview|chatgpt|generative engine|search demand|searchers?|queries per month/i.test(
    source
  );
}

export function normalizeDomain(value) {
  let domain = String(value || "").trim().toLowerCase();
  if (!domain) return "";
  domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0];
  if (!domain || !domain.includes(".")) return "";
  return domain;
}

/** Domains the user typed in the message (URLs or bare hostnames). */
export function extractDomainsFromMessage(text) {
  const domains = new Set();
  const source = String(text || "");
  for (const match of source.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})\b/gi)) {
    const domain = normalizeDomain(match[1]);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

function extractDomains(text, website) {
  const explicit = extractDomainsFromMessage(text);
  if (explicit.length) return explicit.slice(0, 3);

  const source = String(text || "");
  const domains = new Set();
  const includeWorkspaceSite =
    website &&
    (looksLikeProjectSiteReference(source) ||
      (looksLikeDomainMetricsQuestion(source) &&
        /\b(my|our)\s+(site|website|domain)\b/i.test(source)));
  if (includeWorkspaceSite) {
    const normalized = normalizeDomain(website);
    if (normalized) domains.add(normalized);
  }
  return [...domains].slice(0, 3);
}

function cleanKeywordPhrase(phrase) {
  return String(phrase || "")
    .replace(/\s+\b(keyword|term|query|phrase)\s*$/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripIntentWords(phrase) {
  return cleanKeywordPhrase(
    phrase
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/\b(for|on|in)\s+(google|bing|us|uk|india)\b.*$/i, "")
      .trim()
  );
}

export function messagePlainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
}

function authHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${token}`;
}

function withLocale(input, config) {
  const task = { ...input };
  if (task.location_code == null) task.location_code = Number(config.locationCode) || 2356;
  if (!task.language_code) task.language_code = config.languageCode || "en";
  return task;
}

export async function dataforseoPost({ login, password, path, tasks }) {
  const timeoutMs = path.includes("ai_optimization") ? 150000 : 120000;
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(login, password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tasks),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.status_message || data?.error?.message || `DataForSEO HTTP ${response.status}`;
    throw new Error(message);
  }
  if (data.status_code && data.status_code !== 20000) {
    throw new Error(data.status_message || "DataForSEO request failed.");
  }
  return data;
}

export async function executeDataForSeoTool(name, input, config) {
  const path = TOOL_ROUTES[name];
  if (!path) throw new Error(`Unknown DataForSEO tool: ${name}`);

  let task;
  if (name === "dataforseo_serp_google_organic_live") {
    task = withLocale(
      {
        keyword: String(input.keyword || "").trim(),
        depth: Math.min(Number(input.depth) || 10, 20),
        device: input.device === "mobile" ? "mobile" : "desktop",
        ...(input.target ? { target: String(input.target).replace(/^https?:\/\//, "").replace(/^www\./, "") } : {}),
      },
      config
    );
  } else if (name === "dataforseo_keywords_search_volume_live") {
    const keywords = (Array.isArray(input.keywords) ? input.keywords : [])
      .map((k) => String(k || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!keywords.length) throw new Error("keywords array is required.");
    task = withLocale({ keywords }, config);
  } else if (name === "dataforseo_labs_keyword_suggestions_live") {
    task = withLocale(
      {
        keyword: String(input.keyword || "").trim(),
        limit: Math.min(Number(input.limit) || 25, 50),
      },
      config
    );
  } else if (name === "dataforseo_backlinks_summary_live") {
    const target = normalizeDomain(input.target);
    if (!target) throw new Error("target domain is required.");
    task = {
      target,
      include_subdomains: input.include_subdomains !== false,
      backlinks_status_type: input.backlinks_status_type || "live",
      rank_scale: "one_thousand",
    };
  } else if (name === "dataforseo_backlinks_referring_domains_live") {
    const target = normalizeDomain(input.target);
    if (!target) throw new Error("target domain is required.");
    task = {
      target,
      limit: Math.min(Number(input.limit) || 20, 50),
      order_by: Array.isArray(input.order_by) ? input.order_by : ["rank,desc"],
      include_subdomains: true,
      backlinks_status_type: "live",
      rank_scale: "one_thousand",
    };
  } else if (name === "dataforseo_ai_llm_mentions_live") {
    const target = [];
    const keyword = stripIntentWords(String(input.keyword || "").trim());
    const domain = normalizeDomain(input.domain);
    if (keyword) {
      target.push({ keyword, search_filter: "include", match_type: "word_match", search_scope: ["any"] });
    }
    if (domain) {
      target.push({ domain, search_filter: "include", search_scope: ["any"] });
    }
    if (!target.length) throw new Error("keyword or domain is required for AI mentions.");
    task = withLocale({
      target,
      limit: Math.min(Number(input.limit) || 15, 30),
      ...(input.platform ? { platform: input.platform } : {}),
    });
  }

  if (
    !task?.keyword &&
    !task?.keywords?.length &&
    !task?.target &&
    !(Array.isArray(task?.target) && task.target.length)
  ) {
    throw new Error("DataForSEO task missing required fields.");
  }

  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path,
    tasks: [task],
  });

  return summarizeDataForSeoResponse(name, raw, task);
}

function summarizeDataForSeoResponse(toolName, raw, task) {
  const taskResult = raw?.tasks?.[0];
  if (!taskResult) return JSON.stringify({ error: "Empty DataForSEO response." }).slice(0, 12000);
  if (taskResult.status_code !== 20000) {
    return JSON.stringify({
      error: taskResult.status_message || "Task error",
      status_code: taskResult.status_code,
    });
  }

  if (toolName === "dataforseo_serp_google_organic_live") {
    return JSON.stringify(formatSerpSummary(taskResult.result?.[0]), null, 2).slice(0, 14000);
  }
  if (toolName === "dataforseo_keywords_search_volume_live") {
    return JSON.stringify(formatVolumeSummary(taskResult.result), null, 2).slice(0, 14000);
  }
  if (toolName === "dataforseo_labs_keyword_suggestions_live") {
    return JSON.stringify(formatSuggestionsSummary(taskResult.result?.[0]), null, 2).slice(0, 14000);
  }
  if (toolName === "dataforseo_backlinks_summary_live") {
    return JSON.stringify(formatBacklinksSummary(taskResult.result?.[0]), null, 2).slice(0, 14000);
  }
  if (toolName === "dataforseo_backlinks_referring_domains_live") {
    return JSON.stringify(formatReferringDomainsSummary(taskResult.result?.[0]), null, 2).slice(0, 14000);
  }
  if (toolName === "dataforseo_ai_llm_mentions_live") {
    return JSON.stringify(formatAiMentionsSummary(taskResult.result?.[0]), null, 2).slice(0, 16000);
  }
  return JSON.stringify(taskResult.result ?? taskResult).slice(0, 14000);
}

function formatSerpSummary(result) {
  if (!result) return { note: "No SERP result." };
  const items = (result.items || []).filter((item) => item.type === "organic").slice(0, 15);
  return {
    keyword: result.keyword,
    location_code: result.location_code,
    language_code: result.language_code,
    se_results_count: result.se_results_count,
    check_url: result.check_url,
    item_types: result.item_types,
    organic: items.map((item) => ({
      rank: item.rank_group ?? item.rank_absolute,
      title: item.title,
      url: item.url,
      domain: item.domain,
      description: item.description?.slice(0, 220),
    })),
    people_also_ask: (result.items || [])
      .filter((item) => item.type === "people_also_ask")
      .flatMap((item) => (item.items || []).map((q) => q.title).filter(Boolean))
      .slice(0, 8),
    related_searches: (result.items || [])
      .filter((item) => item.type === "related_searches")
      .flatMap((item) => (item.items || []).map((r) => r.title).filter(Boolean))
      .slice(0, 8),
  };
}

function formatVolumeSummary(rows) {
  if (!Array.isArray(rows)) return { keywords: [] };
  return {
    keywords: rows.slice(0, 20).map((row) => ({
      keyword: row.keyword,
      search_volume: row.search_volume,
      competition: row.competition,
      competition_index: row.competition_index,
      cpc: row.cpc,
      low_top_of_page_bid: row.low_top_of_page_bid,
      high_top_of_page_bid: row.high_top_of_page_bid,
      monthly_searches: Array.isArray(row.monthly_searches) ? row.monthly_searches.slice(-6) : undefined,
    })),
  };
}

function formatSuggestionsSummary(result) {
  const items = result?.items || result?.[0]?.items || [];
  return {
    seed: result?.keyword,
    suggestions: items.slice(0, 25).map((item) => ({
      keyword: item.keyword,
      search_volume: item.keyword_info?.search_volume ?? item.search_volume,
      cpc: item.keyword_info?.cpc ?? item.cpc,
      competition: item.keyword_info?.competition_level ?? item.competition,
    })),
  };
}

function formatBacklinksSummary(result) {
  if (!result) return { note: "No backlinks summary." };
  return {
    target: result.target,
    rank: result.rank,
    domain_rank_note: "rank is DataForSEO domain rank on 0-1000 scale (use as domain strength proxy).",
    backlinks: result.backlinks,
    referring_domains: result.referring_domains,
    referring_main_domains: result.referring_main_domains,
    referring_pages: result.referring_pages,
    referring_ips: result.referring_ips,
    broken_backlinks: result.broken_backlinks,
    backlinks_spam_score: result.backlinks_spam_score,
    target_spam_score: result.target_spam_score,
    first_seen: result.first_seen,
    top_tlds: result.referring_links_tld,
  };
}

function formatReferringDomainsSummary(result) {
  const items = result?.items || [];
  return {
    target: result?.target,
    total_count: result?.total_count,
    domains: items.slice(0, 20).map((item) => ({
      domain: item.domain,
      rank: item.rank,
      backlinks: item.backlinks,
      referring_pages: item.referring_pages,
      first_seen: item.first_seen,
      spam_score: item.backlinks_spam_score,
    })),
  };
}

function formatAiMentionsSummary(result) {
  const items = result?.items || [];
  return {
    total_count: result?.total_count,
    items_count: result?.items_count,
    mentions: items.slice(0, 12).map((item) => ({
      platform: item.platform,
      model_name: item.model_name,
      question: item.question?.slice(0, 220),
      answer_excerpt: item.answer?.slice(0, 320),
      ai_search_volume: item.ai_search_volume,
      monthly_searches: Array.isArray(item.monthly_searches) ? item.monthly_searches.slice(-3) : undefined,
      sources: (item.sources || []).slice(0, 5).map((source) => ({
        domain: source.domain,
        title: source.title,
        url: source.url,
      })),
    })),
  };
}

function extractKeywords(text, website) {
  const keywords = new Set();
  const source = String(text || "").replace(/\s+/g, " ").trim();

  const volumePatterns = [
    /(?:what is|what's|tell me|show me|get)\s+(?:the\s+)?(?:search\s+)?(?:traffic\s+)?volu?m(?:e|ne)?\s+(?:for\s+)?(?:the\s+)?(.+?)\s*$/i,
    /(?:traffic\s+volu?m|search\s+traffic|monthly\s+traffic)\s+(?:for\s+)?(?:the\s+)?(.+?)\s*$/i,
    /search\s+volu?m(?:e|ne)?\s+(?:for\s+)?(?:the\s+)?(.+?)\s*$/i,
    /volu?m(?:e|ne)?\s+(?:for\s+)?(?:the\s+)?(?:keyword\s+)?(.+?)\s*$/i,
    /how many searches (?:for|does)\s+(.+?)\s*$/i,
    /how much traffic (?:does|for)\s+(.+?)\s*$/i,
  ];
  for (const pattern of volumePatterns) {
    const match = source.match(pattern);
    if (match?.[1]) keywords.add(stripIntentWords(match[1]));
  }

  for (const match of source.matchAll(/"([^"]{2,80})"/g)) keywords.add(stripIntentWords(match[1]));
  for (const match of source.matchAll(/'([^']{2,80})'/g)) keywords.add(stripIntentWords(match[1]));
  for (const match of source.matchAll(
    /(?:keyword|query|term|serp for|rank(?:ing)? for|volume for|search volume for)[:\s]+["']?([^\n",.?]{2,80})/gi
  )) {
    keywords.add(stripIntentWords(match[1]));
  }

  const forMatch = source.match(/\bfor\s+(?:the\s+)?(?:keyword\s+)?["']?([a-z0-9][a-z0-9\s\-/]{2,70})/i);
  if (forMatch && needsSeoData(source)) {
    keywords.add(stripIntentWords(forMatch[1]));
  }

  if (!keywords.size && needsSeoData(source) && !looksLikeDomainMetricsQuestion(source)) {
    const cleaned = source
      .replace(/^(what|how|show|tell|get|find|check)\s+(is|are|me|the|please)?\s*/i, "")
      .replace(/^search\s+volu?m(?:e|ne)?\s+(?:for\s+)?/i, "")
      .trim();
    const candidate = stripIntentWords(cleaned);
    if (candidate.length >= 3 && candidate.length <= 90 && isValidSearchKeyword(candidate)) {
      keywords.add(candidate);
    }
  }

  return [...keywords].filter(isValidSearchKeyword).slice(0, 8);
}

function looksLikeDomainMetricsQuestion(text) {
  return /domain rating|domain authority|domain rank|\bdr\b|\bda\b|backlink|referring domain|link profile|spam score|domain strength|authority score/i.test(
    String(text || "")
  );
}

function looksLikeProjectSiteReference(text) {
  return /\b(our|my)\s+(project|site|website|domain|company)\b|\bwe\b.*\b(site|domain)\b|\bour project\b/i.test(
    String(text || "")
  );
}

function resolveContextDomain(userText, website) {
  if (extractDomainsFromMessage(userText).length > 0) return "";
  const domain = normalizeDomain(website);
  if (!domain) return "";
  if (looksLikeProjectSiteReference(userText) || looksLikeDomainMetricsQuestion(userText)) return domain;
  return "";
}

function isValidSearchKeyword(keyword) {
  const value = String(keyword || "").trim();
  if (value.length < 2 || value.length > 70) return false;
  const lower = value.toLowerCase();
  if (/https?:\/\//i.test(lower)) return false;
  if (/domain rating|domain authority|domain rank|our project|my site|our site|backlink|referring domain|link profile|what is|how many|project rating/i.test(lower)) {
    return false;
  }
  const stopwordHits = (lower.match(/\b(is|the|our|my|for|of|a|an|we|project|site|domain|rating|authority)\b/g) || []).length;
  if (stopwordHits >= 3) return false;
  return true;
}

function looksLikeMarketingChatOnly(text) {
  const source = String(text || "");
  if (needsSeoData(source) || looksLikeDomainMetricsQuestion(source)) return false;
  return /write|draft|rewrite|email|caption|tagline|brainstorm|ideas? for|tone of voice|messaging|positioning|value prop|campaign concept|social post|ad copy|blog outline|strategy(?!.*\d)|what do you think|help me (write|plan|brainstorm)/i.test(
    source
  );
}

function emptyFetchPlan() {
  return {
    fetch: false,
    intent: "marketing_chat",
    keywords: [],
    domains: [],
    volume: false,
    serp: false,
    suggestions: false,
    backlinks: false,
    ai_optimization: false,
  };
}

function apiFallbackFetchPlan(message, website) {
  if (looksLikeMarketingChatOnly(message)) return emptyFetchPlan();
  const explicit = extractDomainsFromMessage(message);
  if (looksLikeDomainMetricsQuestion(message) || looksLikeProjectSiteReference(message) || explicit.length) {
    const domains = explicit.length
      ? explicit.slice(0, 3)
      : [resolveContextDomain(message, website) || normalizeDomain(website)].filter(Boolean);
    if (domains.length) {
      return {
        fetch: true,
        intent: "domain_metrics",
        keywords: [],
        domains,
        volume: false,
        serp: false,
        suggestions: false,
        backlinks: true,
        ai_optimization: false,
      };
    }
  }
  return normalizeFetchPlan({ fetch: needsSeoData(message) }, message, website);
}

async function heuristicFetch(userText, config, website, plan) {
  const explicit = extractDomainsFromMessage(userText);
  const contextDomain = resolveContextDomain(userText, website);
  const domains = (
    explicit.length
      ? explicit
      : [
          ...(plan?.domains?.length ? plan.domains : []),
          ...extractDomains(userText, website),
          ...(contextDomain ? [contextDomain] : []),
        ]
  )
    .map(normalizeDomain)
    .filter(Boolean);
  const uniqueDomains = [...new Set(domains)].slice(0, 3);

  const keywords = (plan?.keywords?.length ? plan.keywords : extractKeywords(userText, website)).filter(
    isValidSearchKeyword
  );
  if (!keywords.length && !uniqueDomains.length) return "";

  const blocks = [];
  const primary = keywords[0];
  const primaryDomain = uniqueDomains[0];
  const wantsVolume = Boolean(plan?.volume && keywords.length);
  const wantsSerp = Boolean(plan?.serp && keywords.length);
  const wantsSuggestions = Boolean(plan?.suggestions && keywords.length);
  const wantsBacklinks = Boolean(plan?.backlinks && primaryDomain);
  const wantsAi = Boolean(plan?.ai_optimization && (keywords.length || primaryDomain));

  try {
    if (wantsVolume && keywords.length) {
      blocks.push(
        await executeDataForSeoTool(
          "dataforseo_keywords_search_volume_live",
          { keywords: keywords.slice(0, 10) },
          config
        )
      );
    }
    if (wantsSerp && keywords.length) {
      blocks.push(
        await executeDataForSeoTool(
          "dataforseo_serp_google_organic_live",
          { keyword: keywords[0], target: primaryDomain, depth: 10 },
          config
        )
      );
    }
    if (wantsSuggestions && keywords.length) {
      blocks.push(
        await executeDataForSeoTool(
          "dataforseo_labs_keyword_suggestions_live",
          { keyword: primary, limit: 20 },
          config
        )
      );
    }
    if (wantsBacklinks && primaryDomain) {
      blocks.push(
        await executeDataForSeoTool("dataforseo_backlinks_summary_live", { target: primaryDomain }, config)
      );
      blocks.push(
        await executeDataForSeoTool(
          "dataforseo_backlinks_referring_domains_live",
          { target: primaryDomain, limit: 20 },
          config
        )
      );
    }
    if (wantsAi && (keywords.length || primaryDomain)) {
      blocks.push(
        await executeDataForSeoTool(
          "dataforseo_ai_llm_mentions_live",
          {
            keyword: primary || undefined,
            domain: primaryDomain || undefined,
            limit: 15,
          },
          config
        )
      );
    }
  } catch (error) {
    blocks.push(JSON.stringify({ error: error.message || "SEO data fetch failed." }));
  }

  return blocks.filter(Boolean).join("\n\n");
}

function formatLiveSeoContext(raw) {
  if (!raw?.trim()) return "";
  return `Blazly live SEO data (already retrieved for this reply — use these exact metrics in tables and prose; never say data is missing or pending):\n${raw}`;
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
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

function normalizeFetchPlan(value, userText, website) {
  const parsed = value && typeof value === "object" ? value : {};
  const text = String(userText || "");
  const intent = String(parsed.intent || parsed.mode || "").toLowerCase();

  if (parsed.fetch === false || intent === "marketing_chat" || intent === "conversation") {
    return emptyFetchPlan();
  }

  if (looksLikeMarketingChatOnly(text) && parsed.fetch !== true) {
    return emptyFetchPlan();
  }

  const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
    .map((item) => stripIntentWords(String(item || "")))
    .filter(isValidSearchKeyword)
    .slice(0, 8);

  const parsedDomains = (Array.isArray(parsed.domains) ? parsed.domains : [])
    .map((item) => normalizeDomain(item))
    .filter(Boolean);

  const explicitFromMessage = extractDomainsFromMessage(text);
  const contextDomain = resolveContextDomain(text, website);
  const fallbackDomains = explicitFromMessage.length
    ? explicitFromMessage.slice(0, 3)
    : [...new Set([...parsedDomains, ...extractDomains(text, website), ...(contextDomain ? [contextDomain] : [])])].slice(
        0,
        3
      );

  let fallbackKeywords = keywords.length ? keywords : extractKeywords(text, website).filter(isValidSearchKeyword);

  const domainMetrics =
    intent === "domain_metrics" ||
    intent === "backlinks" ||
    looksLikeDomainMetricsQuestion(text) ||
    (looksLikeProjectSiteReference(text) && Boolean(fallbackDomains.length));

  if (domainMetrics) {
    fallbackKeywords = fallbackKeywords.filter((item) => !looksLikeDomainMetricsQuestion(item));
    if (!fallbackKeywords.length) {
      return {
        fetch: true,
        intent: "domain_metrics",
        keywords: [],
        domains: fallbackDomains,
        volume: false,
        serp: false,
        suggestions: false,
        backlinks: true,
        ai_optimization: Boolean(parsed.ai_optimization ?? parsed.aiOptimization),
      };
    }
  }

  const wantsBacklinks =
    Boolean(parsed.backlinks) || domainMetrics || /backlink|referring domain|domain authority|domain rank|link profile|spam score/i.test(text);
  const wantsAi =
    Boolean(parsed.ai_optimization ?? parsed.aiOptimization) ||
    /ai discoverability|llm mention|ai overview|chatgpt|generative engine|geo tool|aeo|ai search volume|cited by ai/i.test(text);
  const wantsVolumeText = /volu?m|traffic|searches|cpc|competition|keyword/i.test(text);
  const wantsKeywordResearch =
    intent === "keyword_research" ||
    intent === "keyword_volume" ||
    (fallbackKeywords.length > 0 && wantsVolumeText && !domainMetrics);

  const shouldFetch =
    parsed.fetch === true ||
    wantsKeywordResearch ||
    wantsBacklinks ||
    wantsAi ||
    Boolean(parsed.serp);

  if (!shouldFetch) return emptyFetchPlan();

  return {
    fetch: true,
    intent: domainMetrics ? "domain_metrics" : wantsKeywordResearch ? "keyword_research" : intent || "mixed",
    keywords: fallbackKeywords,
    domains: fallbackDomains,
    volume: wantsKeywordResearch && fallbackKeywords.length > 0,
    serp: Boolean(parsed.serp && fallbackKeywords.length),
    suggestions: Boolean(parsed.suggestions !== false && wantsKeywordResearch && fallbackKeywords.length),
    backlinks: wantsBacklinks && fallbackDomains.length > 0,
    ai_optimization: wantsAi,
  };
}

export async function classifySeoFetchIntent({ apiKey, model, userText, scope, mode, website, project }) {
  const message = String(userText || "").trim();
  if (!message) return emptyFetchPlan();

  if (looksLikeMarketingChatOnly(message)) {
    return emptyFetchPlan();
  }

  if (!apiKey) {
    return apiFallbackFetchPlan(message, website);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-opus-5-5",
      max_tokens: 768,
      temperature: 0,
      system: [
        "You classify user intent for Blazly (SEO, GEO, AEO workspace) BEFORE any live data fetch.",
        "Step 1 — Pick intent:",
        "- marketing_chat: copy, strategy discussion, brainstorming, opinions, how-to advice WITHOUT needing live numbers.",
        "- keyword_research: user wants search volume/CPC/competition/SERP/suggestions for specific SEARCH TERMS people type in Google.",
        "- domain_metrics: domain rating/authority/rank, backlinks, referring domains, link profile for a specific site.",
        "- ai_visibility: AI/LLM mentions, GEO/AEO visibility, ChatGPT/Google AI citations.",
        "- mixed: clearly needs more than one of the above.",
        "Step 2 — Decide fetch:true ONLY when live numeric SEO data is required to answer well.",
        "CRITICAL: Do NOT put the user's question sentence in keywords. keywords[] = actual Google search terms only (e.g. ai discoverability), never domain rating of our project.",
        "If the user names a domain or URL in their message (e.g. acelasolutions.com), put THAT domain in domains[] — never replace it with Website from context.",
        "For our project / our site / my website (no other domain named) → use Website from context in domains[], backlinks:true, keywords:[], volume:false.",
        "Return ONLY JSON:",
        '{"fetch":boolean,"intent":"marketing_chat|keyword_research|domain_metrics|ai_visibility|mixed","keywords":[],"domains":[],"volume":boolean,"serp":boolean,"suggestions":boolean,"backlinks":boolean,"ai_optimization":boolean}',
        "fetch:false for marketing_chat. fetch:true for keyword_research, domain_metrics, ai_visibility, or mixed when metrics are needed.",
        "When unsure between marketing_chat and data, choose marketing_chat (fetch:false).",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            project ? `Project: ${project}` : "",
            scope ? `Workstream: ${scope}` : "",
            mode ? `Mode: ${mode}` : "",
            website ? `Website (use for our project / our site questions): ${website}` : "",
            `User message:\n${message}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return apiFallbackFetchPlan(message, website);
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return apiFallbackFetchPlan(message, website);
  }

  return normalizeFetchPlan(parsed, message, website);
}

export async function planAndExecuteDataForSeo({ apiKey, model, userText, website, config, plan }) {
  if (!config?.login || !config?.password) return "";

  const plannerBody = {
    model: model || "claude-opus-5-5",
    max_tokens: 2048,
    system: [
      "You are Blazly's SEO data planner (internal only).",
      "The user needs factual SEO metrics. Call one or more SEO research tools with valid task fields.",
      `Default location_code: ${Number(config.locationCode) || 2356}. Default language_code: ${config.languageCode || "en"}.`,
      website ? `User website context: ${website}` : "",
      plan?.keywords?.length ? `Keywords to query: ${plan.keywords.join(", ")}` : "",
      plan?.domains?.length ? `Domains to query: ${plan.domains.join(", ")}` : "",
      plan
        ? `Flags: volume=${plan.volume}, serp=${plan.serp}, suggestions=${plan.suggestions}, backlinks=${plan.backlinks}, ai_optimization=${plan.ai_optimization}.`
        : "",
      "Do not answer the user. Prefer calling tools.",
    ]
      .filter(Boolean)
      .join("\n"),
    tools: DATAFORSEO_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
    messages: [{ role: "user", content: userText }],
  };

  let response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(plannerBody),
    signal: AbortSignal.timeout(120000),
  });

  let data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return heuristicFetch(userText, config, website, plan);
  }

  const toolResults = [];

  for (let round = 0; round < 2; round += 1) {
    const content = data.content || [];
    const toolUses = content.filter((block) => block.type === "tool_use");
    const textBlocks = content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

    if (!toolUses.length) {
      break;
    }

    const resultBlocks = await Promise.all(
      toolUses.map(async (call) => {
        try {
          const resultText = await executeDataForSeoTool(call.name, call.input || {}, config);
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: resultText,
          };
        } catch (error) {
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify({ error: error.message || "Tool failed." }),
            is_error: true,
          };
        }
      })
    );

    toolResults.push({ tools: toolUses.map((t) => t.name), results: resultBlocks.map((r) => r.content) });

    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: plannerBody.model,
        max_tokens: 1024,
        system: plannerBody.system,
        tools: plannerBody.tools,
        messages: [
          { role: "user", content: userText },
          { role: "assistant", content },
          { role: "user", content: resultBlocks },
        ],
      }),
      signal: AbortSignal.timeout(120000),
    });

    data = await response.json().catch(() => ({}));
    if (!response.ok) break;
  }

  if (!toolResults.length) {
    return heuristicFetch(userText, config, website, plan);
  }

  return toolResults
    .map((entry) => entry.results.join("\n\n"))
    .join("\n\n---\n\n");
}

function mergeContextBlocks(...parts) {
  const seen = new Set();
  const blocks = [];
  for (const part of parts) {
    const chunk = String(part || "").trim();
    if (!chunk || seen.has(chunk)) continue;
    seen.add(chunk);
    blocks.push(chunk);
  }
  return blocks.join("\n\n---\n\n");
}

export async function buildDataForSeoContext({ apiKey, model, messages, website, config, scope, mode, project }) {
  if (!config?.login || !config?.password) {
    return "";
  }
  const lastUser = [...(messages || [])].reverse().find((item) => item.role === "user");
  const userText = messagePlainText(lastUser?.content);
  if (!userText.trim()) return "";

  let plan;
  try {
    plan = await classifySeoFetchIntent({ apiKey, model, userText, scope, mode, website, project });
  } catch {
    plan = apiFallbackFetchPlan(userText, website);
  }

  if (!plan.fetch) return "";
  if (!plan.keywords.length && !plan.domains.length) return "";

  let heuristic = "";
  let planned = "";
  try {
    heuristic = await heuristicFetch(userText, config, website, plan);
  } catch {
    heuristic = "";
  }

  const skipPlanner = plan.intent === "domain_metrics" && heuristic.length >= 80;
  if (!skipPlanner && (!heuristic || heuristic.length < 80)) {
    try {
      planned = await planAndExecuteDataForSeo({ apiKey, model, userText, website, config, plan });
    } catch {
      planned = "";
    }
  }

  const merged = mergeContextBlocks(heuristic, planned);
  return formatLiveSeoContext(merged);
}
