import { test, expect } from "@playwright/test";
import starters from "../../src/data/editorial-starters.json" with { type: "json" };

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4310/_fixture/reset");
});

test("catch me up gathers stories across editions and returns focus", async ({ page, request }, testInfo) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: null, lastVisit: "2026-10-03T00:00:00Z", previousVisit: null, read: [], welcomeDismissed: true }));
    }
  });
  expect((await request.post("http://127.0.0.1:4310/_fixture/cross-edition")).ok()).toBe(true);
  await page.goto("/");
  const open = page.getByRole("button", { name: "Catch me up: 4 new stories since Oct 3, 2026" });
  await expect(open).toBeVisible();
  await expect(page.locator(".brief-list .brief-card")).toHaveCount(2);
  const region = page.getByRole("region", { name: "Since your last visit" });
  await open.click();
  await expect(region.getByRole("heading", { name: "Since your last visit" })).toBeFocused();
  await expect(region.locator(".brief-card")).toHaveCount(4);
  await expect(region.locator(".brief-card .brief-headline")).toHaveText([
    starters[2].content.oneLiner, starters[3].content.oneLiner,
    starters[0].content.oneLiner, starters[1].content.oneLiner,
  ]);
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
  expect((await request.post("http://127.0.0.1:4310/_fixture/reset")).ok()).toBe(true);
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
