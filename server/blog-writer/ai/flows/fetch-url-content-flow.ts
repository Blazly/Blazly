
'use server';
/**
 * @fileOverview A Genkit flow that wraps the fetchUrlContentTool.
 *
 * This flow acts as a server-side entry point that can be safely called
 * from client components to fetch the content of a URL.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  fetchUrlContentTool,
  FetchUrlContentInputSchema,
  type FetchUrlContentInput,
  FetchUrlContentOutputSchema,
  type FetchUrlContentOutput,
} from '../tools/fetch-url-content-tool';

export async function fetchUrlContent(input: FetchUrlContentInput): Promise<FetchUrlContentOutput> {
  return fetchUrlContentFlow(input);
}

const fetchUrlContentFlow = defineFlowOnce(
  {
    name: 'fetchUrlContentFlow',
    inputSchema: FetchUrlContentInputSchema,
    outputSchema: FetchUrlContentOutputSchema,
  },
  async (input) => {
    // Directly call the tool and return its output.
    // This flow serves as a secure, server-side wrapper for the tool.
    return await fetchUrlContentTool(input);
  }
);
