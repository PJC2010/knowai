import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeSourceUrl, wordCount } from "../brief";
import { safeImageUrl } from "./images";

export async function boundedFetch(
  url: string,
  init: RequestInit = {},
  maxBytes = 2_000_000,
  remainingSourceRedirects = 0,
): Promise<string> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: init.signal || AbortSignal.timeout(15000),
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!remainingSourceRedirects || !location)
      throw new Error("Redirect requires source verification.");
    return boundedFetch(
      normalizeSourceUrl(new URL(location, url).toString()),
      init,
      maxBytes,
      remainingSourceRedirects - 1,
    );
  }
  if (!response.ok)
    throw new Error(`Source request failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("Source exceeds the size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Source returned no content.");
  const decoder = new TextDecoder();
  let total = 0,
    body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new Error("Source exceeds the size limit.");
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel();
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
  const url = normalizeSourceUrl(input);
  return extractSourceImage(await boundedFetch(url, {}, 2_000_000, 3), url);
}
export async function retrieveImportMetadata(input: string) {
  const url = normalizeSourceUrl(input);
  const html = await boundedFetch(url, {}, 2_000_000, 3);
  const { document } = parseHTML(html);
  const title = (document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.querySelector('title')?.textContent || '').replace(/\s+/gu,' ').trim().slice(0,500);
  if (!title) throw new Error('The source did not provide an article title. Try its original article URL.');
  let published = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || document.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content');
  if (!published) {
    const dates = (value: unknown): string | undefined => {
      if (Array.isArray(value)) return value.map(dates).find(Boolean);
      if (!value || typeof value !== 'object') return;
      const item = value as Record<string, unknown>;
      if (typeof item.datePublished === 'string' && /Article|BlogPosting/.test(String(item['@type']))) return item.datePublished;
      return dates(item['@graph']);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { published = dates(JSON.parse(script.textContent || '')); } catch { /* Unusable metadata is not a publication date. */ }
      if (published) break;
    }
  }
  const date = published ? new Date(published) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.getTime() > Date.now()+300000)
    throw new Error('No trustworthy original publication date was found. Import from a dated publisher feed instead; today’s date will not be invented.');
  const names: Record<string,string> = {'openai.com':'OpenAI','blog.google':'Google','huggingface.co':'Hugging Face','techcrunch.com':'TechCrunch','deepmind.google':'Google DeepMind','research.google':'Google Research','engineering.fb.com':'Meta Engineering'};
  return {url,title,source_published_at:date.toISOString(),source_name:names[new URL(url).hostname],source_image_url:extractSourceImage(html,url)};
}

export async function retrieveSource(url: string) {
  return (await retrieveSourceArticle(url)).text;
}

export async function retrieveSourceArticle(url: string) {
  const html = await boundedFetch(
      normalizeSourceUrl(url),
      {
        headers: { "User-Agent": "knowai/1.0 (editorial source review)" },
        signal: AbortSignal.timeout(15000),
      },
      2_000_000,
      3,
    );
  return {text:extractSource(html), imageUrl:extractSourceImage(html,url)};
}
