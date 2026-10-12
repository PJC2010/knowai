import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decodeHTML } from "entities";
import { parseHTML } from "linkedom";
import { safeImageUrl } from "./images";
import { normalizePublisherUrl, publisherByKey, type PublisherDefinition } from "./publisher-catalog";

export type FeedCandidate = {
  url: string;
  title: string;
  source_name: string;
  source_published_at: string;
  source_image_url: string | null;
  /** Original zero-based entry position, not the filtered candidate position. */
  index: number;
};
export type PublisherFeedResult = {
  candidates: FeedCandidate[];
  scanned: number;
  filtered: number;
  invalid: number;
  total: number;
  warning: string | null;
};
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => decodeHTML(typeof value === "string" ? value : String(record(value)["#text"] || ""))
  .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const aiTopic = /\b(?:AI|artificial intelligence|LLMs?|GPT(?:-\d+)?|Gemini|Claude|OpenAI|Anthropic|DeepSeek|Llama|Mistral|language models?|foundation models?|machine (?:learning|intelligence)|generative|neural|transformers? (?:architecture|models?|training|networks?)|diffusion models?|agents? (?:evaluation|frameworks?|training|safety|learn|reason|plan)|agentic|(?:AI|software|autonomous|multi)[- ]agents?|inference|model training|training (?:large |language |AI )?models|natural language processing|ML applications)\b/i;

/** Strict original dates: no Date.parse guesses, impossible days or local-time timestamps. */
export function originalPublicationDate(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || !Number.isFinite(now)) return null;
  const input = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d))?$/.exec(input);
  const rfc = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s+(?:GMT|UTC|UT|[ECMP][SD]T|[+-](?:[01]\d|2[0-3])[0-5]\d)$/i.exec(input);
  if (!iso && !rfc) return null;
  const year = Number(iso ? iso[1] : rfc![3]);
  const month = iso ? Number(iso[2]) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(rfc![2].toLowerCase()) + 1;
  const day = Number(iso ? iso[3] : rfc![1]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const timestamp = Date.parse(input);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day ||
    !Number.isFinite(timestamp) || timestamp > now) return null;
  return new Date(timestamp).toISOString();
}

function feedImage(item: Record<string, unknown>, url: string): string | null {
  for (const key of ["media:content", "media:thumbnail", "enclosure"]) {
    for (const node of list(item[key]).map(record)) {
      if ((key === "enclosure" && !String(node["@_type"]).startsWith("image/")) ||
        (node["@_type"] && !String(node["@_type"]).startsWith("image/")) ||
        (node["@_medium"] && node["@_medium"] !== "image")) continue;
      const image = safeImageUrl(node["@_url"], url);
      if (image) return image;
    }
  }
  const html = item["content:encoded"] || item.description || record(item.content)["#text"];
  if (typeof html === "string") {
    const { document } = parseHTML(`<article>${html}</article>`);
    for (const image of document.querySelectorAll("img")) {
      const value = safeImageUrl(image.getAttribute("src") || image.getAttribute("data-src"), url);
      if (value) return value;
    }
  }
  return null;
}

export function parsePublisherFeed(xml: string, definition: PublisherDefinition, now = Date.now()): PublisherFeedResult {
  const configured = publisherByKey(definition.key);
  if (!configured || configured.discovery.method !== "feed") throw new Error("Only configured feed publishers can parse feeds.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid feed XML.");
  const parsed = new XMLParser({ processEntities: false, ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const roots = Object.keys(parsed).filter(key => !key.startsWith("?"));
  const rootName = roots[0] || "";
  const atom = rootName === "feed" || rootName.endsWith(":feed");
  const prefix = atom ? rootName.slice(0, -4) : "";
  const root = parsed[rootName];
  const namespace = record(root)[prefix ? `@_xmlns:${prefix.slice(0, -1)}` : "@_xmlns"];
  const container = atom ? root : root?.channel;
  if (roots.length !== 1 || (!atom && rootName !== "rss") || container === undefined ||
    Array.isArray(container) || (typeof container !== "object" && container !== "") ||
    (atom && (prefix || namespace) && namespace !== "http://www.w3.org/2005/Atom")) throw new Error("Invalid feed structure.");
  const items = list(atom ? record(container)[`${prefix}entry`] : record(container).item);
  const scanned = Math.min(items.length, configured.scanLimit);
  const warning = items.length > scanned ? `${configured.name}: only the first ${scanned} of ${items.length} feed entries were scanned. Items can fall out of an unpaged feed between daily refreshes.` : null;
  const result: PublisherFeedResult = { candidates: [], scanned, filtered: 0, invalid: 0, total: items.length, warning };
  for (const [index, value] of items.slice(0, scanned).entries()) {
    const item = Object.fromEntries(Object.entries(record(value)).map(([key, field]) => [prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key, field]));
    const links = list(item.link).map(record);
    const alternate = links.find(link => (!link["@_rel"] || link["@_rel"] === "alternate") &&
      (!link["@_type"] || ["text/html", "application/xhtml+xml"].includes(String(link["@_type"]))));
    let url: string;
    try { url = normalizePublisherUrl(text(atom ? alternate?.["@_href"] : item.link), definition, "article"); }
    catch { result.invalid++; continue; }
    const date = originalPublicationDate(text(atom ? item.published : item.pubDate), now);
    const title = text(item.title).slice(0, 500);
    if (!title || !date) { result.invalid++; continue; }
    const categories = list(item.category).flatMap(value => [text(value), text(record(value)["@_term"]), text(record(value)["@_label"])]).join(" ");
    if ((configured.topicPolicy === "ai-filtered" && !aiTopic.test(`${title} ${categories}`)) ||
      (configured.key === "techcrunch" && /expo.*pass|disrupt.*ticket|last.*chance|save.*\$|deal.*disrupt/i.test(title))) { result.filtered++; continue; }
    const author = text(item["dc:creator"] || record(item.author).name || item.author).slice(0, 200);
    const source_name = configured.key === "hugging-face" && author ? `${author} · Hugging Face` : configured.name;
    result.candidates.push({ url, title, source_name, source_published_at: date, source_image_url: feedImage(item, url), index });
  }
  return result;
}
