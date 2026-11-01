import { splitArticleAssistantText } from "./chatBlocks.js";
import { htmlToPlainMarkdown, isHtmlArticle } from "./articleFormat.js";
import { stripUiBlocks } from "./parseAssistantUi.js";

function metricsAsPlainLines(content) {
  const match = String(content || "").match(/METRICS_START\n([\s\S]*?)\nMETRICS_END/);
  if (!match) return "";
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.indexOf("|");
      if (pipe === -1) return line;
      return `${line.slice(0, pipe).trim()}: ${line.slice(pipe + 1).trim()}`;
    })
    .join("\n");
}

/** Plain text for copy / speak — matches what the user reads in chat, not raw HTML. */
export function assistantPlainText(content) {
  const raw = String(content || "");
  if (!raw.trim()) return "";

  const metrics = metricsAsPlainLines(raw);
  const { summary, html } = splitArticleAssistantText(raw);
  const parts = [];

  if (summary?.trim()) parts.push(summary.trim());
  if (metrics) parts.push(metrics);

  if (html && isHtmlArticle(html)) {
    parts.push(htmlToPlainMarkdown(html));
  }

  const combined = parts.filter(Boolean).join("\n\n");
  if (combined) return combined;

  return stripUiBlocks(raw).replace(/^WORKPANE\|[^\n]+\n?/gm, "").trim();
}
