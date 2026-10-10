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

test("the cost estimator prices an everyday task without an account", async ({ page }) => {
  await page.goto("/models");
  const est = page.getByRole("region", { name: "What would it cost me?" });
  await est.getByLabel("Task").selectOption({ label: "Summarize an email" });
  await est.getByLabel("Times per day").fill("");
  await est.getByLabel("Times per day").blur();
  await expect(est.getByLabel("Times per day")).toHaveValue("1");
  const table = est.getByRole("table", { name: "Cheapest paid models for this task" });
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(est).toContainText("Real costs vary with length, reasoning, and caching.");
  const status = await page.locator(".catalog-status").innerText();
  if (status.includes("Saved catalog")) {
    await expect(est).toContainText(`saved catalog from ${status.split(" · ")[1]}`);
  } else {
    await expect(est).toContainText("live OpenRouter catalog");
  }
  const tryIt = table.getByRole("link", { name: /Try it/ }).first();
  expect(await tryIt.getAttribute("href")).toMatch(/^\/playground\?models=[^&]+&prompt=Summarize/);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("selected models show estimates, including free ones and task limits", async ({ page }) => {
  await page.goto("/models");
  const est = page.getByRole("region", { name: "What would it cost me?" });
  await expect(est.getByRole("table", { name: "Your selected models" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search models" }).fill("Ling 3.1 Flash");
  await page.getByRole("button", { name: "Compare Ling 3.1 Flash" }).click();
  const selected = est.getByRole("table", { name: "Your selected models" });
  await expect(selected).toContainText("Ling 3.1 Flash");
  await expect(selected).toContainText("Free");
  await page.getByRole("textbox", { name: "Search models" }).fill("Hy-MT2-1.8B");
  await page.getByRole("button", { name: "Compare Hy-MT2-1.8B" }).click();
  await est.getByLabel("Task").selectOption("document");
  await expect(selected.getByRole("row", { name: /Hy-MT2-1.8B/ })).toContainText("Unavailable");
  await expect(selected.getByRole("row", { name: /Hy-MT2-1.8B/ }).getByRole("link")).toHaveCount(0);
  await expect(selected.getByRole("link", { name: "Try it with Ling 3.1 Flash" })).toHaveAttribute("href", /prompt=Summarize/);
  await page.getByRole("button", { name: "Remove Hy-MT2-1.8B" }).click();
  await page.getByRole("textbox", { name: "Search models" }).fill("Ling 3.1 Flash");
  await page.getByRole("button", { name: "Remove Ling 3.1 Flash" }).click();
  await expect(selected).toHaveCount(0);
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
