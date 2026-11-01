import type { AuditCategoryId, AuditGrade, ScoreBucketId } from './types/site-audit';

/** Which content-review pass grades the check. Checks without a review are rule-based. */
export type ReviewPass = 'relevance' | 'authority';

export type CheckDef = {
  id: string;
  label: string;
  weight?: number;
  review?: ReviewPass;
  group?: string;
  hint?: string;
};

export type CategoryDef = {
  id: AuditCategoryId;
  number: number;
  label: string;
  checks: CheckDef[];
};

export const AUDIT_CATEGORIES: CategoryDef[] = [
  {
    id: 'url-indexability',
    number: 1,
    label: 'URL & Indexability',
    checks: [
      { id: 'url-readable', label: 'URL is short, descriptive, and readable' },
      { id: 'url-topic', label: 'Primary keyword/topic is reflected in URL where appropriate' },
      { id: 'url-hyphens', label: 'URL uses hyphens, not underscores' },
      { id: 'url-clean', label: 'No unnecessary parameters, IDs, dates, or duplicate URL variations' },
      { id: 'status-200', label: 'Page returns 200 status code', weight: 3 },
      { id: 'indexable', label: 'Page is indexable', weight: 3 },
      { id: 'no-noindex', label: 'No accidental noindex', weight: 3 },
      { id: 'no-nofollow', label: 'No accidental nofollow', weight: 2 },
      { id: 'canonical-exists', label: 'Canonical tag exists' },
      { id: 'canonical-correct', label: 'Canonical points to the correct preferred URL', weight: 2 },
      { id: 'canonical-indexable', label: 'Canonical URL itself is indexable', weight: 2 },
      { id: 'https-redirect', label: 'HTTP → HTTPS correctly redirected', weight: 2 },
      { id: 'host-consistent', label: 'WWW/non-WWW version is consistent' },
      { id: 'no-duplicate-url', label: 'No duplicate page competing with this URL' },
    ],
  },
  {
    id: 'title',
    number: 2,
    label: 'Title Tag',
    checks: [
      { id: 'title-exists', label: 'Title tag exists', weight: 3 },
      { id: 'title-accurate', label: 'Title accurately describes the page', review: 'relevance' },
      { id: 'title-topic', label: 'Primary keyword/topic is naturally included', weight: 2 },
      { id: 'title-topic-early', label: 'Keyword appears early where appropriate' },
      { id: 'title-unique', label: 'Title is unique across the website', weight: 2 },
      { id: 'title-not-repetitive', label: "Title isn't unnecessarily repetitive" },
      {
        id: 'title-compelling',
        label: 'Title is compelling enough to encourage clicks',
        review: 'relevance',
        hint: 'Judge click appeal in a SERP: specificity, benefit, freshness, numbers or differentiators — without clickbait.',
      },
      { id: 'title-no-stuffing', label: 'No keyword stuffing' },
      { id: 'title-brand', label: 'Brand name is included where appropriate' },
      { id: 'title-length', label: "Title isn't truncated excessively in SERPs" },
    ],
  },
  {
    id: 'meta-description',
    number: 3,
    label: 'Meta Description',
    checks: [
      { id: 'meta-exists', label: 'Meta description exists', weight: 2 },
      {
        id: 'meta-page-specific',
        label: 'Unique for the page',
        review: 'relevance',
        hint: 'Is it written specifically for this page, or is it generic site-wide boilerplate? Fail if missing.',
      },
      { id: 'meta-summary', label: 'Clearly summarizes the page', review: 'relevance', hint: 'Fail if missing.' },
      { id: 'meta-topic', label: 'Primary topic/keyword included naturally' },
      { id: 'meta-value', label: 'Strong value proposition', review: 'relevance', hint: 'Fail if missing.' },
      {
        id: 'meta-cta',
        label: 'Appropriate CTA where relevant',
        review: 'relevance',
        hint: 'A soft call to action (learn, compare, get, try, book…). Use na only when a CTA would be inappropriate.',
      },
      { id: 'meta-no-stuffing', label: 'No keyword stuffing' },
      { id: 'meta-not-duplicated', label: 'Not duplicated across multiple pages' },
      { id: 'meta-length', label: 'Appropriate length' },
    ],
  },
  {
    id: 'headings',
    number: 4,
    label: 'Heading Structure',
    checks: [
      { id: 'h1-single', label: 'One clear H1', weight: 2 },
      { id: 'h1-intent', label: 'H1 accurately represents the primary search intent', review: 'relevance' },
      { id: 'h1-topic', label: 'Primary topic is naturally reflected in H1' },
      { id: 'h1-descriptive', label: 'H1 is unique and descriptive' },
      { id: 'h2-sections', label: 'H2s organize major sections' },
      { id: 'h3-logical', label: 'H3s/H4s are used logically under relevant H2s' },
      { id: 'heading-levels', label: 'No unnecessary heading levels' },
      { id: 'heading-not-styling', label: "Headings aren't being used purely for visual styling" },
      { id: 'heading-questions', label: 'Important questions/topics are covered in headings where appropriate' },
    ],
  },
  {
    id: 'search-intent',
    number: 5,
    label: 'Search Intent & Content Relevance',
    checks: [
      { id: 'intent-dominant', label: 'Page matches the dominant search intent', weight: 3, review: 'relevance' },
      { id: 'intent-satisfies', label: 'Content satisfies what users actually want', weight: 2, review: 'relevance' },
      { id: 'intent-content-type', label: 'Content type matches SERP expectations', weight: 2, review: 'relevance', hint: 'e.g. guide vs product page vs comparison vs tool vs category page for the primary keyword.' },
      { id: 'intent-quick-value', label: 'Page provides a clear answer/value quickly', review: 'relevance', hint: 'Within the first screen / first ~100 words.' },
      { id: 'intent-no-mismatch', label: 'No significant intent mismatch', weight: 2, review: 'relevance' },
      { id: 'intent-primary-topic', label: 'Primary topic is clearly established', review: 'relevance' },
      { id: 'intent-subtopics', label: 'Secondary topics/subtopics are covered', review: 'relevance' },
      { id: 'intent-no-padding', label: "Content isn't unnecessarily padded", review: 'relevance' },
      { id: 'intent-people-first', label: 'Content is genuinely useful rather than written primarily for search engines', weight: 2, review: 'relevance' },
      { id: 'intent-competitive', label: 'Page provides something competitive with or better than ranking results', weight: 2, review: 'relevance', hint: 'Compare with what typically ranks on page one for the primary keyword.' },
    ],
  },
  {
    id: 'content-quality',
    number: 6,
    label: 'Content Quality',
    checks: [
      { id: 'cq-original', label: 'Content is original', weight: 2, review: 'relevance', hint: 'Unique angle, examples or data vs rehashed generic copy.' },
      { id: 'cq-accurate', label: 'Content is factually accurate', weight: 2, review: 'relevance' },
      { id: 'cq-claims-supported', label: 'Claims are supported where necessary', review: 'relevance' },
      { id: 'cq-not-outdated', label: 'No outdated information', review: 'relevance' },
      { id: 'cq-stats-sourced', label: 'Statistics/data have appropriate sources', review: 'relevance', hint: 'na if the page cites no statistics.' },
      { id: 'cq-expertise', label: 'Content demonstrates relevant expertise', review: 'relevance' },
      { id: 'cq-no-ai-errors', label: 'No obvious AI-generated factual errors', review: 'relevance', hint: 'Invented statistics, wrong dates, contradictions or hallucinated names.' },
      { id: 'cq-no-filler', label: 'No excessive generic filler', review: 'relevance' },
      { id: 'cq-no-repetition', label: 'No repetitive paragraphs', review: 'relevance' },
      { id: 'cq-no-stuffing', label: 'No keyword stuffing', review: 'relevance' },
      { id: 'cq-readability', label: 'Grammar and readability are good', review: 'relevance' },
      { id: 'cq-scannable', label: 'Content is easy to scan', review: 'relevance', hint: 'Short paragraphs, subheadings, lists, bolded key points.' },
      { id: 'cq-not-buried', label: "Important information isn't buried unnecessarily", review: 'relevance' },
      { id: 'cq-depth', label: 'Content has sufficient depth for the topic', weight: 2, review: 'relevance' },
      { id: 'cq-fresh', label: 'Content is updated when freshness matters', review: 'relevance', hint: 'na for evergreen topics where freshness does not matter.' },
    ],
  },
  {
    id: 'keyword-topic',
    number: 7,
    label: 'Keyword / Topic Optimization',
    checks: [
      { id: 'kw-targeted', label: 'Primary keyword/topic is clearly targeted', weight: 2, review: 'relevance' },
      { id: 'kw-in-title', label: 'Primary topic appears naturally in the title' },
      { id: 'kw-in-h1', label: 'Primary topic appears naturally in the H1' },
      { id: 'kw-in-intro', label: 'Primary topic appears naturally in the introduction' },
      { id: 'kw-in-subheadings', label: 'Primary topic appears naturally in relevant H2/H3s' },
      { id: 'kw-in-body', label: 'Primary topic appears naturally in body content' },
      { id: 'kw-in-url', label: 'Primary topic appears in the URL where appropriate' },
      { id: 'kw-in-alt', label: 'Primary topic appears in image alt text where appropriate' },
      { id: 'kw-entities', label: 'Relevant semantic entities/topics are covered', review: 'relevance' },
      { id: 'kw-variations', label: 'Search variations are naturally addressed', review: 'relevance' },
      { id: 'kw-questions', label: 'Related questions are answered', review: 'relevance' },
      { id: 'kw-no-repetition', label: 'No unnatural keyword repetition' },
      { id: 'kw-no-overlap', label: 'No multiple pages unnecessarily targeting the same intent' },
      { id: 'kw-clear-intent', label: 'Page has a clearly defined primary intent', review: 'relevance' },
    ],
  },
  {
    id: 'internal-links',
    number: 8,
    label: 'Internal Linking',
    checks: [
      { id: 'il-has-links', label: 'Page has relevant internal links', weight: 2 },
      { id: 'il-inbound', label: 'Important pages link to this page', weight: 2 },
      { id: 'il-outbound', label: 'This page links to relevant supporting pages' },
      { id: 'il-anchor-descriptive', label: 'Anchor text is descriptive' },
      { id: 'il-anchor-not-exact', label: "Anchor text isn't excessively exact-match" },
      { id: 'il-relevant', label: 'Links point to relevant pages', review: 'relevance', hint: 'Judge from the internal link list (anchor → path). na if there are no internal links.' },
      { id: 'il-no-broken', label: 'No broken internal links', weight: 2 },
      { id: 'il-not-orphaned', label: "Important pages aren't orphaned", weight: 2 },
      { id: 'il-topical', label: "Internal links support the site's topical structure" },
      { id: 'il-commercial', label: 'Commercial/conversion pages receive appropriate internal authority' },
    ],
  },
  {
    id: 'external-links',
    number: 9,
    label: 'External Links',
    checks: [
      { id: 'el-relevant', label: 'External links are relevant', review: 'relevance', hint: 'na if there are no external links in the content.' },
      { id: 'el-trustworthy', label: 'Sources are trustworthy', review: 'relevance', hint: 'na if there are no external links in the content.' },
      { id: 'el-claims', label: 'Important claims have supporting sources where appropriate', review: 'relevance' },
      { id: 'el-not-excessive', label: "Links aren't unnecessarily excessive" },
      { id: 'el-no-broken', label: 'Broken external links are avoided' },
      { id: 'el-rel', label: 'Sponsored/UGC links use appropriate attributes when required' },
      { id: 'el-helpful', label: 'External links genuinely help the user', review: 'relevance', hint: 'na if there are no external links in the content.' },
    ],
  },
  {
    id: 'images',
    number: 10,
    label: 'Images',
    checks: [
      { id: 'img-relevant', label: 'Images are relevant to the content', review: 'relevance', hint: 'Judge from image alt text and filenames. na if the page has no content images.' },
      { id: 'img-filenames', label: 'Descriptive filenames' },
      { id: 'img-alt', label: 'Appropriate alt text', weight: 2 },
      { id: 'img-alt-not-stuffed', label: "Alt text isn't keyword stuffed" },
      { id: 'img-decorative', label: "Decorative images don't have unnecessary alt text" },
      { id: 'img-compressed', label: 'Images are compressed' },
      { id: 'img-modern', label: 'Modern formats such as WebP/AVIF used where appropriate' },
      { id: 'img-dimensions', label: 'Correct image dimensions' },
      { id: 'img-responsive', label: 'Responsive images implemented' },
      { id: 'img-not-large', label: "Images aren't unnecessarily large" },
      { id: 'img-lazy', label: 'Lazy loading used where appropriate' },
      { id: 'img-hero-eager', label: "Important above-the-fold images aren't unnecessarily lazy-loaded" },
      { id: 'img-no-broken', label: 'No broken images', weight: 2 },
    ],
  },
  {
    id: 'page-speed',
    number: 11,
    label: 'Page Speed / Core Web Vitals',
    checks: [
      { id: 'ps-lcp', label: 'LCP is healthy', weight: 2 },
      { id: 'ps-inp', label: 'INP is healthy', weight: 2 },
      { id: 'ps-cls', label: 'CLS is healthy', weight: 2 },
      { id: 'ps-mobile', label: 'Mobile performance checked', weight: 2 },
      { id: 'ps-desktop', label: 'Desktop performance checked' },
      { id: 'ps-images', label: 'Large images optimized' },
      { id: 'ps-render-blocking', label: 'Render-blocking resources minimized' },
      { id: 'ps-js', label: 'Unnecessary JavaScript minimized' },
      { id: 'ps-css', label: 'CSS optimized' },
      { id: 'ps-fonts', label: 'Fonts optimized' },
      { id: 'ps-third-party', label: 'Third-party scripts reviewed' },
      { id: 'ps-above-fold', label: 'Above-the-fold content loads quickly' },
      { id: 'ps-layout-shifts', label: 'No major layout shifts' },
    ],
  },
  {
    id: 'mobile-ux',
    number: 12,
    label: 'Mobile UX',
    checks: [
      { id: 'mx-responsive', label: 'Fully responsive', weight: 2 },
      { id: 'mx-no-hscroll', label: 'No horizontal scrolling' },
      { id: 'mx-readable', label: 'Text is readable without zooming' },
      { id: 'mx-tap-targets', label: 'Buttons/links are easy to tap' },
      { id: 'mx-navigation', label: 'Navigation works properly' },
      { id: 'mx-popups', label: "Pop-ups don't obstruct important content" },
      { id: 'mx-sticky', label: "Sticky elements don't cover content" },
      { id: 'mx-forms', label: 'Forms work correctly' },
      { id: 'mx-images-scale', label: 'Images scale correctly' },
      { id: 'mx-parity', label: 'Mobile page contains the important content available on desktop', weight: 2 },
    ],
  },
  {
    id: 'structured-data',
    number: 13,
    label: 'Structured Data / Schema',
    checks: [
      { id: 'sd-identified', label: 'Appropriate schema identified', weight: 2 },
      { id: 'sd-implemented', label: 'Schema implemented correctly' },
      { id: 'sd-matches', label: 'Schema matches visible page content' },
      { id: 'sd-not-misleading', label: 'No misleading structured data' },
      { id: 'sd-required', label: 'Required properties present' },
      { id: 'sd-recommended', label: 'Recommended properties added where useful' },
      { id: 'sd-validates', label: 'Schema validates correctly' },
      { id: 'sd-no-conflicts', label: 'No conflicting schema' },
      { id: 'sd-site-basics', label: 'Organization/WebSite/Breadcrumb schema implemented where appropriate' },
      { id: 'sd-appropriate', label: 'Article/Product/FAQ/LocalBusiness/etc. used only when genuinely applicable' },
    ],
  },
  {
    id: 'eeat',
    number: 14,
    label: 'E-E-A-T Signals',
    checks: [
      { id: 'eeat-author', label: 'Author identified where appropriate', review: 'authority', hint: 'na for pages where authorship is not expected (homepage, pricing, contact).' },
      { id: 'eeat-credentials', label: 'Author has relevant credentials/experience', review: 'authority', hint: 'na when authorship is not expected.' },
      { id: 'eeat-bio', label: 'Author bio/profile available', review: 'authority', hint: 'na when authorship is not expected.' },
      { id: 'eeat-organization', label: 'Organization/company identified', review: 'authority' },
      { id: 'eeat-about-contact', label: 'About/contact information accessible', review: 'authority' },
      { id: 'eeat-sources', label: 'Sources cited where appropriate', review: 'authority' },
      { id: 'eeat-experience', label: 'First-hand experience included where relevant', review: 'authority' },
      { id: 'eeat-expertise', label: 'Content demonstrates genuine expertise', weight: 2, review: 'authority' },
      { id: 'eeat-trust', label: 'Trust signals present', review: 'authority', hint: 'Reviews, testimonials, client logos, certifications, guarantees, security/privacy info.' },
      { id: 'eeat-transparent', label: 'Commercial claims are transparent', review: 'authority', hint: 'Pricing, affiliations and promises are clear and not exaggerated. na if the page makes no commercial claims.' },
    ],
  },
  {
    id: 'conversion-ux',
    number: 15,
    label: 'Conversion / UX',
    checks: [
      { id: 'cx-cta', label: 'Clear primary CTA', weight: 2, review: 'relevance', hint: 'Judge from the CTA list and content.' },
      { id: 'cx-cta-intent', label: 'CTA matches search intent', review: 'relevance' },
      { id: 'cx-next-step', label: 'User knows what to do next', review: 'relevance' },
      { id: 'cx-visible', label: "Important conversion elements aren't hidden" },
      { id: 'cx-forms', label: 'Forms work' },
      { id: 'cx-contact', label: 'Contact information accessible' },
      { id: 'cx-trust', label: 'Trust signals present' },
      { id: 'cx-not-overwhelming', label: "Page doesn't overwhelm users with CTAs" },
      { id: 'cx-value', label: 'Commercial pages clearly communicate value', review: 'relevance', hint: 'na for purely informational pages.' },
    ],
  },
  {
    id: 'duplicates',
    number: 16,
    label: 'Duplicate & Cannibalization Checks',
    checks: [
      { id: 'dup-content', label: 'No substantial duplicate content', weight: 2 },
      { id: 'dup-title', label: 'No duplicate title' },
      { id: 'dup-h1', label: 'No duplicate H1' },
      { id: 'dup-meta', label: 'No duplicate meta description where avoidable' },
      { id: 'dup-intent', label: 'Page has a unique search intent' },
      { id: 'dup-better-url', label: 'No other URL is better suited for the same keyword/topic' },
      { id: 'dup-canonical', label: 'Canonicalization is correct' },
      { id: 'dup-differentiated', label: 'Similar pages have clear differentiation' },
    ],
  },
  {
    id: 'technical',
    number: 17,
    label: 'Technical On-Page Elements',
    checks: [
      { id: 'tech-lang', label: 'Correct language attribute' },
      { id: 'tech-charset', label: 'Correct charset' },
      { id: 'tech-viewport', label: 'Viewport configured', weight: 2 },
      { id: 'tech-breadcrumbs', label: 'Breadcrumbs present where useful' },
      { id: 'tech-breadcrumb-links', label: 'Breadcrumb links work' },
      { id: 'tech-pagination', label: 'Pagination handled correctly where applicable' },
      { id: 'tech-faceted', label: 'Faceted navigation controlled where applicable' },
      { id: 'tech-infinite-scroll', label: 'Infinite scroll has crawlable URLs where applicable' },
      { id: 'tech-js-content', label: 'JavaScript content is accessible to search engines', weight: 2 },
      { id: 'tech-hidden-content', label: "Important content isn't hidden behind interactions unnecessarily" },
      { id: 'tech-no-cloaking', label: 'No accidental cloaking', weight: 2 },
      { id: 'tech-interstitials', label: 'No intrusive interstitial issues' },
    ],
  },
  {
    id: 'geo',
    number: 18,
    label: 'GEO / AI Search Optimization',
    checks: [
      { id: 'geo-direct-answer', label: 'Page directly answers the primary question', weight: 2, review: 'authority', group: 'AI answerability' },
      { id: 'geo-question-headings', label: 'Important questions appear as headings', review: 'authority', group: 'AI answerability' },
      { id: 'geo-extractable', label: 'Answers are concise and extractable', weight: 2, review: 'authority', group: 'AI answerability' },
      { id: 'geo-key-facts', label: 'Key facts are clearly stated', review: 'authority', group: 'AI answerability' },
      { id: 'geo-definitions', label: 'Definitions are easy to identify', review: 'authority', group: 'AI answerability' },
      { id: 'geo-lists-tables', label: 'Lists/tables are used where they improve answer extraction', review: 'authority', group: 'AI answerability' },
      { id: 'geo-sourced-claims', label: 'Important claims have supporting sources', review: 'authority', group: 'AI answerability' },
      { id: 'geo-entities-identified', label: 'Entities are clearly identified', review: 'authority', group: 'AI answerability' },
      { id: 'geo-unambiguous', label: 'Company/product/service information is unambiguous', review: 'authority', group: 'AI answerability' },
      { id: 'geo-original-insights', label: 'Content contains useful original insights', review: 'authority', group: 'AI answerability' },
      { id: 'geo-attributable', label: 'Statistics and claims are attributable', review: 'authority', group: 'AI answerability' },
      { id: 'geo-retrieval-structure', label: 'Content is structured for AI retrieval', review: 'authority', group: 'AI answerability', hint: 'Self-contained sections, descriptive headings, one idea per paragraph.' },
      { id: 'geo-org-entity', label: 'Organization/entity clearly identified', review: 'authority', group: 'Entity optimization' },
      { id: 'geo-offerings', label: 'Products/services clearly defined', review: 'authority', group: 'Entity optimization' },
      { id: 'geo-locations', label: 'Locations clearly identified where relevant', review: 'authority', group: 'Entity optimization', hint: 'na when location is irrelevant to the business or page.' },
      { id: 'geo-people', label: 'People/authors identified where relevant', review: 'authority', group: 'Entity optimization' },
      { id: 'geo-consistent-naming', label: 'Consistent entity naming', review: 'authority', group: 'Entity optimization' },
      { id: 'geo-entity-links', label: 'Important entities linked/referenced appropriately', review: 'authority', group: 'Entity optimization' },
      { id: 'geo-org-consistency', label: 'Organization information consistent across the site', review: 'authority', group: 'Entity optimization', hint: 'Compare the brand name/description in title, schema, og:site_name and copy.' },
    ],
  },
  {
    id: 'aeo',
    number: 19,
    label: 'AEO / Featured Snippet Optimization',
    checks: [
      { id: 'aeo-direct-answer', label: 'Direct answer to the target question', weight: 2, review: 'authority' },
      { id: 'aeo-answer-placement', label: 'Answer appears near the relevant heading', review: 'authority' },
      { id: 'aeo-concise-definition', label: 'Definition-style answer is concise', review: 'authority', hint: '40–60 word answer block. na if the topic needs no definition.' },
      { id: 'aeo-lists', label: 'Lists formatted as lists', review: 'authority' },
      { id: 'aeo-steps', label: 'Processes formatted as steps', review: 'authority', hint: 'na if the page describes no process.' },
      { id: 'aeo-tables', label: 'Comparisons use tables where appropriate', review: 'authority', hint: 'na if the page makes no comparisons.' },
      { id: 'aeo-faq', label: 'FAQ questions are answered directly', review: 'authority', hint: 'na if the page has no FAQ section.' },
      { id: 'aeo-supporting', label: 'Supporting explanation follows the concise answer', review: 'authority' },
    ],
  },
];

export type ScoreBucketDef = {
  id: ScoreBucketId;
  label: string;
  weight: number;
  categories: AuditCategoryId[];
};

/** Page-Level SEO Final Score weights (sum = 100). */
export const SCORE_BUCKETS: ScoreBucketDef[] = [
  { id: 'search-intent-content', label: 'Search Intent & Content', weight: 20, categories: ['search-intent'] },
  { id: 'technical-indexability', label: 'Technical Indexability', weight: 15, categories: ['url-indexability', 'technical', 'duplicates'] },
  { id: 'title-h1-metadata', label: 'Title / H1 / Metadata', weight: 10, categories: ['title', 'meta-description', 'headings'] },
  { id: 'content-topic', label: 'Content & Topic Coverage', weight: 15, categories: ['content-quality', 'keyword-topic', 'external-links'] },
  { id: 'internal-linking', label: 'Internal Linking', weight: 10, categories: ['internal-links'] },
  { id: 'ux-mobile-speed', label: 'UX / Mobile / Speed', weight: 10, categories: ['page-speed', 'mobile-ux', 'conversion-ux'] },
  { id: 'images-media', label: 'Images / Media', weight: 5, categories: ['images'] },
  { id: 'structured-data', label: 'Structured Data', weight: 5, categories: ['structured-data'] },
  { id: 'eeat', label: 'E-E-A-T', weight: 5, categories: ['eeat'] },
  { id: 'geo-aeo', label: 'GEO / AEO', weight: 5, categories: ['geo', 'aeo'] },
];

export function reviewChecks(pass: ReviewPass): Array<CheckDef & { category: string }> {
  return AUDIT_CATEGORIES.flatMap((category) =>
    category.checks
      .filter((check) => check.review === pass)
      .map((check) => ({ ...check, category: category.label })),
  );
}

export function gradeForScore(score: number): AuditGrade {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'needs-work';
  return 'poor';
}

export const GRADE_LABELS: Record<AuditGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  'needs-work': 'Needs work',
  poor: 'Poor',
};
