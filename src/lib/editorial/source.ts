import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeSourceUrl, wordCount } from "../brief";

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
export async function retrieveSource(url: string) {
  return extractSource(
    await boundedFetch(
      normalizeSourceUrl(url),
      {
        headers: { "User-Agent": "knowai/1.0 (editorial source review)" },
        signal: AbortSignal.timeout(15000),
      },
      2_000_000,
      3,
    ),
  );
}
