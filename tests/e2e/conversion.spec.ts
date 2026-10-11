import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("homepage introduces the promise with a direct follow action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI news everyone can understand.");
  await expect(page.locator(".page-heading").getByRole("link", { name: "Get The Brief", exact: true })).toHaveAttribute("href", "/follow");
});

test("follow page is usable on a narrow phone with keyboard and clipboard access", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/follow");
  await page.getByRole("button", { name: "Copy feed address" }).click();
  await expect(page.getByRole("status")).toHaveText("Feed address copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.getByRole("textbox", { name: "Feed address" }).inputValue());
  await page.getByRole("button", { name: "Copied", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Feed address" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "View raw RSS feed" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  }
});

test("follow page explains reader setup and passes the canonical feed to reader apps", async ({ page, request }) => {
  await page.goto("/follow");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get The Brief. Keep making sense of AI.");
  await expect(page.getByRole("main")).toContainText("A feed reader is an app that collects new stories from sites you follow.");
  await expect(page.getByRole("main")).toContainText("Email delivery is not available yet.");
  const feedUrl = await page.locator('link[rel="alternate"][type="application/rss+xml"]').getAttribute("href");
  const feedly = new URL((await page.getByRole("link", { name: "Follow in Feedly" }).getAttribute("href"))!);
  expect(feedly.origin).toBe("https://feedly.com");
  expect(decodeURIComponent(feedly.pathname)).toBe(`/i/subscription/feed/${feedUrl}`);
  const inoreader = new URL((await page.getByRole("link", { name: "Follow in Inoreader" }).getAttribute("href"))!);
  expect(inoreader.origin).toBe("https://www.inoreader.com");
  expect(inoreader.searchParams.get("add_feed")).toBe(feedUrl);
  await expect(page.getByRole("link", { name: "View raw RSS feed" })).toHaveAttribute("href", "/feed.xml");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("/follow</loc>");
  await page.getByRole("link", { name: "Read the latest Brief" }).click();
  await expect(page).toHaveURL("/");
});

test("each main destination has its own search and social description", async ({ page }) => {
  const descriptions = new Set<string>();
  for (const [path, title] of [
    ["/", "AI news everyone can understand"],
    ["/learn", "AI 101"],
    ["/models", "Model Library"],
    ["/playground", "Playground"],
    ["/follow", "Follow The Brief"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(title));
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute("content", /.+/);
    const value = (await description.getAttribute("content"))!;
    descriptions.add(value);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", value);
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute("content", value);
    const canonical = new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!);
    expect(canonical.pathname).toBe(path);
    const socialUrl = new URL((await page.locator('meta[property="og:url"]').getAttribute("content"))!);
    expect(socialUrl.href).toBe(canonical.href);
  }
  expect(descriptions.size).toBe(5);
});

test("AI 101 offers a way to keep learning without connecting an AI account", async ({ page }) => {
  await page.goto("/learn");
  const follow = page.getByRole("region", { name: "Follow The Brief" });
  await follow.getByRole("link", { name: "Choose how to follow" }).click();
  await expect(page).toHaveURL("/follow");
  await expect(page.getByRole("main")).toContainText("No knowai account is needed.");
});

test("reading pages lead to follow while Playground keeps connection controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Get The Brief", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Connect OpenRouter", exact: true })).toHaveCount(0);
  await header.getByRole("link", { name: "Get The Brief", exact: true }).click();
  await expect(page).toHaveURL("/follow");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Explore knowai" });
  await menu.getByRole("link", { name: "Get The Brief", exact: true }).click();
  await expect(menu).toBeHidden();
  await page.goto("/");
  const card = page.getByRole("region", { name: "Follow The Brief" });
  await expect(card.getByRole("link", { name: "Choose how to follow" })).toHaveAttribute("href", "/follow");
  await page.goto("/playground");
  await header.getByRole("button", { name: "Connect OpenRouter", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your key to exploring AI." })).toBeVisible();
});

test("follow page keeps the feed address usable even when clipboard access is denied", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } }));
  await page.goto("/follow");
  await page.getByRole("button", { name: "Copy feed address" }).click();
  const input = page.getByRole("textbox", { name: "Feed address" });
  await expect(input).toHaveValue(/\/feed\.xml$/);
  await expect(page.getByRole("status")).toContainText("Select and copy the feed address below.");
  await input.focus();
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd)).toBe((await input.inputValue()).length);
});
