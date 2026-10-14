import { test, expect } from "@playwright/test";

test("a first-time visitor gets free models, a starter prompt, and a $0 path", async ({
  page,
}) => {
  await page.goto("/playground");
  await expect(page.getByText("Try it free. No card needed.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your prompt" })).not.toHaveValue("");
  await expect(page.locator(".model-select-card .free-tag")).toHaveCount(2);
  await expect(page.locator(".cost-estimate strong")).toContainText("Free");
  await page.getByRole("button", { name: "Connect to compare", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Your key to exploring AI." });
  await expect(dialog.getByText("$0 to start · no card needed")).toBeVisible();
  await expect(dialog.getByText("Sign in with OpenRouter", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Add a little credit")).toHaveCount(0);
});

test("a 402 offers a free switch, and returning visitors can reconnect in one click", async ({
  page,
}) => {
  await page.route("https://openrouter.ai/api/v1/key", (route) =>
    route.fulfill({ status: 200, json: { data: { label: "Test key" } } }),
  );
  await page.route("https://openrouter.ai/api/v1/chat/completions", (route) =>
    route.fulfill({ status: 402, json: { error: { code: 402, message: "Insufficient credits" } } }),
  );
  await page.goto("/playground?models=openai%2Fgpt-4o-mini");
  await page.getByRole("button", { name: "Connect to compare", exact: true }).click();
  await page.getByLabel("OpenRouter API key", { exact: true }).fill("test-only-not-a-real-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Start exploring", exact: true }).click();
  await page.getByRole("button", { name: "Run model", exact: true }).click();
  await expect(page.getByText("This model needs credits.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Add credits/ }).first()).toHaveAttribute(
    "href",
    "https://openrouter.ai/settings/credits",
  );
  await page.getByRole("button", { name: "Switch to a free model", exact: true }).click();
  await expect(page.locator(".model-select-card .free-tag")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("a free model");

  const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(storage).not.toContain("test-only-not-a-real-key");

  let authStarted = "";
  await page.route("https://openrouter.ai/auth**", (route) => {
    authStarted = route.request().url();
    return route.fulfill({ status: 200, body: "ok" });
  });
  await page.reload();
  await expect(page.getByText("Welcome back.")).toBeVisible();
  await page.getByRole("button", { name: "Reconnect OpenRouter", exact: true }).click();
  await expect.poll(() => authStarted).toContain("code_challenge_method=S256");
});
