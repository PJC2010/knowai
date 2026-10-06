import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const title = (n: number) => `Fixture candidate ${n}`;
async function openCoverage(page: Page, n: number) {
  await page.goto(`/editor?q=${encodeURIComponent(title(n))}`, { waitUntil: 'domcontentloaded' });
  // Wait for the source-preview handler, not just the server-rendered button.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
    button.textContent?.startsWith('Source preview') && Object.keys(button).some(key => key.startsWith('__reactProps$'))));
  await page.locator('.desk-story').first().getByRole('button', { name: /Source preview/ }).click();
  const coverage = page.getByRole('region', { name: 'Related coverage', exact: true });
  await expect(coverage).toContainText('source in this private group');
  return coverage;
}
async function review(page: Page, n: number) {
  const coverage = page.getByRole('region', { name: 'Related coverage', exact: true });
  await coverage.getByRole('searchbox', { name: 'Find another stored article' }).fill(title(n));
  await coverage.getByRole('button', { name: 'Search coverage', exact: true }).click();
  await coverage.locator('.desk-event-search-result').filter({ hasText: title(n) }).getByRole('button', { name: 'Review merge', exact: true }).click();
  const preview = coverage.getByRole('region', { name: 'Review group merge', exact: true });
  await expect(preview.getByRole('button', { name: 'Confirm merge', exact: true })).toBeDisabled();
  return preview;
}
async function confirm(page: Page) {
  const preview = page.getByRole('region', { name: 'Review group merge', exact: true });
  await preview.getByLabel('I reviewed every source in both groups.').check();
  await preview.getByRole('button', { name: 'Confirm merge', exact: true }).click();
}

test.beforeEach(async ({ request, context }) => {
  await request.post('http://127.0.0.1:4310/_fixture/reset');
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'editor@example.test', email_confirmed_at: '2026-10-04T00:00:00Z' };
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.editor-fixture-signature`;
  await context.addCookies([{ name: 'sb-127-auth-token', value: `base64-${encode({ access_token: token, refresh_token: 'fixture-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user })}`, domain: '127.0.0.1', path: '/' }]);
});

test('merge preview shows both full groups and proposed lead before explicit confirmation on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const coverage = await openCoverage(page, 134);
  const preview = await review(page, 133);
  await expect(preview.getByRole('region', { name: 'Current group', exact: true })).toContainText(title(134));
  await expect(preview.getByRole('region', { name: 'Incoming group', exact: true })).toContainText(title(133));
  await expect(preview).toContainText('2 sources after merging');
  await expect(preview).toContainText(`Proposed lead: ${title(134)}`);
  await expect(preview.getByRole('link', { name: /Read original/ })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('merge-preview-phone.png'), fullPage: true });
  await preview.getByRole('button', { name: 'Cancel merge', exact: true }).click();
  await expect(coverage).toContainText('1 source in this private group');
  await review(page, 133);
  await confirm(page);
  await expect(coverage).toContainText('2 sources in this private group');
});

test('another editor session changing a group invalidates confirmation until explicit reload and fresh review', async ({ page, context }, testInfo) => {
  const publicBefore = await (await page.request.get('/api/brief')).text();
  const feedBefore = await (await page.request.get('/feed.xml')).text();
  const coverage = await openCoverage(page, 134);
  const initial = await review(page, 133);
  await initial.getByLabel('I reviewed every source in both groups.').check();
  const other = await context.newPage();
  try {
    const otherCoverage = await openCoverage(other, 133);
    await review(other, 132);
    await confirm(other);
    await expect(otherCoverage).toContainText('2 sources in this private group');
    await initial.getByRole('button', { name: 'Confirm merge', exact: true }).click();
    await expect(coverage.getByRole('alert')).toContainText('Nothing was merged');
    await expect(coverage.getByRole('button', { name: 'Confirm merge', exact: true })).toHaveCount(0);
    // A third read proves rejection left the target alone. No auto retry.
    const verifier = await context.newPage();
    await expect(await openCoverage(verifier, 134)).toContainText('1 source in this private group');
    await verifier.close();
    await page.screenshot({ path: testInfo.outputPath('merge-conflict.png'), fullPage: true });
    const reload = coverage.getByRole('button', { name: 'Reload groups', exact: true });
    await expect(reload).toBeVisible();
    await reload.click();
    const reloaded = coverage.getByRole('region', { name: 'Review group merge', exact: true });
    await expect(reloaded.getByRole('region', { name: 'Incoming group', exact: true })).toContainText(title(132));
    await expect(reloaded).toContainText('3 sources after merging');
    await expect(reloaded.getByLabel('I reviewed every source in both groups.')).not.toBeChecked();
    await expect(reloaded.getByRole('button', { name: 'Confirm merge', exact: true })).toBeDisabled();
    await confirm(page);
    await expect(coverage).toContainText('3 sources in this private group');
    await expect(page.getByText('0 / 10 attempts today')).toBeVisible();
    expect(await (await page.request.get('/api/brief')).text()).toBe(publicBefore);
    expect(await (await page.request.get('/feed.xml')).text()).toBe(feedBefore);
  } finally { await other.close(); }
});
