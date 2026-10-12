export type SourceKind = "company" | "journalism" | "research" | "community";
export type TopicPolicy = "ai-dedicated" | "ai-filtered";
export type PublisherDefinition = {
  key: string;
  name: string;
  kind: SourceKind;
  description: string;
  homepageUrl: string;
  articleHosts: readonly string[];
  articlePathPrefixes: readonly string[];
  topicPolicy: TopicPolicy;
  scanLimit: number;
  canonicalization?: "bair-https";
  discovery:
    | { method: "feed"; feedUrl: string; feedHosts: readonly string[] }
    | { method: "newsroom"; listingUrl: string; listingHosts: readonly string[]; connector: "anthropic-newsroom"; maxArticleFetches: number };
};
export type PublisherUrlPurpose = "feed" | "listing" | "article";

function feed(key: string, name: string, kind: SourceKind, homepageUrl: string, feedUrl: string,
  description: string, articlePathPrefixes: readonly string[] = ["/"], topicPolicy: TopicPolicy = "ai-dedicated", scanLimit = 50,
): PublisherDefinition {
  return { key, name, kind, description, homepageUrl, articleHosts: [new URL(homepageUrl).hostname], articlePathPrefixes, topicPolicy, scanLimit,
    discovery: { method: "feed", feedUrl, feedHosts: [new URL(feedUrl).hostname] } };
}

export const PUBLISHERS: readonly PublisherDefinition[] = [
  feed("openai", "OpenAI", "company", "https://openai.com/news/", "https://openai.com/news/rss.xml", "Official model, product and research announcements."),
  feed("google", "Google", "company", "https://blog.google/technology/ai/", "https://blog.google/technology/ai/rss/", "Google AI product and company announcements."),
  feed("hugging-face", "Hugging Face", "community", "https://huggingface.co/blog", "https://huggingface.co/blog/feed.xml", "Community-authored models, datasets and open-source tooling."),
  feed("techcrunch", "TechCrunch", "journalism", "https://techcrunch.com/category/artificial-intelligence/", "https://techcrunch.com/category/artificial-intelligence/feed/", "AI industry reporting and analysis.", ["/"], "ai-dedicated", 8),
  feed("deepmind", "Google DeepMind", "research", "https://deepmind.google/blog/", "https://deepmind.google/blog/rss.xml", "Research and model announcements from Google DeepMind."),
  feed("google-research", "Google Research", "research", "https://research.google/blog/", "https://research.google/blog/rss/", "AI-relevant research from Google's broader research blog.", ["/"], "ai-filtered"),
  feed("meta-engineering", "Meta Engineering", "company", "https://engineering.fb.com/", "https://engineering.fb.com/feed/", "AI and infrastructure engineering from Meta.", ["/"], "ai-filtered"),
  feed("microsoft-research", "Microsoft Research", "research", "https://www.microsoft.com/en-us/research/", "https://www.microsoft.com/en-us/research/feed/", "AI-relevant research, including research articles and media.", ["/en-us/research/blog/"], "ai-filtered"),
  feed("nvidia", "NVIDIA", "company", "https://blogs.nvidia.com/", "https://blogs.nvidia.com/feed/", "AI models, computing and infrastructure from NVIDIA.", ["/blog/"], "ai-filtered"),
  feed("aws-ml", "AWS Machine Learning", "company", "https://aws.amazon.com/blogs/machine-learning/", "https://aws.amazon.com/blogs/machine-learning/feed/", "Machine learning, agents and deployment tutorials from AWS.", ["/blogs/machine-learning/"]),
  feed("mistral", "Mistral", "company", "https://mistral.ai/news", "https://mistral.ai/news/rss", "Official Mistral model and product announcements.", ["/news/"]),
  { ...feed("bair", "Berkeley BAIR", "research", "https://bair.berkeley.edu/blog/", "https://bair.berkeley.edu/blog/feed.xml", "Research from Berkeley Artificial Intelligence Research.", ["/blog/"]), canonicalization: "bair-https" },
  feed("ars-technica", "Ars Technica", "journalism", "https://arstechnica.com/", "https://arstechnica.com/feed/", "AI-relevant technology reporting from a broader news feed.", ["/"], "ai-filtered", 20),
  feed("the-verge", "The Verge", "journalism", "https://www.theverge.com/ai-artificial-intelligence", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "Reporting from The Verge's dedicated artificial intelligence feed.", ["/"], "ai-dedicated", 20),
  feed("mit-tech-review", "MIT Technology Review", "journalism", "https://www.technologyreview.com/topic/artificial-intelligence/", "https://www.technologyreview.com/topic/artificial-intelligence/feed/", "AI journalism; some original articles require a subscription.", ["/"], "ai-dedicated", 20),
  feed("the-decoder", "The Decoder", "journalism", "https://the-decoder.com/", "https://the-decoder.com/feed/", "AI-focused news, reporting and analysis.", ["/"], "ai-dedicated", 20),
  { key: "anthropic", name: "Anthropic", kind: "company", description: "Official Anthropic model, product and company news; metadata-only discovery.",
    homepageUrl: "https://www.anthropic.com/news", articleHosts: ["www.anthropic.com"], articlePathPrefixes: ["/news/"], topicPolicy: "ai-dedicated", scanLimit: 40,
    discovery: { method: "newsroom", listingUrl: "https://www.anthropic.com/news", listingHosts: ["www.anthropic.com"], connector: "anthropic-newsroom", maxArticleFetches: 8 } },
];

export function publisherByKey(key: string): PublisherDefinition | undefined {
  return PUBLISHERS.find((publisher) => publisher.key === key);
}
export function publisherByName(name: string): PublisherDefinition | undefined {
  return PUBLISHERS.find((publisher) => publisher.name === name);
}
const unsupported = () => new Error("Only the configured publishers’ HTTPS URLs are supported for this source purpose.");

export function normalizePublisherUrl(input: string, definition: PublisherDefinition, purpose: PublisherUrlPurpose): string {
  const publisher = publisherByKey(definition.key);
  if (!publisher) throw unsupported();
  let url: URL;
  try { url = new URL(input); } catch { throw unsupported(); }
  if (/[\\\u0000-\u0020]/.test(input) || /%(?:2f|5c|00|25)/i.test(url.pathname)) throw unsupported();
  if (publisher.canonicalization === "bair-https" && purpose === "article" && url.protocol === "http:" &&
    url.hostname === "bair.berkeley.edu" && !url.port && /^\/blog\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/.test(url.pathname)) url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw unsupported();
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  if (purpose === "feed" || purpose === "listing") {
    const discovery = publisher.discovery;
    const endpoint = purpose === "feed" && discovery.method === "feed" ? discovery.feedUrl
      : purpose === "listing" && discovery.method === "newsroom" ? discovery.listingUrl : null;
    if (!endpoint || url.toString().replace(/\/$/, "") !== endpoint.replace(/\/$/, "")) throw unsupported();
    return endpoint;
  }
  if (purpose !== "article" || !publisher.articleHosts.includes(url.hostname) ||
    !publisher.articlePathPrefixes.some((prefix) => url.pathname.startsWith(prefix)) || url.pathname === "/") throw unsupported();
  const discoveryUrl = publisher.discovery.method === "feed" ? publisher.discovery.feedUrl : publisher.discovery.listingUrl;
  if (url.pathname.replace(/\/$/, "") === new URL(discoveryUrl).pathname.replace(/\/$/, "")) throw unsupported();
  if (publisher.articlePathPrefixes.some((prefix) => url.pathname.replace(/\/$/, "") === prefix.replace(/\/$/, "")) ||
    /^\/(?:rss|feed|tag|tags|category|categories|topic)(?:\/|$)/.test(url.pathname)) throw unsupported();
  if (publisher.key === "anthropic") {
    if (!/^\/news\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname) || url.search ||
      /^\/news\/(?:category|categories|tag|tags|rss|feed)\/?$/.test(url.pathname)) throw unsupported();
    url.pathname = url.pathname.replace(/\/$/, "");
  }
  return url.toString();
}

export function resolvePublisherArticle(input: string): PublisherDefinition | undefined {
  return PUBLISHERS.find((publisher) => {
    try { normalizePublisherUrl(input, publisher, "article"); return true; } catch { return false; }
  });
}
