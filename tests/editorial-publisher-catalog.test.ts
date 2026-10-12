import test from "node:test";
import assert from "node:assert/strict";
import { PUBLISHERS, publisherByKey, publisherByName, normalizePublisherUrl, resolvePublisherArticle } from "../src/lib/editorial/publisher-catalog";

const additions = [
  ["microsoft-research", "Microsoft Research", "research", "https://www.microsoft.com/en-us/research/feed/", "https://www.microsoft.com/en-us/research/blog/agent-evaluation/", 50],
  ["nvidia", "NVIDIA", "company", "https://blogs.nvidia.com/feed/", "https://blogs.nvidia.com/blog/model-inference/", 50],
  ["aws-ml", "AWS Machine Learning", "company", "https://aws.amazon.com/blogs/machine-learning/feed/", "https://aws.amazon.com/blogs/machine-learning/agent-tools/", 50],
  ["mistral", "Mistral", "company", "https://mistral.ai/news/rss", "https://mistral.ai/news/new-model", 50],
  ["bair", "Berkeley BAIR", "research", "https://bair.berkeley.edu/blog/feed.xml", "https://bair.berkeley.edu/blog/2026/10/01/research/", 50],
  ["ars-technica", "Ars Technica", "journalism", "https://arstechnica.com/feed/", "https://arstechnica.com/ai/2026/10/models/", 20],
  ["the-verge", "The Verge", "journalism", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "https://www.theverge.com/ai-artificial-intelligence/12345/new-model", 20],
  ["mit-tech-review", "MIT Technology Review", "journalism", "https://www.technologyreview.com/topic/artificial-intelligence/feed/", "https://www.technologyreview.com/2026/10/01/12345/new-model/", 20],
  ["the-decoder", "The Decoder", "journalism", "https://the-decoder.com/feed/", "https://the-decoder.com/a-new-model/", 20],
] as const;

test("all nine additions have distinct configured feed, article, provenance and scan policies", () => {
  for (const [key, name, kind, feedUrl, articleUrl, scanLimit] of additions) {
    const publisher = publisherByKey(key);
    assert.ok(publisher, key);
    assert.equal(publisherByName(name), publisher);
    assert.equal(publisher.kind, kind);
    assert.equal(publisher.scanLimit, scanLimit);
    assert.ok(publisher.description.length > 20);
    assert.deepEqual(publisher.discovery, { method: "feed", feedUrl, feedHosts: [new URL(feedUrl).hostname] });
    assert.equal(resolvePublisherArticle(articleUrl), publisher);
    assert.equal(normalizePublisherUrl(articleUrl + "?utm_source=rss#top", publisher, "article"), articleUrl);
    assert.equal(normalizePublisherUrl(feedUrl, publisher, "feed"), feedUrl);
  }
});

test("Anthropic is a newsroom with separate exact listing and article policies", () => {
  const publisher = publisherByKey("anthropic");
  assert.ok(publisher);
  assert.equal(publisher.name, "Anthropic");
  assert.equal(publisher.kind, "company");
  assert.deepEqual(publisher.discovery, { method: "newsroom", listingUrl: "https://www.anthropic.com/news", listingHosts: ["www.anthropic.com"], connector: "anthropic-newsroom", maxArticleFetches: 8 });
  assert.equal(normalizePublisherUrl("https://www.anthropic.com/news/", publisher, "listing"), "https://www.anthropic.com/news");
  assert.equal(normalizePublisherUrl("https://www.anthropic.com/news/claude-5?utm_medium=feed", publisher, "article"), "https://www.anthropic.com/news/claude-5");
  for (const url of ["https://anthropic.com/news/claude", "https://www.anthropic.com/research/claude", "https://www.anthropic.com/news?category=release", "https://www.anthropic.com/news/", "https://www.anthropic.com/news/category/models", "https://www.anthropic.com/news/category", "https://www.anthropic.com/news/rss", "https://www.anthropic.com/news/story?category=research", "https://www.anthropic.com/news/%2fprivate", "https://www.anthropic.com/news/story/extra"]) {
    assert.throws(() => normalizePublisherUrl(url, publisher, "article"), /configured publishers/, url);
  }
  assert.throws(() => normalizePublisherUrl("https://www.anthropic.com/news/story", publisher, "listing"));
  assert.throws(() => normalizePublisherUrl("https://www.anthropic.com/news/rss.xml", publisher, "feed"));
  assert.equal(PUBLISHERS.length, 17);
  assert.equal(new Set(PUBLISHERS.map(p => p.key)).size, 17);
  assert.equal(new Set(PUBLISHERS.map(p => p.name)).size, 17);
});

test("new URL policies reject escaped paths, discovery-as-article and impostors", () => {
  for (const [key, , , feedUrl, articleUrl] of additions) {
    const publisher = publisherByKey(key)!;
    const url = new URL(articleUrl);
    for (const unsafe of [articleUrl.replace(url.hostname, `${url.hostname}.evil.test`), articleUrl.replace(url.hostname, `sub.${url.hostname}`), articleUrl.replace("https:", key === "bair" ? "ftp:" : "http:"), articleUrl.replace("https://", "https://a:b@"), articleUrl.replace(url.hostname, `${url.hostname}:8443`), articleUrl.replace(url.pathname, "/%2fprivate"), feedUrl]) {
      assert.throws(() => normalizePublisherUrl(unsafe, publisher, "article"), /configured publishers/, unsafe);
    }
    assert.throws(() => normalizePublisherUrl(articleUrl, publisher, "feed"));
    assert.throws(() => normalizePublisherUrl("https://openai.com/news/other", publisher, "article"));
  }
  for (const [key, url] of [["microsoft-research", "https://www.microsoft.com/en-us/store/item"], ["nvidia", "https://blogs.nvidia.com/blog/"], ["aws-ml", "https://aws.amazon.com/blogs/storage/story/"], ["mistral", "https://mistral.ai/news/"], ["bair", "https://bair.berkeley.edu/blog/"], ["the-verge", "https://www.theverge.com/rss/other.xml"], ["mit-tech-review", "https://www.technologyreview.com/topic/artificial-intelligence/"], ["the-decoder", "https://the-decoder.com/category/news/"], ["ars-technica", "https://arstechnica.com/tag/ai/"]])
    assert.throws(() => normalizePublisherUrl(url, publisherByKey(key)!, "article"), /configured publishers/, url);
  assert.throws(() => normalizePublisherUrl("https://evil.test/story", { ...publisherByKey("mistral")!, key: "unknown", articleHosts: ["evil.test"] }, "article"));
  assert.throws(() => normalizePublisherUrl("https://evil.test/story", { ...publisherByKey("mistral")!, articleHosts: ["evil.test"] }, "article"));
});

test("BAIR alone upgrades known dated blog articles to HTTPS, never the feed or arbitrary paths", () => {
  const publisher = publisherByKey("bair")!;
  assert.equal(normalizePublisherUrl("http://bair.berkeley.edu/blog/2026/10/01/research/?utm_source=feed", publisher, "article"), "https://bair.berkeley.edu/blog/2026/10/01/research/");
  assert.equal(publisher.canonicalization, "bair-https");
  for (const url of ["http://bair.berkeley.edu/blog/undated-path", "http://bair.berkeley.edu/blog/feed.xml", "http://bair.berkeley.edu/people/", "http://bair.berkeley.edu.evil.test/blog/2026/10/01/research/", "http://a:b@bair.berkeley.edu/blog/2026/10/01/research/", "http://bair.berkeley.edu:8080/blog/2026/10/01/research/"]) {
    assert.throws(() => normalizePublisherUrl(url, publisher, "article"), /configured publishers/);
    assert.equal(resolvePublisherArticle(url), undefined);
  }
  assert.throws(() => normalizePublisherUrl("http://bair.berkeley.edu/blog/feed.xml", publisher, "feed"));
});

test("existing names, exact article hosts and discovery endpoints remain configured", () => {
  for (const [key, name, host] of [
    ["openai", "OpenAI", "openai.com"], ["google", "Google", "blog.google"], ["hugging-face", "Hugging Face", "huggingface.co"],
    ["techcrunch", "TechCrunch", "techcrunch.com"], ["deepmind", "Google DeepMind", "deepmind.google"],
    ["google-research", "Google Research", "research.google"], ["meta-engineering", "Meta Engineering", "engineering.fb.com"],
  ]) {
    const publisher = publisherByKey(key)!;
    assert.equal(publisher.name, name);
    assert.deepEqual(publisher.articleHosts, [host]);
    assert.equal(resolvePublisherArticle(`https://${host}/story`), publisher);
    assert.equal(publisher.scanLimit, key === "techcrunch" ? 8 : 50);
  }
  assert.equal(publisherByKey("not-configured"), undefined);
  assert.equal(publisherByName("google"), undefined);
});
