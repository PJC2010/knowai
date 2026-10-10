import { test, expect } from "@playwright/test";

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
  const address = card.getByRole("textbox", { name: "Feed address" });
  await expect(address).toHaveValue(/\/feed\.xml$/);
  await address.focus();
  expect(await address.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(0);
  expect(await address.evaluate((input: HTMLInputElement) => input.selectionEnd)).toBe((await address.inputValue()).length);
});

test("subscribe card fits phones and has 44px targets", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const card = page.getByRole("region", { name: "Follow The Brief" });
    await card.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const target of [card.getByRole("link", { name: "Open the RSS feed" }), card.getByRole("button", { name: "Copy feed address" })])
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("privacy explains on-device reading memory and clears it", async ({ page }) => {
  await page.goto("/privacy");
  await page.evaluate(() => {
    localStorage.setItem("knowai-reader", '{"v":1,"read":["a"]}');
    localStorage.setItem("unrelated", "keep");
  });
  const section = page.getByRole("region", { name: "Reading preferences on this device" });
  await expect(section).toContainText("never leave");
  await expect(section.getByRole("status")).toBeEmpty();
  await section.getByRole("button", { name: "Clear reading history on this device" }).click();
  await expect(section.getByRole("status")).toHaveText("Reading history cleared.");
  expect(await page.evaluate(() => localStorage.getItem("knowai-reader"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("unrelated"))).toBe("keep");
});

test("privacy clear control fits a 320px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/privacy");
  const section = page.getByRole("region", { name: "Reading preferences on this device" });
  const button = section.getByRole("button", { name: "Clear reading history on this device" });
  await expect(button).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("privacy does not claim clearing succeeded when storage refuses removal", async ({ page }) => {
  await page.addInitScript(() => {
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key === "knowai-reader") throw new DOMException("denied", "SecurityError");
      return removeItem.call(this, key);
    };
  });
  await page.goto("/privacy");
  await page.evaluate(() => localStorage.setItem("knowai-reader", '{"v":1,"read":["a"]}'));
  const section = page.getByRole("region", { name: "Reading preferences on this device" });
  await section.getByRole("button", { name: "Clear reading history on this device" }).click();
  await expect(section.getByRole("status")).toHaveText("Could not clear reading history. Clear this site’s browser data to remove it.");
  expect(await page.evaluate(() => localStorage.getItem("knowai-reader"))).not.toBeNull();
});
