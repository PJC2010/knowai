import { expect, type APIRequestContext, type Browser } from "@playwright/test";

const fixtureOrigin = "http://127.0.0.1:4310";
const appOrigin = "http://127.0.0.1:4311";
const seededRevision = "20000000-0000-4000-8000-000000000001";

// Local fixture only: use the actual authenticated editor action to invalidate
// the app's cached Brief after direct fixture SQL changes, then restore the feature.
export async function refreshFixtureBriefCache(browser: Browser, request: APIRequestContext) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== fixtureOrigin ||
      process.env.NEXT_PUBLIC_SITE_URL !== `${appOrigin}/`)
    throw new Error("Brief cache refresh is limited to the local fixture and app origins.");

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "editor@example.test", email_confirmed_at: "2026-10-04T00:00:00Z" };
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", role: "authenticated", exp: 4102444800 })}.editor-fixture-signature`;
  const context = await browser.newContext({ baseURL: appOrigin });
  try {
    await context.addCookies([{
      name: "sb-127-auth-token",
      value: `base64-${encode({ access_token: token, refresh_token: "fixture-refresh", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user })}`,
      domain: "127.0.0.1", path: "/",
    }]);
    const page = await context.newPage();
    await page.goto(`${appOrigin}/editor?view=published&id=${seededRevision}`);
    const panel = page.getByRole("region", { name: "Featured article of the week", exact: true });
    await panel.getByLabel("Week of", { exact: true }).fill("2026-09-28");
    await panel.getByRole("button", { name: "Feature this article", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Remove featured article", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Remove featured article", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Feature this article", exact: true })).toBeVisible();
    const response = await request.get(`${fixtureOrigin}/rest/v1/brief_publications?select=featured_week`, {
      headers: { apikey: "fixture-public-key", authorization: "Bearer fixture-public-key" },
    });
    expect(response.ok()).toBe(true);
    const rows = await response.json() as { featured_week: string | null }[];
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.featured_week === null)).toBe(true);
  } finally {
    await context.close();
  }
}
