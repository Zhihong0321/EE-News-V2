function robotsRuleMatches(url, rule) {
  if (!rule) return false;
  const parsed = new URL(url);
  const target = `${parsed.pathname}${parsed.search}`;
  const pattern = rule
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${pattern}`).test(target);
}

function parseRobots(text, userAgent) {
  const agentToken = userAgent.toLowerCase().split(/[\s/]/)[0];
  const lines = text.split(/\r?\n/).map((line) => line.split('#')[0].trim());
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    const [name, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (name.toLowerCase() === 'user-agent') agents.push(value.toLowerCase());
    if (name.toLowerCase() === 'disallow' && agents.some((agent) => agent === '*' || agent === agentToken)) rules.push(value);
  }
  flush();
  return groups;
}

export async function checkRobotsTxt(url, userAgent) {
  const robotsUrl = new URL('/robots.txt', url);
  const warnings = [];
  let text;
  try {
    text = await fetchText(robotsUrl.href, { accept: 'text/plain' });
  } catch (error) {
    if (crawlPolicy.stopStatuses.includes(error.status)) {
      warnings.push(`robots.txt returned HTTP ${error.status}; stopping this site.`);
      return { allowed: false, blockedRule: `HTTP ${error.status}`, robotsUrl: robotsUrl.href, warnings };
    }
    warnings.push(`Could not read robots.txt; continuing cautiously (${error.message}).`);
    return { allowed: true, robotsUrl: robotsUrl.href, warnings };
  }
  if (/automated means to data mine|scrape|extract/i.test(text)) {
    warnings.push('robots.txt states that automated scraping/data mining requires permission.');
  }
  const contentSignal = text.match(/^content-signal:\s*(.+)$/im)?.[1];
  if (contentSignal) warnings.push(`robots.txt content signal: ${contentSignal}`);

  const blockedRule = parseRobots(text, userAgent)
    .flatMap((group) => group.rules)
    .find((rule) => robotsRuleMatches(url, rule));
  return {
    allowed: !blockedRule,
    blockedRule,
    robotsUrl: robotsUrl.href,
    warnings
  };
}
import { fetchText } from './http.js';
import { crawlPolicy } from '../config/crawl-policy.js';
