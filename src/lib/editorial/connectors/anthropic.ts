import { parseHTML } from 'linkedom';
import { safeImageUrl } from '../images';

const LISTING_URL = 'https://www.anthropic.com/news';
const MAX_LINKS = 40;
const MAX_ARTICLE_REQUESTS = 8;
const DEADLINE_MS = 60_000;

export type AnthropicCandidate = {
  url: string;
  title: string;
  source_name: 'Anthropic';
  source_published_at: string;
  source_image_url: string | null;
};
export type AnthropicDiscoveryOptions = {
  /** Caller enforces response-size/request-time limits and validates every redirect hop. */
  fetchText: (url: string, signal: AbortSignal) => Promise<string>;
  /** Stored canonical URLs; never mutated by discovery. */
  knownUrls: ReadonlySet<string>;
  signal: AbortSignal;
  now?: () => number;
  /** Next unprocessed candidate, not an arbitrary fetch target; max 2048 characters. */
  continuation?: string | null;
};
export type AnthropicDiscoveryResult = {
  candidates: AnthropicCandidate[];
  /** Unique validated links in this visible window, including known entries (at most 40). */
  scanned: number;
  duplicates: number;
  /** No topical filter for this dedicated source. Invalid fetched metadata is counted separately. */
  filtered: number;
  invalid: number;
  attempted: number;
  /** Unprocessed candidates in the bounded window, not a count of the unseen archive. */
  remaining: number;
  warning: string | null;
  continuation: string | null;
  outcome: 'ok' | 'empty' | 'partial' | 'unavailable';
  errorCode: string | null;
  /** Bounded raw Retry-After header; caller converts it into a persisted retry window. */
  retryAfter: string | null;
};

function articleUrl(value: string): string | null {
  // Reject URL-parser repairs (dot segments, escapes and backslashes), not just the repaired URL.
  if (!value || value.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(value)
    || value.split(/[?#]/, 1)[0].includes('%')
    || /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(value)) return null;
  try {
    const url = new URL(value, LISTING_URL);
    if (url.protocol !== 'https:' || url.hostname !== 'www.anthropic.com' || url.port
      || url.username || url.password || !/^\/news\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname)
      || /^\/news\/(?:category|categories|tag|tags|rss|feed)\/?$/.test(url.pathname)) return null;
    for (const key of url.searchParams.keys()) {
      if (!/^(?:utm_[a-z_]+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) return null;
    }
    return `https://www.anthropic.com${url.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
}

function hasMarker(element: Element, component: string, name: string): boolean {
  return Array.from(element.classList).some(token =>
    token.startsWith(`${component}-module-scss-module__`) && token.endsWith(`__${name}`));
}

export class AnthropicConnectorError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AnthropicConnectorError';
  }
}

function rejectChallenge(document: Document): void {
  if (/just a moment|access denied|verify (?:you are|you're) human|attention required/i.test(document.title)
    || document.querySelector('#challenge-form, #cf-challenge-running, .g-recaptcha, .h-captcha, script[src*="/cdn-cgi/challenge-platform/"]')) {
    throw new AnthropicConnectorError('challenge', 'Anthropic access challenge; no bypass attempted.');
  }
}

/** Verified PublicationList/FeaturedGrid markers; CSS-module hashes may change.
 * No pagination, script execution or fallback to arbitrary navigation anchors. */
export function parseAnthropicListing(html: string): { urls: string[]; truncated: boolean } {
  const { document } = parseHTML(html);
  rejectChallenge(document);
  const main = document.querySelector('main');
  const root = main && Array.from(main.querySelectorAll('[class]')).find(e => hasMarker(e, 'PublicationList', 'root'));
  const list = root && Array.from(root.querySelectorAll('ul[class]')).find(e => hasMarker(e, 'PublicationList', 'list'));
  if (!root || !list || !Array.from(main!.querySelectorAll('h1')).some(e => e.textContent?.trim() === 'Newsroom')) {
    throw new AnthropicConnectorError('layout-changed', 'Anthropic newsroom layout changed: publication list not recognized.');
  }
  const urls = new Set<string>();
  let truncated = Array.from(root.querySelectorAll('[class]')).some(e => hasMarker(e, 'PublicationList', 'seeMore'));
  for (const a of document.querySelectorAll('main a[href]')) {
    const publication = hasMarker(a, 'PublicationList', 'listItem')
      && a.parentElement?.tagName === 'LI'
      && a.parentElement.parentElement === list;
    const featured = hasMarker(a, 'FeaturedGrid', 'content')
      && a.parentElement && hasMarker(a.parentElement, 'FeaturedGrid', 'featuredItem')
      && a.parentElement.parentElement && hasMarker(a.parentElement.parentElement, 'FeaturedGrid', 'root');
    if (!publication && !featured) continue;
    const url = articleUrl(a.getAttribute('href')!);
    if (url && !urls.has(url)) {
      if (urls.size === MAX_LINKS) { truncated = true; break; }
      urls.add(url);
    }
  }
  if (urls.size === 0) {
    // An intact empty list alone is ambiguous (failed hydration, removed items, layout drift).
    const header = Array.from(root.querySelectorAll('[class]')).some(e => hasMarker(e, 'PublicationList', 'listHeader'));
    const explicitEmpty = Array.from(root.querySelectorAll('[role="status"]')).some(e =>
      /^No (?:results|news|publications)(?: found| available)?\.?$/i.test(e.textContent?.trim() ?? ''));
    if (list.children.length || !header || !explicitEmpty) {
      throw new AnthropicConnectorError('layout-changed', 'Anthropic newsroom layout changed: no usable entries or explicit empty state.');
    }
  }
  return { urls: [...urls], truncated };
}

function publicationInstant(value: unknown, now: number): number {
  if (typeof value !== 'string') throw new AnthropicConnectorError('invalid-metadata', 'Missing original publication timestamp.');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const stamp = Date.parse(value);
  if (!parts || !Number.isFinite(stamp) || stamp > now) {
    throw new AnthropicConnectorError('invalid-metadata', 'Invalid or future original publication timestamp.');
  }
  const [, year, month, day, hour, minute, second, zone] = parts;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
    || +hour > 23 || +minute > 59 || +second > 59
    || (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59))) {
    throw new AnthropicConnectorError('invalid-metadata', 'Invalid original publication calendar date.');
  }
  return stamp;
}

function articleNodes(value: unknown): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const pending: {value: unknown; depth: number}[] = [{value, depth: 0}];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++visited > 1000 || current.depth > 32) {
      throw new AnthropicConnectorError('invalid-metadata', 'JSON-LD metadata exceeds bounded structural complexity.');
    }
    if (Array.isArray(current.value)) {
      if (current.value.length + pending.length > 1000) throw new AnthropicConnectorError('invalid-metadata', 'JSON-LD metadata has too many nodes.');
      for (const child of current.value) pending.push({value: child, depth: current.depth + 1});
    } else if (current.value && typeof current.value === 'object') {
      const node = current.value as Record<string, unknown>;
      nodes.push(node);
      if ('@graph' in node) pending.push({value: node['@graph'], depth: current.depth + 1});
    }
  }
  return nodes;
}

function identity(value: unknown): string | null {
  if (typeof value === 'string') return articleUrl(value);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return typeof object['@id'] === 'string' ? articleUrl(object['@id']) : null;
  }
  return null;
}

/** Metadata-only: original date agreement is by instant, never dateModified or fetch time. */
export function parseAnthropicArticle(html: string, url: string, now = Date.now()): AnthropicCandidate {
  const requested = articleUrl(url);
  if (!requested || !url.startsWith('https://')) throw new AnthropicConnectorError('invalid-url', 'Invalid Anthropic article URL.');
  const { document } = parseHTML(html);
  rejectChallenge(document);
  const meta = (property: string) => document.head.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;
  if (Array.from(document.head.querySelectorAll('meta[property="og:type"]')).some(e => e.getAttribute('content') !== 'article')) {
    throw new AnthropicConnectorError('invalid-metadata', 'Page metadata does not describe an article.');
  }
  const links = Array.from(document.head.querySelectorAll('link[rel~="canonical"]'), e => articleUrl(e.getAttribute('href') ?? ''));
  if (links.some(value => !value) || new Set(links).size > 1) throw new AnthropicConnectorError('invalid-url', 'Unsafe or conflicting canonical URL.');
  const canonical = links[0] ?? requested;
  for (const metaUrl of document.head.querySelectorAll('meta[property="og:url"]')) {
    if (articleUrl(metaUrl.getAttribute('content') ?? '') !== canonical) {
      throw new AnthropicConnectorError('invalid-url', 'Metadata URL conflicts with the canonical URL.');
    }
  }
  const titles: unknown[] = [meta('og:title')];
  const dates: unknown[] = Array.from(document.head.querySelectorAll('meta[property="article:published_time"]'), e => e.getAttribute('content'));
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try { data = JSON.parse(script.textContent ?? ''); }
    catch { throw new AnthropicConnectorError('invalid-metadata', 'Unreadable JSON-LD publication metadata.'); }
    for (const node of articleNodes(data)) {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (!types.some(type => ['NewsArticle', 'Article', 'BlogPosting'].includes(String(type)))) continue;
      const identities = ['url', 'mainEntityOfPage'].filter(key => key in node).map(key => identity(node[key]));
      if (!identities.includes(canonical)) continue;
      if (identities.some(value => value !== canonical)) throw new AnthropicConnectorError('invalid-metadata', 'Conflicting article metadata identities.');
      if ('datePublished' in node) dates.push(node.datePublished);
      titles.push(node.headline);
    }
  }
  if (!dates.length) throw new AnthropicConnectorError('invalid-metadata', 'Missing article-bound original publication metadata.');
  const instants = dates.map(value => publicationInstant(value, now));
  if (new Set(instants).size !== 1) throw new AnthropicConnectorError('invalid-metadata', 'Conflicting original publication metadata.');
  titles.push(document.querySelector('main h1')?.textContent);
  const title = titles.filter((value): value is string => typeof value === 'string')
    .map(value => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).find(Boolean)?.slice(0, 500);
  if (!title) throw new AnthropicConnectorError('invalid-metadata', 'Missing article title.');
  const image = safeImageUrl(meta('og:image'));
  return {
    url: canonical,
    title,
    source_name: 'Anthropic',
    source_published_at: new Date(instants[0]).toISOString(),
    source_image_url: image,
  };
}

function recordFailure(result: AnthropicDiscoveryResult, error: unknown): void {
  const detail = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = typeof detail.status === 'number' && Number.isInteger(detail.status) && detail.status >= 400 && detail.status <= 599 ? detail.status : null;
  result.errorCode = error instanceof AnthropicConnectorError ? error.code : status ? `http-${status}` : 'fetch-failed';
  result.retryAfter = typeof detail.retryAfter === 'string' && detail.retryAfter.length <= 256
    && !/[\r\n]/.test(detail.retryAfter) ? detail.retryAfter : null;
  result.warning = `Anthropic discovery unavailable (${result.errorCode}); no automatic retry or fallback attempted.`;
  result.outcome = result.candidates.length ? 'partial' : 'unavailable';
}

export async function discoverAnthropic(options: AnthropicDiscoveryOptions): Promise<AnthropicDiscoveryResult> {
  const now = options.now ?? Date.now;
  const expires = now() + DEADLINE_MS;
  const controller = new AbortController();
  const expire = () => controller.abort(new AnthropicConnectorError('deadline', 'Anthropic sixty-second deadline expired.'));
  const timer = setTimeout(expire, DEADLINE_MS);
  const abort = () => controller.abort(new AnthropicConnectorError('aborted', 'Inherited discovery signal aborted.'));
  options.signal.addEventListener('abort', abort, {once: true});
  if (options.signal.aborted) abort();
  const checkActive = () => {
    if (now() >= expires) expire();
    controller.signal.throwIfAborted();
  };
  try {
    return await discoverWithBudget({...options, signal: controller.signal, fetchText: async (url, signal) => {
      checkActive();
      const html = await new Promise<string>((resolve, reject) => {
        const onAbort = () => { cleanup(); reject(signal.reason); };
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, {once: true});
        // Attach both handlers even if abort wins: a late dependency rejection is consumed.
        try {
          options.fetchText(url, signal).then(
            value => { cleanup(); resolve(value); },
            error => { cleanup(); reject(error); },
          );
        } catch (error) { cleanup(); reject(error); }
      });
      checkActive();
      return html;
    }}, checkActive);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
  }
}

async function discoverWithBudget(options: AnthropicDiscoveryOptions, checkActive: () => void): Promise<AnthropicDiscoveryResult> {
  const { fetchText, signal, now = Date.now, knownUrls } = options;
  const cursor = options.continuation && options.continuation.startsWith('https://')
    ? articleUrl(options.continuation) : null;
  const result: AnthropicDiscoveryResult = {
    candidates: [], scanned: 0, duplicates: 0, filtered: 0, invalid: 0,
    attempted: 0, remaining: 0, warning: null, continuation: cursor,
    outcome: 'ok', errorCode: null, retryAfter: null,
  };
  let listing: ReturnType<typeof parseAnthropicListing>;
  try { listing = parseAnthropicListing(await fetchText(LISTING_URL, signal)); checkActive(); }
  catch (error) { recordFailure(result, error); return result; }
  const {urls, truncated} = listing;
  result.scanned = urls.length;
  const cursorIndex = cursor ? urls.indexOf(cursor) : -1;
  const cursorReset = !!options.continuation && cursorIndex < 0;
  const start = Math.max(0, cursorIndex);
  const ordered = [...urls.slice(start), ...urls.slice(0, start)];
  const queue = ordered.filter(url => {
    if (!knownUrls.has(url)) return true;
    result.duplicates++;
    return false;
  });
  const seen = new Set<string>();
  let consumed = 0;
  for (const url of queue) {
    if (seen.has(url)) { result.duplicates++; consumed++; continue; }
    if (result.attempted === MAX_ARTICLE_REQUESTS) break;
    try { checkActive(); } catch (error) { recordFailure(result, error); break; }
    result.attempted++;
    consumed++;
    let html: string;
    try { html = await fetchText(url, signal); }
    catch (error) { recordFailure(result, error); break; }
    try {
      const candidate = parseAnthropicArticle(html, url, now());
      checkActive();
      if (knownUrls.has(candidate.url) || seen.has(candidate.url)) result.duplicates++;
      else result.candidates.push(candidate);
      seen.add(candidate.url);
    } catch (error) {
      if (!(error instanceof AnthropicConnectorError)) throw error;
      if (!['invalid-metadata', 'invalid-url'].includes(error.code)) { recordFailure(result, error); break; }
      result.invalid++;
    }
  }
  result.remaining = queue.length - consumed;
  result.continuation = queue[consumed] ?? null;
  const warnings: string[] = [];
  if (cursorReset) warnings.push('Continuation reset: candidate is invalid or no longer in the visible listing.');
  if (truncated) warnings.push('Only the first 40 links or visible listing window were inspected; unpaged items may be missed.');
  if (result.remaining) warnings.push(!result.errorCode && result.attempted === MAX_ARTICLE_REQUESTS
    ? 'Eight-article metadata request limit reached; candidates remain.'
    : `${result.remaining} candidates remain unprocessed.`);
  if (result.invalid) warnings.push(`${result.invalid} articles lacked valid original metadata.`);
  result.warning = [result.warning, ...warnings].filter(Boolean).join(' ') || null;
  if (!result.errorCode) result.outcome = warnings.length ? 'partial' : result.candidates.length ? 'ok' : 'empty';
  if (!result.errorCode && result.invalid && !result.remaining && !result.candidates.length && !result.duplicates) {
    result.outcome = 'unavailable';
    result.errorCode = 'invalid-metadata';
  }
  return result;
}
