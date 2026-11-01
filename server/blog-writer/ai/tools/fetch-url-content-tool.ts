
/**
 * @fileOverview A Genkit tool to fetch HTML content from a URL.
 *
 * - fetchUrlContentTool - The Genkit tool definition.
 * - FetchUrlContentInputSchema - Zod schema for the input.
 * - FetchUrlContentInput - TypeScript type for the input.
 * - FetchUrlContentOutputSchema - Zod schema for the output.
 * - FetchUrlContentOutput - TypeScript type for the output.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {z} from 'genkit';
import { extractMainContentFromHtml, fetchPageHtml } from '../../lib/scrape/extract-page-content';

export const FetchUrlContentInputSchema = z.object({
  url: z.string().url().describe('The URL to fetch content from.'),
});
export type FetchUrlContentInput = z.infer<typeof FetchUrlContentInputSchema>;

export const FetchUrlContentOutputSchema = z.object({
  url: z.string().url().describe('The original URL that was fetched.'),
  htmlContent: z.string().optional().describe('The fetched and cleaned HTML content of the page.'),
  error: z.string().optional().describe('An error message if fetching failed.'),
});
export type FetchUrlContentOutput = z.infer<typeof FetchUrlContentOutputSchema>;

export const fetchUrlContentTool = defineToolOnce(
  {
    name: 'fetchUrlContentTool',
    description: 'Fetches and cleans the main HTML content of a given URL. Returns the HTML content or an error message.',
    inputSchema: FetchUrlContentInputSchema,
    outputSchema: FetchUrlContentOutputSchema,
  },
  async ({ url }): Promise<FetchUrlContentOutput> => {
    try {
      const rawHtml = await fetchPageHtml(url, 20000);
      if (!rawHtml) {
        return { url, error: `Failed to fetch URL or page did not return HTML: ${url}` };
      }

      const extracted = extractMainContentFromHtml(rawHtml);
      if (!extracted?.htmlContent) {
        return { url, error: "Could not find a 'body' or main content element in the HTML." };
      }

      return { url, htmlContent: extracted.htmlContent };

    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        return { url, error: `Timeout while fetching URL: ${url}` };
      }
      return { url, error: `Exception during fetch: ${err.message}` };
    }
  }
);
