import "./editorial-server-hook";
import test from "node:test";
import assert from "node:assert/strict";
import { act, createElement, StrictMode, useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { QueueControls, SourceCard, SourceKindBadge } from "../src/components/editor/inbox";
import type { DeskData, DeskMutation, DeskPublisher, DeskSource } from "../src/lib/editorial/desk-types";
import { PUBLISHERS } from "../src/lib/editorial/publisher-catalog";

const labels = { company: "Company announcement", journalism: "Journalism", research: "Research blog", community: "Community / tooling" };
const publisher = (key = "openai", patch: Partial<DeskPublisher> = {}): DeskPublisher => {
  const catalog = PUBLISHERS.find(item => item.key === key)!;
  const discovery = catalog.discovery;
  return {
    id: `id-${key}`, name: catalog.name, catalog_key: key, catalog, source_kind: catalog.kind,
    discovery_method: discovery.method, discovery_url: discovery.method === "feed" ? discovery.feedUrl : discovery.listingUrl,
    feed_url: discovery.method === "feed" ? discovery.feedUrl : null, enabled: false, access_status: "approved",
    last_attempt_at: null, last_success_at: null, last_error: null, last_result: null, last_warning: null, retry_after: null,
    ...patch,
  };
};
const run = async (_input: DeskMutation) => ({ ok: true, message: "Saved" });

const parse = (html: string) => parseHTML(html).document;
const health = { outcome: "ok" as const, scanned: 12, inserted: 2, duplicates: 3, filtered: 4, invalid: 3, attempted: 8, remaining: 5, elapsed_ms: 325 };

const data: DeskData = { sources: [], revisions: [], jobs: [], publishers: PUBLISHERS.map(item => publisher(item.key)), active: null, history: [], counts: { inbox: 0, selected: 0, saved: 0, dismissed: 0, drafts: 0, published: 0, failed: 0, queued: 0, rejected: 0 }, total: 0, page: 1, pageSize: 20, selectedIds: [], attemptsToday: 2, dailyAttemptLimit: 10, autoDraft: false };
const router = { back() {}, forward() {}, push() {}, replace() {}, refresh() {}, prefetch() {}, bfcacheId: "test" };

test("the sources desk integrates all publisher cards without changing paid drafting or the daily cap", async () => {
  const { EditorDesk } = await import("../src/components/editor/desk");
  const document = parse(renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(EditorDesk, { data, query: { view: "sources", sourceKind: "research", q: "useful" }, mutate: run, signOut: null }))));
  assert.equal(document.querySelectorAll('article[aria-label]').length, 17);
  assert.equal(document.querySelector('#daily-attempt-limit')?.getAttribute("value"), "10");
  assert.match(document.documentElement.textContent || "", /Automatic drafting/);
  assert.match(document.documentElement.textContent || "", /original four feeds only/);
  assert.match(document.documentElement.textContent || "", /Publishing always requires your review/);
  assert.match(document.documentElement.textContent || "", /access-approved publisher/);
  assert.doesNotMatch(document.querySelector(".desk-heading")?.textContent || "", /Approved publishers/);
  for (const link of document.querySelectorAll(".desk-navigation a")) {
    const url = new URL(link.getAttribute("href")!, "https://example.com");
    assert.equal(url.searchParams.get("sourceKind"), "research");
    assert.equal(url.searchParams.get("q"), "useful");
  }
});

test("source-type-only empty views explain the filter and selection navigation retains it", async () => {
  const { EditorDesk } = await import("../src/components/editor/desk");
  const document = parse(renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(EditorDesk, { data: { ...data, selectedIds: ["s1"] }, query: { view: "inbox", sourceKind: "research" }, mutate: run, signOut: null }))));
  assert.match(document.querySelector(".desk-empty")?.textContent || "", /Try clearing a filter/);
  const selectedHref = document.querySelector(".desk-selection-tray a")?.getAttribute("href");
  assert.equal(new URL(selectedHref!, "https://example.com").searchParams.get("sourceKind"), "research");
});

test("source cards use shrinkable single-column mobile layout and wrapping touch-friendly links", () => {
  const css = readFileSync(new URL("../src/app/brief.css", import.meta.url), "utf8");
  assert.ok(/\.desk-publishers\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css), "Shrinkable mobile grid");
  assert.ok(/\.desk-publisher-links a\s*\{[^}]*min-height:\s*44px[^}]*overflow-wrap:\s*anywhere/.test(css), "Wrapping links with a touch target");
  assert.ok(/\.desk-publisher-counts\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(css), "Counts wrap into narrow columns");
  assert.ok(/\.desk-publisher-times > div\s*\{[^}]*flex-wrap:\s*wrap/.test(css), "Long timestamps wrap");
});

test("provenance disclosures keep a visible native marker, keyboard focus and a touch target", () => {
  const css = readFileSync(new URL("../src/app/brief.css", import.meta.url), "utf8");
  const summary = css.match(/summary\.desk-source-kind\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(summary, /display:\s*list-item/, "Keep the native expand/collapse marker discoverable");
  assert.match(summary, /min-height:\s*44px/, "The whole label is a touch target");
  assert.match(summary, /cursor:\s*pointer/);
  assert.match(css, /summary\.desk-source-kind:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/, "Keyboard focus is visible");
});

async function withDOM(check: (document: Document, render: (element: ReactNode) => Promise<void>, click: (element: Element) => Promise<void>) => Promise<void>) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const previous = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries({ window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { configurable: true, value });
  const root = createRoot(window.document.getElementById("root")!);
  try {
    await check(window.document, async element => { await act(async () => { root.render(element); }); }, async element => { await act(async () => { element.dispatchEvent(new window.Event("click", { bubbles: true })); }); });
  } finally {
    await act(async () => { root.unmount(); });
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("retry expiry unlocks an approved source without automatically making a request", async context => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  let now = Date.parse("2026-10-12T00:00:00Z");
  context.mock.method(Date, "now", () => now);
  await withDOM(async (document, render) => {
    let expire: (() => void) | undefined;
    const original = window.setTimeout.bind(window);
    context.mock.method(window, "setTimeout", ((callback: () => void, delay: number) => {
      if (delay === 1000) { expire = callback; return 123; }
      return original(callback, delay);
    }) as typeof window.setTimeout);
    const calls: DeskMutation[] = [];
    await render(createElement(PublisherSettings, { publishers: [publisher("openai", { enabled: true, retry_after: "2026-10-12T00:00:01Z" })], busy: false, run: async input => { calls.push(input); return { ok: true, message: "Done" }; } }));
    assert.equal(document.querySelector("button")?.hasAttribute("disabled"), true);
    assert.ok(expire, "Retry schedules a local UI update");
    await act(async () => { now += 1000; expire!(); });
    assert.equal(document.querySelector("button")?.hasAttribute("disabled"), false);
    assert.deepEqual(calls, [], "A retry window never starts an automatic fetch");
    context.mock.restoreAll();
  });
});

test("retry expiry between render and passive effects unlocks refresh without a request", async context => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  let now = Date.parse("2026-10-12T00:00:00Z");
  context.mock.method(Date, "now", () => now);
  await withDOM(async (document, render) => {
    let catchUp: (() => void) | undefined;
    let catchUps = 0;
    const original = window.setTimeout.bind(window);
    context.mock.method(window, "setTimeout", ((callback: () => void, delay: number) => {
      if (delay === 0) { catchUps++; catchUp = callback; return 123; }
      return original(callback, delay);
    }) as typeof window.setTimeout);
    const calls: DeskMutation[] = [];
    let disabledAtCommit: boolean | undefined;
    function ExpireBeforePassiveEffects() {
      useLayoutEffect(() => {
        disabledAtCommit = document.querySelector("button")?.hasAttribute("disabled");
        now += 1000;
      }, []);
      return createElement(PublisherSettings, {
        publishers: [publisher("openai", { enabled: true, retry_after: "2026-10-12T00:00:01Z" })], busy: false,
        run: async input => { calls.push(input); return { ok: true, message: "Done" }; },
      });
    }
    await render(createElement(ExpireBeforePassiveEffects));
    assert.equal(disabledAtCommit, true, "The committed render saw an active retry window");
    await act(async () => { catchUp?.(); });
    assert.equal(document.querySelector("button")?.hasAttribute("disabled"), false, "Expiry before the passive effect must not strand refresh disabled");
    assert.equal(catchUps, 1, "The expired render deadline needs only one catch-up timer");
    assert.deepEqual(calls, [], "Catching up the UI must not start a request");
  });
});

test("retry timers advance distinct deadlines and clean up in StrictMode and on unmount", async context => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  let now = Date.parse("2026-10-12T00:00:00Z");
  context.mock.method(Date, "now", () => now);
  await withDOM(async (document, render) => {
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let scheduled = 0;
    context.mock.method(window, "setTimeout", ((callback: () => void, delay: number) => {
      const id = ++scheduled;
      timers.set(id, { callback, delay });
      return id;
    }) as typeof window.setTimeout);
    context.mock.method(window, "clearTimeout", ((id: number) => { timers.delete(id); }) as typeof window.clearTimeout);
    const calls: DeskMutation[] = [];
    const props = {
      publishers: [
        publisher("openai", { enabled: true, retry_after: "2026-10-12T00:00:01Z" }),
        publisher("anthropic", { enabled: true, retry_after: "2026-10-12T00:00:02Z" }),
      ], busy: false, run: async (input: DeskMutation) => { calls.push(input); return { ok: true, message: "Done" }; },
    };
    await render(createElement(StrictMode, null, createElement(PublisherSettings, props)));
    assert.equal(scheduled, 2, "StrictMode replays the effect");
    assert.equal(timers.size, 1, "Effect cleanup leaves only one timer");
    assert.deepEqual([...document.querySelectorAll("button")].map(button => button.hasAttribute("disabled")), [true, true]);
    for (const expected of [[false, true], [false, false]]) {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      assert.equal(timer.delay, 1000, "Each deadline gets its own remaining wait");
      timers.delete(id);
      await act(async () => { now += timer.delay; timer.callback(); });
      assert.deepEqual([...document.querySelectorAll("button")].map(button => button.hasAttribute("disabled")), expected);
    }
    assert.equal(timers.size, 0, "Expired deadlines never create a timer loop");
    await render(createElement(StrictMode, null, createElement(PublisherSettings, {
      ...props, publishers: [publisher("openai", { enabled: true, retry_after: "2026-10-12T00:00:03Z" })],
    })));
    assert.equal(timers.size, 1, "New publisher props schedule their deadline");
    await render(null);
    assert.equal(timers.size, 0, "Unmount cancels the outstanding timer");
    assert.deepEqual(calls, [], "Timer updates never fetch or mutate publishers");
  });
});

test("publisher controls fail closed for policy, missing configuration, disabled sources, retry windows and pending work", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  const cases: [Partial<DeskPublisher>, boolean, boolean, boolean, string][] = [
    [{ enabled: true }, false, false, false, "Enabled"],
    [{ enabled: false }, false, true, false, "Discovery paused"],
    [{ enabled: true, access_status: "blocked", access_note: "Automated access is restricted." }, false, true, false, "Automated access is restricted."],
    [{ enabled: true, access_status: "review_required", access_note: "Permission needs review." }, false, true, false, "Permission needs review."],
    [{ enabled: true, access_status: undefined }, false, true, false, "Access review required"],
    [{ enabled: true, catalog: null }, false, true, false, "Discovery configuration unavailable"],
    [{ enabled: true, discovery_url: "https://example.com/unreviewed" }, false, true, false, "Discovery configuration unavailable"],
    [{ enabled: true, retry_after: "2099-01-01T00:00:00Z" }, false, true, false, "Retry window is active"],
    [{ enabled: true, retry_after: "2000-01-01T00:00:00Z" }, false, false, false, "Retry after"],
    [{ enabled: true }, true, true, true, "Request in progress"],
  ];
  for (const [patch, busy, refreshDisabled, toggleDisabled, explanation] of cases) {
    const document = parse(renderToStaticMarkup(createElement(PublisherSettings, { publishers: [publisher("openai", patch)], busy, run })));
    const refresh = document.querySelector("button");
    const toggle = document.querySelector('input[role="switch"]');
    assert.ok(refresh, "Individual refresh button is present");
    assert.ok(toggle, "Discovery toggle is present");
    assert.equal(refresh.textContent, "Refresh OpenAI");
    assert.equal(refresh.hasAttribute("disabled"), refreshDisabled, explanation);
    assert.equal(toggle.hasAttribute("disabled"), toggleDisabled, explanation);
    assert.ok(document.documentElement.textContent?.includes(explanation), explanation);
    if (patch.access_status === "blocked" || patch.access_status === "review_required") assert.match(document.documentElement.textContent || "", /cannot be overridden by a toggle or an article import/);
  }
});

test("individual refresh sends only the publisher ID and never invents result counts", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  await withDOM(async (document, render, click) => {
    const calls: DeskMutation[] = [];
    const props = { publishers: [publisher("anthropic", { enabled: true, last_result: health })], busy: false, run: async (input: DeskMutation) => { calls.push(input); return { ok: true, message: "Server acknowledged" }; } };
    await render(createElement(PublisherSettings, props));
    const button = document.querySelector("button")!;
    assert.ok(button);
    await click(button);
    assert.deepEqual(calls, [{ intent: "discover", publisherId: "id-anthropic" }]);
    assert.equal(document.querySelector(".desk-publisher-counts")?.textContent?.includes("New2"), true);
    await render(createElement(PublisherSettings, { ...props, busy: true }));
    await click(document.querySelector("button")!);
    assert.equal(calls.length, 1, "Pending refresh cannot be duplicated");
    await render(createElement(PublisherSettings, { ...props, publishers: [publisher("anthropic", { enabled: true, access_status: "blocked" })] }));
    await click(document.querySelector("button")!);
    assert.equal(calls.length, 1, "Policy restriction cannot be bypassed");
  });
});

test("an already-enabled restricted source can be paused but never re-enabled", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  await withDOM(async (document, render, click) => {
    const calls: DeskMutation[] = [];
    const props = { publishers: [publisher("anthropic", { enabled: true, access_status: "blocked" })], busy: false, run: async (input: DeskMutation) => { calls.push(input); return { ok: true, message: "Saved" }; } };
    await render(createElement(PublisherSettings,props));
    const toggle=document.querySelector<HTMLInputElement>('input[role="switch"]')!;
    assert.equal(toggle.hasAttribute("disabled"),false,"Pausing never requires source approval");
    toggle.checked=false;await click(toggle);
    assert.deepEqual(calls,[{intent:"publisher",id:"id-anthropic",enabled:false}]);
    await render(createElement(PublisherSettings,{...props,publishers:[publisher("anthropic",{enabled:false,access_status:"blocked"})]}));
    const paused=document.querySelector<HTMLInputElement>('input[role="switch"]')!;
    assert.equal(paused.hasAttribute("disabled"),true);paused.checked=true;await click(paused);
    assert.equal(calls.length,1,"A paused blocked source cannot be re-enabled");
  });
});

test("approved discovery toggles send only the requested state while restricted toggles cannot act", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  await withDOM(async (document, render, click) => {
    const calls: DeskMutation[] = [];
    const props = { publishers: [publisher("anthropic")], busy: false, run: async (input: DeskMutation) => { calls.push(input); return { ok: true, message: "Saved" }; } };
    await render(createElement(PublisherSettings, props));
    const toggle = document.querySelector<HTMLInputElement>('input[role="switch"]')!;
    toggle.checked = true;
    await click(toggle);
    assert.deepEqual(calls, [{ intent: "publisher", id: "id-anthropic", enabled: true }]);
    assert.equal(document.querySelector("button")?.hasAttribute("disabled"), true, "Discovery stays paused until new server props confirm the change");
    for (const access_status of ["review_required", "blocked"] as const) {
      await render(createElement(PublisherSettings, { ...props, publishers: [publisher("anthropic", { access_status })] }));
      const restricted = document.querySelector<HTMLInputElement>('input[role="switch"]')!;
      restricted.checked = true;
      await click(restricted);
      assert.equal(calls.length, 1, access_status);
    }
  });
});

test("publisher health shows recorded counts, separate attempt and success times, errors, warnings and retry", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  const document = parse(renderToStaticMarkup(createElement(PublisherSettings, {
    publishers: [publisher("openai", { enabled: true, last_result: { ...health, outcome: "partial" }, last_attempt_at: "2026-10-12T03:10:00Z", last_success_at: "2026-10-11T02:05:00Z", last_error: "Metadata request failed (HTTP 429).", last_warning: "Five entries remain for a later refresh.", retry_after: "2026-10-12T03:20:00Z" })], busy: false, run,
  })));
  const facts = Object.fromEntries([...document.querySelectorAll("dl > div")].map(row => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]));
  assert.equal(document.querySelector(".desk-publisher-health")?.textContent, "Partial refresh");
  assert.equal(facts["Last attempt"], "2026-10-12 03:10 UTC");
  assert.equal(facts["Last successful refresh"], "2026-10-11 02:05 UTC");
  for (const [key, value] of Object.entries({ Scanned: "12", New: "2", Duplicates: "3", Filtered: "4", Invalid: "3", "Article requests": "8", Remaining: "5" })) assert.equal(facts[key], value, key);
  for (const text of ["Metadata request failed (HTTP 429).", "Five entries remain for a later refresh.", "Retry after", "2026-10-12 03:20 UTC"]) assert.ok(document.documentElement.textContent?.includes(text), text);
});

test("health never turns unchecked or unavailable sources into a healthy zero-new result", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  for (const [patch, label, hasCounts] of [
    [{}, "Not checked", false],
    [{ last_attempt_at: "2026-10-12T03:10:00Z" }, "No result recorded", false],
    [{ last_success_at: "2026-10-11T03:10:00Z" }, "No result recorded", false],
    [{ last_result: { ...health, outcome: "empty", inserted: 0 } }, "Healthy — no new stories", true],
    [{ last_result: { ...health, inserted: 0 } }, "Healthy — no new stories", true],
    [{ last_result: health }, "Healthy", true],
    [{ last_result: { ...health, outcome: "unavailable", inserted: 0 }, last_error: "HTTP 403" }, "Unavailable", true],
    [{ last_result: { ...health, outcome: "skipped", inserted: 0 } }, "Refresh skipped", true],
  ] as const) {
    const document = parse(renderToStaticMarkup(createElement(PublisherSettings, { publishers: [publisher("openai", patch)], busy: false, run })));
    assert.equal(document.querySelector(".desk-publisher-health")?.textContent, label);
    assert.equal(Boolean(document.querySelector(".desk-publisher-counts")), hasCounts);
    if (!hasCounts) assert.equal(document.documentElement.textContent?.includes("0 new"), false);
  }
});

test("all catalog sources expose named cards, plain provenance and truthful discovery links", async () => {
  const { PublisherSettings } = await import("../src/components/editor/publisher-settings");
  const document = parse(renderToStaticMarkup(createElement(PublisherSettings, { publishers: PUBLISHERS.map(item => publisher(item.key)), busy: false, run })));
  const cards = [...document.querySelectorAll("article")];
  assert.equal(cards.length, 17);
  for (const definition of PUBLISHERS) {
    const card = cards.find(card => card.getAttribute("aria-label") === definition.name);
    assert.ok(card, definition.name);
    assert.ok(card.textContent?.includes(definition.description), definition.name);
    assert.equal(card.querySelector(".desk-source-kind")?.textContent, labels[definition.kind]);
    const links = [...card.querySelectorAll("a")];
    assert.equal(links.find(link => link.textContent?.startsWith("Homepage"))?.getAttribute("href"), definition.homepageUrl);
    const discovery = definition.discovery;
    const label = discovery.method === "feed" ? "Feed" : "Newsroom";
    assert.equal(links.find(link => link.textContent?.startsWith(label))?.getAttribute("href"), discovery.method === "feed" ? discovery.feedUrl : discovery.listingUrl);
    if (discovery.method === "newsroom") assert.equal(links.some(link => link.textContent?.startsWith("Feed")), false);
  }
});

test("inbox provenance uses a native disclosure for keyboard and touch, not a hover-only title", () => {
  for (const [source_kind, label] of Object.entries(labels)) {
    const source = { id: "s1", title: "Original headline", source_name: "Example", source_published_at: "2026-10-01T09:00:00Z", category: "Tools", triage: "inbox", source_kind } as DeskSource;
    const document = parse(renderToStaticMarkup(createElement(SourceCard, { source, selected: false, pending: false, onTriage: () => {}, onPreview: () => {} })));
    const badge = document.querySelector(".desk-source-kind");
    assert.ok(badge);
    assert.equal(badge.textContent, label);
    assert.equal(badge.tagName, "SUMMARY", "The label must be a native keyboard/touch disclosure control");
    const disclosure = badge.parentElement;
    assert.ok(disclosure);
    assert.equal(disclosure.tagName, "DETAILS");
    assert.equal(disclosure.firstElementChild, badge);
    assert.equal(disclosure.hasAttribute("open"), false, "Keep the mobile metadata concise until requested");
    const description = disclosure.querySelector("p")?.textContent || "";
    assert.ok(description, "Provenance must be readable text inside the disclosure");
    if (source_kind === "research") assert.match(description, /not necessarily peer-reviewed/i);
    if (source_kind === "company") assert.match(description, /not independent corroboration/i);
    if (source_kind === "journalism") assert.match(description, /Reporting and analysis\. Check the original article and its sources\./);
    if (source_kind === "community") assert.match(description, /Community work and tools\. Check claims at the original source\./);
  }
});

test("unknown provenance stays an honest label without an empty disclosure", () => {
  const document = parse(renderToStaticMarkup(createElement(SourceKindBadge, { kind: undefined })));
  assert.equal(document.querySelector(".desk-source-kind")?.textContent, "Source type unavailable");
  assert.equal(document.querySelector("details"), null);
});

test("browser source checks reject console.error and pageerror but ignore ordinary console output", async () => {
  const [{ transform }, { expect }, { runInNewContext }, { EventEmitter }] = await Promise.all([
    import("esbuild"), import("@playwright/test"), import("node:vm"), import("node:events"),
  ]);
  const makePage = () => Object.assign(new EventEmitter(), { context: () => ({ addCookies: async () => {} }) });
  type Hook = (fixtures: { page: ReturnType<typeof makePage> }) => Promise<void>;
  const before: Hook[] = [], after: Hook[] = [];
  // Execute the real spec's hooks with an event-emitting Page boundary, not a browser/server.
  // Test bodies are registered only; their fixture requests and screenshots never run here.
  const register = Object.assign(() => {}, {
    describe: (_name: string, body: () => void) => body(), use: () => {},
    beforeEach: (hook: Hook) => before.push(hook), afterEach: (hook: Hook) => after.push(hook),
  });
  const file = new URL("./brief-e2e/editor-sources.spec.ts", import.meta.url);
  const compiled = await transform(readFileSync(file, "utf8"), { loader: "ts", format: "cjs" });
  runInNewContext(compiled.code, {
    exports: {}, Buffer,
    require(name: string) {
      if (name === "@playwright/test") return { test: register, expect };
      if (name === "node:fs/promises") return { mkdir: () => assert.fail("Browser test bodies must not run in the hook regression") };
      throw new Error(`Unexpected browser spec dependency: ${name}`);
    },
  }, { filename: file.pathname });
  assert.equal(before.length, 2, "Both desktop and mobile suites install the capture");
  assert.equal(after.length, before.length);
  for (let index = 0; index < before.length; index++) {
    const page = makePage();
    await before[index]({ page });
    for (const type of ["log", "info", "debug", "warning"]) page.emit("console", { type: () => type, text: () => `ordinary ${type}` });
    await after[index]({ page });
    page.emit("console", { type: () => "error", text: () => "console-only regression sentinel" });
    await assert.rejects(() => after[index]({ page }), /console-only regression sentinel/, "console.error alone must fail the actual browser afterEach");

    const exceptionPage = makePage();
    await before[index]({ page: exceptionPage });
    exceptionPage.emit("pageerror", new Error("uncaught regression sentinel"));
    await assert.rejects(() => after[index]({ page: exceptionPage }), /uncaught regression sentinel/, "Uncaught page errors must still fail");

    const cleanPage = makePage();
    await before[index]({ page: cleanPage });
    await after[index]({ page: cleanPage });
  }
});

test("source-type filter opens for the active type and preserves it in both paging links", () => {
  const document = parse(renderToStaticMarkup(createElement(QueueControls, {
    query: { view: "inbox", sourceKind: "research", q: "model", page: "2" },
    publishers: [], total: 60, page: 2, pageSize: 20, onFilter: () => {},
  })));
  const select = document.querySelector('select[name="sourceKind"]');
  assert.ok(select, "Source type filter is present");
  assert.equal(select.parentElement?.textContent?.startsWith("Source type"), true);
  assert.deepEqual([...select.querySelectorAll("option")].map(option => [option.getAttribute("value"), option.textContent]), [
    ["", "All source types"], ["company", "Company announcement"], ["journalism", "Journalism"], ["research", "Research blog"], ["community", "Community / tooling"],
  ]);
  assert.equal(select.querySelector("option[selected]")?.getAttribute("value"), "research");
  assert.ok(document.querySelector("details[open]"));
  for (const link of document.querySelectorAll('.desk-pager a')) {
    const url = new URL(link.getAttribute("href")!, "https://example.com");
    assert.equal(url.searchParams.get("sourceKind"), "research");
    assert.equal(url.searchParams.get("q"), "model");
  }
  assert.equal(document.querySelector('.desk-filters a')?.getAttribute("href"), "/editor?view=inbox");
});
