import { test, expect } from "@playwright/test";

test("news categories and navigation work", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI news everyone can understand." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Research", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const tags = await page.locator(".news-card .category-tag").allTextContents();
  expect(tags.length).toBeGreaterThan(0);
  expect(tags.every((t) => t === "Research")).toBeTruthy();
  await page.getByRole("link", { name: "Model Library", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Find your kind of intelligence." }),
  ).toBeVisible();
});

test("model library finds models, displays details, and builds a comparison", async ({
  page,
}) => {
  await page.goto("/models");
  await page
    .getByRole("textbox", { name: "Search models" })
    .fill("gpt-4o-mini");
  await expect(page.locator(".model-card").first()).toBeVisible();
  await page.locator(".model-name-button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close model details" }).click();
  await page.locator(".select-model").first().click();
  await page.getByRole("link", { name: "Compare models", exact: true }).click();
  await expect(page.getByLabel("Model A", { exact: true })).toHaveValue(
    /gpt-4o-mini/,
  );
});

test("comparison uses direct API calls, shows actual costs and partial failure, and forgets key on refresh", async ({
  page,
}) => {
  const calls: Record<string, any>[] = [];
  await page.route("https://openrouter.ai/api/v1/key", (route) =>
    route.fulfill({ status: 200, json: { data: { label: "Test key" } } }),
  );
  await page.route(
    "https://openrouter.ai/api/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON();
      calls.push(body);
      expect(route.request().headers().authorization).toBe(
        "Bearer test-only-not-a-real-key",
      );
      if (body.model.startsWith("google/"))
        return route.fulfill({
          status: 429,
          json: { error: { message: "Rate limited" } },
        });
      return route.fulfill({
        status: 200,
        json: {
          choices: [
            {
              message: { content: "A useful **test response**." },
              finish_reason: "length",
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 45, cost: 0.000123 },
        },
      });
    },
  );
  await page.goto("/playground");
  await page
    .getByRole("button", { name: "Explain something", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to compare", exact: true })
    .click();
  await page
    .getByLabel("OpenRouter API key", { exact: true })
    .fill("test-only-not-a-real-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByText("You’re connected.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start exploring", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Compare models", exact: true })
    .click();
  await expect(page.locator(".response-body")).toContainText("test response");
  await expect(page.locator(".response-error")).toContainText("rate-limited");
  await expect(page.locator(".response-stats").first()).toContainText(
    "$0.000123",
  );
  await expect(page.locator(".truncation-note")).toContainText(
    "Output limit reached",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].messages).toEqual(calls[1].messages);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("test-only-not-a-real-key");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Connect to compare", exact: true }),
  ).toBeVisible();
});

test("verified OAuth callback exchanges once and cleans temporary state", async ({
  page,
}) => {
  let exchanges = 0;
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "knowai-oauth",
      JSON.stringify({
        state: "test-state",
        verifier: "test-verifier",
        created: Date.now(),
      }),
    ),
  );
  await page.route("https://openrouter.ai/api/v1/auth/keys", (route) => {
    exchanges++;
    expect(route.request().postDataJSON()).toEqual({
      code: "test-code",
      code_verifier: "test-verifier",
      code_challenge_method: "S256",
    });
    return route.fulfill({ status: 200, json: { key: "test-only-oauth-key" } });
  });
  await page.goto("/playground?code=test-code&state=test-state");
  await expect(
    page.getByText("You’re connected.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/playground");
  expect(exchanges).toBe(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("knowai-oauth")),
  ).toBeNull();
});

test("invalid OAuth state is rejected without exchanging a code", async ({
  page,
}) => {
  let exchanged = false;
  await page.route("https://openrouter.ai/api/v1/auth/keys", (route) => {
    exchanged = true;
    return route.fulfill({ status: 400, json: {} });
  });
  await page.goto("/playground?code=test-code&state=untrusted");
  await expect(page.getByRole("alert")).toContainText("could not be verified");
  await expect(page).toHaveURL("/playground");
  expect(exchanged).toBeFalsy();
});

test("mobile navigation and all pages fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("link", { name: "AI 101", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "A little knowledge. A lot more possibility.",
    }),
  ).toBeVisible();
  for (const path of ["/", "/models", "/playground", "/learn"]) {
    await page.goto(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});
