import { test, expect } from '@playwright/test';
import { XMLValidator } from 'fast-xml-parser';

test('RSS is discoverable on public pages and accessible from the mobile footer', async ({ page, request }, testInfo) => {
  for (const path of ['/', '/models', '/playground', '/learn']) {
    await page.goto(path);
    await expect(page.locator('head link[rel="alternate"][type="application/rss+xml"]'))
      .toHaveAttribute('href', /\/feed\.xml$/);
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Subscribe via RSS' }))
      .toHaveAttribute('href', '/feed.xml');
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Subscribe via RSS' });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await link.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('rss-footer-mobile.png') });
  }
  const response = await request.get('/feed.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/rss+xml');
  expect(XMLValidator.validate(await response.text())).toBe(true);
  const head = await request.head('/feed.xml');
  expect(head.status()).toBe(200);
  expect(await head.text()).toBe('');
  expect((await request.post('/feed.xml')).status()).toBe(405);
});
