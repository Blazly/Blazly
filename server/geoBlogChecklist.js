/** Backend GEO publishing checklist (eseospace) — injected for GEO blog writer runs. */
export const GEO_BLOG_WRITER_CHECKLIST = `
GEO BLOG WRITER — MANDATORY CHECKLIST (follow every stage):

1. BEFORE WRITING: TOPIC AND INTENT
- Pick a question people actually ask AI tools (conversational, long-tail: "how do I…", "what's the best… for…", "X vs Y").
- List the 5–10 follow-up questions someone would ask next (AI engines fan out a query into sub-questions; cover them in the article).
- Account for what ChatGPT, Perplexity and Google AI Overviews would cite for this query; fill gaps competitors miss.
- Decide unique value: original data, first-hand experience, expert opinion, local context — and deliver it.

2. ANSWER-FIRST STRUCTURE
- Direct 40–60 word answer right under the title or H1 (TL;DR or summary box).
- Each H2/H3 phrased as a question or clear topic label.
- First 1–2 sentences under every heading answer that heading directly; context after.
- Each section stands alone (AI pulls passages, not whole pages) — no "as mentioned above".
- Short paragraphs (2–4 sentences), one idea each.
- Lists for steps, tables for comparisons, definitions in "X is…" form.
- FAQ section at the end with real questions and concise answers.

3. CITATION-WORTHY CONTENT
- Specific statistics and numbers, with source named and linked.
- Quotes from named experts or practitioners when appropriate.
- Outbound links to authoritative primary sources (studies, official docs, government data).
- Original data, examples, case studies or clearly labeled illustrative examples.
- Clear, declarative statements (quotable facts over hedging).
- Consistent entity names: brand, product and people named the same way throughout.
- No keyword stuffing.

4. TRUST AND E-E-A-T SIGNALS
- Write so a named author bio, credentials and profile link could attach naturally (practitioner voice).
- Show first-hand experience where true ("we tested…", "in our work…") — never invent experience.
- Content should support a visible "last updated" mindset; prefer current stats and recent sources.
- For YMYL topics, tone must be careful, factual, and review-ready.
- Assume About, contact and editorial policy exist on the site.

5. TECHNICAL AND ON-PAGE (reflect in copy structure)
- Title tag and meta description must state the answer or benefit (return in metaTitle/metaDescription fields).
- One H1 worth of title in blogTitle; logical H2/H3 hierarchy in HTML only (no duplicate H1 in body).
- Structure content so Article/BlogPosting, FAQPage, HowTo, Person, Organization schema could be generated from it.
- Main content in plain HTML in blogPost — not dependent on tabs/accordions for meaning.
- Descriptive context for images in prose; use real HTML tables for comparisons.
- Internal link suggestions for related topic-cluster pages.

6. OFF-PAGE AND BRAND SIGNALS (inform mentions and CTAs)
- Phrasing that could earn mentions on trusted third-party surfaces (publications, forums, review contexts).
- Consistent brand naming aligned with Google Business Profile / LinkedIn style when brand is provided.
- Key facts stated clearly enough to repurpose in posts and video scripts.
- Position this piece within a topic cluster, not an isolated article.

7. AFTER PUBLISHING (mention in conclusion where natural)
- Encourage indexing in Google Search Console and Bing Webmaster Tools.
- Suggest re-checking target queries in ChatGPT, Perplexity, Gemini and Google AI Mode after publication.
- Note tracking AI referral traffic (chatgpt.com, perplexity.ai, gemini.google.com).
- Plan to refresh stats and dates every 3–6 months.
`.trim();

export function appendGeoChecklistToKnowledge(knowledgeBase) {
  const block = `## GEO PUBLISHING CHECKLIST\n${GEO_BLOG_WRITER_CHECKLIST}`;
  return knowledgeBase ? `${knowledgeBase}\n\n${block}` : block;
}
