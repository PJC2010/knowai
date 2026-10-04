import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import starters from "../../src/data/editorial-starters.json" with { type: "json" };

test("editor sign-in only contacts Supabase for allowed emails and explains delivery restrictions", async ({
  page,
  request,
}) => {
  const attempts = async () =>
    (await request.get("http://127.0.0.1:4310/_fixture/otp-requests")).json();
  const before = (await attempts()).length;
  await page.goto("/editor");
  await page.getByLabel("Editor email").fill("outsider@example.test");
  await page.getByRole("button", { name: "Send a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If this address is authorized",
  );
  expect((await attempts()).length).toBe(before);
  await page.getByLabel("Editor email").fill("editor@example.test");
  await page.getByRole("button", { name: "Send a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "email provider is restricting delivery",
  );
  const requests = await attempts();
  expect(requests).toHaveLength(before + 1);
  expect(requests.at(-1)).toMatchObject({
    email: "editor@example.test",
    create_user: false,
    redirect_to: "http://127.0.0.1:4311/editor/callback",
    code_challenge_method: "s256",
  });
  expect(requests.at(-1).code_challenge).toBeTruthy();
  await page.getByLabel("Editor email").fill("editor@example.test");
  await page.getByRole("button", { name: "Send a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Too many sign-in requests",
  );
  expect((await attempts()).length).toBe(before + 2);
});

test("normal is the default; individual expansion stays inline and global controls reset overrides", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.locator(".brief-card");
  await expect(cards).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Normal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(cards.first().locator(".brief-short")).toBeVisible();
  await expect(cards.first().locator(".brief-full")).toBeHidden();
  await cards
    .first()
    .getByRole("button", { name: "The whole picture", exact: true })
    .click();
  await expect(cards.first().locator(".brief-full")).toBeVisible();
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Quick scan", exact: true }).click();
  for (const card of await cards.all())
    await expect(card.locator(".brief-short")).toBeHidden();
  await cards.first().locator(".brief-headline").click();
  await expect(cards.first().locator(".brief-short")).toBeVisible();
  await page.getByRole("button", { name: "Deep", exact: true }).click();
  for (const card of await cards.all())
    await expect(card.locator(".brief-full")).toBeVisible();
  await page.reload();
  await expect(cards.first().locator(".brief-full")).toBeVisible();
});
test("keyboard navigation works without stealing controls, and digest includes the whole selected edition", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?depth=quick");
  await page.locator(".brief-card").first().waitFor();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("j");
  await expect(page.locator(".brief-card").nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(page.locator(".brief-card").nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(page.locator(".brief-card").nth(0)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    page.locator(".brief-card").first().locator(".brief-short"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator(".brief-card")).toHaveCount(1);
  await page.getByRole("button", { name: /Copy .*one-liners/ }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  for (const story of starters)
    expect(copied).toContain(story.content.oneLiner);
  expect(copied).toContain("depth=quick&date=2026-10-04");
  await page.getByRole("combobox", { name: "Briefing edition" }).focus();
  await page.keyboard.press("j");
  await expect(
    page.getByRole("combobox", { name: "Briefing edition" }),
  ).toBeFocused();
});
test("permanent pages expose all depths in server HTML and missing stories are not indexed", async ({
  page,
  request,
}) => {
  const slug = starters[0].slug;
  await page.goto(`/brief/${slug}#full`);
  await expect(page.locator("#full h2")).toHaveText("The whole picture");
  const response = await request.get(`/brief/${slug}`);
  const html = await response.text();
  expect(html).toContain(starters[0].content.shortVersion);
  expect(html).toContain(starters[0].content.wholePicture[0]);
  expect(html).toContain("application/ld+json");
  expect(html).toContain(
    `rel="canonical" href="http://127.0.0.1:4311/brief/${slug}"`,
  );
  const missing = await request.get("/brief/does-not-exist");
  // Next.js returns 200 when a parent loading boundary has already streamed.
  expect([200, 404]).toContain(missing.status());
  expect(await missing.text()).toContain('name="robots" content="noindex"');
  await page.goto("/brief/does-not-exist");
  await expect(
    page.getByRole("link", { name: "Back to The Brief", exact: true }),
  ).toBeVisible();
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    `/brief/${slug}`,
  );
  const publicData = await (await request.get("/api/brief")).text();
  expect(publicData).not.toContain("PRIVATE_CAPTURE");
  for (const story of JSON.parse(publicData).stories) {
    expect(story).not.toHaveProperty("evidence");
    expect(story).not.toHaveProperty("source_text");
    expect(story).not.toHaveProperty("reviewed_by");
  }
});
test("editor and cron deny unauthenticated access; public pages pass accessibility and mobile overflow checks", async ({
  page,
  request,
}) => {
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: "Send a sign-in link" }),
  ).toBeVisible();
  await expect(page.locator(".editor-form")).toHaveCount(0);
  expect((await request.get("/api/cron/editorial")).status()).toBe(401);
  for (const path of [
    "/?depth=quick",
    "/?depth=normal",
    "/?depth=deep",
    `/brief/${starters[0].slug}`,
  ]) {
    await page.goto(path);
    await page.locator("h1").waitFor();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
test("captures the new reading layouts", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const depth of ["normal", "quick", "deep"]) {
    await page.goto(`/?depth=${depth}`);
    await page.locator(".brief-card").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: testInfo.outputPath(`brief-${depth}.png`),
      fullPage: depth !== "deep",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?depth=normal");
  await page.locator(".brief-card").first().waitFor();
  await page.screenshot({
    path: testInfo.outputPath("brief-mobile.png"),
    fullPage: true,
  });
});
test("editor saves a correction privately, requires review, then publishes the saved version", async ({
  page,
  context,
}) => {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "editor@example.test",
    email_confirmed_at: "2026-10-04T00:00:00Z",
  };
  const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: user.id, aud: "authenticated", role: "authenticated", exp: 4102444800 })}.editor-fixture-signature`;
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: `base64-${encoded({ access_token: token, refresh_token: "fixture-refresh", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user })}`,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.goto("/editor?id=10000000-0000-4000-8000-000000000001");
  await expect(page.locator(".editor-form")).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Approve and publish" }),
  ).toBeDisabled();
  const revised =
    "Amazon says it ended data center NDAs with government agencies.";
  await page.getByRole("textbox", { name: /^The one-liner/ }).fill(revised);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("needs review · Revision version 2"),
  ).toBeVisible();
  const publicBefore = await page.request.get("/api/brief");
  expect(await publicBefore.text()).not.toContain(revised);
  await page
    .getByLabel("I checked the original source and the factual claims.")
    .check();
  await page
    .getByLabel(
      "I reviewed all three standalone versions, including the one-liner’s tone.",
    )
    .check();
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(
    page.getByRole("button", { name: "Create an editable revision" }),
  ).toBeVisible();
  await page.goto(`/brief/${starters[0].slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(revised);
});
