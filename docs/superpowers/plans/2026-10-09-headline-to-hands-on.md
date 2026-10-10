# Headline to Hands-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make knowai the only AI news site where a newcomer can read a story, understand its jargon, try it on real models, and see what it would cost them.

**Architecture:** Three pure, unit-tested modules carry the logic:
- `src/lib/glossary.ts`: term matching
- `src/lib/playground-link.ts`: prompt links and the story prompt
- `src/lib/task-costs.ts`: task cost estimates

Thin components render them in existing surfaces: Brief cards, story pages, AI 101, the Playground and the Model Library. Catch me up adds one pure function to the reader-memory module from the retention plan.

**Tech Stack:** Next.js 16 App Router, React 19 (native `popover` / `popoverTarget` attributes), TypeScript, `node:test` via `tsx`, Playwright (public suite :3100; Brief fixture suite via `npm run test:brief`).

**Spec:** `docs/superpowers/specs/2026-10-09-headline-to-hands-on-design.md`

**Depends on:** `docs/superpowers/plans/2026-10-09-reader-retention.md`. Execute that plan first; only Task 6 here uses its interfaces (`useReaderMemory`, `newStoryIds`, `ReaderMemory`). Tasks 1–5 are independent of it.

## Global Constraints

- No new dependencies, vendors, migrations, env vars, or paid calls. Nothing sends a request without the reader pressing the existing run button.
- Glossary popovers are `<span popover="auto">` (valid inside `<p>`) and **never** carry `role="dialog"`. Never annotate one-liners or headings. Never annotate in the editor preview.
- Prompt cap **4,000** characters; times-per-day clamp **1–10,000**; month = **30** days; cheapest list size **3**.
- All copy is verbatim from the spec (glossary table, presets table, quoted UI strings, story prompt template).
- Touch targets ≥ 44px; no horizontal overflow at 320px; keyboard reachable; the existing j/k, depth, digest, RSS and cost-accounting behavior is unchanged.
- Read `node_modules/next/dist/docs/` before changing page conventions (AGENTS.md). After `npm run test:brief`, run `npm run build` again before the public suite.
- Branch: continue on `feat/reader-retention`, or branch `feat/headline-to-hands-on` from it.

## Review Focus

1. **The glossary's always-present popovers.** j/k card navigation must keep working while they exist. → Task 2 test `j/k still moves between cards with glossary terms present`.
2. **Text where a term sits inside a longer word** (`tokenizer`, `ragged`), or appears as a lowercase acronym (`rag`, `api`). These must not be annotated. → Task 1 test `does not match inside longer words or lowercase acronyms`.
3. **A hostile or oversized shared link** (`?prompt=` with 5,000 characters, control characters, `<script>`). It must be capped, shown as plain text and never run. → Task 3 tests `promptFromParams cleans and caps` and `a prompt link pre-fills but never sends`.
4. **Estimator inputs: models with a context window too small for the task, free models, and junk "times per day" values.** These must not appear as cheapest; junk values clamp. → Task 5 tests `cheapestPaid excludes free and too-small models` and `clampPerDay`.
5. **Story text containing quotes, `&`, `#`, curly apostrophes and newlines.** It must survive the Playground link unchanged. → Task 4 test `storyPrompt round-trips through a playground link`.

---

### Task 1: Glossary data and matcher

**Files:**
- Create: `src/data/glossary.json`, `src/lib/glossary.ts`
- Test: `tests/glossary.test.ts`

**Interfaces:**
- Produces:
  - `type GlossaryTerm = { id: string; term: string; aliases: string[]; definition: string }`
  - `type GlossarySegment = string | { termId: string; text: string }`
  - `glossary: GlossaryTerm[]` (the JSON, typed)
  - `annotateSections(sections: string[], terms?: GlossaryTerm[]): GlossarySegment[][]` (default `glossary`). Annotates the first occurrence of each term across all sections in order. Joining each section's segment texts reproduces the input exactly.
  - `termById(id: string): GlossaryTerm | undefined`

- [x] **Step 1: Write the failing tests** in `tests/glossary.test.ts`:

```ts
const found = (s: GlossarySegment[]) => s.filter((x) => typeof x !== "string").map((x: any) => [x.termId, x.text]);
const text = (s: GlossarySegment[]) => s.map((x) => (typeof x === "string" ? x : x.text)).join("");

test("glossary data is valid", () => {
  assert.equal(glossary.length, 19);
  assert.equal(new Set(glossary.map((t) => t.id)).size, 19);
  const aliases = glossary.flatMap((t) => t.aliases.map((a) => a.toLowerCase()));
  assert.equal(new Set(aliases).size, aliases.length);
  for (const t of glossary) { assert.ok(t.aliases.length > 0); assert.ok(Array.from(t.definition).length <= 200); }
});
test("matches whole words, plural aliases, and the longest alias first", () => {
  const [s] = annotateSections(["New API keys and APIs for every LLM."]);
  assert.deepEqual(found(s), [["api-key", "API keys"], ["api", "APIs"], ["llm", "LLM"]]);
});
test("does not match inside longer words or lowercase acronyms", () => {
  const [s] = annotateSections(["A tokenizer, a ragged rag, an api call, and agentic flows."]);
  assert.deepEqual(found(s), [["agent", "agentic"]]);
});
test("non-acronym aliases match case-insensitively and keep the original text", () => {
  assert.deepEqual(found(annotateSections(["Training Data matters."])[0]), [["training-data", "Training Data"]]);
});
test("annotates only the first occurrence per story across sections", () => {
  const [a, b] = annotateSections(["Tokens cost money.", "More tokens, more cost."]);
  assert.equal(found(a).length, 1);
  assert.equal(found(b).length, 0);
});
test("hyphens and punctuation are boundaries, and text is preserved exactly", () => {
  const input = "LLM-based tools (GPUs), data centres.";
  const [s] = annotateSections([input]);
  assert.deepEqual(found(s).map(([id]) => id), ["llm", "gpu", "data-center"]);
  assert.equal(text(s), input);
});
test("no terms returns the text unchanged", () => {
  assert.deepEqual(annotateSections(["Nothing here."], []), [["Nothing here."]]);
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/glossary.test.ts`
Expected: FAIL. `src/lib/glossary` cannot be resolved.

- [x] **Step 3: Create `src/data/glossary.json`** with exactly the 19 rows of the spec's glossary table (`id`, `term`, `aliases` array, `definition`).

- [x] **Step 4: Implement `src/lib/glossary.ts`**

Build one case-insensitive regex from all aliases, escaped and sorted longest first. Wrap it in `(?<![\p{L}\p{N}])(…)(?![\p{L}\p{N}])` with the `giu` flags. For each match:
- find the alias it equals case-insensitively
- if that alias is all capitals and the matched text is not identical to it, skip the match
- skip the match if the term was already seen

Keep a `Set` of seen ids across sections.

- [x] **Step 5: Run to verify pass**

Run: `npx tsx --test tests/glossary.test.ts && npm run typecheck`
Expected: 7 tests pass; no type errors.

- [x] **Step 6: Commit**

```bash
git add src/data/glossary.json src/lib/glossary.ts tests/glossary.test.ts
git commit -m "feat(glossary): add plain-English glossary and term matcher"
```

---

### Task 2: Glossary in Brief cards, story pages, and AI 101

**Files:**
- Create: `src/components/glossary-text.tsx`
- Modify: `src/components/brief-feed.tsx` (`BriefCard` short version, whole-picture paragraphs, why it matters), `src/app/brief/[slug]/page.tsx` (same three sections), `src/app/learn/page.tsx` (new Glossary section after the lessons, before the playground banner), `src/app/brief.css`
- Test: `tests/brief-reader.test.ts`, `tests/brief-e2e/hands-on.spec.ts` (new), `tests/e2e/hands-on-public.spec.ts` (new)

**Interfaces:**
- Consumes: `annotateSections`, `termById`, `glossary`, `GlossarySegment` (Task 1).
- Produces: `GlossaryText({ segments, scope }: { segments: GlossarySegment[]; scope: string }): JSX.Element`. It renders strings as text and terms as `<button type="button" className="glossary-term" popoverTarget={`${scope}-term-${termId}`}>` plus `<span popover="auto" id=… className="glossary-pop"><strong>{term}</strong> {definition} <a href={`/learn#term-${id}`}>More in the AI 101 glossary</a></span>`. It has no hooks, so it works in server and client components.

- [x] **Step 1: Write failing tests**

Unit (`brief-reader.test.ts`):
```ts
test("story copy gets glossary terms but one-liners and previews do not", () => {
  const s = { ...story, one_liner: "An LLM headline.", short_version: "A new LLM arrives with open weights." };
  const html = render([s], "2026-10-02");
  assert.match(html, /class="glossary-term"[^>]*>LLM</);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.match(html, /An LLM headline\./); // headline untouched
  assert.doesNotMatch(html.split("brief-headline")[1].split("</button>")[0], /glossary-term/);
  const preview = renderToStaticMarkup(createElement(BriefFeed, { stories: [s], initialDate: "2026-10-02", preview: true }));
  assert.doesNotMatch(preview, /glossary-term/);
});
```

Brief e2e (`hands-on.spec.ts`; `beforeEach` resets the fixture; `starters[1]` short version contains "training data"):
```ts
test("glossary term explains itself and links to AI 101", async ({ page }) => {
  await page.goto(`/brief/${starters[1].slug}`);
  const term = page.locator("#short .glossary-term", { hasText: "training data" });
  await term.click();
  const pop = page.locator(".glossary-pop:popover-open");
  await expect(pop).toContainText("The material a model learned from.");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await term.click();
  await page.locator(".glossary-pop:popover-open").getByRole("link", { name: "More in the AI 101 glossary" }).click();
  await expect(page).toHaveURL(/\/learn#term-training-data$/);
});
test("j/k still moves between cards with glossary terms present", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brief-card .glossary-term").first()).toBeAttached();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("j");
  await expect(page.locator(".brief-card").first()).toBeFocused();
  await page.keyboard.press("j");
  await expect(page.locator(".brief-card").nth(1)).toBeFocused();
});
```

Public e2e (`hands-on-public.spec.ts`):
```ts
test("AI 101 lists every glossary term with an anchor", async ({ page }) => {
  await page.goto("/learn#term-token");
  const section = page.getByRole("region", { name: "Glossary" });
  await expect(section.locator("dt")).toHaveCount(19);
  await expect(page.locator("#term-token")).toBeInViewport();
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test`, then `npm run test:brief`, then `npm run build && npx playwright test tests/e2e/hands-on-public.spec.ts`
Expected: the new unit test FAILS (no `glossary-term`). The two Brief tests FAIL. The AI 101 test FAILS (no Glossary region).

- [x] **Step 3: Implement `GlossaryText`**, then wire it in

In `BriefCard` and the story page, call `annotateSections([short_version, ...whole_picture, why_it_matters], preview ? [] : glossary)` once per story and pass each section's segments to `GlossaryText` with `scope={story.slug}`.

The AI 101 section is `<section aria-labelledby="glossary-title" id="glossary"><h2 id="glossary-title">Glossary</h2><dl>`, with one `<dt id="term-{id}">{term}</dt><dd>{definition}</dd>` per entry, in JSON order.

CSS:
- `.glossary-term` is inline, inherits font, and has a dotted underline in `--accent`. Give it a 44px minimum hit area via padding plus negative margin, so the line height doesn't change.
- `.glossary-pop` uses the `.notice` surface with `max-width: min(20rem, 90vw)`.

- [x] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test && npm run test:brief && npm run build && npx playwright test tests/e2e`
Expected: all pass, including the existing `brief.spec.ts` keyboard test and `site.spec.ts` mobile fit for `/learn`.

- [x] **Step 5: Commit**

```bash
git add src/components/glossary-text.tsx src/components/brief-feed.tsx "src/app/brief/[slug]/page.tsx" src/app/learn/page.tsx src/app/brief.css tests/brief-reader.test.ts tests/brief-e2e/hands-on.spec.ts tests/e2e/hands-on-public.spec.ts
git commit -m "feat(glossary): explain jargon inline in stories and list it in AI 101"
```

---

### Task 3: Prompt links into the Playground

**Files:**
- Create: `src/lib/playground-link.ts`
- Modify: `src/components/playground.tsx:52-70` (initial prompt state and notice)
- Test: `tests/playground-link.test.ts`, `tests/e2e/hands-on-public.spec.ts`

**Interfaces:**
- Produces:
  - `PROMPT_LIMIT = 4000`
  - `promptFromParams(params: Pick<URLSearchParams, "get">): string`
  - `playgroundHref(options: { models?: string[]; prompt?: string }): string`. Returns `/playground` plus `models` (comma-joined) and `prompt` query params, omitting empty ones.

- [ ] **Step 1: Write failing tests**

Unit:
```ts
test("promptFromParams cleans and caps", () => {
  const p = (v: string) => promptFromParams(new URLSearchParams({ prompt: v }));
  assert.equal(p("  hi\r\nthere\u0000\u0007\t! "), "hi\nthere\t!");
  assert.equal(Array.from(p("é".repeat(5000))).length, 4000);
  assert.equal(promptFromParams(new URLSearchParams()), "");
});
test("playgroundHref omits empty parts and encodes values", () => {
  assert.equal(playgroundHref({}), "/playground");
  const url = new URL(playgroundHref({ models: ["openai/gpt-4o-mini", "x/y"], prompt: "a & b #1" }), "http://x");
  assert.equal(url.searchParams.get("models"), "openai/gpt-4o-mini,x/y");
  assert.equal(url.searchParams.get("prompt"), "a & b #1");
});
```

Public e2e:
```ts
test("a prompt link pre-fills but never sends", async ({ page }) => {
  let calls = 0;
  await page.route("https://openrouter.ai/api/v1/chat/completions", (r) => { calls++; return r.abort(); });
  const prompt = '<script>window.__x=1</script> Explain tokens & "costs"';
  await page.goto(`/playground?prompt=${encodeURIComponent(prompt + "x".repeat(5000))}`);
  const box = page.getByRole("textbox").first();
  await expect(box).toHaveValue(new RegExp("^" + prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  expect(Array.from(await box.inputValue()).length).toBe(4000);
  await expect(page.getByText("Prompt loaded from a link. Read it first; nothing is sent until you start the comparison.")).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls).toBe(0);
  expect(await page.evaluate(() => (window as any).__x)).toBeUndefined();
});
```
(If the prompt textarea has an accessible name, use `getByRole("textbox", { name: … })` instead of `.first()`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/playground-link.test.ts`, then `npm run build && npx playwright test tests/e2e/hands-on-public.spec.ts`
Expected: unit FAILS (module missing); e2e FAILS (empty textarea).

- [ ] **Step 3: Implement**

Write `src/lib/playground-link.ts`. In `Playground`, initialize `prompt` with `useState(() => promptFromParams(params))` and a `fromLink` flag. Render the notice as `<p className="notice">` above the prompt box while `fromLink` is true. Don't add any auto-run path.

- [ ] **Step 4: Run to verify pass**

Run: `npm test && npm run build && npx playwright test tests/e2e`
Expected: all pass, including the existing `site.spec.ts` comparison and `models=` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playground-link.ts src/components/playground.tsx tests/playground-link.test.ts tests/e2e/hands-on-public.spec.ts
git commit -m "feat(playground): accept shareable prompt links without auto-running"
```

---

### Task 4: Ask AI models about this story

**Files:**
- Modify: `src/lib/playground-link.ts`, `src/components/brief-feed.tsx` (inside `.brief-full`, after the source link), `src/app/brief/[slug]/page.tsx` (after the source button), `src/app/brief.css`
- Test: `tests/playground-link.test.ts`, `tests/brief-reader.test.ts`, `tests/brief-e2e/hands-on.spec.ts`

**Interfaces:**
- Consumes: `playgroundHref`, `promptFromParams` (Task 3).
- Produces: `storyPrompt(story: Pick<BriefStory, "one_liner" | "short_version" | "source_name">): string`, returning the spec's template exactly.

- [ ] **Step 1: Write failing tests**

Unit (`playground-link.test.ts`):
```ts
test("storyPrompt follows the template exactly", () => {
  const p = storyPrompt({ source_name: "OpenAI", one_liner: "A.", short_version: "B." });
  assert.equal(p, 'I just read this AI news summary from knowai (source: OpenAI):\n\n"A. B."\n\nIn plain English:\n1. What does this change for an ordinary person or small business?\n2. What questions should I ask before believing or acting on it?\n3. What, if anything, here might be overstated or uncertain?\nKeep it under 200 words.');
});
test("storyPrompt round-trips through a playground link", () => {
  const p = storyPrompt({ source_name: "Hugging Face", one_liner: "It’s “new” & #1?", short_version: "50% off; a/b=c." });
  const url = new URL(playgroundHref({ prompt: p }), "http://x");
  assert.equal(promptFromParams(url.searchParams), p);
});
```

Unit (`brief-reader.test.ts`): `ask link appears in deep cards but not in preview`. Render with `initialDepth: "deep"` and assert `/Ask AI models about this story/` and `href="\/playground\?prompt=`. With `preview: true`, assert no match.

Brief e2e:
```ts
test("a story can be taken straight into the Playground", async ({ page }) => {
  await page.goto(`/brief/${starters[0].slug}`);
  await expect(page.getByText("Opens the Playground with this story as a prompt. You choose the models and decide whether to run it.")).toBeVisible();
  await page.getByRole("link", { name: "Ask AI models about this story" }).click();
  await expect(page).toHaveURL(/\/playground\?prompt=/);
  await expect(page.getByRole("textbox").first()).toHaveValue(new RegExp(starters[0].content.oneLiner.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`, then `npm run test:brief`
Expected: the new unit tests FAIL (`storyPrompt` not exported; no link in markup); the Brief e2e test FAILS.

- [ ] **Step 3: Implement `storyPrompt` and both placements**

Each placement renders `<a className="button secondary" href={playgroundHref({ prompt: storyPrompt(story) })}>` (use `Link` on the story page, `small-link` style in cards) with a `<p className="ask-help">` holding the helper text. Cards skip it when `preview`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test && npm run test:brief`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playground-link.ts src/components/brief-feed.tsx "src/app/brief/[slug]/page.tsx" src/app/brief.css tests/playground-link.test.ts tests/brief-reader.test.ts tests/brief-e2e/hands-on.spec.ts
git commit -m "feat(brief): let readers ask AI models about any story"
```

---

### Task 5: "What would it cost me?" estimator

**Files:**
- Create: `src/lib/task-costs.ts`, `src/components/cost-estimator.tsx`
- Modify: `src/components/model-library.tsx` (render after `.model-grid` / load-more, before the comparison tray), `src/app/globals.css`
- Test: `tests/task-costs.test.ts`, `tests/e2e/hands-on-public.spec.ts`

**Interfaces:**
- Consumes: `Model`, `ModelsData` (`src/lib/types.ts`); `playgroundHref` (Task 3); `dateLabel`.
- Produces:
  - `type TaskPreset = { id: string; label: string; inputTokens: number; outputTokens: number; samplePrompt: string }`
  - `taskPresets: TaskPreset[]` (the spec's 5 rows, in order)
  - `DAYS_PER_MONTH = 30`
  - `perUseCost(model: Pick<Model, "inputPrice" | "outputPrice">, preset: TaskPreset): number`
  - `monthlyCost(model, preset, perDay: number): number`
  - `clampPerDay(value: string | number): number`
  - `cheapestPaid(models: Model[], preset: TaskPreset, count?: number): Model[]` (default 3)
  - `freeCapableCount(models: Model[], preset: TaskPreset): number`
  - `formatEstimate(value: number, floor: 0.01 | 0.0001): string`
  - `CostEstimator({ data, selected }: { data: ModelsData; selected: Model[] }): JSX.Element` (client)

- [ ] **Step 1: Write failing tests**

Unit (`task-costs.test.ts`):
```ts
const m = (id: string, inputPrice: number, outputPrice: number, contextLength = 128000) => ({ id, name: id, inputPrice, outputPrice, contextLength }) as Model;
const preset = { id: "t", label: "t", inputTokens: 500, outputTokens: 200, samplePrompt: "p" };
test("costs match the AI 101 worked example", () => {
  assert.equal(perUseCost(m("a", 1, 3), preset).toFixed(4), "0.0011");
  assert.equal(monthlyCost(m("a", 1, 3), preset, 10).toFixed(2), "0.33");
});
test("cheapestPaid excludes free and too-small models, sorts by cost then name, limits to 3", () => {
  const models = [m("free", 0, 0), m("tiny", 0.01, 0.01, 600), m("b", 1, 1), m("a", 1, 1), m("c", 2, 2), m("d", 3, 3)];
  assert.deepEqual(cheapestPaid(models, preset).map((x) => x.id), ["a", "b", "c"]);
  assert.equal(freeCapableCount([...models, m("free-small", 0, 0, 100)], preset), 1);
});
test("clampPerDay", () => {
  assert.deepEqual(["", "abc", 0, -5, 2.7, 20000, "12"].map(clampPerDay), [1, 1, 1, 1, 3, 10000, 12]);
});
test("formatEstimate", () => {
  assert.equal(formatEstimate(0, 0.01), "Free");
  assert.equal(formatEstimate(0.004, 0.01), "<$0.01");
  assert.equal(formatEstimate(1234.5, 0.01), "$1,234.50");
  assert.equal(formatEstimate(0.00004, 0.0001), "<$0.0001");
  assert.equal(formatEstimate(0.0011, 0.0001), "$0.0011");
});
test("presets match the spec", () => {
  assert.deepEqual(taskPresets.map((p) => [p.id, p.inputTokens, p.outputTokens]),
    [["email", 600, 120], ["support", 1200, 250], ["article", 300, 1400], ["document", 12000, 400], ["code", 1500, 600]]);
});
```

Public e2e:
```ts
test("the cost estimator prices an everyday task without an account", async ({ page }) => {
  await page.goto("/models");
  const est = page.getByRole("region", { name: "What would it cost me?" });
  await est.getByLabel("Task").selectOption({ label: "Summarize an email" });
  await est.getByLabel("Times per day").fill("abc");
  await est.getByLabel("Times per day").blur();
  await expect(est.getByLabel("Times per day")).toHaveValue("1");
  const table = est.getByRole("table", { name: "Cheapest paid models for this task" });
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(est).toContainText("Real costs vary with length, reasoning, and caching.");
  const tryIt = table.getByRole("link", { name: /Try it/ }).first();
  expect(await tryIt.getAttribute("href")).toMatch(/^\/playground\?models=[^&]+&prompt=Summarize/);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/task-costs.test.ts`, then `npm run build && npx playwright test tests/e2e/hands-on-public.spec.ts`
Expected: unit FAILS (module missing); e2e FAILS (region not found).

- [ ] **Step 3: Implement `src/lib/task-costs.ts`**

Format with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`, using 2 or 4 fraction digits to match `floor`.

- [ ] **Step 4: Implement `CostEstimator` and render it in `ModelLibrary`**

Root: `<section aria-labelledby=…>` with `<h2>What would it cost me?</h2>` and the spec's intro, free note and disclaimer.

Controls:
- `Task` select listing the presets
- `Times per day` number input with `min=1 max=10000`. Clamp on blur and on change; keep the raw text while typing.

Results:
- `<table>`s with `<caption>`. A `Try it` link per row, with an accessible name ``Try it with ${model.name}``.
- The `Your selected models` table appears only when `selected.length > 0`, built from `ModelLibrary`'s selected ids.

On narrow screens, rows stack as cards so 320px doesn't overflow.

- [ ] **Step 5: Run to verify pass**

Run: `npm run typecheck && npm test && npm run build && npx playwright test tests/e2e`
Expected: PASS, including the existing model-library and mobile-fit tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/task-costs.ts src/components/cost-estimator.tsx src/components/model-library.tsx src/app/globals.css tests/task-costs.test.ts tests/e2e/hands-on-public.spec.ts
git commit -m "feat(models): estimate monthly cost of everyday tasks without an account"
```

---

### Task 6: Catch me up

**Files:**
- Modify: `src/lib/reader-memory.ts`, `src/components/brief-feed.tsx`, `src/app/brief.css`
- Test: `tests/reader-memory.test.ts`, `tests/brief-e2e/hands-on.spec.ts`

**Interfaces:**
- Consumes (retention plan): `useReaderMemory(enabled)`, `ReaderMemory`, and the `BriefCard` `marker` prop.
- Produces: `catchUpStories<T extends Pick<BriefStory, "id" | "published_at">>(stories: T[], previousVisit: string | null): T[]`. Returns stories with `Date.parse(published_at) > Date.parse(previousVisit)`, newest first; `[]` when `previousVisit` is null.

- [ ] **Step 1: Write failing tests**

Unit:
```ts
test("catchUpStories spans editions, newest first, and is empty on a first visit", () => {
  const s = [{ id: "a", published_at: "2026-10-01T00:00:00Z" }, { id: "b", published_at: "2026-10-05T00:00:00+00:00" },
             { id: "c", published_at: "2026-10-03T00:00:00Z" }];
  assert.deepEqual(catchUpStories(s, "2026-10-02T00:00:00Z").map((x) => x.id), ["b", "c"]);
  assert.deepEqual(catchUpStories(s, null), []);
});
```

Brief e2e (seeds memory exactly as in the retention plan's `retention.spec.ts`, with `lastVisit: "2026-10-03T00:00:00Z", welcomeDismissed: true`):
```ts
test("catch me up gathers everything since the last visit and returns focus", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("button", { name: "Catch me up: 4 new stories since Oct 3, 2026" });
  await open.click();
  const region = page.getByRole("region", { name: "Since your last visit" });
  await expect(region.locator(".brief-card")).toHaveCount(4);
  await expect(region.getByRole("heading", { name: "Since your last visit" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Briefing edition" })).toBeHidden();
  await page.getByRole("button", { name: "Back to the briefing" }).click();
  await expect(open).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Briefing edition" })).toBeVisible();
});
test("no catch-up on a first visit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Catch me up/ })).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/reader-memory.test.ts`, then `npm run test:brief`
Expected: unit FAILS (`catchUpStories` not exported); both e2e tests run, and the first FAILS (button missing).

- [ ] **Step 3: Implement**

Add `catchUpStories`. In `BriefFeed`, add `catchingUp` state. Build the button label with `dateLabel(memory.previousVisit)` and the singular/plural `story`/`stories` per the spec. Place the button in `.brief-toolbar`.

While catching up:
- render `<section aria-labelledby="catch-up-title">` with `<h2 id="catch-up-title" tabIndex={-1}>` in place of the featured section and `.brief-list`
- hide `.brief-controls` filters and the edition picker
- keep cards at the current depth, with markers

Move focus with refs after the state change. Hide everything in `preview`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test && npm run test:brief`
Expected: PASS, including all `retention.spec.ts` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reader-memory.ts src/components/brief-feed.tsx src/app/brief.css tests/reader-memory.test.ts tests/brief-e2e/hands-on.spec.ts
git commit -m "feat(brief): catch returning readers up on everything since their last visit"
```

---

### Task 7: Docs and full verification

**Files:**
- Modify: `README.md` ("What works"), `docs/roadmap.md`

- [ ] **Step 1: Update docs**

- README "What works": add bullets for the glossary layer, prompt links, "Ask AI models about this story", the cost estimator and Catch me up. State that none of them send requests or store data.
- Roadmap:
  - add "R12. Headline to hands-on — implemented locally; rollout pending", with checked items per task
  - mark R06's "Deep-link to a pack/prompt" item as done via `?prompt=`
  - list the spec's "Later" items (Receipts, Who should care, Model changelog, Editor-picked Try it) as unchecked, each with the decision it needs

- [ ] **Step 2: Run the full validation**

Run: `npm run typecheck && npm test && npm run test:brief && npm run build && npx playwright test`
Expected: all unit/db tests, all Brief fixture tests, the build and all public e2e tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/roadmap.md
git commit -m "docs: document the headline-to-hands-on features"
```
