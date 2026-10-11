import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { BriefFeed } from "../src/components/brief-feed";
import type { BriefStory } from "../src/lib/brief";

const story: BriefStory = {
  id: "featured-story",
  slug: "featured-story",
  source_url: "https://example.com/article",
  source_name: "Example publisher",
  source_published_at: "2026-10-01T12:00:00Z",
  category: "Research",
  one_liner: "A source-backed weekly selection.",
  short_version: "The short version of the selected article.",
  whole_picture: ["The whole picture."],
  why_it_matters: "Why this article matters.",
  published_at: "2026-10-02T12:00:00Z",
  updated_at: "2026-10-02T12:00:00Z",
  edition_date: "2026-10-02",
  featured_week: "2026-09-28",
  image_url: "https://example.com/article-photo.jpg",
  image_alt: "The research team's laboratory",
};

function render(stories: BriefStory[], date: string, category = "All updates") {
  return renderToStaticMarkup(
    createElement(BriefFeed, {
      stories,
      initialDate: date,
      initialCategory: category,
    }),
  );
}

test("story copy gets glossary terms but one-liners and previews do not", () => {
  const s = {
    ...story,
    one_liner: "An LLM headline.",
    short_version: "A new LLM arrives with open weights.",
    whole_picture: ["Its training data includes many tokens."],
    why_it_matters: "The API is available to developers.",
  };
  const html = render([s], "2026-10-02");
  assert.match(html, /class="glossary-term"[^>]*>LLM</);
  assert.match(html, /popoverTarget="featured-story-term-llm"/);
  assert.match(html, /href="\/learn#term-llm"/);
  assert.doesNotMatch(html, /role="dialog"/);
  const { document } = parseHTML(html);
  assert.equal(document.querySelector(".brief-headline")?.textContent?.trim(), "An LLM headline.");
  assert.equal(document.querySelector(".brief-headline .glossary-term"), null);
  for (const [selector, expected] of [
    [".brief-short p", s.short_version],
    [".brief-full > p", s.whole_picture[0]],
    [".brief-matters p", s.why_it_matters],
  ]) {
    const paragraph = document.querySelector(selector);
    paragraph?.querySelectorAll(".glossary-pop").forEach((pop) => pop.remove());
    assert.equal(paragraph?.textContent, expected);
    assert.ok(paragraph?.querySelector(".glossary-term"), `${selector} has an inline term`);
  }
  const preview = renderToStaticMarkup(createElement(BriefFeed, { stories: [s], initialDate: "2026-10-02", preview: true }));
  assert.doesNotMatch(preview, /glossary-term|glossary-pop/);
});

test("ask link appears in deep cards but not in preview", () => {
  const deep = renderToStaticMarkup(createElement(BriefFeed, {
    stories: [story], initialDate: "2026-10-02", initialDepth: "deep",
  }));
  const { document } = parseHTML(deep);
  const link = document.querySelector('.brief-full a[href^="/playground?prompt="]');
  assert.equal(link?.textContent?.trim(), "Ask AI models about this story");
  assert.equal(link?.previousElementSibling?.textContent?.trim(), "Read the Example publisher original");
  assert.equal(link?.nextElementSibling?.textContent?.trim(), "Opens the Playground with this story as a prompt. You choose the models and decide whether to run it.");
  const url = new URL(link?.getAttribute("href") || "", "http://x");
  assert.match(url.searchParams.get("prompt") || "", /A source-backed weekly selection\. The short version of the selected article\./);

  const preview = renderToStaticMarkup(createElement(BriefFeed, {
    stories: [story], initialDate: "2026-10-02", initialDepth: "deep", preview: true,
  }));
  assert.doesNotMatch(preview, /Ask AI models about this story|\/playground\?prompt=/);
});

test("server markup contains no reader-memory markers", () => {
  const { document } = parseHTML(render([story], "2026-10-02"));
  assert.equal(document.querySelector(".brief-new, .brief-read"), null);
  assert.doesNotMatch(document.querySelector(".brief-toolbar p")?.textContent ?? "", /new since your last visit/);
});

test("server markup has no welcome strip", () => {
  assert.doesNotMatch(render([story], "2026-10-02"), /Welcome to The Brief|New here\?/);
  const preview = renderToStaticMarkup(createElement(BriefFeed, { stories: [story], initialDate: "2026-10-02", preview: true }));
  assert.doesNotMatch(preview, /Welcome to The Brief|New here\?/);
});

test("the subscribe card offers a readable follow flow and never appears in preview", () => {
  const props = { stories: [story], initialDate: "2026-10-02", feedUrl: "https://knowai.example/feed.xml" };
  const html = renderToStaticMarkup(createElement(BriefFeed, props));
  assert.match(html, /Follow The Brief/);
  assert.match(html, /Follow new, editor-reviewed stories in a reader app\. No knowai account needed\./);
  const { document } = parseHTML(html);
  const card = document.querySelector(".subscribe-card");
  assert.equal(card?.previousElementSibling?.className, "brief-reading");
  assert.equal(card?.nextElementSibling?.className, "brief-next");
  assert.equal(card?.querySelector('a[href="/follow"]')?.textContent, "Choose how to follow");
  assert.equal(card?.querySelector('a[href="/feed.xml"]'), null);
  assert.equal(card?.querySelector("button")?.textContent?.trim(), "Copy feed address");
  assert.match(card?.textContent ?? "", /New to RSS\?.*A feed reader, such as Feedly or Inoreader, collects new posts from sites you follow\./);
  assert.doesNotMatch(render([story], "2026-10-02"), /Follow The Brief/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(BriefFeed, { ...props, preview: true })), /Follow The Brief/);
});

test("the weekly feature appears once and retains the selected article image", () => {
  const html = render([story], "2026-10-02");
  assert.equal((html.match(/class="brief-card brief-featured"/g) || []).length, 1);
  assert.equal((html.match(/id="featured-story-title"/g) || []).length, 1);
  assert.match(html, /Featured article of the week/);
  assert.match(html, /src="https:\/\/example.com\/article-photo.jpg"/);
  assert.match(html, /alt="The research team&#x27;s laboratory"/);
});

test("the feature follows the selected UTC week and never shows a later edition", () => {
  assert.match(render([story], "2026-10-04"), /brief-card brief-featured/);
  assert.doesNotMatch(render([story], "2026-10-05"), /brief-card brief-featured/);
  assert.doesNotMatch(render([story], "2026-10-01"), /brief-card brief-featured/);
  assert.doesNotMatch(render([story], "2026-09-27"), /brief-card brief-featured/);
});

test("category filtering includes the feature and image-free stories remain readable", () => {
  assert.match(render([story], "2026-10-02", "Research"), /brief-card brief-featured/);
  assert.doesNotMatch(render([story], "2026-10-02", "Industry"), /brief-card brief-featured/);
  const html = render([{ ...story, image_url: null, featured_week: null }], "2026-10-02");
  assert.match(html, /A source-backed weekly selection/);
  assert.doesNotMatch(html, /<img|brief-card brief-featured/);
});
