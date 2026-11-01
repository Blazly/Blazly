import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resetBlogWriterModelChain,
  setBlogWriterModelChain,
} from "./blog-writer/blogLlmChain.js";
import { appendGeoChecklistToKnowledge } from "./geoBlogChecklist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(__dirname, { interopDefault: true, esmResolve: true });

const { getSerpResults } = jiti("./blog-writer/ai/flows/get-serp-results.ts");
const { fetchBlogGenerationSources, generateBlogPost } = jiti("./blog-writer/ai/flows/generate-blog-post.ts");
const { analyzeOnPageSEO } = jiti("./blog-writer/ai/flows/analyze-seo-onpage.ts");
const { enhanceSeo } = jiti("./blog-writer/ai/flows/enhance-seo.ts");
const { advancedHumanizeText } = jiti("./blog-writer/ai/flows/advanced-humanize-text.ts");
const { factCheckBlog } = jiti("./blog-writer/ai/flows/fact-check-blog.ts");
const { enforceKeywordOccurrences } = jiti("./blog-writer/ai/flows/enforce-keyword-occurrences.ts");
const { finalizeBlogHtml } = jiti("./blog-writer/lib/blog/sanitize-blog-html.ts");
const { pickReferenceUrls } = jiti("./blog-writer/lib/blog/reference-urls.ts");
const { rewriteBlogWithPrompt } = jiti("./blog-writer/ai/flows/rewrite-blog-with-prompt.ts");

/** Same step order as Blazly Blog Writer (`blog-generation-job.ts`). */
export const BLOG_WRITER_STEPS = [
  "researching",
  "writing",
  "seo_optimizing",
  "humanizing",
  "fact_checking",
  "finalizing",
];

const ALLOWED_BLOG_TONES = [
  "Informational",
  "Casual",
  "Formal",
  "Humorous",
  "Persuasive",
  "Technical",
  "Storytelling",
  "Academic",
  "Empathetic",
];

/** Map Intent line to Genkit tone when it matches a known label (e.g. Commercial → Persuasive). */
function toneFromIntent(rawIntent) {
  const value = String(rawIntent || "").trim();
  if (!value) return undefined;
  const exact = ALLOWED_BLOG_TONES.find((t) => t.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const key = value.toLowerCase();
  const intentMap = {
    commercial: "Persuasive",
    transactional: "Persuasive",
    sales: "Persuasive",
    conversion: "Persuasive",
    informational: "Informational",
    educational: "Informational",
    casual: "Casual",
    formal: "Formal",
    humorous: "Humorous",
    persuasive: "Persuasive",
    technical: "Technical",
    storytelling: "Storytelling",
    academic: "Academic",
    empathetic: "Empathetic",
  };
  return intentMap[key];
}

function normalizeBriefUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** Ensure the target URL appears as at least one hyperlink in the article HTML. */
function primaryKeywordFromSlug(slug) {
  const phrase = String(slug || "")
    .trim()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
  return phrase.length >= 3 ? phrase : "";
}

function resolveRewritePrimaryKeyword(prior) {
  const direct = String(prior?.primaryKeyword || "").trim();
  if (direct) return direct;
  const fromSlug = primaryKeywordFromSlug(prior?.urlSlug);
  if (fromSlug) return fromSlug;
  return "";
}

function ensureTargetUrlLinks(html, landingPageUrl, brandName) {
  if (!landingPageUrl || !html) return html;
  const needle = landingPageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`href=["']${needle}["']`, "i").test(html)) return html;
  const label = (brandName && String(brandName).trim()) || "Learn more";
  const safeLabel = label.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${html}\n<p><a href="${landingPageUrl}" rel="noopener noreferrer">${safeLabel}</a></p>`;
}

const STEP_LABELS = {
  researching: "Researching SERP and reference pages",
  gathering_references: "Gathering reference content",
  writing: "Writing SEO draft",
  seo_optimizing: "On-page SEO optimization",
  humanizing: "Humanizing tone and flow",
  fact_checking: "Fact checking claims",
  finalizing: "Final polish and keyword pass",
};

function estimateBlogEtaSeconds(wordCount) {
  const base = 120;
  const perThousand = 45;
  return Math.ceil(base + (wordCount / 1000) * perThousand);
}

function buildKnowledgeBlock(knowledge) {
  if (!knowledge || typeof knowledge !== "object") return "";
  const parts = [];
  for (const [key, value] of Object.entries(knowledge)) {
    if (value == null || value === "") continue;
    parts.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return parts.join("\n");
}

export function parseBlogWriterBrief(
  text,
  { knowledge, website, brandName, effortAuto, effortTier, writerMode } = {},
) {
  const isGeoWriter = writerMode === "geo";
  const raw = String(text || "").trim();
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  let primaryKeyword = "";
  let targetWordCount = 1500;
  let blogTitle;
  let landingPageUrl;
  let contentIntent;
  let productUrl = website || "";
  let language = "English";

  for (const line of lines) {
    const targetPrompt = line.match(/^target\s*prompt\s*:\s*(.+)$/i);
    if (targetPrompt) primaryKeyword = targetPrompt[1].trim();
    const kw = line.match(/^(?:primary\s*)?keyword\s*:\s*(.+)$/i);
    if (kw) primaryKeyword = kw[1].trim();
    const wc = line.match(/^(?:target\s*)?word\s*count\s*:\s*(\d+)/i);
    if (wc) targetWordCount = Math.min(8000, Math.max(400, Number(wc[1])));
    const intentMatch = line.match(/^intent\s*:\s*(.+)$/i);
    if (intentMatch) contentIntent = intentMatch[1].trim();
    const targetUrlMatch = line.match(/^target\s*url\s*:\s*(.+)$/i);
    if (targetUrlMatch) landingPageUrl = normalizeBriefUrl(targetUrlMatch[1]);
    const titleMatch = line.match(/^title\s*:\s*(.+)$/i);
    if (titleMatch) blogTitle = titleMatch[1].trim();
    const langMatch = line.match(/^language\s*:\s*(.+)$/i);
    if (langMatch) language = langMatch[1].trim();
  }

  if (landingPageUrl) {
    productUrl = landingPageUrl;
  }

  if (!primaryKeyword) {
    for (const line of lines) {
      const m =
        line.match(/^target\s*prompt\s*:\s*(.+)$/i) || line.match(/^keyword\s*:\s*(.+)$/i);
      if (m?.[1]?.trim()) {
        primaryKeyword = m[1].trim().slice(0, 120);
        break;
      }
    }
  }
  if (!primaryKeyword) {
    const firstLine = raw.split(/\n/)[0]?.trim() || "";
    if (
      firstLine &&
      !/^keyword\s*:\s*$/i.test(firstLine) &&
      !/^keyword\s*:/i.test(firstLine) &&
      !/^target prompt\s*:\s*$/i.test(firstLine) &&
      !/^target prompt\s*:/i.test(firstLine)
    ) {
      primaryKeyword = firstLine.slice(0, 120);
    }
  }
  if (!primaryKeyword || /^keyword\s*:?\s*$/i.test(primaryKeyword)) {
    primaryKeyword = "SEO blog topic";
  }

  let knowledgeBase = buildKnowledgeBlock(knowledge);
  if (contentIntent) {
    const intentLine = `Content intent: ${contentIntent}`;
    knowledgeBase = knowledgeBase ? `${knowledgeBase}\n${intentLine}` : intentLine;
  }
  if (landingPageUrl) {
    const linkHint = `Target URL to hyperlink in the article (2–3 contextual links): ${landingPageUrl}`;
    knowledgeBase = knowledgeBase ? `${knowledgeBase}\n${linkHint}` : linkHint;
  }

  if (isGeoWriter) {
    knowledgeBase = appendGeoChecklistToKnowledge(knowledgeBase);
  }

  const tone = toneFromIntent(contentIntent);

  return {
    primaryKeyword,
    targetWordCount,
    tone,
    contentIntent: contentIntent || undefined,
    blogTitle,
    productUrl: productUrl || undefined,
    landingPageUrl: landingPageUrl || undefined,
    language,
    brandName: brandName || undefined,
    knowledgeBase: knowledgeBase || undefined,
    keywordOccurrences: 4,
    generateComparisonTable: "auto",
    geoFormat: true,
    writingStyle: isGeoWriter ? "geo" : "standard",
    sourceMessage: raw,
    effortAuto: isGeoWriter
      ? false
      : effortAuto === undefined || effortAuto === null || effortAuto === true || effortAuto === "true",
    effortTier: isGeoWriter ? "max" : effortTier || "medium",
  };
}

export async function runBlogWriterPipeline(input, onProgress) {
  const { resolveBlogWriterGenkitChain } = await import("./blogModelRouter.js");

  const routed = await resolveBlogWriterGenkitChain({
    message: input.sourceMessage || input.primaryKeyword,
    effortAuto: input.effortAuto,
    effortTier: input.effortTier,
  });
  setBlogWriterModelChain(routed.chain);

  const deadlineAt = Date.now() + 770_000;
  const primaryKeyword = input.primaryKeyword ?? "";
  const language = input.language || "English";
  const keywordOccurrences = input.keywordOccurrences ?? 4;
  let state = {
    input,
    presetTitle: input.blogTitle?.trim() || primaryKeyword,
    sources: undefined,
    draft: undefined,
    title: input.blogTitle?.trim() || primaryKeyword,
    html: "",
    metaTitle: "",
    metaDescription: "",
  };

  const emit = (stage, extra = {}) => {
    onProgress?.({
      type: "progress",
      phase: "blog",
      stage,
      message: STEP_LABELS[stage] || stage,
      etaSeconds: estimateBlogEtaSeconds(input.targetWordCount),
      model: routed.model,
      effortTier: routed.resolvedTier,
      ...extra,
    });
  };

  try {
  emit("researching");
  let referenceUrls = [];
  try {
    const serp = await getSerpResults({ query: primaryKeyword });
    referenceUrls = pickReferenceUrls(serp.results);
  } catch {
    // supplementary
  }

  let sources = {};
  if (referenceUrls.length > 0 || input.productUrl) {
    emit("gathering_references");
    try {
      const fetched = await fetchBlogGenerationSources({ ...input, referenceUrls });
      sources = {
        yourProductHtmlContent: fetched.yourProductHtmlContent,
        yourProductFetchError: fetched.yourProductFetchError,
        referenceBlogsHtml: fetched.referenceBlogsHtml,
        competitorsHtml: fetched.competitorsHtml,
      };
    } catch {
      sources = {};
    }
  }
  state = { ...state, sources };

  emit("writing");
  const draft = await generateBlogPost({
    ...input,
    skipInternalHumanization: true,
    skipUrlFetching: true,
    prefetchedSources: sources,
    deadlineAt,
  });
  if (!draft.blogPost) throw new Error("Blog generation failed to produce content.");
  const { referenceFetchResults, yourProductFetchResult, competitorFetchResults, ...draftFields } = draft;
  state = {
    ...state,
    sources: undefined,
    draft: draftFields,
    title: draft.blogTitle?.trim() || state.presetTitle || draft.metaTitle,
    html: draft.blogPost,
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
  };

  emit("seo_optimizing");
  const seoAnalysis = await analyzeOnPageSEO({
    htmlContent: state.html,
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    primaryKeyword,
  });
  const enhanced = await enhanceSeo({
    htmlContent: state.html,
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    primaryKeyword,
    keywordOccurrences,
    seoAnalysis,
    language,
    knowledgeBase: input.knowledgeBase,
    geoFormat: true,
  });
  state = {
    ...state,
    html: enhanced.enhancedHtmlContent,
    metaTitle: enhanced.enhancedMetaTitle,
    metaDescription: enhanced.enhancedMetaDescription,
  };

  emit("humanizing");
  const humanized = await advancedHumanizeText({
    htmlContent: state.html,
    blogTitle: state.title,
    primaryKeyword,
    keywordOccurrences,
    secondaryKeyword: input.secondaryKeyword,
    tone: input.tone,
    targetWordCount: input.targetWordCount,
    language,
    humanizationLevel: 2,
    knowledgeBase: input.knowledgeBase,
    preserveExactFormat: true,
    deadlineAt,
  });
  state = { ...state, html: humanized.humanizedHtmlContent || state.html };

  emit("fact_checking");
  const checked = await factCheckBlog({
    htmlContent: state.html,
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    blogTitle: state.title ?? primaryKeyword,
    primaryKeyword,
    keywordOccurrences,
    language,
    knowledgeBase: input.knowledgeBase,
    geoFormat: true,
  });
  state = {
    ...state,
    html: checked.correctedHtmlContent,
    metaTitle: checked.correctedMetaTitle,
    metaDescription: checked.correctedMetaDescription,
  };

  emit("finalizing");
  const enforced = await enforceKeywordOccurrences({
    htmlContent: state.html,
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    primaryKeyword,
    keywordOccurrences,
    language,
    geoFormat: true,
  });
  state = {
    ...state,
    html: ensureTargetUrlLinks(
      finalizeBlogHtml(enforced.htmlContent, primaryKeyword, { allowQuestions: true }),
      input.landingPageUrl,
      input.brandName
    ),
    metaTitle: enforced.metaTitle,
    metaDescription: enforced.metaDescription,
  };

  const finalSeo = await analyzeOnPageSEO({
    htmlContent: state.html,
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    primaryKeyword,
  }).catch(() => null);

  return {
    ...state.draft,
    blogTitle: state.title,
    blogPost: state.html,
    metaTitle: state.metaTitle,
    metaDescription: state.metaDescription,
    primaryKeyword,
    seoAnalysis: finalSeo,
    landingPageUrl: input.landingPageUrl,
    contentIntent: input.contentIntent,
    urlSlug: state.draft?.urlSlug,
    modelUsed: routed.model,
    effortTier: routed.resolvedTier,
    isGeoWriter: input.writingStyle === "geo",
  };
  } finally {
    resetBlogWriterModelChain();
  }
}

export async function runBlogWriterRewrite(
  { rewritePrompt, previousArticle, effortAuto, effortTier, brandName, knowledgeBase },
  onProgress,
) {
  const { resolveBlogWriterGenkitChain } = await import("./blogModelRouter.js");
  const prior = previousArticle || {};
  const prompt = String(rewritePrompt || "").trim();
  if (!prompt) throw new Error("Enter instructions for how to update the article.");
  if (!prior.html) throw new Error("No previous article found to rewrite.");

  const routed = await resolveBlogWriterGenkitChain({
    message: prompt,
    effortAuto,
    effortTier,
  });
  setBlogWriterModelChain(routed.chain);

  const emit = (stage, extra = {}) => {
    onProgress?.({
      type: "progress",
      phase: "blog",
      stage,
      message: extra.message || stage,
      model: routed.model,
      effortTier: routed.resolvedTier,
      ...extra,
    });
  };

  try {
    emit("rewriting", { message: "Applying your instructions to the article" });
    const rewritten = await rewriteBlogWithPrompt({
      htmlContent: prior.html,
      metaTitle: prior.metaTitle || prior.blogTitle || "Blog article",
      metaDescription: prior.metaDescription || "",
      rewritePrompt: prompt,
      blogTitle: prior.blogTitle,
      primaryKeyword: prior.primaryKeyword || undefined,
      language: "English",
    });

    let html = ensureTargetUrlLinks(
      finalizeBlogHtml(rewritten.rewrittenHtmlContent, prior.primaryKeyword || "", {
        allowQuestions: true,
      }),
      prior.landingPageUrl,
      brandName,
    );

    const metaTitle = rewritten.rewrittenMetaTitle;
    const metaDescription = rewritten.rewrittenMetaDescription;
    const primaryKeyword = resolveRewritePrimaryKeyword(prior);

    emit("finalizing", { message: "Checking on-page SEO" });
    let finalSeo = null;
    if (primaryKeyword) {
      finalSeo = await analyzeOnPageSEO({
        htmlContent: html,
        metaTitle,
        metaDescription,
        primaryKeyword,
      }).catch(() => null);
    }
    if (!finalSeo && prior.seoScore != null && prior.seoScore > 0) {
      finalSeo = {
        seoScore: prior.seoScore,
        scoreJustification: "Reused the previous on-page score because SEO analysis could not run for this revision.",
        whatIsDoneWell: [],
        areasForImprovement: [],
      };
    }

    return {
      blogTitle: prior.blogTitle || metaTitle,
      blogPost: html,
      metaTitle,
      metaDescription,
      primaryKeyword,
      seoAnalysis: finalSeo,
      landingPageUrl: prior.landingPageUrl,
      contentIntent: prior.contentIntent,
      urlSlug: prior.urlSlug,
      modelUsed: routed.model,
      effortTier: routed.resolvedTier,
      rewritten: true,
    };
  } finally {
    resetBlogWriterModelChain();
  }
}

export function formatBlogWriterReply(result, { intro } = {}) {
  const title = result.blogTitle || result.metaTitle || "SEO blog article";
  const defaultIntro = result.rewritten
    ? "Updated your article using your instructions — same topic, revised in depth and polish."
    : result.isGeoWriter
      ? "Your GEO blog is ready — answer-first structure, citation-worthy sections, FAQs, and full pipeline polish for AI search engines."
      : "Your SEO blog article is ready — researched, written, SEO-optimized, humanized, and fact-checked (same pipeline as Blazly Blog Writer).";
  const lines = [
    `WORKPANE|article|${title}`,
    "",
    intro || defaultIntro,
    "",
    "METRICS_START",
    `Meta title|${result.metaTitle}`,
    `Meta description|${result.metaDescription}`,
  ];
  if (result.primaryKeyword) lines.push(`Target keyword|${result.primaryKeyword}`);
  if (result.seoAnalysis?.seoScore != null) {
    lines.push(`On-page SEO score|${result.seoAnalysis.seoScore}/100`);
  }
  if (result.urlSlug) lines.push(`URL slug|${result.urlSlug}`);
  if (result.landingPageUrl) lines.push(`Target URL|${result.landingPageUrl}`);
  if (result.contentIntent) lines.push(`Intent|${result.contentIntent}`);
  lines.push("METRICS_END");
  lines.push("");
  lines.push(result.blogPost);
  return lines.join("\n");
}
