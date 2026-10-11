import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("reader layouts remain accessible without horizontal overflow", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (const path of ["/", "/brief/amazon-data-center-ndas"]) {
    await page.goto(path);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  }
});

test("story arrivals get context and a follow option before the deep dive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/brief/amazon-data-center-ndas");
  await expect(page.locator(".story-intro")).toContainText("AI knowledge everyone can understand.");
  await expect(page.getByRole("link", { name: "Read The Brief", exact: true })).toHaveAttribute("href", /\/\?date=/);
  const follow = page.getByRole("complementary", { name: "Keep up with The Brief" });
  await expect(follow.getByRole("link", { name: "Get The Brief", exact: true })).toHaveAttribute("href", "/follow");
  expect((await follow.boundingBox())!.y).toBeLessThan((await page.locator("#full").boundingBox())!.y);
  await follow.getByRole("link", { name: "Get The Brief", exact: true }).click();
  await expect(page).toHaveURL("/follow");
});

test("first-time readers see the promise and a complete story headline in the phone viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI news everyone can understand.");
  const hero = page.locator(".brief-hero");
  await expect(hero.getByRole("link", { name: "Get The Brief", exact: true })).toHaveAttribute("href", "/follow");
  await expect(hero).toContainText("Written with AI, checked by a human editor.");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("region", { name: "Welcome to The Brief" })).toBeVisible();
  const first = page.locator(".brief-card").first();
  const headline = first.locator("h3");
  const box = (await headline.boundingBox())!;
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  const filterBox = (await page.getByRole("button", { name: "Research", exact: true }).boundingBox())!;
  expect(filterBox.y).toBeGreaterThan(box.y + box.height);
  await expect(page.getByRole("complementary", { name: "Keep up with The Brief" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("homepage-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".brief-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Research", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tools", exact: true })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Briefing edition" })).toBeVisible();
});
