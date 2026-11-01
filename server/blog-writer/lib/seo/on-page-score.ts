export type OnPageSeoSignals = {
  metaTitleHasKeyword: boolean;
  metaTitleLengthOk: boolean;
  metaDescriptionHasKeyword: boolean;
  metaDescriptionLengthOk: boolean;
  headingHasKeyword: boolean;
  hasSubheadings: boolean;
  subheadingHasKeyword: boolean;
  keywordInFirst100Words: boolean;
  keywordCountInBody: number;
  bodyWordCount: number;
  subheadingCount: number;
  subheadingKeywordRatio: number;
  keywordDensityPer100Words: number;
};

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countKeywordOccurrences(text: string, keyword: string): number {
  const trimmed = keyword.trim();
  if (!trimmed) return 0;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(escaped, 'gi')) || []).length;
}

function extractHeadings(html: string, tag: 'h1' | 'h2' | 'h3'): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const headings: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    headings.push(stripHtmlToText(match[1]));
  }
  return headings;
}

export function analyzeOnPageSeoSignals(
  htmlContent: string,
  metaTitle: string,
  metaDescription: string,
  primaryKeyword: string,
): OnPageSeoSignals {
  const keyword = primaryKeyword.trim();
  const keywordLower = keyword.toLowerCase();
  const bodyText = stripHtmlToText(htmlContent);
  const metaTitleLower = metaTitle.toLowerCase();
  const metaDescriptionLower = metaDescription.toLowerCase();

  const h1Headings = extractHeadings(htmlContent, 'h1');
  const h2Headings = extractHeadings(htmlContent, 'h2');
  const h3Headings = extractHeadings(htmlContent, 'h3');
  const allHeadings = [...h1Headings, ...h2Headings, ...h3Headings];

  const first100Words = bodyText.split(/\s+/).slice(0, 100).join(' ').toLowerCase();
  const subheadings = [...h2Headings, ...h3Headings];
  const subheadingsWithKeyword = subheadings.filter((heading) =>
    heading.toLowerCase().includes(keywordLower),
  );
  const keywordCountInBody = countKeywordOccurrences(bodyText, keyword);
  const bodyWordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  return {
    metaTitleHasKeyword: keyword.length > 0 && metaTitleLower.includes(keywordLower),
    metaTitleLengthOk: metaTitle.length >= 45 && metaTitle.length <= 65,
    metaDescriptionHasKeyword: keyword.length > 0 && metaDescriptionLower.includes(keywordLower),
    metaDescriptionLengthOk: metaDescription.length >= 120 && metaDescription.length <= 170,
    headingHasKeyword:
      keyword.length > 0 &&
      allHeadings.some((heading) => heading.toLowerCase().includes(keywordLower)),
    hasSubheadings: subheadings.length > 0,
    subheadingHasKeyword:
      keyword.length > 0 && subheadingsWithKeyword.length > 0,
    keywordInFirst100Words: keyword.length > 0 && first100Words.includes(keywordLower),
    keywordCountInBody,
    bodyWordCount,
    subheadingCount: subheadings.length,
    subheadingKeywordRatio:
      subheadings.length > 0 ? subheadingsWithKeyword.length / subheadings.length : 0,
    keywordDensityPer100Words:
      bodyWordCount > 0 ? (keywordCountInBody / bodyWordCount) * 100 : 0,
  };
}

export function computeOnPageSeoScore(signals: OnPageSeoSignals): number {
  let score = 0;

  if (signals.metaTitleHasKeyword) score += 18;
  if (signals.metaTitleLengthOk) score += 4;

  if (signals.metaDescriptionHasKeyword) score += 14;
  if (signals.metaDescriptionLengthOk) score += 6;

  if (signals.headingHasKeyword) score += 12;
  if (signals.hasSubheadings) score += 4;
  if (signals.subheadingHasKeyword) score += 6;

  if (signals.keywordInFirst100Words) score += 12;
  if (signals.keywordCountInBody >= 2) score += 4;
  if (signals.keywordCountInBody >= 4 && signals.keywordCountInBody <= 12) score += 4;

  if (signals.bodyWordCount >= 300) score += 4;
  if (signals.bodyWordCount >= 600) score += 4;

  let penalties = 0;

  if (signals.subheadingCount >= 3 && signals.subheadingKeywordRatio >= 0.95) {
    penalties += 18;
  } else if (signals.subheadingCount >= 2 && signals.subheadingKeywordRatio >= 0.85) {
    penalties += 10;
  } else if (signals.subheadingCount >= 4 && signals.subheadingKeywordRatio >= 0.75) {
    penalties += 5;
  }

  if (signals.keywordDensityPer100Words > 2.5) {
    penalties += 15;
  } else if (signals.keywordDensityPer100Words > 1.8) {
    penalties += 8;
  } else if (signals.keywordCountInBody > 14) {
    penalties += 5;
  }

  if (!signals.metaTitleHasKeyword) penalties += 5;
  if (!signals.metaDescriptionHasKeyword) penalties += 4;
  if (!signals.keywordInFirst100Words) penalties += 5;

  return Math.min(100, Math.max(0, score - penalties));
}

export function buildOnPageSeoFeedback(
  signals: OnPageSeoSignals,
  primaryKeyword: string,
): { whatIsDoneWell: string[]; areasForImprovement: string[]; scoreJustification: string } {
  const doneWell: string[] = [];
  const improve: string[] = [];

  if (signals.metaTitleHasKeyword) {
    doneWell.push(`Primary keyword "${primaryKeyword}" appears in the meta title.`);
  } else {
    improve.push(`Add "${primaryKeyword}" to the meta title, ideally near the beginning.`);
  }

  if (signals.metaDescriptionHasKeyword) {
    doneWell.push('Meta description includes the primary keyword.');
  } else {
    improve.push(`Include "${primaryKeyword}" naturally in the meta description.`);
  }

  if (signals.headingHasKeyword) {
    doneWell.push('A heading (H1/H2/H3) contains the primary keyword.');
  } else {
    improve.push(`Add "${primaryKeyword}" to at least one H2 or H3 subheading.`);
  }

  if (signals.keywordInFirst100Words) {
    doneWell.push('Primary keyword appears early in the opening content.');
  } else {
    improve.push('Use the primary keyword within the first 100 words of the article.');
  }

  if (signals.keywordCountInBody >= 3 && signals.keywordCountInBody <= 12) {
    doneWell.push(`Keyword appears ${signals.keywordCountInBody} times in the body content.`);
  } else if (signals.keywordCountInBody < 2) {
    improve.push(`Increase natural usage of "${primaryKeyword}" in the body (currently ${signals.keywordCountInBody} times).`);
  }

  if (signals.subheadingCount >= 2 && signals.subheadingKeywordRatio >= 0.85) {
    improve.push(
      'Reduce keyword stuffing in subheadings — weave the primary keyword into some H2/H3 tags, not every one.',
    );
  } else if (signals.subheadingCount >= 4 && signals.subheadingKeywordRatio >= 0.75) {
    improve.push(
      'Vary subheading phrasing — too many H2/H3 tags repeat the exact primary keyword.',
    );
  }

  if (signals.keywordDensityPer100Words > 1.8) {
    improve.push(
      `Keyword density is high (${signals.keywordDensityPer100Words.toFixed(1)} per 100 words). Use synonyms and semantic variations.`,
    );
  }

  if (signals.bodyWordCount < 300) {
    improve.push('Expand the article body for stronger topical coverage (aim for 300+ words).');
  }

  const score = computeOnPageSeoScore(signals);
  const scoreJustification =
    score >= 85
      ? 'Strong on-page SEO with solid keyword placement and natural heading usage.'
      : score >= 70
        ? 'Good SEO foundation, but some on-page elements (density, headings, or meta tags) can be refined.'
        : score >= 55
          ? 'Decent coverage of basics, but keyword stuffing, missing meta elements, or weak structure are holding the score back.'
          : 'Important on-page SEO elements are missing or weak — focus on meta tags, headings, and natural keyword placement.';

  return {
    whatIsDoneWell: doneWell.slice(0, 4),
    areasForImprovement: improve.slice(0, 4),
    scoreJustification,
  };
}

export function scoreOnPageSeo(
  htmlContent: string,
  metaTitle: string,
  metaDescription: string,
  primaryKeyword: string,
): {
  seoScore: number;
  scoreJustification: string;
  whatIsDoneWell: string[];
  areasForImprovement: string[];
} {
  const signals = analyzeOnPageSeoSignals(htmlContent, metaTitle, metaDescription, primaryKeyword);
  const feedback = buildOnPageSeoFeedback(signals, primaryKeyword.trim());
  return {
    seoScore: computeOnPageSeoScore(signals),
    ...feedback,
  };
}
