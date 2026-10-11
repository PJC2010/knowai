import { test, expect, type Page } from "@playwright/test";

async function openMobileMenu(page: Page, path = "/") {
  await page.goto(path);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Explore knowai" });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("mobile navigation accessibility", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Escape closes the menu and returns focus to its trigger", async ({
    page,
  }) => {
    const menu = await openMobileMenu(page);
    await menu
      .getByRole("link", { name: "Model Library", exact: true })
      .focus();
    await page.keyboard.press("Escape");

    await expect(menu).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open menu", exact: true }),
    ).toBeFocused();
  });

  test("Tab and Shift+Tab wrap within the open menu", async ({ page }) => {
    const menu = await openMobileMenu(page);
    const firstControl = menu.getByRole("link", { name: "knowai home" });
    const lastControl = menu.getByRole("link", {
      name: "Get The Brief",
      exact: true,
    });

    await firstControl.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(lastControl).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(firstControl).toBeFocused();
    await expect(menu).toBeVisible();
  });

  test("connecting from the Playground menu opens a usable connection dialog", async ({
    page,
  }) => {
    const menu = await openMobileMenu(page, "/playground");
    await menu
      .getByRole("button", { name: "Connect OpenRouter", exact: true })
      .click();

    await expect(menu).not.toBeVisible();
    const connection = page.getByRole("dialog", {
      name: "Your key to exploring AI.",
      exact: true,
    });
    await expect(connection).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    const keyField = connection.getByLabel("OpenRouter API key", {
      exact: true,
    });
    await keyField.fill("test-only-not-a-real-key");
    await expect(keyField).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      connection.getByRole("button", { name: "Connect", exact: true }),
    ).toBeFocused();

    await connection
      .getByRole("button", { name: "Close connection dialog" })
      .click();
    await expect(connection).not.toBeVisible();
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(menu).toBeVisible();
  });
});

test("footer legal links lead to readable pages with a path back home", async ({
  page,
}) => {
  await page.goto("/");

  for (const destination of [
    { label: "Privacy", path: "/privacy", heading: "Privacy, explained." },
    { label: "Terms", path: "/terms", heading: "A few things to know." },
  ]) {
    await page
      .getByRole("contentinfo")
      .getByRole("link", {
        name: destination.label,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(destination.path);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: destination.heading,
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "Back to the newsroom", exact: true })
      .click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "AI news everyone can understand." }),
    ).toBeVisible();
  }
});

test("reduced motion leaves every reveal section readable before scrolling", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/learn");
  await expect(
    page.getByRole("heading", {
      name: "A little knowledge. A lot more possibility.",
    }),
  ).toBeVisible();

  const sections = page.locator("[data-reveal]");
  expect(await sections.count()).toBeGreaterThan(0);
  for (const section of await sections.all()) {
    await expect(section).toBeVisible();
    // Playwright visibility alone accepts opacity: 0; check readability too.
    await expect(section).toHaveCSS("opacity", "1");
  }

  const lastSection = sections.last();
  await lastSection.scrollIntoViewIfNeeded();
  await expect(
    lastSection.getByRole("heading", {
      name: "Ready for a little experiment?",
    }),
  ).toBeVisible();
});
