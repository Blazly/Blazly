import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type AuditAgent = 'desktop' | 'desktopAlt' | 'mobile' | 'crawler';

const CHROME_VERSION = '148';

const USER_AGENTS: Record<AuditAgent, string> = {
  desktop: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
  desktopAlt:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  mobile:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  crawler: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
};

function browserHeaders(agent: AuditAgent, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENTS[agent],
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (agent === 'crawler') return headers;
  headers['Upgrade-Insecure-Requests'] = '1';
  headers['Sec-Fetch-Dest'] = 'document';
  headers['Sec-Fetch-Mode'] = 'navigate';
  headers['Sec-Fetch-Site'] = 'none';
  headers['Sec-Fetch-User'] = '?1';
  if (agent === 'desktop') {
    headers['sec-ch-ua'] = `"Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}", "Not.A/Brand";v="99"`;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
  }
  return headers;
}

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

// --- SSRF guard ---

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7));
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('ff')
  );
}

const dnsCache = new Map<string, { ok: boolean; at: number }>();

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be audited.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) {
    throw new Error('This address cannot be audited.');
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('This address cannot be audited.');
    return url;
  }
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.at < 60_000) {
    if (!cached.ok) throw new Error('This address cannot be audited.');
    return url;
  }
  const addresses = await lookup(host, { all: true });
  const ok = addresses.length > 0 && !addresses.some((entry) => isPrivateIp(entry.address));
  dnsCache.set(host, { ok, at: Date.now() });
  if (!ok) throw new Error('This address cannot be audited.');
  return url;
}

// --- Fetching ---

export type FetchedDocument = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Headers;
  chain: Array<{ url: string; status: number }>;
  body: string;
  bytes: number;
  elapsedMs: number;
  contentType: string;
};

function charsetFrom(contentType: string): string {
  const match = contentType.match(/charset=["']?([\w-]+)/i);
  return match?.[1]?.toLowerCase() || 'utf-8';
}

async function readLimited(res: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  if (!res.body) return { text: '', bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetFrom(res.headers.get('content-type') || ''));
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return { text: decoder.decode(buffer), bytes: total };
}

export async function fetchDocument(
  url: string,
  options: { agent?: AuditAgent; timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedDocument> {
  const agent = options.agent ?? 'desktop';
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const signal = AbortSignal.timeout(timeoutMs);
  const started = Date.now();
  const chain: FetchedDocument['chain'] = [];
  let current = url;

  for (let hop = 0; hop <= 10; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: 'manual',
      headers: browserHeaders(agent, HTML_ACCEPT),
      signal,
      cache: 'no-store',
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      chain.push({ url: current, status: res.status });
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current).toString();
      continue;
    }
    const { text, bytes } = await readLimited(res, maxBytes);
    return {
      requestedUrl: url,
      finalUrl: current,
      status: res.status,
      headers: res.headers,
      chain,
      body: text,
      bytes,
      elapsedMs: Date.now() - started,
      contentType: res.headers.get('content-type') || '',
    };
  }
  throw new Error('Too many redirects.');
}

const BLOCKED_STATUSES = new Set([403, 429, 503]);

/** Fetches a page as a real browser would, switching browser identity once if the site blocks the first try. */
export async function fetchPageAsBrowser(url: string, timeoutMs = 25_000): Promise<FetchedDocument> {
  const first = await fetchDocument(url, { agent: 'desktop', timeoutMs });
  if (!BLOCKED_STATUSES.has(first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    const second = await fetchDocument(url, { agent: 'desktopAlt', timeoutMs });
    return BLOCKED_STATUSES.has(second.status) ? first : second;
  } catch {
    return first;
  }
}

export type ProbeResult = {
  url: string;
  status: number | null;
  firstStatus: number | null;
  finalUrl: string | null;
  redirected: boolean;
  contentLength: number | null;
  contentType: string | null;
  error?: string;
};

/** Status-only request (HEAD, falling back to GET) used for link, image and URL-variant checks. */
export async function probeUrl(
  url: string,
  options: { timeoutMs?: number; agent?: AuditAgent; accept?: string } = {},
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const agent = options.agent ?? 'desktop';
  const accept = options.accept ?? '*/*';

  const attempt = async (method: 'HEAD' | 'GET'): Promise<ProbeResult> => {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    let firstStatus: number | null = null;
    for (let hop = 0; hop <= 8; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, {
        method,
        redirect: 'manual',
        headers: browserHeaders(agent, accept),
        signal,
        cache: 'no-store',
      });
      if (firstStatus === null) firstStatus = res.status;
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        continue;
      }
      await res.body?.cancel().catch(() => {});
      const length = Number(res.headers.get('content-length'));
      return {
        url,
        status: res.status,
        firstStatus,
        finalUrl: current,
        redirected: current !== url,
        contentLength: Number.isFinite(length) && length > 0 ? length : null,
        contentType: res.headers.get('content-type'),
      };
    }
    throw new Error('Too many redirects');
  };

  try {
    const head = await attempt('HEAD');
    if (head.status === 405 || head.status === 501 || head.status === 403 || head.status === 400) {
      return await attempt('GET');
    }
    return head;
  } catch (error) {
    try {
      return await attempt('GET');
    } catch {
      return {
        url,
        status: null,
        firstStatus: null,
        finalUrl: null,
        redirected: false,
        contentLength: null,
        contentType: null,
        error: error instanceof Error ? error.message : 'Request failed',
      };
    }
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Fetches a small text resource (robots.txt, sitemap) with a short timeout; returns null on any failure. */
export async function fetchText(url: string, timeoutMs = 10_000, maxBytes = 8 * 1024 * 1024): Promise<string | null> {
  try {
    const doc = await fetchDocument(url, { agent: 'desktop', timeoutMs, maxBytes });
    if (doc.status !== 200) return null;
    return doc.body;
  } catch {
    return null;
  }
}
