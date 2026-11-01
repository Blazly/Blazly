
'use server';
/**
 * @fileOverview An AI flow to format scraped HTML content.
 *
 * - formatScrapedContent - A function that takes messy HTML and returns a clean, structured version.
 */

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { z } from 'zod';

const FormatScrapedContentInputSchema = z.object({
  htmlContent: z.string().describe('The raw HTML content scraped from a webpage.'),
});
type FormatScrapedContentInput = z.infer<typeof FormatScrapedContentInputSchema>;

const FormatScrapedContentOutputSchema = z.object({
  formattedHtmlContent: z.string().describe('The cleaned and well-structured HTML content.'),
});
type FormatScrapedContentOutput = z.infer<typeof FormatScrapedContentOutputSchema>;


export async function formatScrapedContent(input: FormatScrapedContentInput): Promise<FormatScrapedContentOutput> {
  return formatScrapedContentFlow(input);
}


const formattingPrompt = definePromptOnce({
    name: 'formatScrapedContentPrompt',
    input: { schema: FormatScrapedContentInputSchema },
    output: { schema: FormatScrapedContentOutputSchema },
    prompt: `You are an expert at cleaning and re-formatting messy HTML code.
Your task is to take the provided HTML content, which was scraped from a website, and re-format it into a clean, readable, and semantically correct HTML structure.

**Execution Rules:**

1.  **Identify the Core Content:** Analyze the HTML to understand the main textual content. Ignore and remove navigation elements, ads, social media links, "related articles" sections, and any other non-essential cruft.
2.  **Preserve Meaning and Structure:** Maintain the original hierarchy of the content. Headings should remain headings, paragraphs should remain paragraphs, and lists should remain lists.
3.  **Use Semantic HTML:** Use appropriate tags like \`<h2>\`, \`<h3>\`, \`<p>\`, \`<ul>\`, \`<ol>\`, \`<li>\`, and \`<strong>\`.
4.  **Remove All Styling:** Strip all inline styles, style attributes, and class attributes. The output should be unstyled, semantic HTML.
5.  **Clean Up Text:** Remove excessive whitespace and any leftover script or style content.
6.  **Output ONLY HTML:** Your final output should be only the cleaned HTML content. Do not include any explanation or surrounding text.

**Messy HTML Input:**
\`\`\`html
{{{htmlContent}}}
\`\`\`

**Cleaned and Formatted HTML Output:**
`,
    config: {
        temperature: 0.2,
    }
});


const formatScrapedContentFlow = defineFlowOnce(
  {
    name: 'formatScrapedContentFlow',
    inputSchema: FormatScrapedContentInputSchema,
    outputSchema: FormatScrapedContentOutputSchema,
  },
  async (input) => {
    if (!input.htmlContent.trim()) {
        return { formattedHtmlContent: '' };
    }

    try {
        const { result: output } = await withLlmModelFallback(
          async (model) => {
            const response = await formattingPrompt(input, { model });
            if (!response.output) {
              throw new Error('Formatting prompt did not return valid output.');
            }
            return response.output;
          },
          { label: 'formatScrapedContent', models: STRATEGY_DEPLOY_LLM_CHAIN },
        );
        return output;
    } catch (error: any) {
      console.error('Error during content formatting flow:', error);
      // Fallback to returning the original content if formatting fails
      return { formattedHtmlContent: input.htmlContent };
    }
  }
);
