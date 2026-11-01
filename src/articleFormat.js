import { buildMarkdownBlocks } from "./markdownBlocks.js";
import { stripInlineMarkdown } from "./inlineFormat.jsx";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdownToHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function isHtmlArticle(value) {
  return /<(p|h1|h2|h3|ul|ol|li|table|div|strong|em|br|img|a)\b/i.test(String(value || ""));
}

export function markdownToHtml(markdown) {
  const blocks = buildMarkdownBlocks(String(markdown || ""));
  if (!blocks.length) return "<p></p>";

  const html = blocks
    .map((block) => {
      if (block.type === "table") {
        const head = block.headers
          .map((cell) => `<th>${inlineMarkdownToHtml(stripInlineMarkdown(cell))}</th>`)
          .join("");
        const body = block.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(stripInlineMarkdown(cell))}</td>`).join("")}</tr>`
          )
          .join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      }
      if (block.type === "heading") {
        return `<h2>${inlineMarkdownToHtml(stripInlineMarkdown(block.text))}</h2>`;
      }
      if (block.type === "list") {
        return `<ul>${block.items.map((item) => `<li>${inlineMarkdownToHtml(stripInlineMarkdown(item))}</li>`).join("")}</ul>`;
      }
      return `<p>${inlineMarkdownToHtml(stripInlineMarkdown(block.text))}</p>`;
    })
    .join("");

  return html;
}

export function htmlToPlainMarkdown(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeName === "BR") return "\n";
    if (node.nodeName === "STRONG" || node.nodeName === "B") {
      return `**${[...node.childNodes].map(walk).join("")}**`;
    }
    if (node.nodeName === "EM" || node.nodeName === "I") {
      return `*${[...node.childNodes].map(walk).join("")}*`;
    }
    if (/^H[1-6]$/.test(node.nodeName)) {
      return `\n\n${"#".repeat(Number(node.nodeName.slice(1)))} ${[...node.childNodes].map(walk).join("")}\n\n`;
    }
    if (node.nodeName === "P") {
      return `\n\n${[...node.childNodes].map(walk).join("")}\n\n`;
    }
    if (node.nodeName === "LI") {
      return `- ${[...node.childNodes].map(walk).join("")}\n`;
    }
    if (node.nodeName === "UL" || node.nodeName === "OL") {
      return `\n${[...node.childNodes].map(walk).join("")}\n`;
    }
    if (node.nodeName === "A") {
      const href = node.getAttribute("href") || "";
      return `[${[...node.childNodes].map(walk).join("")}](${href})`;
    }
    if (node.nodeName === "IMG") {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "image";
      return `\n\n![${alt}](${src})\n\n`;
    }
    if (node.nodeName === "TABLE") {
      return `\n\n${tableToMarkdown(node)}\n\n`;
    }
    return [...node.childNodes].map(walk).join("");
  };

  return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}

function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll("th,td")].map((cell) => cell.textContent.trim())
  );
  if (!rows.length) return "";
  const [head, ...body] = rows;
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(head), `| ${head.map(() => "---").join(" | ")} |`, ...body.map(line)].join("\n");
}

export function sanitizeArticleHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  return doc.body.innerHTML;
}
