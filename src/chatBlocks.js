import {
  extractSidebarInner,
  extractWorkpaneDirective,
  parseAssistantContent,
  parseRows,
  stripUiBlocks,
} from "./parseAssistantUi.js";

export function userWantsFullArticle(text) {
  return /full (article|draft|content|text|write-up)|entire article|complete article|whole article|show me the (full )?.*article|review article|write the (full )?article|yes, create|create the article|generate the (full )?article/i.test(
    String(text || "")
  );
}

const HTML_ARTICLE_START =
  /<(p|h1|h2|h3|h4|ul|ol|div|table|article|section|blockquote)\b/i;

export function splitArticleAssistantText(content) {
  const stripped = stripUiBlocks(String(content || ""))
    .replace(/^WORKPANE\|[^\n]+\n?/gm, "")
    .trim();
  if (!stripped) return { summary: "", html: "" };
  const match = stripped.match(HTML_ARTICLE_START);
  if (!match || match.index == null) {
    return { summary: stripped, html: "" };
  }
  const index = match.index;
  return {
    summary: stripped.slice(0, index).trim(),
    html: stripped.slice(index).trim(),
  };
}

function articlePlainFromMessage(content) {
  const raw = String(content || "");
  if (!raw.trim()) return "";
  const { html } = splitArticleAssistantText(raw);
  return html || splitArticleAssistantText(stripUiBlocks(raw.replace(/^WORKPANE\|[^\n]+\n?/m, ""))).summary;
}

export function extractPlanBlock(content) {
  const match = String(content || "").match(/PLAN_START(?:\|[^\n]*)?\n([\s\S]*?)\nPLAN_END/);
  if (!match) return null;
  return parseRows(match[1]);
}

export function extractResultBlock(content) {
  const match = String(content || "").match(/RESULT_START\n([\s\S]*?)\nRESULT_END/);
  if (!match) return null;
  const rows = parseRows(match[1]);
  const map = Object.fromEntries(rows.map((row) => [row.label.toLowerCase(), row.value]));
  return {
    title: map.title || map["seo title"] || "Blog title",
    copy: map.copy || map.excerpt || map.description || "",
    image: map.image || map.thumbnail || "",
    rows,
  };
}

function parseSidebarSegments(content) {
  const inner = extractSidebarInner(content);
  if (!inner) return null;
  return parseAssistantContent(`.\n${inner}`);
}

export function extractAuditSidebar(content) {
  const segments = parseSidebarSegments(content);
  if (!segments?.length) return null;
  const tables = segments.filter((segment) => segment.type === "table");
  const fixesTable = tables.find((segment) => /^severity$/i.test(segment.headers?.[0] || ""));
  const priorityCard = segments.find((segment) => segment.type === "card");
  const checklist = segments.find((segment) => segment.type === "steps");
  if (!fixesTable?.rows?.length && !priorityCard?.rows?.length && !checklist?.items?.length) return null;
  return { fixesTable, priorityCard, checklist };
}

function extractAuditRerunAction(content) {
  const matches = [...String(content || "").matchAll(/^ACTION\|([^|\n]+)\|([^\n]+)/gm)];
  const match = matches.find((item) => isAuditRerunActionLabel(item[1]));
  if (!match) return null;
  return { label: match[1].trim(), message: match[2].trim() };
}

/** Latest site-audit sidebar + re-run action for the pinned chat footer. */
export function extractLatestAuditDock(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const sidebar = extractAuditSidebar(message.content);
    const action = extractAuditRerunAction(message.content);
    if (!sidebar && !action) continue;
    if (
      !sidebar?.checklist?.items?.length &&
      !sidebar?.fixesTable?.rows?.length &&
      !sidebar?.priorityCard?.rows?.length &&
      !action
    ) {
      continue;
    }

    const signature = `audit-${sidebar?.fixesTable?.rows?.length || 0}-${sidebar?.checklist?.items?.length || 0}`;
    let rerunMessage = action?.message || "";
    if (!rerunMessage) {
      for (let j = messages.length - 1; j >= 0; j--) {
        if (messages[j].role !== "user") continue;
        const urlMatch = String(messages[j].content || "").match(
          /https?:\/\/[^\s<>"']+/i
        );
        if (urlMatch) {
          rerunMessage = `Audit ${urlMatch[0]}`;
          break;
        }
      }
    }

    return {
      checklist: sidebar?.checklist,
      fixesTable: sidebar?.fixesTable,
      priorityCard: sidebar?.priorityCard,
      signature,
      rerunLabel: action?.label || "Re-run audit after fixes",
      rerunMessage,
      messageIndex: i,
    };
  }

  return null;
}

export function isAuditRerunActionLabel(label) {
  return /re-run audit/i.test(String(label || ""));
}

export function extractWorkpaneData(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;

  let plan = null;
  let result = null;
  let articleBody = "";
  let auditSidebar = null;
  const directive = extractWorkpaneDirective(messages);
  let task = directive?.task ? normalizeTask(directive.task) : null;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const planRows = extractPlanBlock(message.content);
    if (planRows?.length) {
      plan = planRows;
      task = "article";
    }
    const resultBlock = extractResultBlock(message.content);
    if (resultBlock) {
      result = resultBlock;
      task = "article";
    }
    const sidebar = extractAuditSidebar(message.content);
    if (sidebar) {
      auditSidebar = sidebar;
      task = "audit";
    }
    const plain = articlePlainFromMessage(message.content);
    if (plain.length > articleBody.length) articleBody = plain;
  }

  if (!task) {
    const userText = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join(" ");
    if (/audit/i.test(userText) && (articleBody || auditSidebar)) task = "audit";
    else if (/article|blog post|blog|write.*content|seo article/i.test(userText) && (plan || result || articleBody)) {
      task = "article";
    } else {
      return null;
    }
  }

  if (task === "audit") {
    if (!auditSidebar) return null;
    return {
      task: "audit",
      signature: `audit-fixes-${auditSidebar.fixesTable?.rows?.length || 0}-${auditSidebar.checklist?.items?.length || 0}`,
      title: directive?.title || "Fixes & to-dos",
      plan,
      result,
      body: "",
      auditFixes: auditSidebar.fixesTable,
      priorityFixes: auditSidebar.priorityCard,
      fixChecklist: auditSidebar.checklist,
      metaDescription: "",
      targetKeyword: "",
      wordCount: "",
      targetUrl: "",
      intent: "",
    };
  }

  if (task === "article" && !plan && !result && !articleBody && !directive) return null;
  if (task === "report" && !plan && !result && !articleBody && !directive) return null;

  const title =
    directive?.title || result?.title || planValue(plan, "SEO Title") || defaultTitle(task);

  return {
    task: task || "article",
    signature: `${directive?.task || task}-${result?.title || ""}-${plan?.length || 0}-${articleBody.length}`,
    title,
    plan,
    result,
    body: articleBody || result?.copy || "",
    metaDescription: planValue(plan, "Meta Description"),
    targetKeyword: planValue(plan, "Target Keyword"),
    wordCount: planValue(plan, "Word Count"),
    targetUrl:
      planValue(plan, "Target URL") ||
      briefLineFromUserMessages(messages, /^target\s*url\s*:\s*(.+)$/i),
    intent:
      planValue(plan, "Intent") || briefLineFromUserMessages(messages, /^intent\s*:\s*(.+)$/i),
  };
}

function slugToKeywordPhrase(slug) {
  const phrase = String(slug || "")
    .trim()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
  return phrase.length >= 3 ? phrase : "";
}

function briefLineFromUserMessages(messages, pattern) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    for (const line of String(messages[i].content || "").split("\n")) {
      const match = line.trim().match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return "";
}

function planValue(plan, label) {
  if (!plan) return "";
  const row = plan.find((item) => item.label.toLowerCase() === label.toLowerCase());
  return row?.value || "";
}

function defaultTitle(task) {
  if (task === "audit") return "Site audit";
  if (task === "report") return "Report";
  return "Blog article";
}

function normalizeTask(value) {
  const task = String(value || "").toLowerCase();
  if (task === "report") return "report";
  if (task === "audit") return "audit";
  return "article";
}

function metricsMapFromAssistant(content) {
  const match = String(content || "").match(/METRICS_START\n([\s\S]*?)\nMETRICS_END/);
  if (!match) return {};
  const map = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pipe = trimmed.indexOf("|");
    if (pipe === -1) continue;
    map[trimmed.slice(0, pipe).trim()] = trimmed.slice(pipe + 1).trim();
  }
  return map;
}

/** Latest assistant message that contains a blog HTML body (for rewrite follow-ups). */
export function extractLastBlogArticleFromHistory(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "assistant") continue;
    const content = messages[i].content;
    const { html } = splitArticleAssistantText(content);
    if (!html || html.length < 80) continue;
    const metrics = metricsMapFromAssistant(content);
    const directive = extractWorkpaneDirective([messages[i]]);
    const seoScoreRaw = metrics["On-page SEO score"] || "";
    const seoScoreMatch = seoScoreRaw.match(/^(\d+)/);

    return {
      html,
      metaTitle: metrics["Meta title"] || "",
      metaDescription: metrics["Meta description"] || "",
      blogTitle: directive?.title || metrics["Meta title"] || "",
      primaryKeyword:
        metrics["Target keyword"] ||
        briefLineFromUserMessages(messages, /^target\s*prompt\s*:\s*(.+)$/i) ||
        briefLineFromUserMessages(messages, /^keyword\s*:\s*(.+)$/i) ||
        slugToKeywordPhrase(metrics["URL slug"]),
      landingPageUrl: metrics["Target URL"] || "",
      contentIntent: metrics["Intent"] || "",
      urlSlug: metrics["URL slug"] || "",
      seoScore: seoScoreMatch ? Number(seoScoreMatch[1]) : undefined,
    };
  }
  return null;
}

export function extractTableBlocks(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const segments = parseAssistantContent(message.content);
    const table = segments.find((segment) => segment.type === "table");
    if (table) return table;
  }
  return null;
}
