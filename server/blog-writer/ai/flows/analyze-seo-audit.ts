'use server';

import { ai } from '../genkit';
import { defineFlowOnce } from '../define-once';
import { getSeoAuditRuntimeContext, getSeoAuditSystemInstruction } from '../../lib/ai/seo-audit-context';
import { z } from 'zod';

const AffectedItemSchema = z.object({
  url: z.string().optional(),
  query: z.string().optional(),
  position: z.number().optional(),
  ctr: z.number().optional(),
  expectedCtr: z.number().optional(),
  impressions: z.number().optional(),
  clicks: z.number().optional(),
  clickChangePct: z.number().optional(),
  impressionChangePct: z.number().optional(),
  competingUrls: z.array(z.string()).optional(),
  linkFromUrls: z.array(z.string()).optional(),
  topicalScore: z.number().optional(),
  potentialGain: z.string().optional(),
  insight: z.string().optional(),
  coverageStatus: z.string().optional(),
  submitted: z.number().optional(),
  indexed: z.number().optional(),
  errors: z.union([z.number(), z.string()]).optional(),
  warnings: z.union([z.number(), z.string()]).optional(),
});

const AnalyzeSeoAuditInputSchema = z.object({
  propertyUrl: z.string(),
  stats: z.object({
    totalPages: z.number(),
    totalClicks: z.number(),
    totalImpressions: z.number(),
    avgPosition: z.number(),
    avgCtr: z.number(),
  }),
  issues: z.array(z.object({
    id: z.string(),
    auditType: z.enum([
      'keyword-opportunity',
      'low-ctr',
      'content-decay',
      'cannibalization',
      'index-coverage',
      'internal-linking',
    ]).optional(),
    category: z.string(),
    severity: z.string(),
    title: z.string(),
    description: z.string(),
    affectedUrls: z.array(AffectedItemSchema).optional(),
    suggestions: z.array(z.string()).optional(),
  })),
});

export type AnalyzeSeoAuditInput = z.infer<typeof AnalyzeSeoAuditInputSchema>;

const AnalyzeSeoAuditOutputSchema = z.object({
  overallScore: z.number().min(0).max(100),
  overallVerdict: z.string(),
  fixes: z.array(z.object({
    issueId: z.string(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    title: z.string(),
    explanation: z.string(),
    steps: z.array(z.string()),
    codeExample: z.string().optional(),
    estimatedImpact: z.string(),
  })),
  quickWins: z.array(z.object({
    title: z.string(),
    description: z.string(),
    timeToFix: z.string(),
  })),
  strategicRecommendations: z.array(z.string()),
});

export type AnalyzeSeoAuditOutput = z.infer<typeof AnalyzeSeoAuditOutputSchema>;

export async function analyzeSeoAudit(input: AnalyzeSeoAuditInput): Promise<AnalyzeSeoAuditOutput> {
  return analyzeSeoAuditFlow(input);
}

const AUDIT_TYPE_GUIDANCE: Record<string, string> = {
  'keyword-opportunity': 'Focus on title rewrites, meta descriptions, FAQ additions, internal links, and content expansion for keywords ranking positions 4–20 with high impressions but low CTR.',
  'low-ctr': 'Focus on emotional titles, numbers, year modifiers, intent mismatch fixes, and SERP-aligned meta descriptions for queries with strong positions but poor CTR.',
  'content-decay': 'Diagnose declining clicks/impressions — recommend content refresh, competitor gap analysis, topical expansion, internal link rebuilds, and AI Overview cannibalization checks.',
  cannibalization: 'Recommend merge/canonical/redirect strategies, intent differentiation, and internal linking to consolidate authority when multiple URLs rank for the same query.',
  'index-coverage': 'Recommend technical fixes for indexing gaps — submitted but not indexed, sitemap errors, low index rates, duplicate/alternate pages, and soft 404 patterns.',
  'internal-linking': 'Recommend which high-authority pages should link to under-ranked URLs. Specify anchor text, placement, and hub-to-cluster linking patterns for programmatic SEO.',
};

function formatAffectedItem(u: z.infer<typeof AffectedItemSchema>): string {
  const parts: string[] = [];
  if (u.query) parts.push(`query: "${u.query}"`);
  if (u.url) parts.push(`url: ${u.url}`);
  if (u.position !== undefined) parts.push(`position: ${u.position}`);
  if (u.ctr !== undefined) parts.push(`CTR: ${u.ctr}%`);
  if (u.expectedCtr !== undefined) parts.push(`expected CTR: ~${u.expectedCtr}%`);
  if (u.impressions !== undefined) parts.push(`impressions: ${u.impressions}`);
  if (u.clicks !== undefined) parts.push(`clicks: ${u.clicks}`);
  if (u.clickChangePct !== undefined) parts.push(`click change: ${u.clickChangePct}%`);
  if (u.potentialGain) parts.push(`potential: ${u.potentialGain}`);
  if (u.competingUrls?.length) parts.push(`competing URLs: ${u.competingUrls.join(', ')}`);
  if (u.linkFromUrls?.length) parts.push(`link from: ${u.linkFromUrls.join(', ')}`);
  if (u.topicalScore !== undefined) parts.push(`topical score: ${u.topicalScore}`);
  if (u.coverageStatus) parts.push(`status: ${u.coverageStatus}`);
  if (u.submitted !== undefined && u.indexed !== undefined) parts.push(`indexed: ${u.indexed}/${u.submitted}`);
  if (u.insight) parts.push(`insight: ${u.insight}`);
  return parts.join(', ');
}

const analyzeSeoAuditFlow = defineFlowOnce(
  {
    name: 'analyzeSeoAuditFlow',
    inputSchema: AnalyzeSeoAuditInputSchema,
    outputSchema: AnalyzeSeoAuditOutputSchema,
  },
  async (input) => {
    const isSingleIssue = input.issues.length === 1;

    const issuesSummary = input.issues.map((issue) => {
      const auditType = issue.auditType || 'unknown';
      let detail = `- [${issue.id}] [${auditType}] [${issue.severity.toUpperCase()}] ${issue.title}: ${issue.description}`;

      if (issue.suggestions?.length) {
        detail += `\n  Pre-computed suggestions: ${issue.suggestions.join('; ')}`;
      }

      if (issue.affectedUrls?.length) {
        const examples = issue.affectedUrls.slice(0, 8).map((u) => `  * ${formatAffectedItem(u)}`).join('\n');
        detail += `\n  Findings:\n${examples}`;
      }

      if (AUDIT_TYPE_GUIDANCE[auditType]) {
        detail += `\n  Audit focus: ${AUDIT_TYPE_GUIDANCE[auditType]}`;
      }

      return detail;
    }).join('\n\n');

    const singleIssuePrompt = isSingleIssue
      ? `Provide a detailed fix for the ONE audit finding below. Include concrete title/meta rewrites, FAQ ideas, internal link targets, or technical HTML where applicable.`
      : `Provide fixes for each audit finding listed below.`;

    const { currentDate, currentYear } = getSeoAuditRuntimeContext();

    const { output } = await ai.generate({
      prompt: `${getSeoAuditSystemInstruction()}

**Authoritative clock:** ${currentDate} (currentYear: ${currentYear})

You are a senior SEO consultant analyzing Google Search Console audit results for "${input.propertyUrl}".

## Site Performance Summary (Last 28 Days)
- Total pages in search results: ${input.stats.totalPages}
- Total clicks: ${input.stats.totalClicks}
- Total impressions: ${input.stats.totalImpressions}
- Average position: ${input.stats.avgPosition}
- Average CTR: ${input.stats.avgCtr}%

## Audit Types in This Report
1. **Keyword Opportunity** — positions 4–20, high impressions, low CTR (easy wins)
2. **Low CTR** — strong rankings but click underperformance vs expected CTR
3. **Content Decay** — pages losing clicks/impressions vs previous 28 days
4. **Cannibalization** — multiple URLs competing for the same query
5. **Index Coverage / Technical SEO Health** — sitemap and indexing gaps
6. **Internal Linking** — high-authority pages that should link to under-ranked URLs via topical similarity

## Findings (${input.issues.length} total)
${issuesSummary || 'No major issues detected.'}

${singleIssuePrompt}

Return:
1. **Overall SEO health score** (0-100) weighted by severity and traffic impact
2. **Overall verdict** — 2-3 sentences on site health and biggest opportunities
3. **Fixes for each issue** — match issueId exactly. For each:
   - Priority (critical/high/medium/low)
   - Clear title
   - WHY this hurts SEO (reference actual queries, URLs, CTR, position, or decay %)
   - Step-by-step actions a site owner can execute this week
   - Code example when useful (title/meta HTML, FAQ schema, canonical tag, robots.txt, redirect)
   - Estimated traffic impact using the metrics provided
4. **Quick wins** — 3-5 fixes under 30 minutes with immediate impact
5. **Strategic recommendations** — 3-5 longer-term moves based on the audit data

Be specific to THIS site. Reference actual queries, URLs, positions, CTR values, and decay percentages from the findings. Do not give generic SEO advice.`,
      output: { schema: AnalyzeSeoAuditOutputSchema },
    });

    if (!output) {
      throw new Error('AI failed to generate SEO audit analysis.');
    }

    return output;
  }
);
