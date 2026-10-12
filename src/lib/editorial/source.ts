import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { wordCount } from "../brief";
import { safeImageUrl } from "./images";
import { normalizePublisherUrl, PUBLISHERS, resolvePublisherArticle } from "./publisher-catalog";
import { originalPublicationDate } from "./feed-parser";

export type BoundedFetchOptions = { validateUrl?: (url: string) => string };

export class SourceRequestError extends Error {
  constructor(public readonly status: number, public readonly retryAfter: string | null) {
    super(`Source request failed (${status}).`);
    this.name = "SourceRequestError";
  }
}

function articlePolicy(input: string) {
  const publisher = resolvePublisherArticle(input);
  if (!publisher) throw new Error("Only the configured publishers’ HTTPS article URLs are supported.");
  const validateUrl = (url: string) => normalizePublisherUrl(url, publisher, "article");
  return { publisher, url: validateUrl(input), validateUrl };
}

function sourcePolicy(input: string): (url: string) => string {
  for (const publisher of PUBLISHERS) {
    for (const purpose of ["feed", "listing", "article"] as const) {
      try {
        normalizePublisherUrl(input, publisher, purpose);
        return (url: string) => normalizePublisherUrl(url, publisher, purpose);
      } catch { /* Select only a configured purpose. */ }
    }
  }
  throw new Error("Only the configured publishers’ HTTPS URLs are supported.");
}

export async function boundedFetch(
  url: string,
  init: RequestInit = {},
  maxBytes = 2_000_000,
  remainingSourceRedirects = 0,
  options: BoundedFetchOptions = {},
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(remainingSourceRedirects) ||
    remainingSourceRedirects < 0 || remainingSourceRedirects > 3) throw new Error("Invalid source size or redirect budget.");
  const validateUrl = options.validateUrl || (remainingSourceRedirects > 0 ? sourcePolicy(url) : undefined);
  init.signal?.throwIfAborted();
  // Source deadlines cap the whole operation, even with a longer runner signal.
  // Provider requests retain their supplied timeout (e.g. the 45s model call).
  const deadline = validateUrl || !init.signal ? AbortSignal.timeout(15000) : null;
  const signal = init.signal && deadline ? AbortSignal.any([init.signal, deadline]) : init.signal || deadline!;
  for (;;) {
    signal.throwIfAborted();
    url = validateUrl ? validateUrl(url) : url;
    const response = await fetch(url, { ...init, redirect: "manual", signal });
    if (signal.aborted) {
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      void response.body?.cancel().catch(() => {});
      if (!remainingSourceRedirects || !location) throw new Error("Redirect requires source verification.");
      remainingSourceRedirects--;
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new SourceRequestError(response.status, response.headers.get("retry-after"));
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error("Source exceeds the size limit.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source returned no content.");
    const decoder = new TextDecoder();
    let total = 0, body = "";
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) throw new Error("Source exceeds the size limit.");
        body += decoder.decode(chunk.value, { stream: true });
      }
      return body + decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
    }
  }
}

export function extractSource(html: string): string {
  const { document } = parseHTML(html);
  document
    .querySelectorAll("script,style,nav,footer,header,form,iframe")
    .forEach((e) => e.remove());
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent || "").replace(/\s+/gu, " ").trim();
  if (wordCount(text) < 200)
    throw new Error(
      "Not enough article text. Review the source manually; no summary was generated.",
    );
  if (text.length > 60000)
    throw new Error(
      "Article is too long for this draft pipeline; select source material manually.",
    );
  return text;
}

export function extractSourceImage(html: string, articleUrl: string): string | null {
  const { document } = parseHTML(html);
  for (const selector of ['meta[property="og:image:secure_url"]','meta[property="og:image"]','meta[name="twitter:image"]','meta[property="twitter:image"]']) {
    for (const node of document.querySelectorAll(selector)) {
      const url = safeImageUrl(node.getAttribute("content"), articleUrl);
      if (url) return url;
    }
  }
  const imageFrom = (value: unknown): string | null => {
    if (typeof value === "string") return safeImageUrl(value, articleUrl);
    if (Array.isArray(value)) return value.map(imageFrom).find(Boolean) || null;
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string,unknown>;
    return imageFrom(item.url) || imageFrom(item.contentUrl);
  };
  const articleImage = (value: unknown): string | null => {
    if (Array.isArray(value)) return value.map(articleImage).find(Boolean) || null;
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string,unknown>;
    return (/Article|BlogPosting/.test(String(item['@type'])) ? imageFrom(item.image) : null) || articleImage(item['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const url = articleImage(JSON.parse(script.textContent || '')); if (url) return url; } catch { /* Continue to article image. */ }
  }
  for (const node of document.querySelectorAll('article img, main img')) {
    const url = safeImageUrl(node.getAttribute('src') || node.getAttribute('data-src'),articleUrl);
    if (url) return url;
  }
  return null;
}

export function extractFeedImage(item: Record<string,unknown>, articleUrl: string): string | null {
  for (const key of ['media:content','media:thumbnail','enclosure']) {
    const values = Array.isArray(item[key]) ? item[key] : [item[key]];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const node = value as Record<string,unknown>;
      if (key === 'enclosure' && !String(node['@_type']).startsWith('image/')) continue;
      if (node['@_type'] && !String(node['@_type']).startsWith('image/')) continue;
      if (node['@_medium'] && node['@_medium'] !== 'image') continue;
      const url = safeImageUrl(node['@_url'], articleUrl);
      if (url) return url;
    }
  }
  const html = item['content:encoded'] || item.description;
  return typeof html === 'string' ? extractSourceImage(`<article>${html}</article>`,articleUrl) : null;
}

export async function retrieveSourceImage(input: string) {
  const { url, validateUrl } = articlePolicy(input);
  return extractSourceImage(await boundedFetch(url, {}, 2_000_000, 3, { validateUrl }), url);
}
export async function retrieveImportMetadata(input: string) {
  const policy = articlePolicy(input);
  const { publisher, validateUrl } = policy;
  let url = policy.url;
  const html = await boundedFetch(url, {}, 2_000_000, 3, { validateUrl: (input) => (url = validateUrl(input)) });
  const { document } = parseHTML(html);
  const pageIdentity = (value: string | null): string => {
    if (!value?.trim()) throw new Error('Invalid canonical or metadata URL.');
    return validateUrl(new URL(value, url).toString());
  };
  const canonicals = Array.from(document.querySelectorAll('link[rel~="canonical"]'), node => pageIdentity(node.getAttribute('href')));
  const canonical = canonicals[0] ?? url;
  const pageUrls = Array.from(document.querySelectorAll('meta[property="og:url"]'), node => pageIdentity(node.getAttribute('content')));
  if ([...canonicals, ...pageUrls].some(value => value !== canonical))
    throw new Error('Conflicting canonical or metadata URLs.');
  url = canonical;
  const title = (document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.querySelector('title')?.textContent || '').replace(/\s+/gu,' ').trim().slice(0,500);
  if (!title) throw new Error('The source did not provide an article title. Try its original article URL.');
  const dateSelector = publisher.key === 'anthropic' ? 'meta[property="article:published_time"]'
    : 'meta[property="article:published_time"],meta[itemprop="datePublished"]';
  const publicationValues: unknown[] = [...document.querySelectorAll(dateSelector)].map(node => node.getAttribute('content'));
  const identity = (value: unknown): string | null => {
    if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      return identity(node['@id'] || node.url);
    }
    if (typeof value !== 'string' || !value.trim()) return null;
    try { return validateUrl(new URL(value, url).toString()); } catch { return null; }
  };
  const dates = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(dates); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    const article = types.some(type => typeof type === 'string' && /^(?:Article|NewsArticle|BlogPosting|TechArticle|ReportageNewsArticle)$/.test(type));
    if (article) {
      const identities = ['url', 'mainEntityOfPage'].filter(key => key in node).map(key => identity(node[key]));
      if (identities.includes(url)) {
        // A conflicting provided identity invalidates even an otherwise valid page-level date.
        if (identities.some(value => value !== url)) publicationValues.push(null);
        else if ('datePublished' in node) publicationValues.push(node.datePublished);
      }
    }
    dates(node['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { dates(JSON.parse(script.textContent || '')); } catch { /* Unusable structured data supplies no date. */ }
  }
  const instants = publicationValues.map(value => originalPublicationDate(value));
  const date = instants[0];
  if (!date || instants.some(value => value !== date))
    throw new Error('No trustworthy original publication date was found, or publication dates conflict. Import from a dated publisher feed instead; today’s date will not be invented.');
  return {url,title,source_published_at:date,source_name:publisher.name,source_image_url:extractSourceImage(html,url)};
}

export async function retrieveSource(url: string) {
  return (await retrieveSourceArticle(url)).text;
}

export async function retrieveSourceArticle(url: string) {
  const policy = articlePolicy(url);
  const html = await boundedFetch(
      policy.url,
      {
        headers: { "User-Agent": "knowai/1.0 (editorial source review)" },
        signal: AbortSignal.timeout(15000),
      },
      2_000_000,
      3,
      { validateUrl: policy.validateUrl },
    );
  return {text:extractSource(html), imageUrl:extractSourceImage(html,url)};
}
