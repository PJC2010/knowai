import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import starters from "../../src/data/editorial-starters.json" with { type: "json" };

const fixture = "http://127.0.0.1:4310";
const draftId = "10000000-0000-4000-8000-000000000001";
const publicationRevision = (index: number) =>
  `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const sourceChecks = "I checked the original source and the factual claims.";
const tierChecks = "I reviewed all three standalone versions, including the one-liner’s tone.";

async function login(context: BrowserContext) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "editor@example.test",
    email_confirmed_at: "2026-10-04T00:00:00Z",
  };
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", role: "authenticated", exp: 4102444800 })}.editor-fixture-signature`;
  await context.addCookies([{
    name: "sb-127-auth-token",
    value: `base64-${encode({ access_token: token, refresh_token: "fixture-refresh", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user })}`,
    domain: "127.0.0.1",
    path: "/",
  }]);
}

async function publish(page: Page) {
  await page.getByRole("button", { name: "Start final review", exact: true }).click();
  await page.getByLabel(sourceChecks).check();
  await page.getByLabel(tierChecks).check();
  await page.getByRole("button", { name: "Approve and publish", exact: true }).click();
  await page.getByRole("button", { name: "Confirm publication", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create an editable revision", exact: true })).toBeVisible();
}

async function publication(page: Page, index = 0) {
  const response = await page.request.get("/api/brief");
  expect(response.ok()).toBe(true);
  return (await response.json()).stories.find((story: { slug: string }) => story.slug === starters[index].slug);
}

test.beforeEach(async ({ request, context }) => {
  await request.post(`${fixture}/_fixture/reset`);
  await login(context);
  await context.route("https://images.example.test/**", route =>
    route.fulfill({ path: "public/images/editorial.png", contentType: "image/png" }));
});

test("a saved draft keeps its selected source-image snapshot when source metadata changes", async ({ page, request }) => {
  const update = await request.patch(`${fixture}/rest/v1/brief_sources?id=eq.00000000-0000-4000-8000-000000000001`, {
    headers: { authorization: "Bearer fixture-service-key" },
    data: { source_image_url: "https://images.example.test/newer-article-image.png" },
  });
  expect(update.ok()).toBe(true);
  await page.goto(`/editor?view=drafts&id=${draftId}`);
  const imagePanel = page.getByRole("region", { name: "Story image", exact: true });
  await expect(imagePanel.locator("img")).toHaveAttribute("src", "https://images.example.test/article-1.png");
  await imagePanel.getByRole("textbox", { name: /^Image description/ }).fill("An updated description of the saved image");
  await imagePanel.getByRole("button", { name: "Save image", exact: true }).click();
  await expect(page.locator(".desk-work-actions")).toContainText("Version 2");
  await expect(imagePanel.locator("img")).toHaveAttribute("src", "https://images.example.test/article-1.png");
  await page.reload();
  await expect(imagePanel.locator("img")).toHaveAttribute("src", "https://images.example.test/article-1.png");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator(".brief-card-image")).toHaveAttribute("src", "https://images.example.test/article-1.png");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await imagePanel.getByRole("radio", { name: "No image", exact: true }).check();
  await imagePanel.getByRole("radio", { name: "Article image", exact: true }).check();
  await expect(imagePanel.locator("img")).toHaveAttribute("src", "https://images.example.test/newer-article-image.png");
  await imagePanel.getByRole("button", { name: "Save image", exact: true }).click();
  await expect(page.locator(".desk-work-actions")).toContainText("Version 3");
  await page.reload();
  await expect(imagePanel.locator("img")).toHaveAttribute("src", "https://images.example.test/newer-article-image.png");
  expect((await publication(page)).image_url).toBe("https://images.example.test/article-1.png");
});

test("article images preview by default, removal persists, and saving an image requires fresh publication review", async ({ page }) => {
  await page.goto(`/editor?view=drafts&id=${draftId}`);
  const imagePanel = page.getByRole("region", { name: "Story image", exact: true });
  await expect(imagePanel.getByRole("radio", { name: "Article image", exact: true })).toBeChecked();
  await expect(imagePanel.locator("img")).toBeVisible();
  const original = await publication(page);
  expect(original.image_url).toBeTruthy();

  await page.getByRole("button", { name: "Start final review", exact: true }).click();
  await page.getByLabel(sourceChecks).check();
  await page.getByLabel(tierChecks).check();
  await imagePanel.getByRole("radio", { name: "No image", exact: true }).check();
  await expect(page.getByRole("button", { name: "Approve and publish", exact: true })).toBeDisabled();
  await imagePanel.getByRole("button", { name: "Save image", exact: true }).click();
  await expect(page.locator(".desk-work-actions")).toContainText("Version 2");
  await expect(page.getByLabel(sourceChecks)).not.toBeChecked();
  await expect(page.getByLabel(tierChecks)).not.toBeChecked();
  expect((await publication(page)).image_url).toBe(original.image_url);

  await page.reload();
  await expect(imagePanel.getByRole("radio", { name: "No image", exact: true })).toBeChecked();
  await expect(imagePanel.locator("img")).toHaveCount(0);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator(".brief-card-image")).toHaveCount(0);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await imagePanel.getByRole("radio", { name: "Article image", exact: true }).check();
  await imagePanel.getByRole("textbox", { name: /^Image description/ }).fill("Article illustration selected by the editor");
  await imagePanel.getByRole("button", { name: "Save image", exact: true }).click();
  await expect(page.locator(".desk-work-actions")).toContainText("Version 3");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator(".brief-card-image")).toHaveAttribute("alt", "Article illustration selected by the editor");
  await publish(page);
  expect(await publication(page)).toMatchObject({ image_url: original.image_url, image_alt: "Article illustration selected by the editor" });
  await page.goto(`/brief/${starters[0].slug}`);
  await expect(page.locator(".story-page-image")).toHaveAttribute("alt", "Article illustration selected by the editor");
});

test("a story without an article image accepts an upload, persists it privately, and publishes it with the story", async ({ page }, testInfo) => {
  await page.goto(`/editor?view=published&id=${publicationRevision(2)}`);
  await page.getByRole("button", { name: "Create an editable revision", exact: true }).click();
  const imagePanel = page.getByRole("region", { name: "Story image", exact: true });
  await expect(imagePanel.getByRole("radio", { name: "Article image", exact: true })).toBeDisabled();
  await expect(imagePanel.locator("img")).toHaveCount(0);
  await imagePanel.getByRole("radio", { name: "Upload an image", exact: true }).check();
  // This local 2.1 MB PNG also checks that the server action accepts the documented upload size.
  await imagePanel.getByLabel(/^Choose image/).setInputFiles("public/images/editorial.png");
  await imagePanel.getByRole("textbox", { name: /^Image description/ }).fill("An editorial illustration uploaded for this story");
  await expect(imagePanel.locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and publish", exact: true })).toBeDisabled();
  await imagePanel.getByRole("button", { name: "Save image", exact: true }).click();
  await expect(page.locator(".desk-work-actions")).toContainText("Version 2");
  expect((await publication(page, 2)).image_url).toBeNull();
  await page.reload();
  await expect(imagePanel.getByRole("radio", { name: "Upload an image", exact: true })).toBeChecked();
  const preview = imagePanel.locator("img");
  await expect(preview).toHaveAttribute("src", /\/storage\/v1\/object\/public\/brief-images\//);
  await expect(preview).toHaveAttribute("alt", "An editorial illustration uploaded for this story");
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await imagePanel.screenshot({ path: testInfo.outputPath("editor-upload-preview-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await imagePanel.screenshot({ path: testInfo.outputPath("editor-upload-preview-mobile.png") });
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await publish(page);
  const uploaded = await publication(page, 2);
  expect(uploaded.image_url).toContain("/storage/v1/object/public/brief-images/");
  expect(uploaded.image_alt).toBe("An editorial illustration uploaded for this story");
  await page.goto(`/brief/${starters[2].slug}`);
  await expect(page.locator(".story-page-image")).toHaveAttribute("src", uploaded.image_url);
});

test("weekly features appear prominently for the edition week, replace one another, and can be removed", async ({ page }, testInfo) => {
  const feature = async (index: number, week: string) => {
    await page.goto(`/editor?view=published&id=${publicationRevision(index)}`);
    const panel = page.getByRole("region", { name: "Featured article of the week", exact: true });
    await panel.getByLabel("Week of", { exact: true }).fill(week);
    await panel.getByRole("button", { name: "Feature this article", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Remove featured article", exact: true })).toBeVisible();
    await expect.poll(async () => (await publication(page, index)).featured_week).toBe(week);
  };
  await feature(0, "2026-09-28");
  await page.goto("/?date=2026-10-04");
  const hero = page.locator(".brief-featured");
  await expect(hero).toHaveCount(1);
  await expect(hero).toContainText(starters[0].content.oneLiner);
  await expect(hero.locator(".brief-card-image")).toBeVisible();
  await expect(page.locator(".brief-card")).toHaveCount(4);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`brief-featured-${width}.png`), fullPage: true });
  }
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);

  await feature(1, "2026-09-28");
  expect((await publication(page, 0)).featured_week).toBeNull();
  await page.goto("/?date=2026-10-04");
  await expect(hero).toHaveCount(1);
  await expect(hero).toContainText(starters[1].content.oneLiner);
  await expect(hero).not.toContainText(starters[0].content.oneLiner);

  await feature(1, "2026-10-05");
  await page.goto("/?date=2026-10-04");
  await expect(hero).toHaveCount(0);
  await page.goto(`/editor?view=published&id=${publicationRevision(1)}`);
  await page.getByRole("button", { name: "Remove featured article", exact: true }).click();
  await expect.poll(async () => (await publication(page, 1)).featured_week).toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove featured article", exact: true })).toHaveCount(0);
});
