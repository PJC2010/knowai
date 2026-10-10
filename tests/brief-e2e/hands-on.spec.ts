import { test, expect } from "@playwright/test";
import starters from "../../src/data/editorial-starters.json" with { type: "json" };

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4310/_fixture/reset");
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
