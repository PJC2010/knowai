import { test, expect } from '@playwright/test';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import starters from '../../src/data/editorial-starters.json' with { type: 'json' };

test('RSS contains only published stories and retains discovery on canonical article pages', async ({ page, request }) => {
  const response = await request.get('/feed.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/rss+xml');
  expect(response.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
  const xml = await response.text();
  expect(XMLValidator.validate(xml)).toBe(true);
  expect(xml).not.toMatch(/PRIVATE_CAPTURE|source_text|reviewed_by|fixture-candidate|fixture-service-key/);
  const channel = new XMLParser({ ignoreAttributes: false, isArray: name => name === 'item' }).parse(xml).rss.channel;
  const { stories } = await (await request.get('/api/brief')).json();
  expect(channel.item).toHaveLength(stories.length);
  for (const story of stories) {
    const item = channel.item.find((i: {link: string}) => i.link.endsWith(`/brief/${story.slug}`));
    expect(item.title).toBe(story.one_liner);
    expect(item.pubDate).toBe(new Date(story.published_at).toUTCString());
    expect(item.guid['#text']).toBe(item.link);
  }
  expect(await (await request.get('/feed.xml')).text()).toBe(xml);
  for (const path of ['/', `/brief/${starters[0].slug}`]) {
    // A non-JavaScript feed reader must see discovery in the initial head,
    // including when Next streams per-article metadata into the body.
    const html = await (await request.get(path)).text();
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
    expect(head).toContain('type="application/rss+xml"');
    await page.goto(path);
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(1);
    await expect(page.locator('head link[rel="alternate"][type="application/rss+xml"]'))
      .toHaveAttribute('href', 'http://127.0.0.1:4311/feed.xml');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Subscribe via RSS' }))
      .toHaveAttribute('href', '/feed.xml');
  }
  await expect(page.locator('link[rel="canonical"]'))
    .toHaveAttribute('href', `http://127.0.0.1:4311/brief/${starters[0].slug}`);
});
