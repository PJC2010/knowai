import { test, expect } from "@playwright/test";

const linkedPromptNotice =
  "Prompt loaded from a link. Read it first; nothing is sent until you start the comparison.";

test("a prompt link pre-fills inert text but never sends with a connected account", async ({ page }) => {
  let calls = 0;
  await page.route("https://openrouter.ai/api/v1/key", (route) =>
    route.fulfill({ status: 200, json: { data: { label: "Test key" } } }),
  );
  await page.route("https://openrouter.ai/api/v1/chat/completions", (route) => {
    calls++;
    return route.abort();
  });
  const prompt = '<script>window.__x=1</script> Explain tokens & "costs"';
  await page.goto(
    `/playground?models=openai%2Fgpt-4o-mini&prompt=${encodeURIComponent(prompt + "x".repeat(5000))}`,
  );
  const box = page.getByRole("textbox", { name: "Your prompt" });
  await expect(box).toHaveValue(
    new RegExp("^" + prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  expect(Array.from(await box.inputValue()).length).toBe(4000);
  await expect(page.getByText(linkedPromptNotice)).toBeVisible();
  await expect(page.getByLabel("Model A", { exact: true })).toHaveValue("openai/gpt-4o-mini");
  await page.getByRole("button", { name: "Connect to compare", exact: true }).click();
  await page.getByLabel("OpenRouter API key", { exact: true }).fill("test-only-not-a-real-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("You’re connected.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start exploring", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run model", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls).toBe(0);
  expect(await page.evaluate(() => (window as Window & { __x?: number }).__x)).toBeUndefined();
});

test("client-side prompt links update the box without resetting subsequent edits", async ({ page }) => {
  await page.goto("/playground?prompt=First%20link");
  const box = page.getByRole("textbox", { name: "Your prompt" });
  await expect(box).toHaveValue("First link");
  await box.fill("My own edits");
  await page.evaluate(() =>
    window.history.pushState(null, "", "/playground?prompt=Second%20link"),
  );
  await expect(box).toHaveValue("Second link");
  await box.fill("Keep these edits");
  await page.evaluate(() =>
    window.history.pushState(
      null,
      "",
      "/playground?prompt=Second%20link&models=openai%2Fgpt-4o-mini",
    ),
  );
  await expect(page.getByLabel("Model A", { exact: true })).toBeVisible();
  await expect(box).toHaveValue("Keep these edits");
});

test("AI 101 without a glossary hash stays at the start", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "A little knowledge. A lot more possibility." })).toBeInViewport();
  await expect(page.locator("#term-token")).not.toBeInViewport();
});

test("unknown glossary hashes do not move the Learn page", async ({ page }) => {
  await page.goto("/learn#term-not-in-glossary");
  await expect(page.getByRole("heading", { name: "A little knowledge. A lot more possibility." })).toBeInViewport();
});

test("AI 101 lists every glossary term with an anchor", async ({ page }) => {
  await page.goto("/learn#term-token");
  const section = page.getByRole("region", { name: "Glossary" });
  await expect(section.locator("dt")).toHaveCount(19);
  await expect(page.locator("#term-token")).toBeInViewport();
});
