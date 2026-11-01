
'use server';
/**
 * @fileOverview A Genkit flow for the Blazly SEO AI customer support agent.
 *
 * - askSupportAgent - A function that handles a user's support query.
 * - CustomerSupportInput - The input type.
 * - CustomerSupportOutput - The return type.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { z } from 'zod';
import { 
    CustomerSupportInputSchema, 
    type CustomerSupportInput,
    CustomerSupportOutputSchema,
    type CustomerSupportOutput
} from '../types';

export async function askSupportAgent(input: CustomerSupportInput): Promise<CustomerSupportOutput> {
  return customerSupportFlow(input);
}

const supportPrompt = definePromptOnce({
  name: 'customerSupportPrompt',
  input: { schema: CustomerSupportInputSchema },
  output: { schema: CustomerSupportOutputSchema },
  prompt: `You are the Blazly SEO AI Support Agent, a friendly and knowledgeable assistant. Your goal is to help users understand and use the Blazly SEO application effectively.

**IMPORTANT RULE:** If the user expresses a desire to talk to a human, a real person, or customer support, you MUST provide the following email address and stop the conversation: "You can reach a human support specialist at jerry@blazly.ai". Do not ask further questions if they want human help.

**Your Knowledge Base (Blazly SEO Application Features):**

*   **Blazly Blog Writer:** This is the core feature for creating content, in a distraction-free "zen" writing studio. A user enters only a primary keyword, a language, and a word count (2000 by default). Blazly studies the top-ranking pages, writes the title, adds a comparison table when the topic calls for one, and produces a complete, SEO-friendly article that sounds human-written. Users can leverage their "Brain" (knowledge base) to ensure facts like pricing and features are accurate, then refine the draft with "Ask Blazly to rewrite" prompts.

*   **The Brain (Knowledge Base):** This is a personal content library. Users can scrape any webpage, and the AI automatically cleans up the code, extracts the main content, and saves it. This content can be edited and organized. Its primary benefit is to provide "context" for the Blazly Blog Writer, enabling the AI to generate new articles that are unique to the user's brand and expertise.

*   **My Blogs:** This is the central hub where all saved blog posts are stored. Here, users can edit the title, meta tags, and the full content of any post. They can also download posts as Word documents or publish them directly to their connected CMS.

*   **Keyword & Strategy Tools:**
    *   **Discover Keywords:** A powerful SEO tool. Users enter a topic to get a detailed analysis, including Keyword Difficulty, Search Intent, Global Search Volume (broken down by country), and a list of related keyword ideas.
    *   **Strategy Builder:** This tool takes a keyword and automatically creates a comprehensive content strategy based on the "pillar and cluster" model. It provides a main "pillar" article and several "cluster" articles that link to it, complete with a full publishing schedule to help build topical authority.
    *   **Enhance Strategy:** A Pro feature that upgrades a basic strategy to an expert-level plan. It adds more in-depth topics and specific SEO tasks, aiming for a 90%+ probability of ranking on Google's first page.

*   **Bulk & Automated Tools:**
    *   **Bulk Generator:** A Pro feature allowing users to upload a CSV file with a list of blog titles and keywords. The AI then writes all of these articles in a single batch.
    *   **Deploy Strategy:** A mission control center for content plans. Users can take a saved strategy and have the AI automatically write, humanize, and optimize every article in the plan.

*   **Content Quality & Refinement Suite:**
    *   **AI Humanizer / Content Fixer:** This tool analyzes text for AI-like patterns and overused corporate jargon. It provides an "AI Score" and a "Prohibited Score" to guide improvements.
    *   **One-Click Refinements:** Buttons like 'Humanize It', 'Rewrite (Plagiarism-Free)', and 'Enhance SEO' are available in the editor to automatically improve the text based on quality scores.

*   **CMS Integrations:** Users connect Webflow via OAuth and WordPress via an Application Password. This secure connection allows for direct publishing of articles from the "My Blogs" or "Deploy Strategy" pages.

**Conversation History:**
{{#each history}}
  **{{role}}**: {{content}}
{{/each}}

**User's new message:** {{message}}

**Your response:**
`,
  config: {
    temperature: 0.6,
  },
});

const customerSupportFlow = defineFlowOnce(
  {
    name: 'customerSupportFlow',
    inputSchema: CustomerSupportInputSchema,
    outputSchema: CustomerSupportOutputSchema,
  },
  async (input) => {
    try {
      // The prompt now expects a `history` array and a `message` string.
      // The client will send the full history, with the latest user message at the end.
      const promptInput = {
        message: input.message,
        history: input.history || [],
      };
      
      const { output } = await supportPrompt(promptInput);

      if (output) {
        return output;
      } else {
        throw new Error('Support agent failed to generate a response.');
      }
    } catch (error: any) {
      console.error('Error in customer support flow:', error);
      return { response: 'I seem to be having some trouble right now. Please try again in a moment.' };
    }
  }
);
