import { test, expect } from "@playwright/test";

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
