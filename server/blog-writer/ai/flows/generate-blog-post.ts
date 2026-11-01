'use server';

/**
 * @fileOverview AI agent that generates blog posts based on user input.
 *
 * - generateBlogPost - A function that generates a blog post based on the provided parameters.
 * - GenerateBlogPostInput - The input type for the generateBlogPost function.
 * - GenerateBlogPostOutput - The return type for the generateBlogPost function.
 */

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { getBlogWriterModelChain } from '../blog-writer-models';
import {z} from 'genkit';
import { fetchUrlContentTool, type FetchUrlContentOutput } from '../tools/fetch-url-content-tool';
import { formatScrapedContent } from '../flows/format-scraped-content';
import { humanWrittenBlogExample } from '../examples/human-written-blog-example';
import { advancedHumanizeText } from '../flows/advanced-humanize-text';
import {
  GenerateBlogPostInputSchema,
  type GenerateBlogPostInput,
  GenerateBlogPostOutputSchema,
  type GenerateBlogPostOutput,
  type BlogGenerationSources,
  BLOG_WRITER_MAX_WORD_COUNT,
} from '../types';
import { finalizeBlogHtml } from '../../lib/blog/sanitize-blog-html';
import { getAiTemporalContextBlock } from '../../lib/ai/date-context';

// Extended schema for the generation prompt to include fetched HTML and the human example
const GenerationPromptInputSchema = GenerateBlogPostInputSchema.extend({
  yourProductHtmlContent: z.string().optional().describe('Clean, formatted HTML content of your product page if URL was provided and fetched.'),
  yourProductFetchError: z.string().optional().describe('Error message if fetching your product URL failed.'),
  referenceBlogsHtml: z.array(z.string()).optional().describe('Clean, formatted HTML content of the reference sites.'),
  competitorsHtml: z.array(z.string()).optional().describe('Clean, formatted HTML content of the competitor sites.'),
  humanWrittenExample: z.string().describe('An example of a high-quality, human-written article to use as a style guide.'),
  shouldGenerateTable: z.boolean().describe('A boolean indicating if the comparison table should be generated.'),
  autoComparisonTable: z.boolean().describe('When true, the AI decides whether the topic needs a comparison table.'),
  isLongForm: z.boolean().describe('True when the target word count is 1500 or more.'),
  maxWordCount: z.number().optional().describe('Upper word limit for the article.'),
});
type GenerationPromptInput = z.infer<typeof GenerationPromptInputSchema>;

export async function generateBlogPost(input: GenerateBlogPostInput): Promise<GenerateBlogPostOutput> {
  return generateBlogPostFlow(input);
}

export async function fetchBlogGenerationSources(input: GenerateBlogPostInput): Promise<BlogGenerationSources> {
  const urlsToFetch: { url: string; type: 'yourProduct' | 'competitor' | 'reference' }[] = [];
  const shouldGenerateTable = input.generateComparisonTable === 'yes';

  if (input.productUrl) {
    urlsToFetch.push({ url: input.productUrl, type: 'yourProduct' });
  }
  if (shouldGenerateTable && input.competitorUrls) {
    input.competitorUrls.forEach((url) => urlsToFetch.push({ url, type: 'competitor' }));
  }
  if (input.referenceUrls) {
    input.referenceUrls.forEach((url) => urlsToFetch.push({ url, type: 'reference' }));
  }

  if (urlsToFetch.length === 0) {
    return {};
  }

  const fetchPromises = urlsToFetch.map((item) =>
    fetchUrlContentTool({ url: item.url }).then(async (result) => {
      if (result.htmlContent) {
        const formatResult = await formatScrapedContent({ htmlContent: result.htmlContent });
        return { ...item, ...result, htmlContent: formatResult.formattedHtmlContent };
      }
      return { ...item, ...result };
    }),
  );
  const fetchResults = await Promise.all(fetchPromises);

  const yourProductFetchResult: FetchUrlContentOutput | undefined = fetchResults.find((r) => r.type === 'yourProduct');
  const referenceFetchResults: FetchUrlContentOutput[] = fetchResults.filter((r) => r.type === 'reference');
  const competitorFetchResults: FetchUrlContentOutput[] = fetchResults.filter((r) => r.type === 'competitor');

  const sources: BlogGenerationSources = {
    yourProductFetchResult,
    referenceFetchResults,
    competitorFetchResults,
  };

  if (yourProductFetchResult?.htmlContent) {
    sources.yourProductHtmlContent = yourProductFetchResult.htmlContent.substring(0, 20000);
  }
  if (yourProductFetchResult?.error) {
    sources.yourProductFetchError = yourProductFetchResult.error;
  }
  sources.referenceBlogsHtml = referenceFetchResults
    .map((r) => r.htmlContent?.substring(0, 20000))
    .filter((c): c is string => !!c);
  sources.competitorsHtml = competitorFetchResults
    .map((r) => r.htmlContent?.substring(0, 20000))
    .filter((c): c is string => !!c);

  return sources;
}

const blogGenerationPrompt = definePromptOnce({
  name: 'generateBlogPostPrompt',
  input: {schema: GenerationPromptInputSchema},
  output: {schema: GenerateBlogPostOutputSchema.omit({ referenceFetchResults: true, yourProductFetchResult: true, competitorFetchResults: true })},
  prompt: `You are an expert content strategist and world-class blog writer with deep subject-matter expertise. Your goal is to write a single, high-quality, SEO-optimized blog post that provides genuine value to readers and is designed to outperform existing content on Google.

## STRICT LANGUAGE MANDATE (CRITICAL)
- **YOUR ENTIRE OUTPUT, INCLUDING THE BLOG POST, META TITLE, AND META DESCRIPTION, MUST BE WRITTEN ENTIRELY IN {{language}}.** 
- **ABSOLUTELY NO ENGLISH**: Do not use English words, phrases, or idioms if {{language}} is not English. Every single sentence must be in {{language}}.
- Translate all concepts and technical terms into {{language}} unless they are proper nouns.
- **NO BILINGUAL OUTPUT**: Never mix in English if the target language is different.

## TONE AND VOICE (CRITICAL)
{{#if tone}}
Requested Tone: {{{tone}}}

**TONE GUIDELINES**:
- You MUST strictly adhere to the requested tone: "{{{tone}}}". 
- If tone is **"Storytelling"**, you MUST write as a narrative. Use personal anecdotes (from the brand's perspective), vivid metaphors, and a conversational journey. Avoid dry lists where possible. The reader should feel like they are being told a story or guided through an experience, not reading a manual.
- Adopt a thought-leadership voice that is authoritative yet accessible.
{{else}}
**DEFAULT EDITORIAL VOICE**:
- Write like a seasoned practitioner explaining the topic to a smart colleague: confident, warm, specific, and plain-spoken.
- Show first-hand expertise (E-E-A-T): concrete examples, numbers, trade-offs, common mistakes, and what actually works in practice.
- Vary sentence length. Mix short punchy lines with fuller explanations. Avoid corporate jargon and hype words ("revolutionary", "game-changer", "unlock", "delve", "in today's fast-paced world").
{{/if}}

## Meta Tag Generation Rules:
- **Meta Title**: Create a concise, SEO-friendly meta title (around 50-60 characters) in {{language}}.
- **Meta Description**: Create a compelling meta description (around 150-160 characters) in {{language}}.

## Blog Post Content Generation Rules:

### EXEMPLARY HUMAN-WRITTEN ARTICLE (Analyze for STRUCTURE and TONE ONLY)
Analyze the style, tone, and professional hierarchy in the following example. 
IMPORTANT: This example is in English, but YOUR OUTPUT MUST BE IN {{language}}. 
Emulate the quality and flow, but NOT the language.
<humanExample>
{{{humanWrittenExample}}}
</humanExample>

## Blog Post Parameters:
{{#if blogTitle}}
Title: {{{blogTitle}}}
{{else}}
Title: NOT PROVIDED — you must write it.
**TITLE RULES**: Craft one compelling, click-worthy H1 title in {{language}} built around "{{{primaryKeyword}}}" (include the keyword or a natural variant). Match the search intent (e.g. "How to…", "X Best…", "A Complete Guide to…", "X vs Y: …"). Keep it under 70 characters, specific, and free of clickbait. No question marks. Return it in the **blogTitle** output field as plain text, and do NOT repeat it as an <h1> inside blogPost.
{{/if}}
{{#if primaryKeyword}}Primary Keyword: {{{primaryKeyword}}}{{/if}}
{{#if keywordOccurrences}}
## PRIMARY KEYWORD USAGE (NATURAL — NOT STUFFED)
The phrase "{{{primaryKeyword}}}" should appear about **{{{keywordOccurrences}}} times** across the article (case-insensitive). Prioritize natural, casual placement — never force the keyword into every heading.

**How to place it:**
1. **Meta title** — include "{{{primaryKeyword}}}" when it fits naturally.
2. **Meta Description** — include it once if it reads smoothly.
3. **Introduction** — use it casually once early in the opening paragraphs (not twice jammed in).
4. **Headings** — put the keyword in **only a few** <h2>/<h3> headings where it sounds natural (roughly 1–2 headings is enough). Most headings should be varied, descriptive, and free of forced keyword repetition.
5. **Body paragraphs** — weave the remaining occurrences casually through <p> text where the topic naturally mentions the phrase. Prefer sentences that would make sense to a human reader.
6. **Conclusion** — include it once only if it fits without feeling repetitive.

**Do NOT:**
- Repeat the exact keyword in most or all H2 titles.
- Rewrite every heading just to insert the keyword.
- Stuff the same phrase into consecutive sentences.

If the count is slightly under {{{keywordOccurrences}}}, add a natural mention in a body paragraph — do **not** pad H2 headings with the keyword.
{{/if}}
{{#if secondaryKeyword}}Secondary Keyword: {{{secondaryKeyword}}}{{/if}}
Language: {{language}}
Strict Target Word Count: The final output must be at least {{targetWordCount}} words in {{language}}.

## CRITICAL: Topic Adherence
Your primary goal is to write about the exact topic defined by the 'Blog Post Parameters' above.
{{#if blogTitle}}
- The article MUST be about: "{{{blogTitle}}}".
{{else}}
- The article MUST fully deliver on the title you write for "{{{primaryKeyword}}}".
{{/if}}
- The content MUST focus on the Primary Keyword: "{{{primaryKeyword}}}".
- **AVOID IDEA REPETITION**: Each paragraph must add new information. Use the primary keyword casually where it fits — do not force it into every heading.
{{#if productUrl}}
**CRITICAL INSTRUCTION ON PERSPECTIVE:**
You will write this blog from the perspective of the company or product owner of the URL: {{{productUrl}}}.
1.  Adopt the Brand Voice: Write from the first-person plural perspective of this brand in {{language}}.
{{#if yourProductFetchError}}
Warning: Could not fetch your product page content.
{{else if yourProductHtmlContent}}
Brand/Product Details:
<details><summary>View Your Product Page HTML</summary><pre>{{{yourProductHtmlContent}}}</pre></details>
{{/if}}
{{else}}
**CRITICAL INSTRUCTION ON PERSPECTIVE:**
You will write this blog from a general expert's perspective in {{language}}.
{{/if}}

{{#if brandName}}
## BRAND
Brand: {{{brandName}}}
- Write on behalf of {{{brandName}}}. Mention "{{{brandName}}}" by name naturally 2–4 times — where it genuinely fits in the body and once in the conclusion. Never in every section.
- Position {{{brandName}}} as a credible expert or option, not an advertisement. Keep at least 90% of the article genuinely educational.
- Never invent features, prices, customers, or claims about {{{brandName}}} beyond what the landing page, Brain, or well-known public facts support.
{{/if}}

{{#if landingPageUrl}}
## TARGET LANDING PAGE (LINKING — MANDATORY)
This article must send qualified readers to: {{{landingPageUrl}}}
- Include 2–3 contextual links to exactly this URL, written as <a href="{{{landingPageUrl}}}">descriptive anchor text</a>. Use the brand name or a natural descriptive phrase as the anchor — never "click here" or a bare URL.
- Place the first link within the first three sections, and the last one in the conclusion as a clear, declarative call to action (no question).
- Never link to competitors.
{{/if}}

{{#if knowledgeBase}}
**CRITICAL BRAIN / KNOWLEDGE BASE — SOURCE OF TRUTH (MANDATORY):**
The user selected Brain content below. Treat every concrete fact in it as authoritative and use it correctly in the article written in {{language}}.

Rules you MUST follow:
1. **Understand then apply**: Read the Brain content carefully. Extract product names, pricing, plans, features, limits, processes, claims, locations, people, and other specifics.
2. **Exact factual fidelity**: Never invent, round, convert, or change numbers or prices from the Brain. Example: if Brain says "$100 / month", the blog MUST say "$100 / month" (or the same amount in {{language}} currency wording) — not "$99", "about $100", "affordable pricing", or a different plan.
3. **Include relevant facts**: When the topic touches the product/brand, weave the Brain facts into the article naturally (intro, body sections, and conclusion where relevant). Do not bury or omit pricing, plan names, or key features that appear in the Brain.
4. **No contradiction**: Do not write anything that conflicts with the Brain. If Brain and a general assumption disagree, Brain wins.
5. **No fabrication beyond Brain**: Do not invent extra prices, tiers, or product claims that are not in the Brain or other provided sources.

<knowledge_base>
{{{knowledgeBase}}}
</knowledge_base>
{{/if}}

{{#if targetPageUrl}}
Planned public URL for this article after publishing: {{{targetPageUrl}}}
{{/if}}

## Task Execution Plan:

### Task 0: Search Intent (think silently, do not output)
Before writing, decide what a person searching "{{{primaryKeyword}}}" actually wants: to learn (guide/explainer), to do (step-by-step how-to), to choose (comparison/best-of list), or to buy (product/pricing focused). Pick the article format that best satisfies that intent and answer the core need early — within the first two sections.

{{#if referenceBlogsHtml}}
### Task 1: Competitive Analysis & Content Strategy
The pages below currently rank for this topic. Identify what they all cover (must-haves), what they miss or explain poorly (content gaps), and how to go deeper. Your article must cover the must-haves better and fill the gaps in {{language}}. Never copy their wording, structure, or examples.
{{#each referenceBlogsHtml}}
<reference_page>
{{{this}}}
</reference_page>
{{/each}}
{{/if}}

{{#if shouldGenerateTable}}
### Task 2: Generate Comparison Table
Create a clean HTML <table> in {{language}}.
{{/if}}
{{#if autoComparisonTable}}
### Task 2: Comparison Table (only when the topic calls for it)
Decide whether a comparison table would genuinely help the reader. Include one when the topic involves choosing between options — tools, products, platforms, services, plans, methods, approaches, or any "X vs Y" / "best X" angle. When it helps, place ONE well-structured comparison <table> inside the blogPost body, right after the section that introduces the options, with a clear <thead> header row and 3–6 meaningful comparison columns (e.g. features, pricing, best for, pros, cons). Only use facts you are confident in or that come from the Brain or reference pages. When the topic does not involve choosing between options, do NOT force a comparison table. Never return it in the separate comparisonTableHtml field.
{{/if}}

{{#if isLongForm}}
### Long-Form Depth Requirements
This is a long-form article (at least {{targetWordCount}} words). It must read as the most complete resource on the topic:
- Use 6–10 <h2> sections, and break larger sections into <h3> subsections.
- Include a short "Key takeaways" <ul> near the top (right after the introduction), summarizing 3–5 concrete points.
- Cover practical implementation: steps, examples, mistakes to avoid, and tools or resources where relevant.
- Spread the depth evenly — do not front-load detail and rush the final sections.
{{/if}}

### Task 3: Write the Blog Post Content
You must follow these strict structural rules meticulously in {{language}}.

#### Rule I: Introduction
1.  **Start with a Hook**: Your first sentence MUST be a compelling hook — a bold claim, a surprising statistic, a real-world scenario, or a concrete observation. NEVER start with a question.
2.  **State the Purpose**: Tell the reader exactly what they will gain from reading this article. Be direct and specific.
3.  **Integrate Keywords**: Naturally weave both keywords into the opening paragraphs.

#### Rule II: Body Structure — SUBSTANCE, SCANNABILITY, AND VARIETY
Divide the content into logical sections. Use <h2> headings that are descriptive and relevant. Only include the primary keyword in a heading when it sounds natural — **do not put it in most headings**. **Do not write wall-of-text paragraphs only.** Each section must follow these rules:

- **MIX CONTENT FORMATS (REQUIRED):** Use a healthy blend of:
  - **Very short <p> paragraphs** — each <p> must contain **2–3 sentences max** (never 4+ in one <p>). Start a new <p> after every 2–3 meaningful lines so readers can scan easily.
  - **<ul><li> bullet lists** for steps, tips, features, benefits, checklists, or takeaways (include at least **3 bullet lists** across the article)
  - **<table>** for comparisons, feature matrices, pros/cons, pricing tiers, or data summaries (include at least **1 table** in the article body when the topic benefits from structured comparison; use <thead>, <tbody>, <tr>, <th>, <td>)
- **FREQUENT PARAGRAPH BREAKS**: When explaining a concept, split it across multiple short <p> tags instead of one dense block. Alternate short paragraphs with lists or tables so no section feels like a wall of text.
- **EVERY PARAGRAPH MUST CONTAIN A CONCRETE FACT, SPECIFIC DETAIL, ACTIONABLE STEP, OR REAL EXAMPLE.**
- **USE SPECIFIC DATA**: Include specific numbers, percentages, statistics, timelines, or measurable outcomes wherever possible.
- **PROVIDE ACTIONABLE GUIDANCE**: Give step-by-step instructions readers can apply.
- **KEYWORD PLACEMENT**: Prefer casual mentions of "{{{primaryKeyword}}}" inside body paragraphs. Use it in headings sparingly (a couple at most), never in nearly every H2.

#### Rule III: Conclusion
Summarize the 3-5 most important actionable takeaways from the article. End with a strong, definitive statement — not a question.

## CRITICAL: ABSOLUTE PROHIBITIONS ON CONTENT QUALITY
1.  **ZERO QUESTIONS IN THE BLOG POST**: Do NOT write any questions anywhere in the blog content — no rhetorical questions, no leading questions, no "Have you ever wondered...?", no "What if...?", no "But how do you...?". EVERY sentence must be a declarative statement that provides information. Questions waste the reader's time and add no value. Replace every question with a direct, informative statement.
2.  **NO FILLER CONTENT**: Do not write sentences that say nothing concrete. Examples of banned filler: "This is very important to consider," "There are many ways to approach this," "It goes without saying that...," "As we all know...". Every sentence must ADD new information.
3.  **NO VAGUE CLAIMS WITHOUT EVIDENCE**: Never write "studies show" or "research indicates" or "experts agree" without specifying WHICH study, WHICH research, or WHICH expert. If you cannot cite a specific source, make your point based on logic and concrete reasoning instead.
4.  **NO REPETITIVE TRANSITIONS**: Do not use "Additionally," "Furthermore," "Moreover," "In addition," or their equivalents in {{language}} as sentence starters. Vary your transitions or simply start new paragraphs with the main point.
5.  **AVOID "However"**: DO NOT USE THE WORD "However" OR ITS EQUIVALENT IN {{language}}. Use "but," "yet," "still," or restructure the sentence.
6.  **NO GENERIC INTRODUCTIONS TO SECTIONS**: Do not start a section with a sentence like "Let's explore..." or "In this section, we will discuss..." — jump directly into the content.

## CRITICAL: Final Output Formatting (HTML)
- **ABSOLUTELY NO ASTERISKS ANYWHERE IN THE OUTPUT**. NEVER use * or ** for bold, italics, emphasis, or any purpose.
- **DO NOT BOLD THE PRIMARY KEYWORD**: Never wrap "{{{primaryKeyword}}}" in <strong>, <b>, or <em> tags. Keywords must appear as plain text unless bolding is essential for a non-keyword phrase (rare).
- Use <strong> and <em> sparingly for emphasis on non-keyword phrases only.
- Output valid HTML tags: <p>, <ul>, <ol>, <li>, <h2>, <h3>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <strong>, <em>.
- **NO QUESTION MARKS**: Every sentence must end with a period.
- **SHORT PARAGRAPHS ONLY**: Each <p> tag must hold at most 3 sentences. Use many short <p> blocks rather than long dense paragraphs.
- The output MUST be in {{language}}.
`
});

const geoBlogGenerationPrompt = definePromptOnce({
  name: 'generateGeoBlogPostPrompt',
  input: {schema: GenerationPromptInputSchema},
  output: {schema: GenerateBlogPostOutputSchema.omit({ referenceFetchResults: true, yourProductFetchResult: true, competitorFetchResults: true, comparisonTableHtml: true })},
  prompt: `${getAiTemporalContextBlock()}

You are a senior SEO and Generative Engine Optimization (GEO) content strategist and subject-matter writer. Write a long-form, highly informational blog post with no AI slop — it must read as completely human-written — that ranks in Google AND gets cited by AI answer engines (ChatGPT, Perplexity, Gemini, Claude, Google AI Overviews).

## STRICT LANGUAGE MANDATE (CRITICAL)
- Write EVERYTHING — title, meta title, meta description, blog post, headings, FAQs, sample prompts, keyword list and link suggestions — entirely in {{language}}.
- Never mix in English when {{language}} is not English. Only proper nouns (brands, tools, standards) stay in their original form.

## INPUTS
- Primary keyword: {{{primaryKeyword}}}
- Secondary keywords: {{#if secondaryKeyword}}{{{secondaryKeyword}}}, plus{{/if}} find 4–8 secondary keywords and semantic variations relevant to the primary keyword. Use them naturally and return them in the secondaryKeywords field.
- Target audience: find it from the keyword — the specific roles, industry and company stage of the people searching "{{{primaryKeyword}}}". Decide it silently and write for that audience in every section.
- Audience awareness level: intermediate and advanced. Do not explain basics they already know.
- Search intent: commercial investigation. If the keyword is clearly informational or transactional, match that intent instead.
- Brand: {{#if brandName}}{{{brandName}}}{{else}}none provided — write brand-neutral and do not promote any product{{/if}}
- Relevant product to mention: {{#if brandName}}the {{{brandName}}} offering described in the landing page content and Brain below{{else}}none{{/if}}
- Target landing page URL for internal link: {{#if landingPageUrl}}{{{landingPageUrl}}}{{else}}none provided{{/if}}
- Tone: {{#if tone}}{{{tone}}} — still practical, with no fluff{{else}}professional, practical, no fluff{{/if}}
- Brain (knowledge base): {{#if knowledgeBase}}provided below — use it as a reference and as the source of truth for brand facts{{else}}none provided{{/if}}
{{#if blogTitle}}- Required title: {{{blogTitle}}} — the article must fully deliver on this title.{{/if}}

{{#if yourProductHtmlContent}}
## LANDING PAGE CONTENT (product facts — do not invent beyond this and the Brain)
<landing_page>
{{{yourProductHtmlContent}}}
</landing_page>
{{/if}}

{{#if knowledgeBase}}
## BRAIN / KNOWLEDGE BASE — SOURCE OF TRUTH (MANDATORY)
Treat every concrete fact below as authoritative. Never invent, round or change numbers, prices, plan names or features from it. If the Brain and a general assumption disagree, the Brain wins.
<knowledge_base>
{{{knowledgeBase}}}
</knowledge_base>
{{/if}}

{{#if referenceBlogsHtml}}
## COMPETING ARTICLES (currently ranking for this keyword)
Identify what they all cover, what they miss and where they stay shallow. Cover the must-haves better, fill the gaps, and add depth they lack (examples, case studies, applied guidance). Never copy their wording, structure or examples.
{{#each referenceBlogsHtml}}
<reference_page>
{{{this}}}
</reference_page>
{{/each}}
{{/if}}

## LENGTH
- Minimum {{targetWordCount}} words in {{language}}. Never pad to reach length. Reach it by adding depth: more examples, case studies, statistics, step-by-step detail, edge cases and mistakes.
- Hard maximum: {{maxWordCount}} words (FAQs and tables included). Never exceed it — tighten sections instead of adding more.

## CONTENT REQUIREMENTS
1. TOPIC-FIRST DEPTH (NO FORCED FRAMEWORKS): Do not invent three named "frameworks" for every article. Choose the structure and proof that fit the keyword and search intent:
   - How-to / process topics: phased steps, checklists, decision rules, before-and-after walkthroughs.
   - Comparison / "best X" topics: criteria tables, pros and cons, "best for" segments, honest trade-offs.
   - Strategy or marketing topics: use a named model or lens only when it clarifies something competitors skip — never gimmicky acronyms for their own sake.
   - Trends, news, or industry topics: case studies, real or clearly labeled illustrative examples, timelines, and practitioner analysis.
   - Write at least 3 major body sections that go materially deeper than competing articles. Each must include concrete support (examples, mini case studies, scenarios, data, or worked applications) appropriate to the topic — not a repetitive "Framework 1/2/3" template.
2. AUDIENCE RELEVANCE: Every section must answer "why does this matter to this audience specifically?" Use scenarios, workflows, tools, KPIs and vocabulary from their industry. Remove anything generic.
3. INFORMATION DENSITY: Every paragraph must add a fact, step, example, comparison or decision rule. No filler intros, no repeated points, no vague claims like "AI is changing everything."
4. ACCURACY: Do not invent statistics, studies, quotes or case studies. If you cite a number, name the source and year and hyperlink it to the source, e.g. <a href="https://publisher-site.com">Publisher name, 2025</a>. Link to the publisher's real homepage or a well-known page you are certain exists — never fabricate deep URLs. Mark any hypothetical example as illustrative (e.g. start it with "Illustrative example:").
5. ACTIONABILITY: When the topic is something readers will implement, include a step-by-step plan, a checklist, and (if it fits naturally) a 30/60/90-day roadmap. Skip operational sections that would feel shoehorned for purely informational or news-driven topics.

## SEO STRUCTURE
- Title (H1) under 60 characters containing the primary keyword. Return it as plain text in the blogTitle field{{#if blogTitle}} (use the required title above){{/if}}, and do NOT repeat it as an <h1> inside blogPost.
- Meta title under 60 characters containing the primary keyword (metaTitle field).
- Meta description under 155 characters, containing the primary keyword (metaDescription field).
- URL slug (urlSlug field): lowercase, hyphen-separated, 3–6 words, contains the primary keyword, no dates or stop words.
- Primary keyword in the first 100 words, in at least 2 H2s, and in the conclusion.{{#if keywordOccurrences}} Use it about {{{keywordOccurrences}}} times in total, always naturally.{{/if}}
- Logical H2/H3 hierarchy. Use secondary keywords and semantic variations naturally; no keyword stuffing.
- Table of contents with jump links: place it right after the Key takeaways list as <h2 id="table-of-contents">Table of contents</h2> (heading text in {{language}}) followed by a <ul> with one <li><a href="#section-id">Section heading</a></li> for every H2 that follows it. Give EVERY <h2> an id attribute: its text in lowercase with hyphens (e.g. <h2 id="how-do-you-measure-ai-visibility">). The TOC hrefs must match these ids exactly.
- At least 2 comparison tables (<table> with <thead> and <tbody>) and 1 checklist (a <ul> under a heading that names it as a checklist).
- 6–8 FAQs at the end, under <h2 id="faqs">Frequently asked questions</h2> (in {{language}}). Each FAQ is an <h3> written as a real question the audience would ask (ending with a question mark), followed by a single <p> with a direct 40–60 word answer.
- 3 internal link opportunities: return them in the internalLinkSuggestions field (anchor text + the topic of the page on the brand's site it should point to). Do not insert placeholder links for them in blogPost.
- 3–5 authoritative external sources (official documentation, standards bodies, original research, major publications) linked inline in blogPost with <a href>. Never link to direct competitors{{#if brandName}} of {{{brandName}}}{{/if}}.

## GEO (AI CITATION) OPTIMIZATION
- Start blogPost with a TL;DR: a single <p> that begins with <strong>TL;DR:</strong> (label in {{language}}) followed by a 2–3 sentence direct answer an AI engine can quote verbatim.
- Right after it, a <h2 id="key-takeaways">Key takeaways</h2> (in {{language}}) with a <ul> of 4–6 concrete bullets.
- Begin each H2 section with a concise, self-contained answer paragraph (40–60 words) before expanding.
- Use clear definitions in the format "X is Y that does Z for [audience]."
- Use question-style H2/H3 headings that match how people prompt AI tools when it fits the section; otherwise use clear, descriptive headings aligned with search intent.
- Include entity-rich language: name tools, platforms, roles, metrics and standards precisely.
- End with a short summary before the closing call to action.
- Add 2–3 sample prompts the audience could type into ChatGPT or Perplexity, each in its own <blockquote>, and explain what makes a brand likely to be recommended in the answer.
- Do NOT write schema markup or JSON inside blogPost. FAQ schema and Article schema are generated automatically from your title, meta description and FAQ section, so keep those sections clean and well-formed.

## BRAND AND CONVERSION
{{#if brandName}}
- Mention {{{brandName}}} naturally in 2–3 places where it solves a problem just described. Do not make the article a sales pitch.
- Never invent features, prices, customers or claims about {{{brandName}}} beyond the landing page content, the Brain, or well-known public facts.
- Be honest about limitations and about when a reader might not need {{{brandName}}}.
{{else}}
- No brand is provided: do not promote any product and do not add a product call to action.
{{/if}}
{{#if landingPageUrl}}
- Include one clear call to action near the end linking to exactly {{{landingPageUrl}}} as <a href="{{{landingPageUrl}}}">descriptive anchor text</a>. One earlier contextual link to the same URL where the brand is mentioned is allowed. Never use "click here" or a bare URL.
{{/if}}

## SUGGESTED OUTLINE (adapt fully to the topic — do not force every section)
1. TL;DR and key takeaways
2. What "{{{primaryKeyword}}}" means for the target audience (definition and why it matters now)
3. Context: what changed, why it matters, or the core problem (use AI search vs traditional search only when the topic is about discovery, SEO, or marketing; otherwise pick the most relevant context for this keyword)
4–6. Three or more deep-dive sections chosen for THIS topic, for example:
   - Step-by-step how-to with clear phases
   - Case study or worked example (real or labeled "Illustrative example:")
   - Comparison of options, tools, or methods
   - Common mistakes and how to avoid them
   - Industry-specific scenarios
   - A concise checklist or decision guide when it helps (avoid generic "Framework 1/2/3" headings)
7. Implementation or action plan (when the topic is actionable)
8. Tools, workflow and measurement (include KPIs and tracking only when relevant to the topic)
9. 30/60/90-day roadmap (only when ongoing execution makes sense)
10. FAQs
11. Conclusion with CTA

## SOUND HUMAN (CRITICAL)
Use the article below for voice and rhythm only — never its topic or language.
<humanExample>
{{{humanWrittenExample}}}
</humanExample>
- Write like a practitioner briefing a smart colleague: specific, confident, plain-spoken. Vary sentence length; mix short punchy lines with fuller explanations.
- Keep every <p> to 3 sentences or fewer.
- Banned phrases (and their equivalents in {{language}}): "delve", "in today's fast-paced world", "game-changer", "unlock", "revolutionize", "ever-evolving landscape", "navigate the complexities", "it's important to note", "in conclusion", "seamless", "robust", "harness the power".
- Do not start sentences with "Additionally", "Furthermore" or "Moreover".
- No rhetorical questions in body paragraphs. Questions belong only in headings, FAQ questions and the sample prompts.

## HTML OUTPUT FORMAT
- blogPost must be valid HTML using only: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <blockquote>, <a>, <strong>, <em>.
- No <h1>, no markdown, no asterisks, no code fences, no <html> or <body> wrappers.
- Never wrap "{{{primaryKeyword}}}" in <strong>, <b> or <em>.
`
});

function toUrlSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}


const generateBlogPostFlow = defineFlowOnce(
  {
    name: 'generateBlogPostFlow',
    inputSchema: GenerateBlogPostInputSchema,
    outputSchema: GenerateBlogPostOutputSchema,
  },
  async (input) => {
    try {
      if (input.writingStyle === 'geo') {
        input = {
          ...input,
          targetWordCount: Math.min(BLOG_WRITER_MAX_WORD_COUNT, input.targetWordCount),
        };
      }
      const shouldGenerateTable = input.generateComparisonTable === 'yes';
      const autoComparisonTable = input.generateComparisonTable === 'auto';
      const isLongForm = (input.targetWordCount ?? 0) >= 1500;
      const maxWordCount =
        input.writingStyle === 'geo'
          ? Math.min(BLOG_WRITER_MAX_WORD_COUNT, Math.round(input.targetWordCount * 1.15))
          : undefined;

      let yourProductFetchResult: FetchUrlContentOutput | undefined;
      let referenceFetchResults: FetchUrlContentOutput[] = [];
      let competitorFetchResults: FetchUrlContentOutput[] = [];

      if (input.skipUrlFetching && input.prefetchedSources) {
        yourProductFetchResult = input.prefetchedSources.yourProductFetchResult;
        referenceFetchResults = input.prefetchedSources.referenceFetchResults ?? [];
        competitorFetchResults = input.prefetchedSources.competitorFetchResults ?? [];
      } else if (!input.skipUrlFetching) {
        const sources = await fetchBlogGenerationSources(input);
        yourProductFetchResult = sources.yourProductFetchResult;
        referenceFetchResults = sources.referenceFetchResults ?? [];
        competitorFetchResults = sources.competitorFetchResults ?? [];
        input = {
          ...input,
          prefetchedSources: sources,
          skipUrlFetching: true,
        };
      }

      const prefetched = input.prefetchedSources;

      // Prepare inputs for the single AI call
      const generationInput: Partial<GenerationPromptInput> = {
        ...input,
        shouldGenerateTable,
        autoComparisonTable,
        isLongForm,
        maxWordCount,
      };
      
      if (prefetched?.yourProductHtmlContent) {
          generationInput.yourProductHtmlContent = prefetched.yourProductHtmlContent;
      }
      if (prefetched?.yourProductFetchError) {
          generationInput.yourProductFetchError = prefetched.yourProductFetchError;
      }

      generationInput.referenceBlogsHtml = prefetched?.referenceBlogsHtml ?? [];
      generationInput.competitorsHtml = prefetched?.competitorsHtml ?? [];

      
      generationInput.humanWrittenExample = humanWrittenBlogExample;
      
      const isGeo = input.writingStyle === 'geo';
      const prompt = isGeo ? geoBlogGenerationPrompt : blogGenerationPrompt;
      // The GEO prompt has many hard structural requirements, so it runs cooler than the creative default.
      const temperature = isGeo ? 0.7 : shouldGenerateTable ? 0.4 : 0.85;
      const models =
        isGeo && !input.forceDefaultModels
          ? await getBlogWriterModelChain(input.userId)
          : STRATEGY_DEPLOY_LLM_CHAIN;
      
      const { result: initialOutput } = await withLlmModelFallback(
        async (model) => {
          const initialResponse = await prompt(generationInput as GenerationPromptInput, {
            config: { temperature },
            model,
          });
          if (
            !initialResponse.output?.blogPost ||
            !initialResponse.output.metaTitle ||
            !initialResponse.output.metaDescription
          ) {
            throw new Error(
              'Failed to generate the blog post. The AI model did not return all the required fields (blogPost, metaTitle, metaDescription).',
            );
          }
          const output = initialResponse.output;
          const blogTitle = input.blogTitle?.trim() || output.blogTitle?.trim() || output.metaTitle;
          return {
            ...output,
            blogTitle,
            urlSlug: isGeo
              ? toUrlSlug(output.urlSlug || input.primaryKeyword || blogTitle) || undefined
              : output.urlSlug,
          };
        },
        { label: 'generateBlogPost', models, deadlineAt: input.deadlineAt },
      );

      let cleanedBlogPost: string;

      const finalizeOptions = { allowQuestions: isGeo };

      if (input.skipInternalHumanization) {
        cleanedBlogPost = finalizeBlogHtml(initialOutput.blogPost, input.primaryKeyword, finalizeOptions);
      } else {
        const humanizationResult = await advancedHumanizeText({
            htmlContent: initialOutput.blogPost,
            blogTitle: input.blogTitle,
            primaryKeyword: input.primaryKeyword,
            keywordOccurrences: input.keywordOccurrences,
            secondaryKeyword: input.secondaryKeyword,
            tone: input.tone,
            targetWordCount: input.targetWordCount,
            language: input.language,
            humanizationLevel: 2,
            knowledgeBase: input.knowledgeBase,
            preserveExactFormat: isGeo,
            blogWriterUserId: isGeo ? input.userId : undefined,
        });

        if (humanizationResult.error || !humanizationResult.humanizedHtmlContent) {
          throw new Error(`Humanization pass failed: ${humanizationResult.error || 'No content returned.'}`);
        }

        cleanedBlogPost = finalizeBlogHtml(
          humanizationResult.humanizedHtmlContent,
          input.primaryKeyword,
          finalizeOptions,
        );
      }

      return {
          ...initialOutput,
          blogPost: cleanedBlogPost,
          yourProductFetchResult,
          referenceFetchResults,
          competitorFetchResults
      };
    } catch (error: any) {
        // This will catch errors from the main prompt or any other part of the flow
        let errorMessage = "An unexpected error occurred during blog generation.";
        if (typeof error === 'string') {
            errorMessage = error;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        }
        console.error("Error in generateBlogPostFlow:", error);
        throw new Error(errorMessage);
    }
  }
);
