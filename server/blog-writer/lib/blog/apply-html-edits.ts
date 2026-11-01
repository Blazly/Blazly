import { z } from 'zod';

export const HtmlEditSchema = z.object({
  find: z
    .string()
    .describe('Exact snippet copied character-for-character from the current HTML (a full sentence or heading, including any inline tags inside it). Must appear only once.'),
  replace: z.string().describe('Replacement HTML for exactly that snippet.'),
  reason: z.string().optional().describe('Short reason for the edit.'),
});
export type HtmlEdit = z.infer<typeof HtmlEditSchema>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies targeted find/replace edits so AI passes don't need to rewrite (and re-emit) the whole
 * article. Falls back to whitespace-insensitive matching; edits that can't be located are skipped.
 */
export function applyHtmlEdits(html: string, edits: HtmlEdit[] | undefined): { html: string; applied: HtmlEdit[] } {
  let result = html;
  const applied: HtmlEdit[] = [];

  for (const edit of edits ?? []) {
    const find = edit.find?.trim();
    if (!find || find === edit.replace?.trim()) continue;

    const index = result.indexOf(find);
    if (index !== -1) {
      result = result.slice(0, index) + edit.replace + result.slice(index + find.length);
      applied.push(edit);
      continue;
    }

    const pattern = new RegExp(find.split(/\s+/).map(escapeRegExp).join('\\s+'));
    const match = pattern.exec(result);
    if (match) {
      result = result.slice(0, match.index) + edit.replace + result.slice(match.index + match[0].length);
      applied.push(edit);
    }
  }

  return { html: result, applied };
}

export const HTML_EDITS_INSTRUCTIONS = `## HOW TO RETURN CHANGES (CRITICAL)
Do NOT rewrite or return the full article. Return only targeted edits in the "edits" array:
- "find": an exact snippet copied character-for-character from the HTML below — a full sentence, list item, table cell or heading, including any inline tags (<a>, <strong>, …) inside it. It must be unique in the article.
- "replace": the corrected HTML for exactly that snippet. Keep surrounding tags, links and id attributes intact.
- Keep edits small and focused. Return an empty array when nothing needs to change.`;
