export const MONTHLY_BLOG_USAGE_COLLECTION = 'monthly_blog_usage';

export function getCurrentMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function buildMonthlyUsageDocId(userId: string, monthKey = getCurrentMonthKey()): string {
  return `${userId}_${monthKey}`.replace(/\//g, '_');
}

export function formatMonthlyBlogLimitError(limit: number, current: number): string {
  return `Monthly blog generation limit reached (${current}/${limit}). Your limit resets at the start of next month.`;
}
