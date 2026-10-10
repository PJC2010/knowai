import { test, expect, type APIRequestContext } from "@playwright/test";
import starters from "../../src/data/editorial-starters.json" with { type: "json" };
import { refreshFixtureBriefCache } from "../helpers/refresh-fixture-brief-cache";

const fixtureOrigin = "http://127.0.0.1:4310";

async function fixturePublications(request: APIRequestContext) {
  const response = await request.get(`${fixtureOrigin}/rest/v1/brief_publications?select=slug,edition_date,published_at,featured_week&order=slug.asc`, {
    headers: { apikey: "fixture-public-key", authorization: "Bearer fixture-public-key" },
  });
  expect(response.ok()).toBe(true);
  return await response.json() as { slug: string; edition_date: string; published_at: string; featured_week: string | null }[];
}

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4310/_fixture/reset");
});

test("catch me up gathers stories across editions and returns focus", async ({ page, request, browser }, testInfo) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: null, lastVisit: "2026-10-03T00:00:00Z", previousVisit: null, read: [], welcomeDismissed: true }));
    }
  });
  // A previous process can leave a disk-backed cache from another fixture state.
  // Invalidate through the editor before deliberately warming the default edition.
  await refreshFixtureBriefCache(browser, request);
  await page.goto("/");
  await expect(page.locator(".brief-list .brief-card")).toHaveCount(4);
  const before = await fixturePublications(request);
  expect(before.map((row) => row.edition_date)).toEqual(Array(4).fill("2026-10-04"));
  try {
    expect((await request.post(`${fixtureOrigin}/_fixture/cross-edition`)).ok()).toBe(true);
    const changed = await fixturePublications(request);
    expect(changed.filter((row) => row.edition_date === "2026-10-05")).toHaveLength(2);
    await refreshFixtureBriefCache(browser, request);
    const after = await fixturePublications(request);
    expect(after.map((row) => row.published_at)).toEqual(changed.map((row) => row.published_at));
    await page.goto("/");
    const open = page.getByRole("button", { name: "Catch me up: 4 new stories since Oct 3, 2026" });
  await expect(open).toBeVisible();
  await expect(page.locator(".brief-list .brief-card")).toHaveCount(2);
  const region = page.getByRole("region", { name: "Since your last visit" });
  await open.click();
  await expect(region.getByRole("heading", { name: "Since your last visit" })).toBeFocused();
  await expect(region.locator(".brief-card")).toHaveCount(4);
  const headlines = await region.locator(".brief-card .brief-headline").allTextContents();
  // Both stories within each date share a published_at; only the date groups have an order.
  expect(headlines.slice(0, 2).sort()).toEqual([starters[2].content.oneLiner, starters[3].content.oneLiner].sort());
  expect(headlines.slice(2, 4).sort()).toEqual([starters[0].content.oneLiner, starters[1].content.oneLiner].sort());
  await expect(page.getByRole("combobox", { name: "Briefing edition" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Copy this edition’s one-liners" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All updates" })).toHaveCount(0);
  await expect(page.locator(".brief-toolbar p")).not.toContainText("2 stories");
  await expect(region.locator(".brief-card .glossary-term").first()).toBeAttached();
  await region.locator(".brief-card").first().focus();
  await page.keyboard.press("j");
  await expect(region.locator(".brief-card").nth(1)).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("catch-up-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to the briefing" }).click();
  await expect(open).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Briefing edition" })).toBeVisible();
  await expect(page.locator(".brief-list .brief-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Copy this edition’s one-liners" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await open.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("catch-up-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    expect((await request.post(`${fixtureOrigin}/_fixture/reset`)).ok()).toBe(true);
    await refreshFixtureBriefCache(browser, request);
  }
  await page.goto("/");
  await expect(page.locator(".brief-list .brief-card")).toHaveCount(4);
  await expect(page.getByRole("combobox", { name: "Briefing edition" }).locator("option")).toHaveCount(1);
  expect((await fixturePublications(request)).map((row) => row.edition_date)).toEqual(Array(4).fill("2026-10-04"));
});

test("no catch-up on a first visit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Catch me up/ })).toHaveCount(0);
});

test("a story can be taken straight into the Playground", async ({ page }) => {
  await page.goto(`/brief/${starters[0].slug}`);
  await expect(page.getByText("Opens the Playground with this story as a prompt. You choose the models and decide whether to run it.")).toBeVisible();
  await page.getByRole("link", { name: "Ask AI models about this story" }).click();
  await expect(page).toHaveURL(/\/playground\?prompt=/);
  await expect(page.getByRole("textbox").first()).toHaveValue(new RegExp(starters[0].content.oneLiner.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

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
  await expect(page.locator("#term-training-data")).toBeInViewport();
});

test("glossary controls are keyboard-operable and have non-overlapping touch targets", async ({ page }) => {
  await page.goto(`/brief/${starters[1].slug}`);
  const term = page.locator("#short .glossary-term", { hasText: "training data" });
  await expect(term).toBeVisible();
  await term.focus();
  await expect(term).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".glossary-pop:popover-open")).toContainText("The material a model learned from.");
  await page.keyboard.press("Escape");
  await expect(page.locator(".glossary-pop:popover-open")).toHaveCount(0);
  const box = await term.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("j/k still moves between cards with glossary terms present", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brief-card .glossary-term").first()).toBeAttached();
  await page.getByRole("button", { name: "Quick scan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quick scan", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Normal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("j");
  await expect(page.locator(".brief-card").first()).toBeFocused();
  await page.keyboard.press("j");
  await expect(page.locator(".brief-card").nth(1)).toBeFocused();
});
