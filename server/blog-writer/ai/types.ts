

import {z} from 'zod';


// Schemas for: analyze-content-authenticity.ts
export const AnalyzeContentAuthenticityInputSchema = z.object({
  textContent: z.string().describe('The plain text content to be analyzed.'),
});
export type AnalyzeContentAuthenticityInput = z.infer<typeof AnalyzeContentAuthenticityInputSchema>;

export const FlaggedSegmentSchema = z.object({
  segment: z.string().describe("The exact word or short phrase from the input text that is problematic."),
  suggestion: z.string().describe("A brief suggestion on how to improve or rephrase this segment (e.g., 'Consider rephrasing for clarity', 'Replace with a simpler word', 'This phrase is common in AI text'). Keep suggestions concise, max 1-2 short sentences."),
});
export type FlaggedSegment = z.infer<typeof FlaggedSegmentSchema>;

export const AnalyzeContentAuthenticityOutputSchema = z.object({
  aiLikelihoodScore: z.number().min(0).max(100).describe('An estimated likelihood (0-100) that the text was AI-generated. 0 means very human-like, 100 means very AI-like.'),
  justification: z.string().describe('A brief justification for the assigned score, highlighting observed characteristics and explaining why the score is at its current level (not higher or lower).'),
  flaggedSegments: z.array(FlaggedSegmentSchema).optional().describe('A list of specific text segments (words or short phrases) that are AI-like and suggestions for them. Aim for up to 10-15 distinct segments. Prioritize segments that most strongly indicate AI origin.'),
  perplexityIndicator: z.enum(['low', 'medium', 'high']).optional().describe("Assessment of text predictability."),
  perplexityJustification: z.string().optional().describe("Reasoning for the perplexity assessment."),
  burstinessIndicator: z.enum(['low', 'medium', 'high']).optional().describe("Assessment of sentence length and structure variation."),
  burstinessJustification: z.string().optional().describe("Reasoning for the burstiness assessment."),
  patternAnalysis: z.string().optional().describe("Notes on repetitive phrases, formality, structural tendencies, or other AI-like patterns observed."),
  identifiedPatterns: z.array(z.string()).optional().describe("Specific examples of repetitive or AI-like patterns found in the text, if any."),
  stylisticObservations: z.string().optional().describe("Other relevant stylistic observations."),
});
export type AnalyzeContentAuthenticityOutput = z.infer<typeof AnalyzeContentAuthenticityOutputSchema>;


// Schemas for: advanced-humanize-text.ts
export const AIAnalysisFeedbackSchema = z.object({
    perplexityIndicator: z.enum(['low', 'medium', 'high']).optional().describe("Assessment of text predictability."),
    perplexityJustification: z.string().optional().describe("Reasoning for the perplexity assessment."),
    burstinessIndicator: z.enum(['low', 'medium', 'high']).optional().describe("Assessment of sentence length and structure variation."),
    burstinessJustification: z.string().optional().describe("Reasoning for the burstiness assessment."),
    patternAnalysis: z.string().optional().describe("Notes on repetitive phrases, formality, structural tendencies, or other AI-like patterns observed."),
    identifiedPatterns: z.array(z.string()).optional().describe("Specific examples of repetitive or AI-like patterns found in the text, if any."),
    stylisticObservations: z.string().optional().describe("Other relevant stylistic observations."),
    flaggedSegments: z.array(FlaggedSegmentSchema).optional().describe('A list of specific text segments (words or short phrases) that are AI-like and suggestions for them.'),
  }).optional().describe('Feedback from a previous AI content analysis to guide humanization.');
export type AIAnalysisFeedback = z.infer<typeof AIAnalysisFeedbackSchema>;
  
export const AdvancedHumanizeTextInputSchema = z.object({
    htmlContent: z.string().describe('The HTML content to humanize.'),
    blogTitle: z.string().optional().describe('The title of the blog post, for context.'),
    primaryKeyword: z.string().optional().describe('The primary keyword for SEO, to maintain if possible.'),
    keywordOccurrences: z.number().optional().describe('Minimum number of times the primary keyword must appear.'),
    secondaryKeyword: z.string().optional().describe('The secondary keyword for SEO, to maintain if possible.'),
    language: z.string().optional().default('English').describe('The language for the blog post content.'),
    tone: z
      .enum([
        'Informational',
        'Casual',
        'Formal',
        'Humorous',
        'Persuasive',
        'Technical',
        'Storytelling',
        'Academic',
        'Empathetic',
      ])
      .optional()
      .describe('The desired tone of the humanized text. If not provided, will try to match existing or use a general engaging tone. This will override some general humanization rules if they conflict (e.g. a "Formal" tone will override a general instruction for "conversational" style).'),
    targetWordCount: z.number().optional().describe('The approximate target word count for the humanized text. If not provided, will aim for similar length.'),
    aiAnalysisFeedback: AIAnalysisFeedbackSchema,
    humanizationLevel: z.number().min(1).optional().describe('The level of humanization strictness to apply. Higher levels mean more aggressive rewriting. Starts at 1.'),
    preserveExactFormat: z
      .boolean()
      .optional()
      .describe(
        'When true, rewrite wording only and keep the exact HTML structure/layout the user provided (paragraphs, headings, lists, line breaks, etc.).',
      ),
    knowledgeBase: z
      .string()
      .optional()
      .describe(
        'User Brain / knowledge base facts that must remain accurate (pricing, product names, features, numbers). Do not alter these facts while humanizing.',
      ),
    blogWriterUserId: z
      .string()
      .optional()
      .describe('Set by Blazly Blog Writer so the humanize pass uses the plan-based writer model (Claude for eligible plans).'),
    deadlineAt: z
      .number()
      .optional()
      .describe('Epoch ms by which the call must finish; fallbacks are skipped when too little time is left.'),
  });
export type AdvancedHumanizeTextInput = z.infer<typeof AdvancedHumanizeTextInputSchema>;

export const AdvancedHumanizeTextOutputSchema = z.object({
    humanizedHtmlContent: z.string().optional().describe('The humanized HTML content.'),
    unavoidableTriggers: z.array(z.string()).optional().describe('A list of any strictly forbidden words/phrases that were necessary to keep for core meaning.'),
    error: z.string().optional().describe('An error message if the humanization process failed.'),
  });
export type AdvancedHumanizeTextOutput = z.infer<typeof AdvancedHumanizeTextOutputSchema>;


// Schemas for: analyze-seo-onpage.ts
export const AnalyzeOnPageSEOInputSchema = z.object({
    htmlContent: z.string().describe('The full HTML content of the blog post.'),
    metaTitle: z.string().describe('The meta title of the blog post.'),
    metaDescription: z.string().describe('The meta description for the blog post.'),
    primaryKeyword: z.string().describe('The primary keyword to analyze for.'),
  });
export type AnalyzeOnPageSEOInput = z.infer<typeof AnalyzeOnPageSEOInputSchema>;
  
export const AnalyzeOnPageSEOOutputSchema = z.object({
    seoScore: z.number().min(0).max(100).describe('An overall on-page SEO score (0-100).'),
    scoreJustification: z.string().describe('A brief, high-level justification for the assigned score.'),
    whatIsDoneWell: z.array(z.string()).describe('A list of positive SEO elements that were found.'),
    areasForImprovement: z.array(z.string()).describe('A list of specific, actionable suggestions for improvement.'),
  });
export type AnalyzeOnPageSEOOutput = z.infer<typeof AnalyzeOnPageSEOOutputSchema>;


// Schemas for: check-plagiarism.ts
export const CheckPlagiarismInputSchema = z.object({
    textContent: z.string().describe('The plain text content to be checked for plagiarism.'),
  });
export type CheckPlagiarismInput = z.infer<typeof CheckPlagiarismInputSchema>;

export const PlagiarizedSegmentSchema = z.object({
      segment: z.string().describe("The exact text segment that appears to be plagiarized."),
      sourceSuggestion: z.string().describe("A suggestion for the potential source or a note about its commonality."),
  });
  
export const CheckPlagiarismOutputSchema = z.object({
    plagiarismScore: z.number().min(0).max(100).describe('An estimated likelihood (0-100) that the text contains plagiarized content. 0 means original, 100 means highly plagiarized.'),
    justification: z.string().describe('A brief justification for the assigned score, explaining why the content is or is not considered plagiarized.'),
    plagiarizedSegments: z.array(PlagiarizedSegmentSchema).optional().describe('A list of specific text segments that appear to be directly copied from other sources.'),
  });
export type CheckPlagiarismOutput = z.infer<typeof CheckPlagiarismOutputSchema>;


// Schemas for: enhance-seo.ts
export const EnhanceSeoInputSchema = z.object({
    htmlContent: z.string().describe('The full HTML content of the blog post to enhance.'),
    metaTitle: z.string().describe('The current meta title of the blog post.'),
    metaDescription: z.string().describe('The current meta description for the blog post.'),
    primaryKeyword: z.string().describe('The primary keyword to optimize for.'),
    keywordOccurrences: z.number().optional().describe('Minimum number of times the primary keyword must appear.'),
    seoAnalysis: AnalyzeOnPageSEOOutputSchema.describe('The results from a previous on-page SEO analysis.'),
    language: z.string().optional().default('English').describe('The target language for the rewritten content.'),
    knowledgeBase: z
      .string()
      .optional()
      .describe(
        'User Brain / knowledge base facts that must remain accurate during SEO rewrite (pricing, product names, features, numbers).',
      ),
    geoFormat: z
      .boolean()
      .optional()
      .describe('Content uses the GEO structure (question headings, TOC jump links, FAQs, tables). Preserve it.'),
  });
export type EnhanceSeoInput = z.infer<typeof EnhanceSeoInputSchema>;
  
export const EnhanceSeoOutputSchema = z.object({
    enhancedHtmlContent: z.string().describe('The rewritten HTML content, optimized for SEO.'),
    enhancedMetaTitle: z.string().describe('The rewritten meta title, optimized for SEO.'),
    enhancedMetaDescription: z.string().describe('The rewritten meta description, optimized for SEO.'),
  });
export type EnhanceSeoOutput = z.infer<typeof EnhanceSeoOutputSchema>;


// Schema for: fetch-url-content-tool.ts
export const FetchUrlContentOutputSchema = z.object({
  url: z.string().url().describe('The original URL that was fetched.'),
  htmlContent: z.string().optional().describe('The fetched and cleaned HTML content of the page.'),
  error: z.string().optional().describe('An error message if fetching failed.'),
});


// Schemas for: generate-blog-post.ts
/** Hard cap on Blazly Blog Writer article length (UI, server and prompt). */
export const BLOG_WRITER_MAX_WORD_COUNT = 4000;

export const GenerateBlogPostInputSchema = z.object({
    userId: z.string().optional().describe('The ID of the user generating the blog.'),
    blogTitle: z
      .string()
      .optional()
      .describe('The title of the blog post. When empty, the AI crafts the title from the primary keyword.'),
    primaryKeyword: z.string().optional().describe('The primary keyword for the blog post.'),
    secondaryKeyword: z.string().optional().describe('The secondary keyword for the blog post.'),
    language: z.string().default('English').describe('The language for the blog post content.'),
    tone: z
      .enum(['Informational', 'Casual', 'Formal', 'Humorous', 'Persuasive', 'Technical', 'Storytelling', 'Academic', 'Empathetic'])
      .optional()
      .describe('The tone of the blog post. When omitted, the AI uses an expert, conversational editorial voice.'),
    targetWordCount: z
      .number()
      .describe('The target word count for the blog post.'),
    primaryKeywordDensity: z.number().optional().describe('The desired density for the primary keyword as a percentage (0-2%).'),
    keywordOccurrences: z.number().int().min(1).optional().describe('Mandatory minimum number of times the primary keyword must appear in the blog.'),
    productUrl: z.string().url().optional().or(z.literal('')).describe('Optional URL of your own product page for the AI to understand "OurProduct/OurSolution".'),
    brandName: z.string().optional().describe('Brand the article is written on behalf of.'),
    landingPageUrl: z
      .string()
      .url()
      .optional()
      .or(z.literal(''))
      .describe('Target landing page the article should send readers to via contextual links.'),
    knowledgeBase: z
      .string()
      .optional()
      .describe(
        'User Brain / knowledge base content. Treat as source of truth for brand, product, pricing, features, and other facts — include them accurately in the blog.',
      ),
    brandGuidelines: z.string().optional().describe('Content from the uploaded brand guidelines .txt file, providing compliance rules, do\'s & don\'ts, or brand voice information.'),
    generateComparisonTable: z
      .enum(['yes', 'no', 'auto'])
      .default('no')
      .describe("Whether to generate a comparison table. 'auto' lets the AI include one in the body only when the topic calls for it."),
    competitorUrls: z.array(z.string().url()).optional().describe('Optional URLs for competitor products.'),
    referenceUrls: z.array(z.string().url()).optional().describe('Optional URLs for reference blog posts or product sites.'),
    contentRole: z.enum(['pillar', 'cluster']).optional().describe('Whether this post is the pillar page or a cluster article in a topic cluster strategy.'),
    pillarPageUrl: z.string().url().optional().describe('Public URL of the pillar page — cluster posts must link here.'),
    targetPageUrl: z.string().url().optional().describe('Planned public URL where this article will live on the user website.'),
    writingStyle: z
      .enum(['standard', 'geo'])
      .optional()
      .describe("'geo' uses the SEO + Generative Engine Optimization long-form prompt (Blazly Blog Writer). Defaults to 'standard'."),
    forceDefaultModels: z
      .boolean()
      .optional()
      .describe('Skip plan-based writer model routing and use the default (fast) model chain.'),
    deadlineAt: z
      .number()
      .optional()
      .describe('Epoch ms by which the call must finish; fallbacks are skipped when too little time is left.'),
    skipInternalHumanization: z.boolean().optional().describe('When true, skip the built-in humanization pass (for client-orchestrated pipelines).'),
    skipUrlFetching: z.boolean().optional().describe('When true, skip fetching URLs and use prefetchedSources instead.'),
    prefetchedSources: z.object({
      yourProductHtmlContent: z.string().optional(),
      yourProductFetchError: z.string().optional(),
      referenceBlogsHtml: z.array(z.string()).optional(),
      competitorsHtml: z.array(z.string()).optional(),
      yourProductFetchResult: FetchUrlContentOutputSchema.optional(),
      referenceFetchResults: z.array(FetchUrlContentOutputSchema).optional(),
      competitorFetchResults: z.array(FetchUrlContentOutputSchema).optional(),
    }).optional().describe('Pre-fetched reference/competitor/product HTML to avoid duplicate fetches.'),
  });
export type GenerateBlogPostInput = z.infer<typeof GenerateBlogPostInputSchema>;

export const BlogGenerationSourcesSchema = z.object({
  yourProductHtmlContent: z.string().optional(),
  yourProductFetchError: z.string().optional(),
  referenceBlogsHtml: z.array(z.string()).optional(),
  competitorsHtml: z.array(z.string()).optional(),
  yourProductFetchResult: FetchUrlContentOutputSchema.optional(),
  referenceFetchResults: z.array(FetchUrlContentOutputSchema).optional(),
  competitorFetchResults: z.array(FetchUrlContentOutputSchema).optional(),
});
export type BlogGenerationSources = z.infer<typeof BlogGenerationSourcesSchema>;
  
export const GenerateBlogPostOutputSchema = z.object({
    blogTitle: z
      .string()
      .optional()
      .describe('The H1 title of the article (plain text, no HTML). Required when no title was provided in the input.'),
    metaTitle: z.string().describe('A concise and SEO-friendly meta title for the blog post (around 50-60 characters), optimized for search engines and including the primary keyword if natural.'),
    metaDescription: z.string().describe('A compelling plain text meta description (around 150-160 characters) that summarizes the blog post. It must be plain text and encourage clicks from search results.'),
    blogPost: z.string().describe('The generated blog post content in HTML format, including placeholders for multimedia and internal links.'),
    comparisonTableHtml: z.string().optional().describe('An optional, clean, unstyled HTML comparison table. This is returned as a separate field and is NOT included in the blogPost content.'),
    urlSlug: z
      .string()
      .optional()
      .describe('Short, lowercase, hyphenated URL slug built around the primary keyword (no domain, no slashes).'),
    secondaryKeywords: z
      .array(z.string())
      .optional()
      .describe('Secondary keywords and semantic variations chosen for and used in the article.'),
    internalLinkSuggestions: z
      .array(
        z.object({
          anchorText: z.string().describe('Anchor text to use for the internal link.'),
          targetTopic: z.string().describe('Topic of the page on the same website that this anchor should point to.'),
        }),
      )
      .optional()
      .describe('Internal link opportunities: anchor text plus the topic of the page it should link to.'),
    yourProductFetchResult: FetchUrlContentOutputSchema.optional().describe('Result of fetching your product URL, including any error.'),
    referenceFetchResults: z.array(FetchUrlContentOutputSchema).optional().describe('Results of fetching reference URLs, including any errors.'),
    competitorFetchResults: z.array(FetchUrlContentOutputSchema).optional().describe('Results of fetching competitor URLs, including any errors.'),
  });
export type GenerateBlogPostOutput = z.infer<typeof GenerateBlogPostOutputSchema>;


// Schemas for: fact-check-blog.ts
export const FactCheckBlogInputSchema = z.object({
  htmlContent: z.string().describe('The full HTML content of the blog post to fact-check.'),
  metaTitle: z.string().describe('The meta title of the blog post.'),
  metaDescription: z.string().describe('The meta description of the blog post.'),
  blogTitle: z.string().describe('The title of the blog post, for context.'),
  primaryKeyword: z.string().optional().describe('The primary keyword, for context.'),
  keywordOccurrences: z.number().optional().describe('Minimum number of times the primary keyword must appear.'),
  language: z.string().optional().default('English').describe('The language of the content.'),
  knowledgeBase: z
    .string()
    .optional()
    .describe(
      'User Brain / knowledge base. Facts here (pricing, product details, etc.) are the source of truth and must NOT be changed or removed.',
    ),
  geoFormat: z
    .boolean()
    .optional()
    .describe('Content uses the GEO structure (question headings, TOC jump links, FAQs, tables). Preserve it.'),
});
export type FactCheckBlogInput = z.infer<typeof FactCheckBlogInputSchema>;

// Schemas for: enforce-keyword-occurrences.ts
export const EnforceKeywordOccurrencesInputSchema = z.object({
  htmlContent: z.string().describe('The blog HTML content.'),
  metaTitle: z.string().describe('The meta title.'),
  metaDescription: z.string().describe('The meta description.'),
  primaryKeyword: z.string().describe('The primary keyword phrase.'),
  keywordOccurrences: z.number().int().min(1).describe('Minimum required keyword occurrences.'),
  language: z.string().default('English').describe('Content language.'),
  currentOccurrences: z.number().optional().describe('Current count passed to the prompt.'),
  geoFormat: z
    .boolean()
    .optional()
    .describe('Content uses the GEO structure (question headings, TOC jump links, FAQs, tables). Preserve it.'),
});
export type EnforceKeywordOccurrencesInput = z.infer<typeof EnforceKeywordOccurrencesInputSchema>;

export const EnforceKeywordOccurrencesOutputSchema = z.object({
  htmlContent: z.string().describe('HTML with keyword count enforced.'),
  metaTitle: z.string().describe('Meta title with keyword included.'),
  metaDescription: z.string().describe('Meta description with keyword included.'),
  finalOccurrences: z.number().describe('Keyword count after enforcement.'),
  wasAdjusted: z.boolean().describe('Whether the content was modified.'),
});
export type EnforceKeywordOccurrencesOutput = z.infer<typeof EnforceKeywordOccurrencesOutputSchema>;

export const FactCheckBlogOutputSchema = z.object({
  correctedHtmlContent: z.string().describe('The fact-checked and corrected HTML content.'),
  correctedMetaTitle: z.string().describe('The fact-checked meta title.'),
  correctedMetaDescription: z.string().describe('The fact-checked meta description.'),
  correctionsSummary: z.array(z.string()).optional().describe('Brief list of factual corrections made.'),
});
export type FactCheckBlogOutput = z.infer<typeof FactCheckBlogOutputSchema>;


// Schemas for: refine-content.ts
export const RefineContentInputSchema = z.object({
    originalContent: z.string().describe('The original AI-generated sentence.'),
    userFeedback: z.string().describe('The user feedback and desired changes for the sentence.'),
  });
export type RefineContentInput = z.infer<typeof RefineContentInputSchema>;
  
export const RefineContentOutputSchema = z.object({
    refinedContent: z.string().describe('The refined AI-generated sentence based on user feedback.'),
  });
export type RefineContentOutput = z.infer<typeof RefineContentOutputSchema>;


// Schemas for: rewrite-blog-with-prompt.ts
export const RewriteBlogWithPromptInputSchema = z.object({
  htmlContent: z.string().describe('The full HTML blog content to rewrite.'),
  metaTitle: z.string().describe('The current meta title.'),
  metaDescription: z.string().describe('The current meta description.'),
  rewritePrompt: z.string().min(1).describe('User instructions describing how to rewrite the blog.'),
  blogTitle: z.string().optional().describe('Blog title for context.'),
  primaryKeyword: z.string().optional().describe('Primary keyword to preserve where possible.'),
  keywordOccurrences: z.number().optional().describe('Target number of primary keyword appearances.'),
  language: z.string().default('English').describe('Language of the content.'),
  tone: z.string().optional().describe('Desired tone of the blog.'),
});
export type RewriteBlogWithPromptInput = z.infer<typeof RewriteBlogWithPromptInputSchema>;

export const RewriteBlogWithPromptOutputSchema = z.object({
  rewrittenHtmlContent: z.string().describe('The rewritten blog HTML content.'),
  rewrittenMetaTitle: z.string().describe('The rewritten meta title.'),
  rewrittenMetaDescription: z.string().describe('The rewritten meta description.'),
});
export type RewriteBlogWithPromptOutput = z.infer<typeof RewriteBlogWithPromptOutputSchema>;


// Schemas for: rewrite-plagiarism-free.ts
export const RewritePlagiarismFreeInputSchema = z.object({
    htmlContent: z.string().describe('The HTML content of the blog post to be rewritten.'),
    blogTitle: z.string().describe('The title of the blog post, for context.'),
    primaryKeyword: z.string().describe('The primary keyword, to be maintained and naturally integrated.'),
    secondaryKeyword: z.string().describe('The secondary keyword, to be maintained and naturally integrated.'),
    tone: z.enum(['Informational', 'Casual', 'Formal', 'Humorous', 'Persuasive', 'Technical', 'Storytelling', 'Academic', 'Empathetic']).describe('The desired tone of the blog post, to be maintained.'),
    targetWordCount: z.number().describe('The approximate target word count.'),
    language: z.string().optional().default('English').describe('The language for the rewritten content.'),
  });
export type RewritePlagiarismFreeInput = z.infer<typeof RewritePlagiarismFreeInputSchema>;
  
export const RewritePlagiarismFreeOutputSchema = z.object({
    rewrittenHtmlContent: z.string().describe('The rewritten blog post content in HTML format, optimized to be plagiarism-free.'),
  });
export type RewritePlagiarismFreeOutput = z.infer<typeof RewritePlagiarismFreeOutputSchema>;


// Schemas for: suggest-blog-titles.ts
export const SuggestBlogTitlesInputSchema = z.object({
    prompt: z.string().describe('A prompt describing the desired blog post topic.'),
  });
export type SuggestBlogTitlesInput = z.infer<typeof SuggestBlogTitlesInputSchema>;
  
export const SuggestBlogTitlesOutputSchema = z.object({
    titles: z.array(z.string()).describe('An array of suggested blog titles.'),
  });
export type SuggestBlogTitlesOutput = z.infer<typeof SuggestBlogTitlesOutputSchema>;


// Schemas for: discover-seo-keywords.ts
export const DiscoverSeoKeywordsInputSchema = z.object({
  topic: z.string().describe('The topic to discover keywords for.'),
});
export type DiscoverSeoKeywordsInput = z.infer<typeof DiscoverSeoKeywordsInputSchema>;

export const KeywordSuggestionSchema = z.object({
  keyword: z.string().describe('The suggested keyword phrase.'),
  avgMonthlySearches: z.string().describe("An estimated range of average monthly searches (e.g., '1K - 10K')."),
  competition: z.enum(['Low', 'Medium', 'High']).describe("The estimated competition level for the keyword."),
});
export type KeywordSuggestion = z.infer<typeof KeywordSuggestionSchema>;

const TrendDataPointSchema = z.object({
  month: z.string().describe('Month in "MMM" format (e.g., "Jan").'),
  volume: z.number().describe('Estimated search volume for the month.'),
});
export type TrendDataPoint = z.infer<typeof TrendDataPointSchema>;

const CountryVolumeSchema = z.object({
  countryCode: z.string().describe('2-letter ISO country code, or "Other".'),
  countryName: z.string().describe('Full country name, or "Other".'),
  volume: z.number().describe('Estimated monthly search volume.'),
  percentage: z.number().describe('Percentage of global volume.'),
});
export type CountryVolume = z.infer<typeof CountryVolumeSchema>;

export const DiscoverSeoKeywordsOutputSchema = z.object({
  keyword: z.string().describe('The keyword being analyzed.'),
  keywordDifficulty: z.number().min(0).max(100).describe('Difficulty score from 0-100.'),
  globalVolume: z.number().describe('Total estimated monthly search volume.'),
  intent: z.enum(['Informational', 'Navigational', 'Commercial', 'Transactional']),
  countryVolumes: z.array(CountryVolumeSchema).describe('Top 5 countries by volume + Other.'),
  searchTrend: z.array(TrendDataPointSchema).length(12).describe('Last 12 months of search trend data.'),
  relatedKeywords: z.array(KeywordSuggestionSchema).describe('A list of related keyword suggestions.'),
});
export type DiscoverSeoKeywordsOutput = z.infer<typeof DiscoverSeoKeywordsOutputSchema>;


// Schemas for: generate-content-strategy.ts and enhance-content-strategy.ts
/** Fresh object each call — Gemini structured output rejects JSON Schema `$ref` from reused Zod instances. */
function createTopicSchema() {
  return z.object({
    title: z.string().describe('The SEO-friendly title for the blog post.'),
    summary: z.string().describe('A brief summary of what the article will cover.'),
    primaryKeyword: z.string().describe('The primary keyword for this specific article.'),
    secondaryKeywords: z.array(z.string()).optional().describe('A list of 2-4 related secondary keywords.'),
    wordCount: z.number().describe("The estimated target word count for the article (e.g., 800, 1500)."),
    publishDate: z.string().describe('The suggested publish date for this article in "Month Day, Year" format (e.g., "July 26, 2024").'),
    slug: z.string().optional().describe('URL slug for this article (e.g., email-marketing-guide). Do not include domain or full URL — slugs only.'),
  });
}

export const TopicSchema = createTopicSchema();
export type Topic = z.infer<typeof TopicSchema> & { url?: string };

export const GenerateContentStrategyInputSchema = z.object({
  keyword: z.string().describe('The primary target keyword for the content strategy.'),
  language: z.string().default('English').describe('The language for the strategy content.'),
  currentDate: z.string().optional().describe('The current date, to be used as the starting point for the content schedule.'),
});
export type GenerateContentStrategyInput = z.infer<typeof GenerateContentStrategyInputSchema>;

export const GenerateContentStrategyOutputSchema = z.object({
    pillarTopic: createTopicSchema().describe('The central, comprehensive pillar topic for the strategy.'),
    clusterTopics: z.array(createTopicSchema()).describe('A list of more specific cluster topics that link to the pillar.'),
    rankingProbability: z.number().min(0).max(100).describe('An estimated probability (0-100) of ranking on the first page of Google with this strategy.'),
    strategySummary: z.string().describe('A brief summary of the overall strategy and justification for the ranking probability.'),
    competition: z.enum(['Low', 'Medium', 'High']).describe('The estimated competition level for the keyword.'),
    language: z.string().default('en').describe('The language of the content.'),
    websiteUrl: z.string().url().optional().describe('The user website base URL used to build planned blog URLs.'),
});
export type GenerateContentStrategyOutput = z.infer<typeof GenerateContentStrategyOutputSchema>;

export const EnhanceContentStrategyInputSchema = z.object({
  currentStrategy: GenerateContentStrategyOutputSchema.describe("The previously generated content strategy that needs enhancement."),
});
export type EnhanceContentStrategyInput = z.infer<typeof EnhanceContentStrategyInputSchema>;

export const EnhancedContentStrategyOutputSchema = z.object({
    originalPillarTopic: createTopicSchema().describe("The original pillar topic provided."),
    originalClusterTopics: z.array(createTopicSchema()).describe("The original cluster topics provided."),
    newClusterTopics: z.array(createTopicSchema()).min(5).describe("A list of NEW, highly-specific, in-depth cluster topics to add to the strategy. This list must be comprehensive."),
    newRankingProbability: z.number().min(90).max(100).describe("The new, higher estimated probability (90-100%) of ranking on the first page of Google after implementing all the enhancements."),
    newStrategySummary: z.string().describe("A brief justification for the new, higher ranking probability, explaining how the new topics and SEO ideas will drastically improve the chances of success."),
});
export type EnhancedContentStrategyOutput = z.infer<typeof EnhancedContentStrategyOutputSchema>;


// Schemas for: suggest-keyword-ideas.ts
export const SuggestKeywordIdeasInputSchema = z.object({
    keyword: z.string().describe('The keyword to generate blog post ideas for.'),
});
export type SuggestKeywordIdeasInput = z.infer<typeof SuggestKeywordIdeasInputSchema>;

export const SuggestKeywordIdeasOutputSchema = z.object({
    ideas: z.array(z.string()).describe('An array of 5-10 suggested blog post titles.'),
});
export type SuggestKeywordIdeasOutput = z.infer<typeof SuggestKeywordIdeasOutputSchema>;


// Schemas for: initiate-strategy.ts
export const InitiateStrategyInputSchema = z.object({
    strategy: GenerateContentStrategyOutputSchema.describe('The full content strategy to be executed.'),
    userId: z.string().describe('The ID of the user initiating the strategy.'),
    generatedTitles: z.array(z.string()).describe('A list of titles of the blogs that have already been generated for this strategy.'),
});
export type InitiateStrategyInput = z.infer<typeof InitiateStrategyInputSchema>;

export const InitiateStrategyOutputSchema = z.object({
    generatedBlogIds: z.array(z.string()).describe('An array of the document IDs for the newly created blog posts in Firestore.'),
    message: z.string().optional().describe('A message indicating the result of the operation.'),
});
export type InitiateStrategyOutput = z.infer<typeof InitiateStrategyOutputSchema>;


// Schemas for CMS Integrations (Webflow, WordPress)

// Webflow: Verify Credentials
export const VerifyWebflowCredentialsInputSchema = z.object({
    apiKey: z.string().describe('The Webflow API key to verify.'),
});
export type VerifyWebflowCredentialsInput = z.infer<typeof VerifyWebflowCredentialsInputSchema>;
  
export const VerifyWebflowCredentialsOutputSchema = z.object({
    success: z.boolean().describe('Whether the credentials are valid or not.'),
    error: z.string().optional().describe('An error message if verification failed.'),
});
export type VerifyWebflowCredentialsOutput = z.infer<typeof VerifyWebflowCredentialsOutputSchema>;

// Webflow: Publisher Tool
export const WebflowPublisherInputSchema = z.object({
    apiKey: z.string().describe('The API key for the Webflow account.'),
    collectionId: z.string().describe('The ID of the Webflow CMS Collection to publish to.'),
    title: z.string().describe('The title of the blog post, which will be used for the "name" field.'),
    slug: z.string().describe('The URL-friendly slug for the blog post.'),
    content: z.string().describe('The full HTML content of the blog post for the rich text field.'),
    fieldMappings: z.object({
        content: z.string().describe('The slug of the rich text field for the main blog content.'),
        metaTitle: z.string().optional().describe('The slug of the plain text field for the meta title.'),
        metaDescription: z.string().optional().describe('The slug of the plain text field for the meta description.'),
    }),
    blogMetaTitle: z.string().optional().describe('The actual meta title value.'),
    blogMetaDescription: z.string().optional().describe('The actual meta description value.'),
});
export type WebflowPublisherInput = z.infer<typeof WebflowPublisherInputSchema>;

export const WebflowPublisherOutputSchema = z.object({
  success: z.boolean().describe('Whether the publishing was successful.'),
  webflowItemId: z.string().optional().describe('The ID of the newly created item in Webflow.'),
  error: z.string().optional().describe('An error message if the publishing failed.'),
});
export type WebflowPublisherOutput = z.infer<typeof WebflowPublisherOutputSchema>;

// Webflow: Get Collections Tool
export const GetWebflowCollectionsInputSchema = z.object({
  userId: z.string().describe('The user ID to fetch credentials for.'),
});
export type GetWebflowCollectionsInput = z.infer<typeof GetWebflowCollectionsInputSchema>;

export const WebflowCollectionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  singularName: z.string(),
});
export type WebflowCollection = z.infer<typeof WebflowCollectionSchema>;

export const GetWebflowCollectionsOutputSchema = z.object({
  collections: z.array(WebflowCollectionSchema).optional(),
  error: z.string().optional(),
});
export type GetWebflowCollectionsOutput = z.infer<typeof GetWebflowCollectionsOutputSchema>;

// Webflow: Get Collection Fields Tool
export const GetWebflowCollectionFieldsInputSchema = z.object({
  apiKey: z.string().describe('The API key for the Webflow account.'),
  collectionId: z.string().describe('The ID of the collection to fetch fields from.'),
});
export type GetWebflowCollectionFieldsInput = z.infer<typeof GetWebflowCollectionFieldsInputSchema>;

export const WebflowFieldSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  slug: z.string(),
  type: z.string(),
  isRequired: z.boolean(),
});
export type WebflowField = z.infer<typeof WebflowFieldSchema>;

export const GetWebflowCollectionFieldsOutputSchema = z.object({
  fields: z.array(WebflowFieldSchema).optional(),
  error: z.string().optional(),
});
export type GetWebflowCollectionFieldsOutput = z.infer<typeof GetWebflowCollectionFieldsOutputSchema>;

// Webflow: Main Publishing Flow
export const PublishToWebflowInputSchema = z.object({
  apiKey: z.string().describe('The API key for the Webflow account.'),
  collectionId: z.string().describe('The ID of the Webflow CMS Collection to publish to.'),
  title: z.string().describe('The title of the blog post.'),
  slug: z.string().describe('The URL-friendly slug for the blog post.'),
  content: z.string().describe('The full HTML content of the blog post.'),
  fieldMappings: z.object({
    content: z.string().describe('The slug of the rich text field for the main blog content.'),
    metaTitle: z.string().optional().describe('The slug of the plain text field for the meta title.'),
    metaDescription: z.string().optional().describe('The slug of the plain text field for the meta description.'),
  }),
  blogMetaTitle: z.string().optional().describe('The actual meta title value.'),
  blogMetaDescription: z.string().optional().describe('The actual meta description value.'),
});
export type PublishToWebflowInput = z.infer<typeof PublishToWebflowInputSchema>;

export const PublishToWebflowOutputSchema = z.object({
  success: z.boolean().describe('Whether the publishing was successful.'),
  webflowItemId: z.string().optional().describe('The ID of the newly created item in Webflow.'),
  error: z.string().optional().describe('An error message if the publishing failed.'),
});
export type PublishToWebflowOutput = z.infer<typeof PublishToWebflowOutputSchema>;

// WordPress: Credentials Schema
const WordPressCredentialsSchema = z.object({
  siteUrl: z.string().url().describe('The base URL of the WordPress site (e.g., https://example.com).'),
  username: z.string().describe('The WordPress login username or account email.'),
  applicationPassword: z.string().describe('The Application Password generated from the WordPress user profile.'),
});
export type WordPressCredentials = z.infer<typeof WordPressCredentialsSchema>;

// WordPress: Verify Credentials
export const VerifyWordPressCredentialsInputSchema = WordPressCredentialsSchema;
export type VerifyWordPressCredentialsInput = z.infer<typeof VerifyWordPressCredentialsInputSchema>;

export const VerifyWordPressCredentialsOutputSchema = z.object({
  success: z.boolean().describe('Whether the credentials are valid.'),
  error: z.string().optional().describe('An error message if verification failed.'),
});
export type VerifyWordPressCredentialsOutput = z.infer<typeof VerifyWordPressCredentialsOutputSchema>;

// WordPress: Publisher Tool
export const WordPressPublisherInputSchema = z.object({
  credentials: WordPressCredentialsSchema.describe('The WordPress credentials.'),
  title: z.string().describe('The title of the blog post.'),
  content: z.string().describe('The HTML content of the blog post.'),
  status: z.enum(['publish', 'draft', 'future']).default('draft').describe('The publishing status of the post.'),
  date: z.string().optional().describe('The date for the post, in ISO-8601 format. Used for scheduling.'),
  excerpt: z.string().optional().describe('The post excerpt, often used as a meta description.'),
  slug: z.string().optional().describe('URL slug for the WordPress post.'),
});
export type WordPressPublisherInput = z.infer<typeof WordPressPublisherInputSchema>;

export const WordPressPublisherOutputSchema = z.object({
  success: z.boolean().describe('Whether the publishing was successful.'),
  postId: z.number().optional().describe('The ID of the newly created post in WordPress.'),
  postUrl: z.string().url().optional().describe('The URL of the newly created post.'),
  error: z.string().optional().describe('An error message if publishing failed.'),
});
export type WordPressPublisherOutput = z.infer<typeof WordPressPublisherOutputSchema>;

// WordPress: Main Publishing Flow
export const PublishToWordPressInputSchema = z.object({
  credentials: WordPressCredentialsSchema.describe('The WordPress credentials.'),
  title: z.string().describe('The title of the blog post.'),
  content: z.string().describe('The HTML content of the blog post.'),
  status: z.enum(['publish', 'draft', 'future']).default('draft').describe('Whether to publish directly or create a draft.'),
  date: z.string().optional().describe('The date for the post, in ISO-8601 format. Used for scheduling.'),
  excerpt: z.string().optional().describe('The post excerpt, often used as a meta description.'),
  slug: z.string().optional().describe('URL slug for the WordPress post.'),
});
export type PublishToWordPressInput = z.infer<typeof PublishToWordPressInputSchema>;

export const PublishToWordPressOutputSchema = z.object({
  success: z.boolean().describe('Whether the publishing was successful.'),
  postId: z.number().optional().describe('The ID of the newly created post in WordPress.'),
  postUrl: z.string().url().optional().describe('The URL of the newly created post.'),
  error: z.string().optional().describe('An error message if publishing failed.'),
});
export type PublishToWordPressOutput = z.infer<typeof PublishToWordPressOutputSchema>;


// Schemas for: customer-support-flow.ts
export const CustomerSupportInputSchema = z.object({
  message: z.string().describe("The user's message to the support agent."),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        content: z.string(),
      })
    )
    .optional()
    .describe('The conversation history.'),
});
export type CustomerSupportInput = z.infer<typeof CustomerSupportInputSchema>;

export const CustomerSupportOutputSchema = z.object({
  response: z.string().describe("The AI support agent's response."),
});
export type CustomerSupportOutput = z.infer<typeof CustomerSupportOutputSchema>;


// Schemas for: validate-license-key.ts
export const ValidateLicenseKeyInputSchema = z.object({
    userId: z.string().describe("The ID of the user trying to claim the key."),
    licenseKey: z.string().describe("The license key being claimed."),
});
export type ValidateLicenseKeyInput = z.infer<typeof ValidateLicenseKeyInputSchema>;

export const ValidateLicenseKeyOutputSchema = z.object({
    success: z.boolean().describe("Whether the key was successfully claimed."),
    planId: z.enum(['pro', 'standard']).optional().describe("The plan associated with the key."),
    error: z.string().optional().describe("An error message if the claim failed."),
});
export type ValidateLicenseKeyOutput = z.infer<typeof ValidateLicenseKeyOutputSchema>;

export interface UserProfile {
    name?: string;
    email?: string;
    isPaid?: boolean;
    planId?: 'pro' | 'standard';
    licenseKey?: string;
    createdAt?: any; 
    updatedAt?: any;
}

// Schemas for: get-serp-results.ts
export const SerpSearchResultSchema = z.object({
  title: z.string().describe('The title of the search result.'),
  url: z.string().url().describe('The URL of the search result.'),
  snippet: z.string().describe('A short snippet of the page content.'),
});
export type SerpSearchResult = z.infer<typeof SerpSearchResultSchema>;

export const SerpSearchOutputSchema = z.object({
  results: z.array(SerpSearchResultSchema).describe('A list of search results.'),
  error: z.string().optional().describe('An error message if the search failed.'),
});
export type SerpSearchOutput = z.infer<typeof SerpSearchOutputSchema>;

// Schemas for: ranking-opportunities.ts
export const RankingOpportunitiesInputSchema = z.object({
  websiteUrl: z.string().min(3).describe('The website URL to analyze for ranking opportunities.'),
  language: z.string().optional().default('English').describe('Language for suggested blog headings.'),
});
export type RankingOpportunitiesInput = z.infer<typeof RankingOpportunitiesInputSchema>;

export const RankingOpportunityScrapedPageSchema = z.object({
  url: z.string(),
  ok: z.boolean(),
  title: z.string().optional(),
  error: z.string().optional(),
});
export type RankingOpportunityScrapedPage = z.infer<typeof RankingOpportunityScrapedPageSchema>;

export const RankingOpportunityHeadingSchema = z.object({
  title: z.string().describe('Publishable blog topic heading.'),
  estimatedTraffic: z
    .union([z.number(), z.string()])
    .transform((value) => {
      const raw = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      if (!Number.isFinite(raw) || raw <= 0) return 0;
      return Math.min(Math.round(raw), 25_000);
    })
    .describe('Estimated organic visits per 30 days if the post ranks well for this topic.'),
});
export type RankingOpportunityHeading = z.infer<typeof RankingOpportunityHeadingSchema>;

export const RankingOpportunitiesOutputSchema = z.object({
  industry: z.string().describe('Primary industry the website operates in.'),
  niche: z.string().describe('More specific niche or vertical within that industry.'),
  brandSummary: z
    .string()
    .describe('1–2 sentence summary of what the business offers, based on scraped pages.'),
  scrapedPages: z.array(RankingOpportunityScrapedPageSchema),
  headings: z
    .array(RankingOpportunityHeadingSchema)
    .describe('Blog topic opportunities with estimated traffic per 30 days.'),
  error: z.string().optional(),
});
export type RankingOpportunitiesOutput = z.infer<typeof RankingOpportunitiesOutputSchema>;
