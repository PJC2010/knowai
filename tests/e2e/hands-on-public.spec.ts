import { test, expect } from "@playwright/test";

test("AI 101 lists every glossary term with an anchor", async ({ page }) => {
  await page.goto("/learn#term-token");
  const section = page.getByRole("region", { name: "Glossary" });
  await expect(section.locator("dt")).toHaveCount(19);
  await expect(page.locator("#term-token")).toBeInViewport();
});
