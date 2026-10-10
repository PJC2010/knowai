import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4310/_fixture/reset");
});

test("first visit explains the three depths and Got it dismisses for good", async ({ page }, testInfo) => {
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Welcome to The Brief" });
  await expect(strip).toContainText("Every story comes three ways: a one-liner, the short version, and the whole picture.");
  await page.screenshot({ path: testInfo.outputPath("welcome-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("welcome-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await strip.getByRole("button", { name: "Got it" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
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

test("chosen depth is remembered across reloads and a URL-free visit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick scan", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Quick scan", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Quick scan", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("URL depth wins and is not saved", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: "deep", lastVisit: null, previousVisit: null, read: [], welcomeDismissed: true }));
    }
  });
  await page.goto("/?depth=quick");
  await expect(page.getByRole("button", { name: "Quick scan", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Deep", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("stories published after the previous visit are marked New and counted", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: null, lastVisit: "2026-10-03T00:00:00Z", previousVisit: null, read: [], welcomeDismissed: true }));
    }
  });
  await page.goto("/");
  await expect(page.locator(".brief-card .brief-new")).toHaveCount(4);
  await expect(page.locator(".brief-toolbar p")).toContainText("4 new since your last visit");
  await page.screenshot({ path: testInfo.outputPath("markers-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("markers-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".brief-card .brief-new")).toHaveCount(1);
  await expect(page.locator(".brief-toolbar p")).toContainText("1 new since your last visit");
});

test("catch-up counts and marks the visible list rather than the selected category", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("knowai-reader", JSON.stringify({ v: 1, depth: null, lastVisit: "2026-10-03T00:00:00Z", previousVisit: null, read: [], welcomeDismissed: true }));
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".brief-card .brief-new")).toHaveCount(1);
  await expect(page.locator(".brief-toolbar p")).toContainText("1 new since your last visit");
  await page.getByRole("button", { name: /Catch me up: 4 new stories/ }).click();
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
