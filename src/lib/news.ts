import { XMLParser } from "fast-xml-parser";
import { decodeHTML } from "entities";
import snapshot from "@/data/news-snapshot.json";
import { safeUrl } from "./format";
import type { Article, NewsCategory, NewsData } from "./types";

const feeds = [
  { name: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { name: "Google", url: "https://blog.google/technology/ai/rss/" },
  { name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml" },
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
];
export function plainText(input: unknown): string {
  return decodeHTML(String(input || ""))
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function categorize(title: string): NewsCategory {
  if (/model|gpt|claude|gemini|llama|deepseek/i.test(title)) return "Models";
  if (/research|study|evaluation|benchmark|training|paper|science/i.test(title))
    return "Research";
  if (/launch|app|tool|agent|feature|build|introduc/i.test(title))
    return "Tools";
  return "Industry";
}
export async function getNews(): Promise<NewsData> {
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const response = await fetch(feed.url, {
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "knowai/1.0 (public RSS reader)" },
      });
      if (!response.ok) throw new Error("Feed unavailable");
      const parser = new XMLParser({
        ignoreAttributes: false,
        processEntities: false,
      });
      const xml = parser.parse(await response.text());
      const items = xml.rss?.channel?.item;
      if (!Array.isArray(items)) throw new Error("Invalid feed");
      return items.slice(0, 12).flatMap((item): Article[] => {
        const url = safeUrl(String(item.link || ""));
        const date = new Date(item.pubDate);
        if (
          !url ||
          !item.title ||
          !Number.isFinite(date.getTime()) ||
          date.getTime() > Date.now() + 300000
        )
          return [];
        const title = plainText(item.title);
        if (
          feed.name === "TechCrunch" &&
          /expo.*pass|disrupt.*ticket|last.*chance|save.*\$|deal.*disrupt/i.test(
            title,
          )
        )
          return [];
        const curated = snapshot.articles.find(
          (article) => article.url === url,
        );
        const description =
          curated?.description ||
          plainText(item.description || item["content:encoded"]).slice(0, 360);
        const communityAuthor =
          feed.name === "Hugging Face"
            ? plainText(item["dc:creator"] || item.author)
            : "";
        const source =
          curated?.source ||
          (communityAuthor ? `${communityAuthor} · Hugging Face` : feed.name);
        return [
          {
            id: url,
            title,
            description,
            url,
            source,
            publishedAt: date.toISOString(),
            category: categorize(title),
          },
        ];
      });
    }),
  );
  const articles = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );
  if (!articles.length) return snapshot as NewsData;
  return {
    articles: [...new Map(articles.map((a) => [a.url, a])).values()].sort(
      (a, b) => b.publishedAt.localeCompare(a.publishedAt),
    ),
    fetchedAt: new Date().toISOString(),
    sources: feeds.map((feed, i) => ({
      name: feed.name,
      ok: results[i].status === "fulfilled",
    })),
    fallback: false,
  };
}
