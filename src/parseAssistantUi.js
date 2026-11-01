import { parseSentimentBlock } from "./brandSentimentClient.js";

const BLOCK_RE = {
  plan: /PLAN_START(?:\|([^\n]*))?\n([\s\S]*?)\nPLAN_END/g,
  card: /CARD_START(?:\|([^\n]*))?\n([\s\S]*?)\nCARD_END/g,
  steps: /STEPS_START\n([\s\S]*?)\nSTEPS_END/g,
  checklist: /CHECKLIST_START\n([\s\S]*?)\nCHECKLIST_END/g,
  metrics: /METRICS_START\n([\s\S]*?)\nMETRICS_END/g,
  table: /TABLE_START\n([\s\S]*?)\nTABLE_END/g,
  chart: /CHART_START(?:\|([^\n]*))?\n([\s\S]*?)\nCHART_END/g,
  result: /RESULT_START\n([\s\S]*?)\nRESULT_END/g,
  sentiment: /SENTIMENT_START\n([\s\S]*?)\nSENTIMENT_END/g,
  video: /VIDEO_START\n([\s\S]*?)\nVIDEO_END/g,
};

export function parseRows(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.indexOf("|");
      if (pipe === -1) return { label: line, value: "" };
      return { label: line.slice(0, pipe).trim(), value: line.slice(pipe + 1).trim() };
    });
}

function parseStepLines(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const stateMatch = line.match(/^(done|pending|active)\|(.+)$/i);
      if (stateMatch) {
        return { text: stateMatch[2].trim(), state: stateMatch[1].toLowerCase() };
      }
      return { text: line, state: "done" };
    });
}

function parseMetrics(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return {
        label: parts[0] || "",
        displayValue: parts[1] || "",
        tone: (parts[2] || inferMetricTone(parts[1] || "")).toLowerCase(),
      };
    });
}

function inferMetricTone(value) {
  if (/^\+|\bup\b|improv|gain|high/i.test(value)) return "up";
  if (/^-|\bdown\b|drop|loss|critical/i.test(value)) return "down";
  return "neutral";
}

function withoutEstimatedTrafficColumn({ headers, rows }) {
  const idx = headers.findIndex((header) => /est\.?\s*traffic/i.test(String(header || "")));
  if (idx === -1) return { headers, rows };
  return {
    headers: headers.filter((_, columnIndex) => columnIndex !== idx),
    rows: rows.map((row) => row.filter((_, columnIndex) => columnIndex !== idx)),
  };
}

function parseChart(body) {
  const lines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const points = lines
    .map((line) => {
      const pipe = line.indexOf("|");
      if (pipe === -1) return null;
      const label = line.slice(0, pipe).trim();
      const value = Number(line.slice(pipe + 1).trim());
      if (!label || !Number.isFinite(value)) return null;
      return { label, value };
    })
    .filter(Boolean);
  return { points };
}

function parseTable(body) {
  const lines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split("|").map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => line.split("|").map((cell) => cell.trim()));
  return withoutEstimatedTrafficColumn({ headers, rows });
}

export function extractSidebarInner(content) {
  const match = String(content || "").match(/SIDEBAR_START\n([\s\S]*?)\nSIDEBAR_END/);
  return match?.[1]?.trim() || "";
}

export function parseAssistantContent(content) {
  const text = String(content || "")
    .replace(/SIDEBAR_START[\s\S]*?SIDEBAR_END/g, "")
    .replace(/REEL_STATE_START[\s\S]*?REEL_STATE_END/g, "")
    .trim();
  const markers = [];

  for (const [type, re] of Object.entries(BLOCK_RE)) {
    re.lastIndex = 0;
    let match = re.exec(text);
    while (match) {
      markers.push({
        index: match.index,
        length: match[0].length,
        type,
        title: match[1]?.trim() || "",
        raw: match[2] ?? match[1] ?? "",
      });
      match = re.exec(text);
    }
  }

  for (const match of text.matchAll(/^WORKPANE\|([^|\n]+)\|?([^\n]*)/gm)) {
    markers.push({
      index: match.index,
      length: match[0].length,
      type: "workpane",
      task: match[1].trim(),
      title: match[2]?.trim() || "",
    });
  }

  for (const match of text.matchAll(/^ACTION\|([^|\n]+)\|([^\n]+)/gm)) {
    const label = match[1].trim();
    const message = match[2].trim();
    if (/^continue\s+reel/i.test(label)) {
      markers.push({ index: match.index, length: match[0].length, type: "skip" });
      continue;
    }
    markers.push({
      index: match.index,
      length: match[0].length,
      type: "action",
      label,
      message,
      variant: "primary",
    });
  }

  for (const match of text.matchAll(/^SECONDARY_ACTION\|([^|\n]+)\|([^\n]+)/gm)) {
    markers.push({
      index: match.index,
      length: match[0].length,
      type: "action",
      label: match[1].trim(),
      message: match[2].trim(),
      variant: "secondary",
    });
  }

  for (const match of text.matchAll(/^LINK_ACTION\|([^|\n]+)\|([^\n]+)/gm)) {
    markers.push({
      index: match.index,
      length: match[0].length,
      type: "action",
      label: match[1].trim(),
      message: match[2].trim(),
      variant: "link",
    });
  }

  markers.sort((a, b) => a.index - b.index);

  const segments = [];
  let cursor = 0;

  for (const marker of markers) {
    const chunk = text.slice(cursor, marker.index).trim();
    if (chunk) segments.push({ type: "text", content: chunk });
    cursor = marker.index + marker.length;

    if (marker.type === "plan") {
      segments.push({
        type: "plan",
        title: marker.title || "Plan",
        rows: parseRows(marker.raw),
      });
    } else if (marker.type === "card") {
      segments.push({
        type: "card",
        title: marker.title || "Details",
        rows: parseRows(marker.raw),
      });
    } else if (marker.type === "steps" || marker.type === "checklist") {
      segments.push({
        type: "steps",
        checklist: marker.type === "checklist",
        items: parseStepLines(marker.raw),
      });
    } else if (marker.type === "metrics") {
      segments.push({ type: "metrics", items: parseMetrics(marker.raw) });
    } else if (marker.type === "table") {
      segments.push({ type: "table", ...parseTable(marker.raw) });
    } else if (marker.type === "chart") {
      segments.push({
        type: "chart",
        title: marker.title || "Trend",
        ...parseChart(marker.raw),
      });
    } else if (marker.type === "result") {
      segments.push({ type: "result", rows: parseRows(marker.raw) });
    } else if (marker.type === "sentiment") {
      const data = parseSentimentBlock(marker.raw);
      if (data) segments.push({ type: "sentiment", data });
    } else if (marker.type === "video") {
      const row = parseRows(marker.raw)[0];
      if (row?.value) {
        segments.push({
          type: "video",
          title: row.label || "Reel",
          src: row.value,
        });
      }
    } else if (marker.type === "workpane") {
      segments.push({ type: "workpane", task: marker.task, title: marker.title });
    } else if (marker.type === "action") {
      segments.push({
        type: "action",
        label: marker.label,
        message: marker.message,
        variant: marker.variant,
      });
    }
  }

  const tail = text.slice(cursor).trim();
  if (tail) segments.push({ type: "text", content: tail });

  return segments;
}

export function hasStructuredSegments(segments) {
  return segments.some((segment) => segment.type !== "text" && segment.type !== "workpane");
}

export function stripUiBlocks(content) {
  return String(content || "")
    .replace(/PLAN_START[\s\S]*?PLAN_END/g, "")
    .replace(/CARD_START[\s\S]*?CARD_END/g, "")
    .replace(/STEPS_START[\s\S]*?STEPS_END/g, "")
    .replace(/CHECKLIST_START[\s\S]*?CHECKLIST_END/g, "")
    .replace(/METRICS_START[\s\S]*?METRICS_END/g, "")
    .replace(/TABLE_START[\s\S]*?TABLE_END/g, "")
    .replace(/CHART_START[\s\S]*?CHART_END/g, "")
    .replace(/RESULT_START[\s\S]*?RESULT_END/g, "")
    .replace(/SENTIMENT_START[\s\S]*?SENTIMENT_END/g, "")
    .replace(/VIDEO_START[\s\S]*?VIDEO_END/g, "")
    .replace(/REEL_STATE_START[\s\S]*?REEL_STATE_END/g, "")
    .replace(/SIDEBAR_START[\s\S]*?SIDEBAR_END/g, "")
    .replace(/^WORKPANE\|[^\n]+\n?/gm, "")
    .replace(/^ACTION\|[^\n]+\n?/gm, "")
    .replace(/^SECONDARY_ACTION\|[^\n]+\n?/gm, "")
    .replace(/^LINK_ACTION\|[^\n]+\n?/gm, "")
    .replace(/^ORCHESTRATOR_AGENT\|[^\n]+\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function messageHasStructuredBlocks(content) {
  const text = String(content || "");
  return /PLAN_START|CARD_START|STEPS_START|CHECKLIST_START|METRICS_START|TABLE_START|CHART_START|RESULT_START|SENTIMENT_START|ACTION\|/.test(text);
}

export function extractWorkpaneDirective(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const match = String(message.content || "").match(/^WORKPANE\|([^|\n]+)\|?([^\n]*)/m);
    if (match) {
      return { task: match[1].trim(), title: match[2]?.trim() || "" };
    }
  }
  return null;
}
