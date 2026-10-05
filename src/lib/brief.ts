import type { NewsCategory } from "./types";

export const depths = ["quick", "normal", "deep"] as const;
export type Depth = (typeof depths)[number];
export type Evidence = { claim: string; quote: string };
export type Tiers = {
  oneLiner: string;
  shortVersion: string;
  wholePicture: string[];
  whyItMatters: string;
  evidence: Evidence[];
};
export type BriefStory = {
  id: string;
  slug: string;
  source_url: string;
  source_name: string;
  source_published_at: string;
  category: NewsCategory;
  one_liner: string;
  short_version: string;
  whole_picture: string[];
  why_it_matters: string;
  published_at: string;
  updated_at: string;
  edition_date: string;
  image_url?: string | null;
  image_alt?: string | null;
  featured_week?: string | null;
};
export type Revision = {
  id: string;
  story_id: string;
  content: Tiers;
  source_text: string;
  source_hash: string;
  state: "needs_review" | "published" | "rejected";
  version: number;
  created_at: string;
  reviewed_at: string | null;
  image_url?: string | null;
  image_alt?: string | null;
  image_source?: "source" | "upload" | "none";
};
export const wordCount = (text: string) =>
  text.trim().split(/\s+/u).filter(Boolean).length;
export const characterCount = (text: string) => Array.from(text).length;
export function validateTiers(value: unknown, sourceText?: string): string[] {
  if (!value || typeof value !== "object")
    return ["The draft is not an object."];
  const v = value as Partial<Tiers>;
  const errors: string[] = [];
  if (
    typeof v.oneLiner !== "string" ||
    !v.oneLiner.trim() ||
    characterCount(v.oneLiner) > 140 ||
    /[\r\n]/.test(v.oneLiner)
  )
    errors.push(
      "The one-liner must be one line, between 1 and 140 characters.",
    );
  if (
    typeof v.shortVersion !== "string" ||
    wordCount(v.shortVersion) < 40 ||
    wordCount(v.shortVersion) > 80 ||
    /[\r\n]/.test(v.shortVersion)
  )
    errors.push("The short version must be one paragraph of 40–80 words.");
  if (
    !Array.isArray(v.wholePicture) ||
    v.wholePicture.length < 2 ||
    v.wholePicture.length > 3 ||
    v.wholePicture.some((p) => typeof p !== "string" || !p.trim()) ||
    wordCount(v.wholePicture.join(" ")) < 150 ||
    wordCount(v.wholePicture.join(" ")) > 300
  )
    errors.push(
      "The whole picture must have 2–3 paragraphs totaling 150–300 words.",
    );
  if (
    typeof v.whyItMatters !== "string" ||
    !v.whyItMatters.trim() ||
    characterCount(v.whyItMatters) > 240
  )
    errors.push(
      "Why it matters must be a line of no more than 240 characters.",
    );
  if (
    !Array.isArray(v.evidence) ||
    v.evidence.length < 2 ||
    v.evidence.length > 8 ||
    v.evidence.some(
      (e) =>
        !e ||
        typeof e.claim !== "string" ||
        !e.claim.trim() ||
        typeof e.quote !== "string" ||
        e.quote.length < 20 ||
        e.quote.length > 600 ||
        (sourceText !== undefined && !sourceText.includes(e.quote)),
    )
  )
    errors.push(
      "Include 2–8 supporting claims with exact source excerpts (20–600 characters each).",
    );
  return errors;
}
export function normalizeSourceUrl(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !["openai.com", "blog.google", "huggingface.co", "techcrunch.com"].includes(
      url.hostname,
    )
  )
    throw new Error(
      "Only the configured publishers’ HTTPS URLs are supported.",
    );
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}
export function digestText(
  stories: BriefStory[],
  edition: string,
  origin: string,
): string {
  const url = new URL("/", origin);
  url.searchParams.set("depth", "quick");
  url.searchParams.set("date", edition);
  return [
    `knowai · The Brief · ${edition} (UTC)`,
    "One story. Your depth.",
    "",
    ...stories.map((s, i) => `${i + 1}. ${s.one_liner}`),
    "",
    url.toString(),
  ].join("\n");
}
