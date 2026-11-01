'use server';

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { z } from 'genkit';

const ClassifyBlogUrlsInputSchema = z.object({
  urls: z
    .array(
      z.object({
        url: z.string(),
        heuristicMatch: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

export type ClassifyBlogUrlsInput = z.infer<typeof ClassifyBlogUrlsInputSchema>;

const ClassifyBlogUrlsOutputSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      isBlogPost: z.boolean(),
    }),
  ),
});

export type ClassifyBlogUrlsOutput = z.infer<typeof ClassifyBlogUrlsOutputSchema>;

export async function classifyBlogUrls(input: ClassifyBlogUrlsInput): Promise<ClassifyBlogUrlsOutput> {
  return classifyBlogUrlsFlow(input);
}

const classifyBlogUrlsPrompt = definePromptOnce({
  name: 'classifyBlogUrlsPromptV1',
  input: { schema: ClassifyBlogUrlsInputSchema },
  output: { schema: ClassifyBlogUrlsOutputSchema },
  prompt: `You are an SEO analyst classifying website URLs from Google Search Console.

For each URL, decide if it is an **individual blog post or article page** that should be refreshed or optimized.

**Mark isBlogPost = true** when the URL is a single article/post (e.g. /blog/my-article, /posts/guide-2026, /articles/how-to-seo).

**Mark isBlogPost = false** when the URL is:
- Blog index or listing (/blog, /blog/page/2)
- Category, tag, or author archive
- Homepage, product, pricing, contact, docs, or utility pages
- Pagination or feed URLs

URLs were pre-filtered for paths containing blog/post/article segments. Use the path structure to confirm each is a single post, not a listing.

**URLs to classify:**
{{#each urls}}
- {{{url}}} (heuristic pre-match: {{heuristicMatch}})
{{/each}}

Return JSON with a "results" array containing every input URL with isBlogPost true or false.`,
  config: {
    temperature: 0.1,
  },
});

const classifyBlogUrlsFlow = defineFlowOnce(
  {
    name: 'classifyBlogUrlsFlow',
    inputSchema: ClassifyBlogUrlsInputSchema,
    outputSchema: ClassifyBlogUrlsOutputSchema,
  },
  async (input) => {
    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await classifyBlogUrlsPrompt(input, { model });
        if (!response.output?.results?.length) {
          throw new Error('Blog URL classification did not return results.');
        }
        return response.output;
      },
      { label: 'classifyBlogUrls', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );

    return output;
  },
);
