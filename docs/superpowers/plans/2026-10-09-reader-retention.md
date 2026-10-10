# Reader Retention and First-Visit Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give first-time visitors a reason to return. Remember them on their device, explain the three-depth hook, make story pages lead to more reading, and make subscribing visible.

**Architecture:** A pure, unit-tested module (`src/lib/reader-memory.ts`) owns the `localStorage` format and visit rules. One client hook (`useReaderMemory`) is the only React entry point to it. `BriefFeed`, the story page and the privacy page consume the hook. A client `SubscribeCard` receives the canonical feed URL from server pages. Related stories come from the existing cached `getPublishedStories()` through a failure-safe helper.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `node:test` via `tsx`, Playwright (public suite on :3100; Brief fixture suite on :4311 via `npm run test:brief`).

**Spec:** `docs/superpowers/specs/2026-10-09-reader-retention-design.md`

## Global Constraints

- Storage key `knowai-reader`; value version `v: 1`; visit gap **30 minutes**; read list cap **200**; related stories limit **3**.
- No new dependencies, vendors, migrations, env vars, cookies, or network transmission of reader state.
- Server HTML must never contain memory-dependent markup. It renders only after hydration.
- `BriefFeed` with `preview` never reads or writes storage and renders no markers, welcome strip, or subscribe card.
- All copy is verbatim from the spec (quoted in the steps below). Use curly apostrophes where the spec does (`today’s`).
- Touch targets ≥ 44px; no horizontal overflow at 320px; keyboard reachable; existing j/k, per-card overrides, digest copy, featured week and RSS behavior unchanged.
- Read `node_modules/next/dist/docs/` before touching route/page conventions (AGENTS.md).
- Work on a new branch `feat/reader-retention` from `main`. `npm run test:brief` builds with fixture config, so run `npm run build` again before the public e2e suite.

## Review Focus

1. **A shared `?depth=quick` link opened by a reader whose saved depth is Deep.** The URL wins and does not overwrite the saved preference. → Task 3 test `URL depth wins and is not saved`.
2. **Storage that throws (Safari private mode, disabled storage).** The Brief renders as a first visit with no page errors, and dismissing the welcome strip still works for the session. → Task 4 test `storage that throws behaves as a first visit`.
3. **Supabase timestamps in `+00:00` form compared with stored `Z`/millisecond ISO strings.** "New" must compare instants, not strings. → Task 1 test `newStoryIds compares instants across ISO formats`.
4. **Editor preview mounting `BriefFeed`.** It must not create `knowai-reader` or show reader markers. → Task 3 adds an assertion to the existing editor-flow preview test.
5. **The story list failing to load while the single story loads.** The story page still renders without "Keep reading". → Task 6 test `safeRelatedStories returns [] when loading fails`.

---

### Task 1: Reader memory core

**Files:**
- Create: `src/lib/reader-memory.ts`
- Test: `tests/reader-memory.test.ts`

**Interfaces:**
- Consumes: `Depth`, `depths`, `BriefStory` from `src/lib/brief.ts`.
- Produces:
  - `READER_MEMORY_KEY = "knowai-reader"`, `VISIT_GAP_MS = 1_800_000`, `READ_LIMIT = 200`
  - `type ReaderMemory = { v: 1; depth: Depth | null; lastVisit: string | null; previousVisit: string | null; read: string[]; welcomeDismissed: boolean }`
  - `emptyMemory(): ReaderMemory`
  - `parseMemory(raw: string | null): ReaderMemory`
  - `beginVisit(memory: ReaderMemory, now: Date): ReaderMemory`
  - `markRead(memory: ReaderMemory, id: string): ReaderMemory`
  - `newStoryIds(stories: Pick<BriefStory, "id" | "published_at">[], previousVisit: string | null): Set<string>`
  - `browserStorage(): Storage | null`
  - `loadMemory(storage: Storage | null, fallback?: ReaderMemory): ReaderMemory`
  - `saveMemory(storage: Storage | null, memory: ReaderMemory): void`
  - `clearMemory(storage: Storage | null): void`

- [x] **Step 1: Write the failing tests** in `tests/reader-memory.test.ts` (`node:test` + `node:assert/strict`, same style as `tests/brief-reader.test.ts`):

```ts
test("parseMemory returns defaults for missing, corrupt, foreign and wrong-version values", () => {
  for (const raw of [null, "", "{", "[]", '"x"', '{"v":2,"depth":"deep"}'])
    assert.deepEqual(parseMemory(raw), emptyMemory());
});
test("parseMemory keeps valid fields and drops invalid ones individually", () => {
  const m = parseMemory(JSON.stringify({ v: 1, depth: "loud", lastVisit: "2026-10-01T00:00:00Z",
    previousVisit: 5, read: ["a", 3, "", "b"], welcomeDismissed: "yes" }));
  assert.deepEqual(m, { ...emptyMemory(), lastVisit: "2026-10-01T00:00:00Z", read: ["a", "b"] });
});
test("beginVisit starts a new visit after 30 minutes and keeps it within 30 minutes", () => {
  const first = beginVisit(emptyMemory(), new Date("2026-10-09T10:00:00Z"));
  assert.equal(first.previousVisit, null);
  assert.equal(first.lastVisit, "2026-10-09T10:00:00.000Z");
  const same = beginVisit(first, new Date("2026-10-09T10:29:59Z"));
  assert.equal(same.previousVisit, null);
  assert.equal(same.lastVisit, "2026-10-09T10:29:59.000Z");
  const next = beginVisit(same, new Date("2026-10-09T11:00:00Z"));
  assert.equal(next.previousVisit, "2026-10-09T10:29:59.000Z");
});
test("markRead deduplicates, keeps newest last, and caps at 200", () => {
  let m = emptyMemory();
  for (let i = 0; i < 205; i++) m = markRead(m, `s${i}`);
  assert.equal(m.read.length, 200);
  assert.equal(m.read[0], "s5");
  m = markRead(m, "s5");
  assert.equal(m.read.at(-1), "s5");
  assert.equal(m.read.filter((id) => id === "s5").length, 1);
});
test("newStoryIds is empty on a first visit and strict after previousVisit", () => {
  const stories = [{ id: "old", published_at: "2026-10-01T00:00:00Z" },
                   { id: "edge", published_at: "2026-10-02T00:00:00Z" },
                   { id: "new", published_at: "2026-10-03T00:00:00Z" }];
  assert.equal(newStoryIds(stories, null).size, 0);
  assert.deepEqual([...newStoryIds(stories, "2026-10-02T00:00:00.000Z")], ["new"]);
});
test("newStoryIds compares instants across ISO formats", () => {
  const stories = [{ id: "a", published_at: "2026-10-04T09:00:00+00:00" }];
  assert.equal(newStoryIds(stories, "2026-10-04T08:59:59.999Z").size, 1);
  assert.equal(newStoryIds(stories, "2026-10-04T09:00:00.000Z").size, 0);
});
test("storage helpers never throw and load the fallback when nothing is stored", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); },
                     removeItem() { throw new Error("denied"); } } as unknown as Storage;
  const fallback = { ...emptyMemory(), welcomeDismissed: true };
  assert.deepEqual(loadMemory(throwing, fallback), fallback);
  assert.deepEqual(loadMemory(null, fallback), fallback);
  assert.doesNotThrow(() => saveMemory(throwing, fallback));
  assert.doesNotThrow(() => clearMemory(throwing));
});
test("save then load round-trips through a Storage", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v),
                    removeItem: (k: string) => void map.delete(k) } as unknown as Storage;
  const m = markRead({ ...emptyMemory(), depth: "quick" }, "x");
  saveMemory(storage, m);
  assert.deepEqual(loadMemory(storage), m);
  clearMemory(storage);
  assert.equal(map.has(READER_MEMORY_KEY), false);
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/reader-memory.test.ts`
Expected: FAIL. The module `src/lib/reader-memory` cannot be resolved.

- [x] **Step 3: Implement `src/lib/reader-memory.ts`**

Use pure functions only, with no React. Compare dates with `Date.parse`. `beginVisit` writes `now.toISOString()`. A `lastVisit` that doesn't parse counts as "no previous visit". `loadMemory` returns `fallback` (default `emptyMemory()`) when storage is null, when `getItem` throws, or when the key is absent. Otherwise it returns `parseMemory(raw)`. `browserStorage()` wraps `window.localStorage` access in try/catch and returns `null` on the server or when access throws.

- [x] **Step 4: Run to verify pass**

Run: `npx tsx --test tests/reader-memory.test.ts && npm run typecheck`
Expected: all 8 tests pass; no type errors.

- [x] **Step 5: Commit**

```bash
git add src/lib/reader-memory.ts tests/reader-memory.test.ts
git commit -m "feat(reader): add on-device reader memory model"
```

---

### Task 2: Privacy disclosure and clear control

This lands before anything writes storage, so the disclosure ships first.

**Files:**
- Create: `src/components/clear-reader-memory.tsx`
- Modify: `src/app/privacy/page.tsx` (new section after "Prompts and model responses", before "Browsing knowai"; update the page description string on line 7 to mention reading preferences)
- Test: `tests/e2e/retention-public.spec.ts`

**Interfaces:**
- Consumes: `browserStorage`, `clearMemory`, `READER_MEMORY_KEY` (Task 1).
- Produces: `ClearReaderMemory(): JSX.Element` (client component).

- [x] **Step 1: Write the failing test** `privacy explains on-device reading memory and clears it`:

```ts
await page.goto("/privacy");
await page.evaluate(() => localStorage.setItem("knowai-reader", '{"v":1,"read":["a"]}'));
const section = page.getByRole("region", { name: "Reading preferences on this device" });
await expect(section).toContainText("never leave");
await section.getByRole("button", { name: "Clear reading history on this device" }).click();
await expect(page.getByRole("status")).toHaveText("Reading history cleared.");
expect(await page.evaluate(() => localStorage.getItem("knowai-reader"))).toBeNull();
```

- [x] **Step 2: Run to verify failure**

Run: `npm run build && npx playwright test tests/e2e/retention-public.spec.ts`
Expected: FAIL. The region "Reading preferences on this device" is not found.

- [x] **Step 3: Implement**

The section is `<section className="legal-section" aria-labelledby="reading-prefs">` with `<h2 id="reading-prefs">Reading preferences on this device</h2>`. Its copy states:
- knowai saves the reading depth you choose, when you last visited, which stories you have read, and whether you dismissed the welcome note
- the data is kept in this browser’s local storage under `knowai-reader` and never leaves your device or reaches knowai’s server
- clearing your browser data or using the button removes it

Then render `<ClearReaderMemory />`. The button shows status text in a `role="status"` element that is always rendered and starts empty.

- [x] **Step 4: Run to verify pass**

Run: `npm run build && npx playwright test tests/e2e/retention-public.spec.ts tests/e2e/site.spec.ts`
Expected: PASS (the existing mobile-fit test in `site.spec.ts` still passes for `/privacy`).

- [x] **Step 5: Commit**

```bash
git add src/components/clear-reader-memory.tsx src/app/privacy/page.tsx tests/e2e/retention-public.spec.ts
git commit -m "feat(privacy): disclose on-device reading memory with a clear control"
```

---

### Task 3: Reader memory in The Brief (depth, New, Read)

**Files:**
- Create: `src/components/use-reader-memory.ts`
- Modify: `src/components/brief-feed.tsx`, `src/app/page.tsx`, `src/app/brief.css`
- Test: `tests/brief-reader.test.ts`, `tests/brief-e2e/retention.spec.ts` (new), `tests/brief-e2e/editor-flow.spec.ts:92-112`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `useReaderMemory(enabled: boolean): { memory: ReaderMemory | null; update: (change: (m: ReaderMemory) => ReaderMemory) => void }`. `memory` is `null` until after mount, and always `null` when disabled. On mount (enabled) it runs `beginVisit(loadMemory(storage), new Date())`, saves, and sets state. `update` applies `change` to `loadMemory(storage, current)`, so it re-reads the latest stored value from other tabs and keeps in-memory state when storage is unavailable. It then saves and sets state. When disabled, `update` is a no-op.
  - `BriefFeed` new prop `depthFromUrl?: boolean` (default `false`).
  - `BriefCard` new prop `marker?: "new" | "read" | null`.

- [ ] **Step 1: Write failing tests**

In `tests/brief-reader.test.ts` add `server markup contains no reader-memory markers`:
```ts
const html = render([story], "2026-10-02");
assert.doesNotMatch(html, /brief-new|brief-read|new since your last visit/);
```
(This passes immediately. It guards against regressions; keep it.)

In `tests/brief-e2e/retention.spec.ts` (`beforeEach`: `request.post("http://127.0.0.1:4310/_fixture/reset")`; the fixture has 4 stories published `2026-10-04T09:00:00Z`):

```ts
test("chosen depth is remembered across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick scan", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Quick scan", exact: true })).toHaveAttribute("aria-pressed", "true");
});
test("URL depth wins and is not saved", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
    localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: "deep", lastVisit: null, previousVisit: null, read: [], welcomeDismissed: true })); } });
  await page.goto("/?depth=quick");
  await expect(page.getByRole("button", { name: "Quick scan", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Deep", exact: true })).toHaveAttribute("aria-pressed", "true");
});
test("stories published after the previous visit are marked New and counted", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
    localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: null, lastVisit: "2026-10-03T00:00:00Z", previousVisit: null, read: [], welcomeDismissed: true })); } });
  await page.goto("/");
  await expect(page.locator(".brief-card .brief-new")).toHaveCount(4);
  await expect(page.locator(".brief-toolbar p")).toContainText("4 new since your last visit");
});
test("expanding a story to Deep marks it Read and it persists", async ({ page }) => {
  await page.goto("/");
  const first = page.locator(".brief-card").first();
  await first.getByRole("button", { name: "The whole picture", exact: true }).click();
  await expect(first.locator(".brief-read")).toHaveText("Read");
  await page.getByRole("button", { name: "Deep", exact: true }).click();
  await expect(page.locator(".brief-read")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".brief-card").first().locator(".brief-read")).toBeVisible();
});
```

In `tests/brief-e2e/editor-flow.spec.ts`, inside `evidence links highlight exact text…`, right after the preview's `.brief-full` visibility assertion:
```ts
expect(await page.evaluate(() => localStorage.getItem("knowai-reader"))).toBeNull();
await expect(page.locator(".brief-new, .brief-read")).toHaveCount(0);
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test && npm run test:brief`
Expected: unit tests pass. In the Brief suite, `retention.spec.ts` tests fail (depth not remembered; `.brief-new` count 0; `.brief-read` missing). `editor-flow` passes.

- [ ] **Step 3: Implement `useReaderMemory` in `src/components/use-reader-memory.ts`** (`"use client"`), matching the Interfaces block.

- [ ] **Step 4: Wire into `BriefFeed`**

- Call `useReaderMemory(!preview)`.
- Apply the remembered depth once, when memory first arrives, only if `!depthFromUrl` and `memory.depth` is set. Use a ref so later updates don't re-apply it.
- The depth toggle's `onClick` also calls `update(m => ({ ...m, depth: value }))`.
- In `advance(id)`, when the computed next depth is `"deep"`, call `update(m => markRead(m, id))`. Global toggles never mark read.
- Compute `newIds = memory ? newStoryIds(stories, memory.previousVisit) : new Set()`. Each card's marker is `"new"` if in `newIds`, otherwise `"read"` if in `memory.read`, otherwise `null`.
- The toolbar `<p>` appends `` ` · ${n} new since your last visit` `` when `n > 0`, where `n` counts new ids among `featured` plus `filtered`.
- `BriefCard` renders `<span className="brief-new">New</span>` or `<span className="brief-read">Read</span>` right after the category tag.
- `page.tsx` passes `depthFromUrl` as `true` exactly when `query.depth` is a valid `Depth`.
- CSS: `.brief-new` uses the accent color on `--accent-ink`, shaped like `.category-tag`. `.brief-read` uses `--muted` text with no fill.

- [ ] **Step 5: Run to verify pass**

Run: `npm run typecheck && npm test && npm run test:brief`
Expected: all pass, including the existing `brief.spec.ts` "normal is the default…" test. That test starts with fresh storage, so it still gets Normal.

- [ ] **Step 6: Commit**

```bash
git add src/components/use-reader-memory.ts src/components/brief-feed.tsx src/app/page.tsx src/app/brief.css tests/brief-reader.test.ts tests/brief-e2e/retention.spec.ts tests/brief-e2e/editor-flow.spec.ts
git commit -m "feat(brief): remember depth and mark new and read stories on this device"
```

---

### Task 4: First-visit welcome strip

**Files:**
- Modify: `src/components/brief-feed.tsx`, `src/app/brief.css`
- Test: `tests/brief-e2e/retention.spec.ts`, `tests/brief-reader.test.ts`

**Interfaces:**
- Consumes: `useReaderMemory` (Task 3). The strip shows when `memory && memory.previousVisit === null && !memory.welcomeDismissed`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write failing tests**

Unit (`brief-reader.test.ts`): `server markup has no welcome strip`, using `assert.doesNotMatch(render([story], "2026-10-02"), /Welcome to The Brief|New here\?/)`.

E2E (`retention.spec.ts`):
```ts
test("first visit explains the three depths and Got it dismisses for good", async ({ page }) => {
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Welcome to The Brief" });
  await expect(strip).toContainText("Every story comes three ways: a one-liner, the short version, and the whole picture.");
  await strip.getByRole("button", { name: "Got it" }).click();
  await expect(strip).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Reading depth" }).locator('[aria-pressed="true"]')).toBeFocused();
  await page.reload();
  await expect(page.getByRole("region", { name: "Welcome to The Brief" })).toHaveCount(0);
});
test("a returning visit hides the welcome strip without dismissal", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
    localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: null, lastVisit: "2026-10-03T00:00:00Z", previousVisit: null, read: [], welcomeDismissed: false })); } });
  await page.goto("/");
  await expect(page.locator(".brief-card")).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Welcome to The Brief" })).toHaveCount(0);
});
test("storage that throws behaves as a first visit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } }));
  await page.goto("/");
  await expect(page.locator(".brief-card")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Normal", exact: true })).toHaveAttribute("aria-pressed", "true");
  const strip = page.getByRole("region", { name: "Welcome to The Brief" });
  await strip.getByRole("button", { name: "Got it" }).click();
  await expect(strip).toHaveCount(0);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:brief`
Expected: the three new tests FAIL (region not found).

- [ ] **Step 3: Implement**

Render `<section className="welcome-strip" aria-label="Welcome to The Brief">` between `.brief-controls` and the featured section. Copy is verbatim: `<strong>New here?</strong> Every story comes three ways: a one-liner, the short version, and the whole picture. Pick a depth above, and knowai will remember it on this device.` The `Got it` button calls `update(m => ({ ...m, welcomeDismissed: true }))`, then focuses the pressed depth button. Hold the toggle group in a ref so focus can move to it. Style it like `.notice`, with a 44px-tall button and wrapping at 320px.

- [ ] **Step 4: Run to verify pass**

Run: `npm test && npm run test:brief`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/brief-feed.tsx src/app/brief.css tests/brief-reader.test.ts tests/brief-e2e/retention.spec.ts
git commit -m "feat(brief): explain the three depths to first-time visitors"
```

---

### Task 5: Visible subscribe card

**Files:**
- Create: `src/components/subscribe-card.tsx`
- Modify: `src/components/icons.ts` (export Phosphor `Rss`), `src/components/brief-feed.tsx`, `src/components/newsroom.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Test: `tests/brief-reader.test.ts`, `tests/e2e/retention-public.spec.ts`

**Interfaces:**
- Consumes: `siteUrl()` from `src/lib/site-url.ts` (server side only, in `page.tsx`).
- Produces:
  - `SubscribeCard({ feedUrl }: { feedUrl: string }): JSX.Element` (client). Root `<section className="subscribe-card" aria-labelledby={useId()-based id}>` with `<h2>Follow The Brief</h2>`.
  - `BriefFeed` new prop `feedUrl?: string`. The card renders only when `feedUrl && !preview`, between the `.brief-reading` section and `.brief-next`.
  - `Newsroom` new required prop `feedUrl: string`. The card renders after `.latest-section`.
  - `page.tsx` passes `feedUrl={new URL("/feed.xml", siteUrl()).href}` to both.

- [ ] **Step 1: Write failing tests**

Unit (`brief-reader.test.ts`):
```ts
test("the subscribe card renders with the canonical feed and never in preview", () => {
  const props = { stories: [story], initialDate: "2026-10-02", feedUrl: "https://knowai.example/feed.xml" };
  const html = renderToStaticMarkup(createElement(BriefFeed, props));
  assert.match(html, /Follow The Brief/);
  assert.match(html, /href="\/feed.xml"/);
  assert.match(html, /New stories arrive in your feed reader after editorial review\. No account or email needed\./);
  assert.doesNotMatch(renderToStaticMarkup(createElement(BriefFeed, { ...props, preview: true })), /Follow The Brief/);
});
```

E2E (`retention-public.spec.ts`, legacy homepage):
```ts
test("legacy homepage subscribe card copies the feed address", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Follow The Brief" });
  await expect(card.getByRole("link", { name: "Open the RSS feed" })).toHaveAttribute("href", "/feed.xml");
  await card.getByRole("button", { name: "Copy feed address" }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(card.getByRole("status")).toHaveText("Feed address copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https?:\/\/.+\/feed\.xml$/);
});
test("subscribe card falls back to a selectable address when the clipboard fails", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } }));
  await page.goto("/");
  const card = page.getByRole("region", { name: "Follow The Brief" });
  await card.getByRole("button", { name: "Copy feed address" }).click();
  await expect(card.getByRole("textbox", { name: "Feed address" })).toHaveValue(/\/feed\.xml$/);
});
test("subscribe card fits phones and has 44px targets", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const card = page.getByRole("region", { name: "Follow The Brief" });
    await card.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const target of [card.getByRole("link", { name: "Open the RSS feed" }), card.getByRole("button", { name: "Copy feed address" })])
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` then `npm run build && npx playwright test tests/e2e/retention-public.spec.ts`
Expected: the new unit test FAILS (no "Follow The Brief"); the three new e2e tests FAIL (region not found).

- [ ] **Step 3: Implement `SubscribeCard`**, with copy verbatim from the spec:

- Body: `New stories arrive in your feed reader after editorial review. No account or email needed.`
- Link: `Open the RSS feed` (`href="/feed.xml" type="application/rss+xml"`).
- Button: `Copy feed address` → `Copied`, with status `Feed address copied.` On rejection, show `<label>Feed address <input readOnly value={feedUrl} /></label>`, selecting its text on focus.
- `<details><summary>New to RSS?</summary><p>A feed reader collects new posts from sites you follow. Paste the feed address into any reader app.</p></details>`
- Use the `Rss` icon, `aria-hidden`.
- Wire it into `BriefFeed`, `Newsroom` and `page.tsx` as described in Interfaces.

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test && npm run build && npx playwright test tests/e2e/retention-public.spec.ts tests/e2e/rss.spec.ts tests/e2e/site.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/subscribe-card.tsx src/components/icons.ts src/components/brief-feed.tsx src/components/newsroom.tsx src/app/page.tsx src/app/globals.css tests/brief-reader.test.ts tests/e2e/retention-public.spec.ts
git commit -m "feat(subscribe): show a visible RSS subscribe card on the Brief and homepage"
```

---

### Task 6: Story pages as entry points

**Files:**
- Create: `src/components/mark-story-read.tsx`
- Modify: `src/lib/brief.ts`, `src/app/brief/[slug]/page.tsx`, `src/app/brief.css`
- Test: `tests/brief.test.ts`, `tests/brief-e2e/retention.spec.ts`

**Interfaces:**
- Consumes: `useReaderMemory`, `markRead` (Tasks 1, 3); `SubscribeCard` (Task 5); `getPublishedStories()` (existing, `src/lib/editorial/published.ts`); `siteUrl()`.
- Produces:
  - `relatedStories(stories: BriefStory[], current: BriefStory, limit?: number): BriefStory[]` (default 3). Excludes `current.id`. Same-category stories come first, then the rest. Within each group, newest `Date.parse(published_at)` first; the sort is stable on ties.
  - `safeRelatedStories(current: BriefStory, load: () => Promise<BriefStory[]>, limit?: number): Promise<BriefStory[]>`. Returns `[]` when `load` rejects.
  - `MarkStoryRead({ id }: { id: string }): null` (client). Calls `update(m => markRead(m, id))` once, after memory arrives.

- [ ] **Step 1: Write failing unit tests** in `tests/brief.test.ts`:

```ts
const mk = (id: string, category: NewsCategory, published_at: string) => ({ ...base, id, slug: id, category, published_at }) as BriefStory;
test("relatedStories prefers the same category, newest first, excludes current, limits to 3", () => {
  const cur = mk("cur", "Models", "2026-10-05T00:00:00Z");
  const all = [cur, mk("r1", "Research", "2026-10-06T00:00:00Z"), mk("m1", "Models", "2026-10-01T00:00:00Z"),
               mk("m2", "Models", "2026-10-03T00:00:00+00:00"), mk("t1", "Tools", "2026-10-04T00:00:00Z")];
  assert.deepEqual(relatedStories(all, cur).map((s) => s.id), ["m2", "m1", "r1"]);
  assert.deepEqual(relatedStories([cur], cur), []);
});
test("safeRelatedStories returns [] when loading fails", async () => {
  assert.deepEqual(await safeRelatedStories(mk("cur", "Models", "2026-10-05T00:00:00Z"), () => Promise.reject(new Error("db down"))), []);
});
```
(`base` is a complete `BriefStory` literal; copy the shape of `story` in `tests/brief-reader.test.ts`.)

E2E (`retention.spec.ts`):
```ts
test("story pages lead to more reading, subscription, and the Brief", async ({ page, request }) => {
  const slug = starters[0].slug;
  const html = await (await request.get(`/brief/${slug}`)).text();
  expect(html).toContain("Keep reading");
  await page.goto(`/brief/${slug}`);
  const more = page.getByRole("region", { name: "Keep reading" }).getByRole("link");
  await expect(more).toHaveCount(3);
  for (const link of await more.all()) expect(await link.getAttribute("href")).not.toBe(`/brief/${slug}`);
  await expect(page.getByRole("region", { name: "Follow The Brief" })).toBeVisible();
  await expect(page.getByText("knowai explains AI news in plain English, at the depth you choose.")).toBeVisible();
  await page.getByRole("link", { name: "Read today’s Brief" }).click();
  await expect(page).toHaveURL("/");
  const card = page.locator(".brief-card", { has: page.locator(`#${slug}-title`) });
  await expect(card.locator(".brief-read")).toHaveText("Read");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` then `npm run test:brief`
Expected: unit tests FAIL (`relatedStories` not exported); the e2e test FAILS ("Keep reading" missing).

- [ ] **Step 3: Implement** `relatedStories` and `safeRelatedStories` in `src/lib/brief.ts`, and `MarkStoryRead`.

- [ ] **Step 4: Update the story page**

After the `#full` section, add:
- `<MarkStoryRead id={story.id} />`.
- When `related.length > 0`: `<section className="story-more" aria-labelledby="keep-reading-title"><h2 id="keep-reading-title">Keep reading</h2>…</section>`. Each item is a `Link` to `/brief/{slug}` containing the `.category-tag` and the one-liner.
- `<SubscribeCard feedUrl={new URL("/feed.xml", siteUrl()).href} />`.
- `<p className="story-about">knowai explains AI news in plain English, at the depth you choose. <Link href="/">Read today’s Brief</Link></p>`.

Get `related` with `await safeRelatedStories(story, getPublishedStories)`. Style `.story-more` items with the `.brief-next a` surface treatment, as a single column below 760px.

- [ ] **Step 5: Run to verify pass**

Run: `npm run typecheck && npm test && npm run test:brief`
Expected: PASS, including the existing `brief.spec.ts` permanent-page and `media-feature.spec.ts` story-page tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/brief.ts src/components/mark-story-read.tsx "src/app/brief/[slug]/page.tsx" src/app/brief.css tests/brief.test.ts tests/brief-e2e/retention.spec.ts
git commit -m "feat(story): add Keep reading, subscribe, and Brief links to story pages"
```

---

### Task 7: Docs and full verification

**Files:**
- Modify: `README.md` ("What works" and "Credentials and billing"/privacy wording), `docs/roadmap.md`

**Interfaces:** none.

- [ ] **Step 1: Update docs**

- README "What works": add a bullet **Returning readers:** on-device depth memory, New/Read markers, first-visit welcome, story-page Keep reading, and visible RSS subscribe card. It must say that nothing leaves the browser.
- README credentials paragraph: the sentence "does not store … in a database or browser storage" stays true for keys, prompts and responses. Add one sentence naming `knowai-reader` and linking to Privacy.
- `docs/roadmap.md`: add "R11. Returning-reader experience — implemented locally; rollout pending" with checked items per task, and an unchecked release gate: "verify on the deployed site after the Brief rollout (R01 gate)".

- [ ] **Step 2: Run the full validation**

Run: `npm run typecheck && npm test && npm run test:brief && npm run build && npx playwright test`
Expected: all unit/db tests pass, all Brief fixture tests pass, the production build succeeds, and all public e2e tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/roadmap.md
git commit -m "docs: document the returning-reader experience"
```
