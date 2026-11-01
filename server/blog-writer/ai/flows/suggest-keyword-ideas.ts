
'use server';

/**
 * @fileOverview A Genkit flow for suggesting blog post titles based on a keyword.
 *
 * This flow takes a keyword and generates a list of engaging, SEO-friendly blog titles.
 * - suggestKeywordIdeas - The main function to call the flow.
 * - SuggestKeywordIdeasInput - The input type.
 * - SuggestKeywordIdeasOutput - The output type.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  SuggestKeywordIdeasInputSchema,
  type SuggestKeywordIdeasInput,
  SuggestKeywordIdeasOutputSchema,
  type SuggestKeywordIdeasOutput,
} from '../types';


export async function suggestKeywordIdeas(input: SuggestKeywordIdeasInput): Promise<SuggestKeywordIdeasOutput> {
  return suggestKeywordIdeasFlow(input);
}

const ideasPrompt = definePromptOnce({
  name: 'suggestKeywordIdeasPrompt',
  input: { schema: SuggestKeywordIdeasInputSchema },
  output: { schema: SuggestKeywordIdeasOutputSchema },
  prompt: `You are an expert blog title generator. Given a keyword, you will generate 7 unique, compelling, and SEO-friendly blog post titles.

The titles should be a mix of different formats, such as:
- List-based titles (e.g., "7 Ways to...")
- How-to guides (e.g., "How to Properly...")
- Question-based titles (e.g., "What Is... And Why Should You Care?")
- Comparison titles (e.g., "X vs. Y: Which Is Better For...?")
- Titles that create curiosity (e.g., "The One Mistake You're Making With...")

Keyword: {{{keyword}}}

Generate 7 titles.`,
  config: {
    temperature: 0.8,
  },
});

const suggestKeywordIdeasFlow = defineFlowOnce(
  {
    name: 'suggestKeywordIdeasFlow',
    inputSchema: SuggestKeywordIdeasInputSchema,
    outputSchema: SuggestKeywordIdeasOutputSchema,
  },
  async (input) => {
    if (!input.keyword.trim()) {
      return { ideas: [] };
    }
    const { output } = await ideasPrompt(input);
    if (!output) {
      throw new Error('Failed to generate blog ideas from the keyword.');
    }
    return output;
  }
);
