/** Pure text helpers shared by the Site Audit crawler (server) and scorer (client). */

const STOP_WORDS = new Set(
  (
    'a an and are as at be best by can do does for from get guide how i in into is it its me my near of on or our ' +
    'the this to top vs what when where which who why will with you your 2024 2025 2026 2027'
  ).split(' '),
);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es') && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function topicTokens(phrase: string): string[] {
  return [...new Set(normalizeText(phrase).split(' ').filter((w) => w && !STOP_WORDS.has(w)).map(stem))];
}

/** Share (0–1) of the topic's significant words that appear in `text`. */
export function topicCoverage(text: string | null | undefined, phrase: string): number {
  const tokens = topicTokens(phrase);
  if (!text || tokens.length === 0) return 0;
  const words = new Set(normalizeText(text).split(' ').map(stem));
  const hits = tokens.filter((token) => words.has(token)).length;
  return hits / tokens.length;
}

export function countPhrase(text: string, phrase: string): number {
  const needle = normalizeText(phrase);
  if (!needle) return 0;
  const haystack = ` ${normalizeText(text)} `;
  let count = 0;
  let index = haystack.indexOf(` ${needle} `);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(` ${needle} `, index + needle.length);
  }
  return count;
}

export function wordList(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Jaccard similarity of significant word sets (used for titles / H1s). */
export function tokenSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = new Set(topicTokens(a || ''));
  const right = new Set(topicTokens(b || ''));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });
  return shared / (left.size + right.size - shared);
}

// --- MinHash for near-duplicate content ---

const MINHASH_SIZE = 48;
const SHINGLE_WORDS = 5;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix(value: number, seed: number): number {
  let h = (value ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function minhashSignature(text: string): number[] {
  const words = normalizeText(text).split(' ').filter(Boolean);
  if (words.length < SHINGLE_WORDS) return [];
  const signature = new Array<number>(MINHASH_SIZE).fill(0xffffffff);
  for (let i = 0; i <= words.length - SHINGLE_WORDS; i++) {
    const base = fnv1a(words.slice(i, i + SHINGLE_WORDS).join(' '));
    for (let k = 0; k < MINHASH_SIZE; k++) {
      const value = mix(base, k + 1);
      if (value < signature[k]) signature[k] = value;
    }
  }
  return signature;
}

/** Estimated Jaccard similarity (0–1) between two MinHash signatures. */
export function signatureSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same += 1;
  return same / a.length;
}
