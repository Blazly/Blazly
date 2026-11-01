'use server';
/**
 * @fileOverview AI agent that attempts to analyze text for AI-like characteristics.
 *
 * - analyzeContentAuthenticity - A function that provides an estimated AI likelihood score.
 * - AnalyzeContentAuthenticityInput - The input type.
 * - AnalyzeContentAuthenticityOutput - The return type.
 * - FlaggedSegment - The type for a flagged text segment with a suggestion.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  AnalyzeContentAuthenticityInputSchema,
  type AnalyzeContentAuthenticityInput,
  AnalyzeContentAuthenticityOutputSchema,
  type AnalyzeContentAuthenticityOutput
} from '../types';


export async function analyzeContentAuthenticity(input: AnalyzeContentAuthenticityInput): Promise<AnalyzeContentAuthenticityOutput> {
  return analyzeContentAuthenticityFlow(input);
}

const analysisPrompt = definePromptOnce({
  name: 'analyzeContentAuthenticityPrompt',
  input: {schema: AnalyzeContentAuthenticityInputSchema},
  output: {schema: AnalyzeContentAuthenticityOutputSchema},
  prompt: `Analyze the following text for characteristics commonly found in AI-generated content.

Consider the following factors:
1.  **Repetitive Phrasing:** Are there unusually repetitive n-grams or phrases? Does the text use the same sentence structures or transition words too often?
2.  **AI-Specific Phrases:** Does the text contain phrases commonly used by AI, such as: "as an AI", "language model", "as an artificial", "i am unable", "generate human-like text", "based on the input", "my purpose is", "i was trained", "deep learning", "it is important to note", "in conclusion", "furthermore", "however", "therefore", "additionally", "leverage", "harness", "delve", "navigate", "seamless", "robust", "dynamic", "realm", "landscape", "testament", "elevate", "crucial", "propel", "unleash", "synergize", "comprehensive", "streamline", "optimize"?
3.  **Generic Vocabulary & Lack of Specificity:** Does the text rely heavily on common or overly general words (e.g., 'important', 'understand', 'various', 'numerous', 'overall') without providing concrete details, examples, or nuanced insights?
4.  **Tone and Voice:** Does the text lack a distinct personal voice? Is it overly formal, impersonal, or robotic? Does it use an excessive amount of corporate jargon or marketing clichés?
5.  **Predictable Structure:** Does the content follow very predictable patterns? Is the flow of ideas too simplistic or lacking in depth?
6.  **E-E-A-T Signals (within the text):** Does the text project a sense of real Experience, Expertise, Authoritativeness, and Trustworthiness? (e.g., through specific examples, cited knowledge (even if simulated), logical depth vs. superficial statements). A lack of these can be an AI tell.
7.  **Unusual Patterns (Watermark-like):** Are there any highly unusual, out-of-place character sequences, formatting quirks, or non-contextual patterns that might suggest automated generation?

Scoring Guidelines:
*   **0-20% (Very Human-like):** Strong E-E-A-T signals, natural and varied language, personal voice evident, no repetitive patterns or AI-specific phrases.
*   **21-40% (Mostly Human-like):** Generally natural, but may contain a few minor AI tells (e.g., occasional generic phrase, slightly predictable structure in parts).
*   **41-60% (Mixed - Leaning AI):** Contains some human elements but also noticeable AI patterns (e.g., some AI phrases, some repetitive structures, somewhat generic vocabulary).
*   **61-80% (Likely AI-generated):** Clear AI characteristics are present (e.g., multiple AI phrases, repetitive sentence structures, formal/impersonal tone, lack of specificity).
*   **81-100% (Highly AI-generated):** Obvious AI generation; many red flags from the factors listed above are present.

Based on your analysis, provide:
1.  An estimated 'aiLikelihoodScore' (0-100).
2.  A 'justification' for your score: Highlight key characteristics. Explain *why* the score is at its current level (what pushed it there, and what prevented it from being higher/lower).
3.  A 'flaggedSegments' array: List up to 10-15 distinct words or short phrases from the input text that are strong indicators of AI generation. For each 'segment', provide a concise 'suggestion' for improvement (e.g., "Consider rephrasing", "Common AI phrase", "Try simpler word").

Text to analyze:
{{{textContent}}}

Analysis:`,
  config: {
    temperature: 0.6, // Slightly increased from 0.5 to encourage more varied scoring and justifications
  },
});

const analyzeContentAuthenticityFlow = defineFlowOnce(
  {
    name: 'analyzeContentAuthenticityFlow',
    inputSchema: AnalyzeContentAuthenticityInputSchema,
    outputSchema: AnalyzeContentAuthenticityOutputSchema,
  },
  async (input) => {
    if (!input.textContent.trim()) {
      return {
        aiLikelihoodScore: 0,
        justification: 'Input text was empty. Score set to 0.',
        flaggedSegments: [],
      };
    }
    
    try {
      const {output} = await analysisPrompt(input);
      if (output) {
        return output;
      } else {
        throw new Error('Analysis prompt did not return a valid output.');
      }
    } catch (error) {
      console.error('Error during content authenticity analysis flow:', error);
      // Fallback response in case of error
      return {
        aiLikelihoodScore: 50, // Default to a neutral score on error
        justification: 'Could not perform analysis due to an internal error. Please try again.',
        flaggedSegments: [],
      };
    }
  }
);
