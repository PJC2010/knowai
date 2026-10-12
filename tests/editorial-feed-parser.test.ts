import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publisherByKey } from "../src/lib/editorial/publisher-catalog";
import { parsePublisherFeed } from "../src/lib/editorial/feed-parser";
const now = Date.parse("2026-10-12T12:00:00Z");
const fixture = (name: string) => readFileSync(new URL(`./fixtures/editorial-feeds/${name}.xml`, import.meta.url), "utf8");

test("Mistral singleton RSS produces only dated attributable candidate metadata", () => {
  const result = parsePublisherFeed(fixture("mistral"), publisherByKey("mistral")!, now);
  assert.deepEqual(result, { candidates: [{ url: "https://mistral.ai/news/new-model", title: "Introducing a new release & tools", source_name: "Mistral", source_published_at: "2026-10-01T12:30:00.000Z", source_image_url: null, index: 0 }], scanned: 1, total: 1, filtered: 0, invalid: 0, warning: null });
});

const rss = (items: string) => `<rss version="2.0"><channel><title>Synthetic feed</title>${items}</channel></rss>`;
const item = (title: string, path = "story", extra = "", date = "2026-10-01T12:30:00Z") => `<item><title>${title}</title><link>https://mistral.ai/news/${path}</link><pubDate>${date}</pubDate>${extra}</item>`;

test("remaining feed fixtures retain dedicated coverage and exclude broad-feed noise", () => {
  for (const key of ["microsoft-research", "nvidia", "aws-ml", "bair", "ars-technica", "mit-tech-review", "the-decoder"]) {
    const publisher = publisherByKey(key)!;
    const result = parsePublisherFeed(fixture(key), publisher, now);
    assert.equal(result.candidates.length, 1, key);
    assert.equal(result.candidates[0].source_name, publisher.name, key);
    assert.equal(result.candidates[0].source_published_at, "2026-10-01T12:30:00.000Z", key);
    assert.equal(new URL(result.candidates[0].url).protocol, "https:", key);
    assert.equal(result.filtered, ["microsoft-research", "nvidia", "ars-technica"].includes(key) ? 1 : 0, key);
  }
});

test("recognized empty RSS/Atom succeed while malformed XML, HTML and entities fail", () => {
  const publisher = publisherByKey("mistral")!;
  for (const xml of [rss(""), '<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>']) {
    assert.deepEqual(parsePublisherFeed(xml, publisher, now), { candidates: [], scanned: 0, total: 0, filtered: 0, invalid: 0, warning: null });
  }
  for (const xml of ["", "not xml", "<html><body>Verify you are human</body></html>", "<rss><channel><item></channel></rss>", "<rss/>", "<rss><channel>Challenge text</channel></rss>", '<!DOCTYPE rss [<!ENTITY boom "unsafe">]><rss><channel><title>&boom;</title></channel></rss>', '<rss><channel/><channel/></rss>', '<feed/><rss><channel/></rss>'])
    assert.throws(() => parsePublisherFeed(xml, publisher, now), /feed|XML/i, xml);
  assert.throws(() => parsePublisherFeed(rss(""), publisherByKey("anthropic")!, now), /feed/i);
  assert.throws(() => parsePublisherFeed(rss(""), { ...publisher, key: "unknown" }, now), /configured|feed/i);
});

test("invalid entries are counted and isolated without inventing or rolling over dates", () => {
  const xml = rss([
    item("", "empty-title"),
    item("Unsafe", "unsafe").replace("https://mistral.ai/news/unsafe", "https://openai.com/news/wrong-publisher"),
    item("Undated", "undated", "<updated>2026-10-01T12:30:00Z</updated>", ""),
    ...["not a date", "1", "2026-02-30T12:30:00Z", "Mon, 30 Feb 2026 12:30:00 GMT", "2026-10-01T12:30:00", "2026-10-12T12:00:00.001Z"].map((date, i) => item("Invalid date", `invalid-${i}`, "", date)),
    item("Valid", "valid", "", "2024-02-29T14:30:00+02:00"),
  ].join(""));
  const result = parsePublisherFeed(xml, publisherByKey("mistral")!, now);
  assert.equal(result.invalid, 9);
  assert.equal(result.scanned, 10);
  assert.deepEqual(result.candidates.map(c => [c.title, c.index, c.source_published_at]), [["Valid", 9, "2024-02-29T12:30:00.000Z"]]);
});

test("scan caps preserve original entry indices, first-eight eligibility and visible truncation", () => {
  const xml = rss(Array.from({ length: 55 }, (_, i) => item(i < 8 ? "" : `Release ${i}`, `story-${i}`)).join(""));
  const result = parsePublisherFeed(xml, publisherByKey("mistral")!, now);
  assert.equal(result.total, 55);
  assert.equal(result.scanned, 50);
  assert.equal(result.invalid, 8);
  assert.equal(result.candidates.length, 42);
  assert.equal(result.candidates[0].index, 8);
  assert.equal(result.candidates.at(-1)!.index, 49);
  assert.match(result.warning!, /first 50.*55/i);
  assert.match(result.warning!, /fall out.*daily|daily.*miss/i);
  const crunch = parsePublisherFeed(xml.replaceAll("https://mistral.ai/news/", "https://techcrunch.com/"), publisherByKey("techcrunch")!, now);
  assert.equal(crunch.scanned, 8);
  assert.equal(crunch.candidates.length, 0);
});

test("seven legacy publishers retain community attribution, topic rules and promotion exclusions", () => {
  for (const key of ["openai", "google", "hugging-face", "techcrunch", "deepmind", "google-research", "meta-engineering"]) {
    const publisher = publisherByKey(key)!;
    const xml = rss(item("New language model", "model", "<dc:creator><![CDATA[Alex &amp; Team]]></dc:creator>") + item("Last chance: Disrupt tickets", "promotion"))
      .replaceAll("https://mistral.ai/news/", `https://${publisher.articleHosts[0]}/blog/`);
    const result = parsePublisherFeed(xml, publisher, now);
    assert.equal(result.candidates[0].source_name, key === "hugging-face" ? "Alex & Team · Hugging Face" : publisher.name, key);
    assert.equal(result.filtered, ["techcrunch", "google-research", "meta-engineering"].includes(key) ? 1 : 0, key);
  }
  const result = parsePublisherFeed('<feed><entry><title>New tools</title><link href="https://huggingface.co/blog/new-tools"/><published>2026-10-01T12:30:00Z</published><author><name>Community author</name></author></entry></feed>', publisherByKey("hugging-face")!, now);
  assert.equal(result.candidates[0].source_name, "Community author · Hugging Face");
});

test("feed images remain safe metadata without retaining descriptions or article content", () => {
  for (const [extra, expected] of [
    ['<media:content url="https://cdn.example/model.png" medium="image"/>', 'https://cdn.example/model.png'],
    ['<enclosure url="https://cdn.example/audio.mp3" type="audio/mpeg"/><media:thumbnail url="https://cdn.example/thumb.png"/>', 'https://cdn.example/thumb.png'],
    ['<enclosure url="https://cdn.example/model.png" type="image/png"/>', 'https://cdn.example/model.png'],
    ['<description><![CDATA[<img src="/images/model.png"/><p>Do not persist this paragraph.</p>]]></description>', 'https://mistral.ai/images/model.png'],
    ['<media:content url="http://127.0.0.1/private"/><description><![CDATA[<img src="javascript:alert(1)"/>]]></description>', null],
  ]) {
    const candidate = parsePublisherFeed(rss(item("A model", "image", extra!)), publisherByKey("mistral")!, now).candidates[0];
    assert.equal(candidate.source_image_url, expected);
    assert.deepEqual(Object.keys(candidate).sort(), ["index", "source_image_url", "source_name", "source_published_at", "title", "url"]);
  }
});

test("broad feed relevance covers AI families without matching ordinary culture or cloud news", () => {
  const positives = ["Language models become more efficient", "Agent evaluation framework", "Transformer architecture for planning", "Diffusion models improve generation", "Training large models on GPU clusters", "Safety evaluations for Claude", "EU AI Act policy debate", "Inference benchmarks", "OpenAI model announcement"];
  const negatives = ["Gaming bundle launches", "Transformers movie tops the box office", "Diffusion of heat in cloud chambers", "A talented travel agent", "Cloud storage adds another region", "A season of entertainment", "Road safety training for drivers"];
  const xml = rss([...positives, ...negatives].map((title, i) => item(title, `story-${i}`)).join("")).replaceAll("https://mistral.ai/news/", "https://arstechnica.com/ai/2026/10/");
  const result = parsePublisherFeed(xml, publisherByKey("ars-technica")!, now);
  assert.deepEqual(result.candidates.map(candidate => candidate.title), positives);
  assert.equal(result.filtered, negatives.length);
});

test("namespace-prefixed Atom uses the same published and alternate-link rules", () => {
  const xml = '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:title>Agent tools</a:title><a:link rel="alternate" href="https://mistral.ai/news/tools"/><a:published>2026-10-01T12:30:00Z</a:published></a:entry></a:feed>';
  assert.equal(parsePublisherFeed(xml, publisherByKey("mistral")!, now).candidates[0]?.url, "https://mistral.ai/news/tools");
  assert.throws(() => parsePublisherFeed(xml.replace('http://www.w3.org/2005/Atom', 'https://unrelated.example/namespace'), publisherByKey("mistral")!, now), /feed/i);
});

test("Verge Atom chooses HTML alternate articles and original published, never updated", () => {
  const result = parsePublisherFeed(fixture("the-verge"), publisherByKey("the-verge")!, now);
  assert.equal(result.scanned, 3);
  assert.equal(result.invalid, 1);
  assert.deepEqual(result.candidates.map(c => [c.url, c.source_published_at, c.index]), [
    ["https://www.theverge.com/ai-artificial-intelligence/12345/new-model", "2026-10-01T12:30:00.000Z", 0],
    ["https://www.theverge.com/ai-artificial-intelligence/12346/new-tool", "2026-09-30T12:30:00.000Z", 1],
  ]);
});
