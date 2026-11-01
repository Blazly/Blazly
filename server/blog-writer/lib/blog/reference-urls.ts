import type { SerpSearchResult } from '../../ai/types';

const REFERENCE_PAGE_COUNT = 3;

const SKIP_REFERENCE_HOSTS =
  /(youtube\.com|youtu\.be|reddit\.com|quora\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|pinterest\.)/i;

/** Top organic article URLs worth reading as competitor references (no social / video hosts). */
export function pickReferenceUrls(results: SerpSearchResult[] | undefined): string[] {
  return (results ?? [])
    .map((r) => r.url)
    .filter((url) => !!url && !SKIP_REFERENCE_HOSTS.test(url))
    .slice(0, REFERENCE_PAGE_COUNT);
}
