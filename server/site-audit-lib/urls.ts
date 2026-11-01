/** URL helpers shared by the Site Audit client and server code. */

function withProtocol(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Returns the project origin (e.g. https://example.com) or throws on invalid input. */
export function normalizeDomainUrl(input: string): string {
  if (!input.trim()) throw new Error('Enter your website domain.');
  let url: URL;
  try {
    url = new URL(withProtocol(input));
  } catch {
    throw new Error('Enter a valid domain, e.g. example.com');
  }
  if (!url.hostname.includes('.')) throw new Error('Enter a valid domain, e.g. example.com');
  return url.origin;
}

export function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** True when `url` is on the project domain or one of its subdomains. */
export function isSameSite(url: string, domainUrl: string): boolean {
  try {
    const host = bareHost(new URL(url).hostname);
    const projectHost = bareHost(new URL(withProtocol(domainUrl)).hostname);
    return host === projectHost || host.endsWith(`.${projectHost}`);
  } catch {
    return false;
  }
}

/** Resolves a page entry (absolute URL, bare host path, or "/path") against the project domain. */
export function resolvePageUrl(input: string, domainUrl: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a page URL.');
  const origin = normalizeDomainUrl(domainUrl);
  let url: URL;
  try {
    url = trimmed.startsWith('/') ? new URL(trimmed, origin) : new URL(withProtocol(trimmed));
  } catch {
    throw new Error('Enter a valid page URL.');
  }
  if (!isSameSite(url.toString(), origin)) {
    throw new Error(`Page must be on ${new URL(origin).hostname}`);
  }
  url.hash = '';
  return url.toString();
}

/** Host-and-path key used to compare URLs (ignores protocol, www, trailing slash, query and hash). */
export function comparableUrl(input: string): string {
  try {
    const url = new URL(withProtocol(input));
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${bareHost(url.hostname)}${path}`.toLowerCase();
  } catch {
    return input.trim().toLowerCase();
  }
}

export function displayUrl(input: string): string {
  return input.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** "https://site.com/blog/seo-tips" → "Seo Tips"; homepage → "Home". */
export function nameFromUrl(input: string): string {
  try {
    const segments = new URL(withProtocol(input)).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return 'Home';
    return decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return '';
  }
}
