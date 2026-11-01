'use server';
/**
 * @fileOverview An AI text humanization agent that uses detailed feedback and specific stylistic directives.
 */

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { getBlogWriterModelChain } from '../blog-writer-models';
import {z} from 'genkit';
import {
  AdvancedHumanizeTextInputSchema,
  type AdvancedHumanizeTextInput,
  AdvancedHumanizeTextOutputSchema,
  type AdvancedHumanizeTextOutput
} from '../types';
import { finalizeBlogHtml, sanitizePreservingFormat } from '../../lib/blog/sanitize-blog-html';

// The prohibited words database - Consolidated and expanded
const PROHIBITED_SINGLE_WORDS = [
    "apparently","supposedly","evidently","seemingly","ostensibly","admittedly",
    "arguably","conceivably","potentially","presumably","theoretically",
    "virtually","practically","effectively","essentially","fundamentally",
    "inherently","predominantly","primarily","principally","roughly",
    "approximately","actionable","bandwidth","benchmark","best-in-class",
    "capitalize","deliverable","disruptive","double-click","drill-down",
    "incentivize","iterate","monetize","onboard","operationalize","prioritize",
    "productize","reimagine","repurpose","strategize","stakeholder","scalability",
    "sustainability","touchpoint","transparency","utilize","value-add","verticals",
    "visibility","workflow","synergy","alignment","deployment","engagement",
    "implementation","methodology","proactive","reactive","redefine","reinvent",
    "rethink","transformational","next-generation","world-class","industry-leading",
    "market-leading","future-proof","mission-critical","aforementioned","ascertain",
    "behoove","burgeoning","captivating","compelling","culminate","elucidate",
    "encapsulate","endeavor","enriching","enthralling","epitomize","exponential",
    "formidable","groundbreaking","illuminate","immersive","indispensable",
    "insightful","intriguing","labyrinth","monumental","mosaic","myriad",
    "odyssey","panorama","perplexing","pinnacle","poignant","quintessential",
    "resonate","riveting","steadfast","symbiotic","treasure","unparalleled",
    "unprecedented","unveiling","venturing","vibrant","voyage","zenith","beacon",
    "catalyst","nexus","epitome","embodiment","testament","manifestation",
    "confluence","dichotomy","juxtaposition","adaptive","advantageous","beneficial",
    "collaborative","consequential","contemporary","critical","cutting-edge",
    "distinctive","effectual","emergent","empowering","enriching","expansive",
    "exponential","far-reaching","forward-thinking","foundational","fruitful",
    "game-changing","groundbreaking","holistic","impactful","indispensable",
    "influential","informative","insightful","instrumental","integrative",
    "meaningful","momentous","noteworthy","optimal","overarching","pervasive",
    "phenomenal","pioneering","practical","pragmatic","proactive","productive",
    "proficient","progressive","prominent","pronounced","revolutionary","rigorous",
    "sophisticated","state-of-the-art","strategic","streamlined","substantial",
    "sustainable","systematic","tangible","thorough","trailblazing",
    "transformational","unparalleled","unprecedented","versatile","well-established",
    "accelerate","accommodate","accomplish","achieve","advance","advocate",
    "amplify","analyze","ascertain","capitalize","characterize","collaborate",
    "commence","complement","comprehend","comprise","configure","constitute",
    "construct","contemplate","contribute","cultivate","delineate","depict",
    "derive","designate","determine","discern","distinguish","elucidate",
    "empower","enable","encompass","endeavor","engage","enhance","enumerate",
    "envision","establish","evaluate","examine","execute","exhibit","expedite",
    "explore","extrapolate","facilitate","formulate","foster","function",
    "generate","harness","identify","illuminate","implement","incorporate",
    "indicate","initiate","innovate","integrate","interpret","investigate",
    "leverage","manifest","maximize","mitigate","navigate","necessitate",
    "optimize","orchestrate","originate","perceive","perpetuate","pinpoint",
    "possess","precipitate","procure","proliferate","propagate","propel",
    "quantify","realize","recognize","redefine","refine","represent",
    "revolutionize","scrutinize","spearhead","stipulate","streamline",
    "substantiate","synthesize","systematize","transcend","transform",
    "underscore","undertake","unveil","utilize","validate","visualize","warrant",
    "accordingly","considerably","critically","decidedly","demonstrably",
    "distinctly","effectively","efficiently","eminently","especially","evidently",
    "exceedingly","exceptionally","exclusively","extensively","extraordinarily",
    "fundamentally","immensely","increasingly","inherently","intrinsically",
    "markedly","meaningfully","monumentally","notably","ostensibly",
    "overwhelmingly","particularly","predominantly","profoundly","progressively",
    "prominently","quantifiably","remarkably","significantly","substantially",
    "tangibly","tremendously","undeniably","unequivocally","uniquely",
    "unmistakably","unprecedentedly","vastly"
];

const PROHIBITED_PHRASES = [
    "a testament to the fact","aligned with our vision","an array of options",
    "as evidenced by the","at the cutting edge","at the intersection of",
    "bears witness to the","break new ground in","brings into sharp focus",
    "by virtue of the","calls into question the","cannot be underestimated",
    "centers around the concept","characterized by a high degree",
    "comes as no surprise","contributes significantly to the",
    "creates a framework for","demonstrates a clear understanding",
    "embodies the essence of","enables us to better understand",
    "epitomizes the notion of","establishes a foundation for",
    "exemplifies the principles of","exhibits a remarkable degree",
    "falls within the realm","forms the backbone of",
    "further underscores the importance","gains traction in the",
    "garners significant attention from","gives rise to questions",
    "has emerged as a","has gained considerable momentum",
    "has garnered widespread attention","has profound implications for",
    "holds great promise for","illuminates the path toward",
    "in an increasingly complex","in no small measure","is predicated on the",
    "is synonymous with quality","lays the groundwork for",
    "lies at the heart","lies at the intersection","makes it abundantly clear",
    "merits careful consideration by","occupies a central position",
    "offers a compelling case","opens up new possibilities",
    "paints a vivid picture","points to the conclusion",
    "presents a unique opportunity","provides a comprehensive overview",
    "provides critical insights into","raises the question of",
    "represents a significant departure","represents a turning point",
    "resonates deeply with audiences","serves as a cornerstone",
    "serves as a gateway","serves as a powerful reminder","sets the stage for",
    "shines a spotlight on","speaks to the broader","stands at the forefront",
    "stands in sharp contrast","strikes a balance between",
    "takes center stage in","throws light on the",
    "underlines the significance of","warrants further investigation into",
    "with this in mind","in the context of","on the basis of",
    "plays an integral role","serves as a catalyst","with respect to the"
];

const FORBIDDEN_SENTENCE_STARTERS = [
    "thus","hence","therefore","consequently","accordingly","subsequently",
    "nevertheless","nonetheless","conversely","alternatively","essentially",
    "fundamentally","critically","notably","interestingly","remarkably",
    "significantly","importantly","ultimately","evidently","clearly","obviously",
    "undoubtedly","certainly","admittedly","understandably"
];

const prohibitedListText = [...PROHIBITED_SINGLE_WORDS, ...PROHIBITED_PHRASES, ...FORBIDDEN_SENTENCE_STARTERS].slice(0, 200).join(', ');

export async function advancedHumanizeText(
  input: AdvancedHumanizeTextInput
): Promise<AdvancedHumanizeTextOutput> {
  return advancedHumanizeTextFlow(input);
}

const advancedHumanizeTextPrompt = definePromptOnce({
  name: 'advancedHumanizeTextPrompt',
  input: {schema: AdvancedHumanizeTextInputSchema.extend({ isStricterPass: z.boolean().optional() })},
  output: {schema: AdvancedHumanizeTextOutputSchema.omit({ error: true }) },
  prompt: `You are a world-class editor specializing in making text 100% human-sounding and impossible for AI detectors to flag. Your goal is to rewrite the text to maximize Perplexity (complexity of word choice) and Burstiness (variation in sentence structure).

## STRICT LANGUAGE MANDATE (CRITICAL)
- **THE OUTPUT MUST BE WRITTEN ENTIRELY AND EXCLUSIVELY IN {{language}}.** 
- **ABSOLUTELY NO ENGLISH**: Do not use English words, phrases, idioms, or sentences if {{language}} is not English.
- Every single sentence, word, and character must be strictly in {{language}}.
- If technical terms are used, they must be translated or localized to the standard usage in {{language}}.
- **NO BILINGUAL OUTPUT**: Never mix languages.

## FORMATTING MANDATE (CRITICAL)
{{#if preserveExactFormat}}
- **EXACT FORMAT PRESERVATION OVERRIDES EVERY OTHER FORMATTING RULE BELOW.**
- The user pasted content with a specific layout. Return HTML that mirrors that layout EXACTLY.
- Keep the same HTML tag structure and order: <h1>–<h6>, <p>, <ul>/<ol>/<li>, <table>, <br>, <blockquote>, <div>, <a>, <strong>, <em>, <u>.
- Do NOT merge, split, add, remove, or reorder blocks. Same number of paragraphs, headings, list items, and line breaks.
- Do NOT reflow short paragraphs into longer ones, or long ones into shorter ones.
- Do NOT invent new headings, lists, or sections that were not in the original.
- Only rewrite the wording inside existing text nodes so it sounds more human.
- Preserve the user's punctuation style, including question marks when present.
- Preserve existing links and emphasis markup; change only the text content inside them when needed.
- Keep every HTML attribute exactly as it is (href, id, src, alt), so table of contents jump links keep working.
- **ABSOLUTELY NO ASTERISKS** (* or **) for markdown bold/italics — use existing HTML tags only.
{{else}}
- **ABSOLUTELY NO ASTERISKS ANYWHERE IN THE OUTPUT**: NEVER use asterisks (* or **) for bold, italics, emphasis, lists, or any purpose whatsoever.
- **DO NOT BOLD THE PRIMARY KEYWORD**: Never wrap "{{{primaryKeyword}}}" in <strong>, <b>, or <em>. Keywords must appear as plain text.
- Use <strong> and <em> sparingly for non-keyword emphasis only.
- **PRESERVE STRUCTURE**: Keep bullet lists (<ul>/<ol>) and <table> elements intact. Do not merge short paragraphs into long blocks.
- **SHORT PARAGRAPHS**: Each <p> must contain at most 3 sentences. Split any longer block into multiple <p> tags.
- **NO QUESTION MARKS**: The output must contain ZERO question mark characters (?). Every sentence must end with a period.
{{/if}}

## TONE ADHERENCE (CRITICAL)
The requested tone is: "{{tone}}".
You MUST ensure the humanized output reflects this tone perfectly.
- If **"Storytelling"**, use narrative flow, evocative language, and a personal, engaging voice. Avoid robotic transitions.
- If **"Formal"**, maintain professionalism while still sounding like a real expert (avoid corporate clichés).

CRITICAL HUMANIZATION RULES:
1.  **DESTROY AI RHYTHM**: AI writes in predictable, medium-length sentences. YOU must mix ultra-short, punchy sentences with long, flowing ones. Break the flow. Use fragments where they add impact.
2.  **ELIMINATE CLICHÉS**: Eradicate all corporate jargon and predictable AI transition words. Avoid phrases like "In conclusion," "Furthermore," "Additionally," or their equivalents in {{language}}.
3.  **VARY VOCABULARY**: Replace common words with more specific, vivid, and unexpected synonyms in {{language}}. Use a conversational yet professional lexicon.
{{#if preserveExactFormat}}
4.  **DO NOT RESTRUCTURE**: Leave paragraph and section boundaries exactly as provided. Humanize word choice and sentence phrasing inside each existing block only.
5.  **IDENTIFY & ELIMINATE PROHIBITED SEMANTICS**: Search for the semantic equivalents of these words in {{language}} and replace them: ${prohibitedListText}.
6.  **PRESERVE SUBSTANCE**: Do NOT remove specific data, statistics, examples, or actionable details. You may rephrase them, but the concrete information must remain intact. If Brain/knowledge base facts are provided, keep pricing and product numbers exactly.
{{else}}
4.  **RESTRUCTURE PARAGRAPHS**: Keep paragraphs short — **2–3 sentences per <p> tag maximum**. Break dense blocks into multiple <p> tags for readability.
5.  **IDENTIFY & ELIMINATE PROHIBITED SEMANTICS**: Search for the semantic equivalents of these words in {{language}} and replace them: ${prohibitedListText}.
6.  **KEYWORD USAGE (NATURAL)**: {{#if primaryKeyword}}{{#if keywordOccurrences}}Keep about {{{keywordOccurrences}}} casual appearances of "{{{primaryKeyword}}}". Prefer body paragraphs; use the keyword in only a few headings if it already fits. Do NOT rewrite most <h2> tags just to insert the keyword.{{/if}}{{/if}}
7.  **ZERO QUESTIONS**: Remove ALL questions from the text — rhetorical, leading, or conversational. Replace each question with a direct, informative declarative statement that conveys the same point. Example: "Have you ever wondered why sites load slowly?" becomes "Slow-loading sites lose visitors at an alarming rate."
8.  **PRESERVE SUBSTANCE**: Do NOT remove specific data, statistics, examples, or actionable details during humanization. You may rephrase them, but the concrete information must remain intact. Never replace a specific fact with a vague generalization. If Brain/knowledge base facts are provided, keep pricing and product numbers exactly.
{{/if}}

Original text:
{{{htmlContent}}}

{{#if knowledgeBase}}
**BRAIN / KNOWLEDGE BASE — SOURCE OF TRUTH (MANDATORY):**
While humanizing, you MUST keep every concrete Brain fact exact — pricing, plan names, product names, numbers, features, limits. Do not change, round, omit, or soften them.
Example: if Brain says "$100 / month", the humanized text MUST still say "$100 / month".
<knowledge_base>
{{{knowledgeBase}}}
</knowledge_base>
{{/if}}

{{#if aiAnalysisFeedback}}
**AI Analysis Feedback to Fix:**
- Perplexity level is currently {{aiAnalysisFeedback.perplexityIndicator}}. Action: Use more unique and contextual synonyms in {{language}}.
- Burstiness level is currently {{aiAnalysisFeedback.burstinessIndicator}}. Action: Dramatically vary sentence lengths{{#if preserveExactFormat}} within each existing paragraph — without changing paragraph boundaries{{/if}}.
- Flagged AI segments: {{#each aiAnalysisFeedback.flaggedSegments}}"{{segment}}" {{/each}}. Action: Completely rephrase these ideas in a non-linear way{{#if preserveExactFormat}} while keeping the same HTML block they live in{{/if}}.
{{/if}}

{{#if preserveExactFormat}}
Return ONLY the humanized HTML in {{language}}. Mirror the original HTML structure exactly. No preamble, explanations, or markdown.
{{else}}
Return ONLY the humanized HTML content in {{language}} with no preamble, explanations, or markdown formatting.
{{/if}}`
});


const advancedHumanizeTextFlow = defineFlowOnce(
  {
    name: 'advancedHumanizeTextFlow',
    inputSchema: AdvancedHumanizeTextInputSchema,
    outputSchema: AdvancedHumanizeTextOutputSchema,
  },
  async (input: AdvancedHumanizeTextInput): Promise<AdvancedHumanizeTextOutput> => {
    try {
      const mutableInput = { ...input };

      // High temperature is CRITICAL for human-like burstiness and word choice
      const temperature = (mutableInput.humanizationLevel && mutableInput.humanizationLevel > 1) ? 0.95 : 0.85;
      
      const isStricterPass = mutableInput.humanizationLevel && mutableInput.humanizationLevel > 1;
      const models = mutableInput.blogWriterUserId
        ? await getBlogWriterModelChain(mutableInput.blogWriterUserId)
        : STRATEGY_DEPLOY_LLM_CHAIN;

      const { result: output } = await withLlmModelFallback(
        async (model) => {
          const response = await advancedHumanizeTextPrompt(
            { ...mutableInput, isStricterPass: isStricterPass } as AdvancedHumanizeTextInput & {
              isStricterPass?: boolean;
            },
            { config: { temperature }, model },
          );
          if (!response?.output?.humanizedHtmlContent) {
            throw new Error('AI model did not return the expected output for text humanization.');
          }
          return response.output;
        },
        { label: 'advancedHumanizeText', models, deadlineAt: mutableInput.deadlineAt },
      );

      const humanizedHtmlContent = input.preserveExactFormat
        ? sanitizePreservingFormat(output.humanizedHtmlContent!)
        : finalizeBlogHtml(output.humanizedHtmlContent!, input.primaryKeyword);
      return {
        ...output,
        humanizedHtmlContent,
      };
    } catch (error: any) {
      console.error('Error in advancedHumanizeTextFlow:', error);
      let detailMessage = 'No specific detail available.';
      if (error instanceof Error) {
        detailMessage = error.message;
      } else if (typeof error === 'string') {
        detailMessage = error;
      }
      throw new Error(`[advancedHumanizeTextFlow] Failed to humanize text. Detail: ${detailMessage}`);
    }
  }
);
