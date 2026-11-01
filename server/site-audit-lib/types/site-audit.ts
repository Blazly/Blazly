export type AuditCheckStatus = 'pass' | 'warn' | 'fail' | 'na';

export type AuditCategoryId =
  | 'url-indexability'
  | 'title'
  | 'meta-description'
  | 'headings'
  | 'search-intent'
  | 'content-quality'
  | 'keyword-topic'
  | 'internal-links'
  | 'external-links'
  | 'images'
  | 'page-speed'
  | 'mobile-ux'
  | 'structured-data'
  | 'eeat'
  | 'conversion-ux'
  | 'duplicates'
  | 'technical'
  | 'geo'
  | 'aeo';

export type ScoreBucketId =
  | 'search-intent-content'
  | 'technical-indexability'
  | 'title-h1-metadata'
  | 'content-topic'
  | 'internal-linking'
  | 'ux-mobile-speed'
  | 'images-media'
  | 'structured-data'
  | 'eeat'
  | 'geo-aeo';

export type AuditCheck = {
  id: string;
  label: string;
  status: AuditCheckStatus;
  weight: number;
  detail: string;
  recommendation?: string;
};

export type AuditCategoryResult = {
  id: AuditCategoryId;
  label: string;
  score: number | null;
  checks: AuditCheck[];
};

export type ScoreBucketResult = {
  id: ScoreBucketId;
  label: string;
  weight: number;
  score: number | null;
};

export type AuditGrade = 'excellent' | 'good' | 'needs-work' | 'poor';

// --- Crawl data (server → client) ---

export type CrawlLink = {
  href: string;
  text: string;
  rel: string;
  internal: boolean;
  inContent: boolean;
};

export type CrawlImage = {
  src: string;
  alt: string | null;
  width: string | null;
  height: string | null;
  loading: string | null;
  hasSrcset: boolean;
  inPicture: boolean;
  filename: string;
  format: string;
  decorative: boolean;
};

export type CrawlSchemaNode = {
  type: string;
  props: string[];
  name: string | null;
  questions: string[];
};

export type UrlProbe = {
  url: string;
  status: number | null;
  finalUrl: string | null;
  redirected: boolean;
  error?: string;
};

export type LinkCheckIssue = { url: string; status: number | null };

export type PageCrawlData = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: Array<{ url: string; status: number }>;
  responseTimeMs: number;
  htmlBytes: number;
  xRobotsTag: string | null;
  robotsTxtFound: boolean;
  blockedByRobotsTxt: boolean;
  lang: string | null;
  charset: string | null;
  viewport: string | null;
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  metaRobots: string | null;
  canonical: string | null;
  canonicalCount: number;
  canonicalProbe: (UrlProbe & { noindex: boolean }) | null;
  ogSiteName: string | null;
  headings: Array<{ level: number; text: string }>;
  wordCount: number;
  introText: string;
  contentText: string;
  contentTruncated: boolean;
  paragraphCount: number;
  duplicateParagraphCount: number;
  avgSentenceLength: number;
  fleschReadingEase: number | null;
  listCount: number;
  orderedListCount: number;
  tableCount: number;
  links: CrawlLink[];
  internalLinkCount: number;
  externalLinkCount: number;
  images: CrawlImage[];
  imageCount: number;
  schema: {
    jsonLdBlocks: number;
    parseErrors: number;
    nodes: CrawlSchemaNode[];
    microdataTypes: string[];
  };
  breadcrumbs: { present: boolean; links: string[] };
  pagination: { relNext: string | null; relPrev: string | null; paginatedUrl: boolean; loadMore: boolean };
  facetedUrl: boolean;
  forms: { count: number; inputsWithoutLabel: number; withoutSubmit: number };
  ctas: string[];
  ctaInFirstScreen: boolean;
  contact: { tel: boolean; mailto: boolean; contactLink: boolean; address: boolean };
  aboutLink: boolean;
  trustSignals: string[];
  author: { meta: string | null; byline: string | null; schema: string | null; authorLink: boolean };
  dates: { published: string | null; modified: string | null };
  popupSignals: string[];
  stickySignals: number;
  hiddenContentRatio: number;
  spaShell: boolean;
  navPresent: boolean;
  mobileMenuToggle: boolean;
  httpProbe: UrlProbe | null;
  hostVariantProbe: UrlProbe | null;
  slashVariantProbe: UrlProbe | null;
  mobileParity: { wordCount: number; h1: string | null; title: string | null } | null;
  crawlerParity: { status: number | null; wordCount: number; title: string | null } | null;
  linkScan: {
    checkedInternal: number;
    checkedExternal: number;
    brokenInternal: LinkCheckIssue[];
    brokenExternal: LinkCheckIssue[];
    redirectedInternal: number;
  };
  imageScan: {
    checked: number;
    broken: LinkCheckIssue[];
    large: Array<{ url: string; bytes: number }>;
    formats: Record<string, number>;
  };
  minhash: number[];
  internalTargets: string[];
};

// --- Site context (once per project run) ---

export type SiteContext = {
  origin: string;
  sitemapFound: boolean;
  sitemapUrls: string[];
  homepageLinks: string[];
};

// --- Speed ---

export type SpeedAuditSnapshot = {
  score: number | null;
  mode: string;
  title: string;
  displayValue?: string;
};

export type SpeedStrategyResult = {
  performance: number;
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  speedIndexMs: number | null;
  field: { lcpMs: number | null; inpMs: number | null; cls: number | null; source: 'url' | 'origin' | null };
  audits: Record<string, SpeedAuditSnapshot>;
};

export type SpeedSnapshot = {
  mobile: SpeedStrategyResult | null;
  desktop: SpeedStrategyResult | null;
  error?: string;
};

// --- Content review ---

export type ReviewCheckResult = {
  id: string;
  status: AuditCheckStatus;
  finding: string;
  recommendation?: string;
};

export type ContentReview = {
  primaryTopic: string;
  primaryKeyword: string;
  pageType: string;
  searchIntent: string;
  summary: string;
  checks: ReviewCheckResult[];
  partial?: boolean;
};

// --- Result ---

export type PageSignature = {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  primaryKeyword: string;
  minhash: number[];
  internalTargets: string[];
};

export type PageAuditResult = {
  url: string;
  finalUrl: string;
  score: number;
  grade: AuditGrade;
  buckets: ScoreBucketResult[];
  categories: AuditCategoryResult[];
  summary: string;
  primaryKeyword: string;
  pageType: string;
  searchIntent: string;
  counts: { pass: number; warn: number; fail: number; na: number };
  speed: {
    mobile: { performance: number; lcpMs: number | null; cls: number | null; inpMs: number | null } | null;
    desktop: { performance: number; lcpMs: number | null; cls: number | null; inpMs: number | null } | null;
  };
  notices: string[];
  signature: PageSignature;
  analyzedAt: string;
};

// --- Persistence ---

export type SiteAuditPageEntry = {
  id: string;
  name: string;
  url: string;
};

export type SiteAuditProject = {
  id: string;
  userId: string;
  name: string;
  domainUrl: string;
  pages: SiteAuditPageEntry[];
  auditedCount: number;
  averageScore: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type StoredPageAudit = {
  pageId: string;
  name: string;
  url: string;
  score: number;
  result: PageAuditResult;
  analyzedAt: string;
};
