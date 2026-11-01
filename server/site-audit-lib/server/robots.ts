import { fetchText } from './fetcher';

type RobotsRule = { allow: boolean; pattern: string };
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

export type RobotsTxt = {
  found: boolean;
  groups: RobotsGroup[];
  sitemaps: string[];
};

export function parseRobotsTxt(text: string): Omit<RobotsTxt, 'found'> {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && !value) continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }

  return { groups, sitemaps };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Googlebot semantics: most specific matching group, longest matching rule wins, ties favour allow. */
export function isAllowedByRobots(robots: RobotsTxt, pathWithQuery: string, agent = 'googlebot'): boolean {
  if (!robots.found) return true;
  const specific = robots.groups.filter((group) => group.agents.some((a) => a !== '*' && agent.includes(a)));
  const applicable = specific.length ? specific : robots.groups.filter((group) => group.agents.includes('*'));
  let best: RobotsRule | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow)
      ) {
        best = rule;
      }
    }
  }
  return best ? best.allow : true;
}

export async function fetchRobotsTxt(origin: string): Promise<RobotsTxt> {
  const text = await fetchText(`${origin}/robots.txt`, 8_000, 512 * 1024);
  if (!text || /<html[\s>]/i.test(text.slice(0, 500))) {
    return { found: false, groups: [], sitemaps: [] };
  }
  return { found: true, ...parseRobotsTxt(text) };
}
