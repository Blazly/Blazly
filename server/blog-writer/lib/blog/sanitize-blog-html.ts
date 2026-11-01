/** Shared HTML cleanup for AI-generated blog content. */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type FinalizeBlogHtmlOptions = {
  /** Keep question marks (question-style headings, FAQs, sample prompts). */
  allowQuestions?: boolean;
};

export function sanitizeBlogContent(html: string, options: FinalizeBlogHtmlOptions = {}): string {
  let result = html;
  result = result.replace(/\*{3}([^*]+?)\*{3}/g, '<strong><em>$1</em></strong>');
  result = result.replace(/\*{2}([^*]+?)\*{2}/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  result = result.replace(/(?<![<\w/])\*+(?![>\w])/g, '');
  if (!options.allowQuestions) {
    result = result.replace(/\?(\s*<\/)/g, '.$1');
    result = result.replace(/\?\s*$/g, '.');
  }
  return result;
}

/** Remove <strong>/<b> wrappers placed only around the primary keyword phrase. */
export function stripPrimaryKeywordBoldTags(
  html: string,
  primaryKeyword?: string | null,
): string {
  if (!primaryKeyword?.trim()) return html;

  const keyword = primaryKeyword.trim();
  const escaped = escapeRegExp(keyword);

  let result = html;

  result = result.replace(
    new RegExp(`<strong\\s*>(\\s*)(${escaped})(\\s*)</strong>`, 'gi'),
    '$1$2$3',
  );
  result = result.replace(
    new RegExp(`<b\\s*>(\\s*)(${escaped})(\\s*)</b>`, 'gi'),
    '$1$2$3',
  );
  result = result.replace(
    new RegExp(`<strong\\s*>(${escaped})([.,;:!?]*)</strong>`, 'gi'),
    '$1$2',
  );
  result = result.replace(
    new RegExp(`<b\\s*>(${escaped})([.,;:!?]*)</b>`, 'gi'),
    '$1$2',
  );

  return result;
}

/** Split plain text into sentences (handles . ! ? terminators). */
function splitPlainSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (sentences ?? [normalized]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Break long <p> blocks into shorter paragraphs for readability.
 * Default: at most 3 sentences per paragraph.
 */
export function splitLongParagraphs(html: string, maxSentences = 3): string {
  return html.replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (_match, attrs: string | undefined, inner: string) => {
    const attrPart = attrs ?? '';
    const plain = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = splitPlainSentences(plain);

    // Rebuilding from plain text would drop inline links, so linked paragraphs stay intact.
    if (sentences.length <= maxSentences || /<a\s/i.test(inner)) {
      return `<p${attrPart}>${inner}</p>`;
    }

    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += maxSentences) {
      chunks.push(sentences.slice(i, i + maxSentences).join(' '));
    }

    return chunks.map((chunk) => `<p${attrPart}>${chunk}</p>`).join('\n');
  });
}

export function finalizeBlogHtml(
  html: string,
  primaryKeyword?: string | null,
  options: FinalizeBlogHtmlOptions = {},
): string {
  const sanitized = stripPrimaryKeywordBoldTags(sanitizeBlogContent(html, options), primaryKeyword);
  return splitLongParagraphs(sanitized, 3);
}

/**
 * Light cleanup that does NOT restructure paragraphs or strip punctuation.
 * Used when humanizing user-pasted content that must keep its original layout.
 */
export function sanitizePreservingFormat(html: string): string {
  let result = html;
  result = result.replace(/\*{3}([^*]+?)\*{3}/g, '<strong><em>$1</em></strong>');
  result = result.replace(/\*{2}([^*]+?)\*{2}/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  result = result.replace(/(?<![<\w/])\*+(?![>\w])/g, '');
  return result;
}
