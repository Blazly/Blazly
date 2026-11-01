import { parse, type HTMLElement } from 'node-html-parser';

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function renderNode(node: HTMLElement, lines: string[]): void {
  const tag = node.tagName?.toLowerCase();

  if (tag && HEADING_TAGS.has(tag)) {
    const level = Number(tag[1]);
    const text = normalizeWhitespace(node.text);
    if (text) lines.push('', `${'#'.repeat(level)} ${text}`, '');
    return;
  }

  if (tag === 'p') {
    const text = normalizeWhitespace(node.text);
    if (text) lines.push(text, '');
    return;
  }

  if (tag === 'li') {
    const text = normalizeWhitespace(node.text);
    if (text) lines.push(`- ${text}`);
    return;
  }

  if (tag === 'tr') {
    const cells = node
      .querySelectorAll('th, td')
      .map((cell) => normalizeWhitespace(cell.text))
      .filter(Boolean);
    if (cells.length > 0) lines.push(cells.join(' | '));
    return;
  }

  if (tag === 'table') {
    node.querySelectorAll('tr').forEach((row) => renderNode(row, lines));
    lines.push('');
    return;
  }

  if (tag === 'blockquote') {
    const text = normalizeWhitespace(node.text);
    if (text) lines.push(`> ${text}`, '');
    return;
  }

  node.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      renderNode(child as HTMLElement, lines);
    }
  });
}

/** Convert article HTML into compact structured text that preserves headings and lists. */
export function htmlToAnalysisText(html: string): string {
  const root = parse(`<div id="analysis-root">${html}</div>`);
  const container = root.querySelector('#analysis-root');
  if (!container) return normalizeWhitespace(html.replace(/<[^>]+>/g, ' '));

  const lines: string[] = [];
  container.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      renderNode(child as HTMLElement, lines);
    }
  });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type PreparedAnalysisContent = {
  analysisContent: string;
  originalHtmlLength: number;
  fullTextLength: number;
  truncated: boolean;
};

const ANALYSIS_MAX_CHARS = 90000;

export function prepareHtmlForAnalysis(html: string, maxChars = ANALYSIS_MAX_CHARS): PreparedAnalysisContent {
  const structured = htmlToAnalysisText(html);
  const originalHtmlLength = html.length;
  const fullTextLength = structured.length;

  if (structured.length <= maxChars) {
    return {
      analysisContent: structured,
      originalHtmlLength,
      fullTextLength,
      truncated: false,
    };
  }

  const headSize = Math.floor(maxChars * 0.72);
  const tailSize = maxChars - headSize - 120;
  const analysisContent = [
    structured.slice(0, headSize),
    '\n\n[... middle of article omitted for length — full page was captured; do not assume the article ends here ...]\n\n',
    structured.slice(-tailSize),
  ].join('');

  return {
    analysisContent,
    originalHtmlLength,
    fullTextLength,
    truncated: true,
  };
}
