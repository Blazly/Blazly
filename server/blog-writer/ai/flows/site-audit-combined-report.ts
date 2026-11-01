import { z } from 'zod';
import { ai } from '../genkit';
import { withLlmModelFallback } from '../llm-fallback';
import { APP_LLM_MODEL_CHAIN } from '../llm-models';
import { getAiTemporalContextBlock } from '../../lib/ai/date-context';
import type { CombinedReportSections } from '../../lib/site-audit/export-report-html';

export type CombinedReportPageInput = {
  name: string;
  url: string;
  score: number;
  gradeLabel: string;
  summary: string;
  failCount: number;
  warnCount: number;
  buckets: Array<{ label: string; score: number | null }>;
  issues: Array<{
    category: string;
    label: string;
    status: 'fail' | 'warn';
    detail: string;
    recommendation: string;
  }>;
};

export type SiteAuditCombinedReportInput = {
  projectName: string;
  domainUrl: string;
  averageScore: number;
  pages: CombinedReportPageInput[];
};

const CombinedReportOutputSchema = z.object({
  executiveSummary: z.string(),
  siteWideThemes: z.array(z.string()).min(1).max(8),
  priorityActions: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        pagesAffected: z.array(z.string()),
      }),
    )
    .min(1)
    .max(12),
  pageHighlights: z
    .array(
      z.object({
        pageName: z.string(),
        url: z.string(),
        score: z.number(),
        note: z.string(),
      }),
    )
    .min(1),
  conclusion: z.string(),
});

function dossier(input: SiteAuditCombinedReportInput): string {
  const lines = input.pages.map((page) => {
    const topIssues = page.issues
      .slice(0, 25)
      .map(
        (i) =>
          `    - [${i.status.toUpperCase()}] ${i.category} · ${i.label}: ${i.detail}${i.recommendation ? ` → Fix: ${i.recommendation}` : ''}`,
      )
      .join('\n');
    const buckets = page.buckets.map((b) => `${b.label}=${b.score ?? 'n/a'}`).join(', ');
    return `PAGE: ${page.name}
URL: ${page.url}
SCORE: ${page.score}/100 (${page.gradeLabel}) · Failed checks: ${page.failCount} · Warnings: ${page.warnCount}
BUCKETS: ${buckets}
SUMMARY: ${page.summary || '(none)'}
ISSUES:
${topIssues || '    (none)'}`;
  });
  return `PROJECT: ${input.projectName}
DOMAIN: ${input.domainUrl}
AVERAGE SCORE: ${input.averageScore}/100
PAGES AUDITED: ${input.pages.length}

${lines.join('\n\n')}`;
}

export async function generateSiteAuditCombinedReport(
  input: SiteAuditCombinedReportInput,
): Promise<CombinedReportSections> {
  const prompt = `${getAiTemporalContextBlock()}

You are a senior SEO consultant writing a client-ready combined site audit report for "${input.projectName}".

You receive scored page audits with checklist failures and warnings. Your job:
1. Synthesize patterns across pages (duplicate themes, systemic technical/content gaps).
2. Prioritize fixes by business impact — do not list every minor warning separately in priority actions; group related issues.
3. Reference specific page names when issues are page-specific.
4. Write in clear, professional English. No markdown. No mention of AI, models, or how this report was produced.

Return JSON matching the schema.

AUDIT DATA
${dossier(input)}`;

  const { result } = await withLlmModelFallback(
    async (model) => {
      const { output } = await ai.generate({
        model,
        prompt,
        output: { schema: CombinedReportOutputSchema },
        config: { temperature: 0.25 },
      });
      if (!output) throw new Error('Combined report returned no output.');
      return output;
    },
    { label: 'siteAuditCombinedReport', models: APP_LLM_MODEL_CHAIN },
  );

  return result;
}
