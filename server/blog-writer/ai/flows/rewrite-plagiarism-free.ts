'use server';

/**
 * @fileOverview AI agent that rewrites blog post content to be plagiarism-free
 * while maintaining core meaning, keywords, and tone.
 *
 * - rewritePlagiarismFree - A function that processes HTML content to make it plagiarism-free.
 * - RewritePlagiarismFreeInput - The input type.
 * - RewritePlagiarismFreeOutput - The return type.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {z} from 'genkit';
import {
  RewritePlagiarismFreeInputSchema,
  type RewritePlagiarismFreeInput,
  RewritePlagiarismFreeOutputSchema,
  type RewritePlagiarismFreeOutput,
} from '../types';


export async function rewritePlagiarismFree(input: RewritePlagiarismFreeInput): Promise<RewritePlagiarismFreeOutput> {
  return rewritePlagiarismFreeFlow(input);
}

// Prompt to convert HTML to plain text for easier rewriting
const htmlToTextPrompt = definePromptOnce({
  name: 'htmlToPlainTextPromptForPlagiarismRewrite',
  input: {schema: z.object({ htmlContent: z.string() })},
  output: {schema: z.object({ plainTextContent: z.string() })},
  prompt: `Convert the following HTML content into clean, well-structured plain text.
Preserve paragraph breaks (as newlines) and the core meaning of list structures.
Remove all HTML tags. Focus on extracting the textual content.

HTML Content:
{{{htmlContent}}}

Plain Text Content:`,
  config: {
    temperature: 0.2,
  },
});

// Prompt for core plagiarism-free rewrite
const coreRewritePrompt = definePromptOnce({
  name: 'corePlagiarismFreeRewritePrompt',
  input: {
    schema: z.object({
      plainTextContent: z.string(),
      blogTitle: z.string(),
      primaryKeyword: z.string(),
      secondaryKeyword: z.string(),
      tone: z.string(),
      targetWordCount: z.number(),
      language: z.string().optional().default('English'),
    }),
  },
  output: {schema: z.object({ rewrittenPlainText: z.string() })},
  prompt: `You are an expert editor tasked with rewriting the following text to make it original and plagiarism-free.
Your goal is to significantly alter the wording and sentence structure while preserving the original meaning, factual information, keywords, tone, and approximate word count.

## STRICT LANGUAGE MANDATE (CRITICAL)
- **THE FINAL OUTPUT MUST BE ENTIRELY AND EXCLUSIVELY IN {{language}}.** 
- **ABSOLUTELY NO ENGLISH**: Do not use English if the target language is not English.
- Every single sentence, word, and character must be strictly in {{language}}.
- **NO BILINGUAL OUTPUT**: Never mix languages.

**FORMATTING RULES (CRITICAL)**: 
- **ABSOLUTELY NO ASTERISKS**: Never use asterisks (* or **) for emphasis.

Original Topic Context: "{{blogTitle}}"
Primary Keyword to maintain: "{{primaryKeyword}}"
Secondary Keyword to maintain: "{{secondaryKeyword}}"
Desired Tone: {{tone}}
Target Language: {{language}}
Strict Target Word Count: At least {{targetWordCount}} words in {{language}}.

Original Text:
{{{plainTextContent}}}

Rewrite this text comprehensively in {{language}}, applying the following techniques to ensure originality:

1.  **Deep Paraphrasing**: Do not just replace a few words. Rephrase entire ideas and concepts in new ways.
2.  **Sentence Structure Variation**: Radically change sentence structures in {{language}}.
3.  **Vocabulary Diversification**: Use a wide range of synonyms in {{language}}.
4.  **Reorganization of Information (Subtle)**: Alter the order of arguments if appropriate.
5.  **Maintain All Constraints**:
    *   The fundamental message MUST be preserved in {{language}}.
    *   Keywords must be naturally integrated.
    *   Target word count MUST be met strictly using {{language}} text.
6.  **Apply SEO Best Practices**: Use headings and lists in {{language}}.

Provide ONLY the rewritten, plagiarism-free plain text in {{language}}. Do not include preambles, apologies, or meta-commentary.
Rewritten Plagiarism-Free Text:`,
  config: {
    temperature: 0.75, 
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  },
});

// Prompt to convert rewritten plain text back to HTML
const textToHtmlPrompt = definePromptOnce({
  name: 'rewrittenTextToHtmlPromptForPlagiarism',
  input: {schema: z.object({ rewrittenPlainText: z.string(), blogTitle: z.string() })},
  output: {schema: z.object({ finalHtmlOutput: z.string() })},
  prompt: `Convert the following rewritten plain text into well-structured HTML.

Guidelines:
- **ABSOLUTELY NO ASTERISKS**: NEVER use asterisks for bold or italics. Use <strong> and <em> tags instead.
- **Do NOT include the main blog title ("{{blogTitle}}") or an <h1> tag.**
- **The content MUST begin with a paragraph tag (<p>). Do not start with a heading.**
- Use <h2>, <h3>, and <h4> for headings as appropriate.
- Use <p> for paragraphs.
- Use <ul> with <li> for bullet points.
- Use <ol> with <li> for numbered lists.
- Use <strong> for bold text.
- Use <em> for italic text.
- Ensure the output is ONLY the HTML content itself.

Plain Text:
{{{rewrittenPlainText}}}

HTML Output:`,
  config: {
    temperature: 0.2,
  },
});


const rewritePlagiarismFreeFlow = defineFlowOnce(
  {
    name: 'rewritePlagiarismFreeFlow',
    inputSchema: RewritePlagiarismFreeInputSchema,
    outputSchema: RewritePlagiarismFreeOutputSchema,
  },
  async (input) => {
    // Step 1: Convert HTML to Plain Text
    const htmlToTextResult = await htmlToTextPrompt({ htmlContent: input.htmlContent });
    const plainTextContent = htmlToTextResult.output?.plainTextContent;

    if (!plainTextContent) {
      throw new Error('Failed to convert HTML to plain text for plagiarism rewrite.');
    }

    // Step 2: Core Plagiarism-Free Rewrite
    const coreRewriteResult = await coreRewritePrompt({
      plainTextContent,
      blogTitle: input.blogTitle,
      primaryKeyword: input.primaryKeyword || '',
      secondaryKeyword: input.secondaryKeyword || '',
      tone: input.tone,
      targetWordCount: input.targetWordCount,
      language: input.language || 'English',
    });
    const rewrittenPlainText = coreRewriteResult.output?.rewrittenPlainText;

    if (!rewrittenPlainText) {
      throw new Error('Failed to perform core plagiarism-free rewrite.');
    }

    // Step 3: Convert Rewritten Plain Text back to HTML
    const textToHtmlResult = await textToHtmlPrompt({ rewrittenPlainText, blogTitle: input.blogTitle });
    const finalHtmlOutput = textToHtmlResult.output?.finalHtmlOutput;

    if (!finalHtmlOutput) {
      throw new Error('Failed to convert rewritten text back to HTML.');
    }

    return { rewrittenHtmlContent: finalHtmlOutput };
  }
);
