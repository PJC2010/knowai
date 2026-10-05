import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { BriefStory } from '../src/lib/brief';
import { renderBriefRss } from '../src/lib/brief-rss';

const origin = 'https://knowai.example';
const story = (overrides: Partial<BriefStory> = {}): BriefStory => ({
  id: 'fixture-id', slug: 'fixture-story', category: 'Research',
  source_url: 'https://openai.com/news/fixture', source_name: 'OpenAI',
  source_published_at: '2026-10-01T08:00:00Z',
  one_liner: 'A clearly labelled fixture headline.',
  short_version: 'A fixture summary, not real reporting.', whole_picture: ['Fixture full context.'],
  why_it_matters: 'A fixture explanation of the stakes.',
  published_at: '2026-10-04T09:00:00Z', updated_at: '2026-10-04T10:00:00Z',
  edition_date: '2026-10-04', ...overrides,
});
test('RSS is deterministic, newest first and bounded to 50 unique story permalinks', () => {
  const stories = Array.from({ length: 55 }, (_, i) => story({
    id: `fixture-${i}`, slug: `fixture-${i}`,
    published_at: new Date(Date.UTC(2026, 9, 4, 9, i)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 9, 4, 9, i)).toISOString(),
  }));
  const before = structuredClone(stories);
  const xml = renderBriefRss([...stories, stories[54]], origin);
  const items = parse(xml).channel.item;
  assert.equal(items.length, 50);
  assert.equal(items[0].link, origin + '/brief/fixture-54');
  assert.equal(items.at(-1).link, origin + '/brief/fixture-5');
  assert.equal(new Set(items.map((item: {link: string}) => item.link)).size, 50);
  assert.deepEqual(stories, before);
  assert.equal(xml, renderBriefRss([...stories].reverse(), origin));
  const revised = story({ one_liner: 'Revised headline.', updated_at: '2026-10-05T10:00:00Z' });
  const originalChannel = parse(renderBriefRss([story()], origin)).channel;
  const revisedChannel = parse(renderBriefRss([revised], origin)).channel;
  assert.deepEqual(revisedChannel.item[0].guid, originalChannel.item[0].guid);
  assert.equal(revisedChannel.item[0].pubDate, originalChannel.item[0].pubDate);
  assert.equal(revisedChannel.lastBuildDate, new Date(revised.updated_at).toUTCString());
  assert.ok(Date.parse(revisedChannel.lastBuildDate) > Date.parse(originalChannel.lastBuildDate));
});

test('RSS escapes text and embedded description HTML without leaking private fields', () => {
  const input = {
    ...story({
      one_liner: 'Research & <tools> "quoted" 😀\u0000\u000b\ud800',
      short_version: '<img src=x onerror=alert(1)> & ]]> a "quote"',
      why_it_matters: '<script>alert(1)</script>', source_name: 'A & B <img src=x>',
      source_url: 'https://openai.com/news/fixture?x=1&y=%22',
    }),
    source_text: 'PRIVATE_CAPTURE', evidence: ['PRIVATE_EVIDENCE'], reviewed_by: 'PRIVATE_EDITOR',
  };
  const xml = renderBriefRss([input], origin);
  assert.doesNotMatch(xml, /[\u0000\u000b\ud800]/u);
  assert.doesNotMatch(xml, /PRIVATE_CAPTURE|PRIVATE_EVIDENCE|PRIVATE_EDITOR|<!\[CDATA\[/);
  const item = parse(xml).channel.item[0];
  assert.equal(item.title, 'Research & <tools> "quoted" 😀');
  assert.ok(item.description.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(item.description.includes('&lt;script&gt;'));
  assert.ok(item.description.includes('x=1&amp;y=%22'));
  assert.doesNotMatch(item.description, /<img|<script/);
});

test('equal publication times use stable slug ordering across query order changes', () => {
  const stories = ['z-story', 'a-story', 'm-story'].map(slug => story({ slug }));
  const xml = renderBriefRss(stories, origin);
  assert.equal(xml, renderBriefRss([...stories].reverse(), origin));
  assert.deepEqual(parse(xml).channel.item.map((item: {link: string}) => item.link),
    ['a-story', 'm-story', 'z-story'].map(slug => `${origin}/brief/${slug}`));
});

test('empty RSS is valid and does not invent a publication date', () => {
  const xml = renderBriefRss([], origin + '/');
  const channel = parse(xml).channel;
  assert.equal(channel.item, undefined);
  assert.equal(channel.lastBuildDate, undefined);
  assert.equal(channel['atom:link']['@_href'], origin + '/feed.xml');
  assert.equal(xml, renderBriefRss([], origin));
});

test('RSS refuses unsafe links and invalid dates instead of emitting malformed items', () => {
  for (const invalid of [
    { slug: '../editor' }, { slug: 'x?preview=true' },
    { source_url: 'javascript:alert(1)' }, { source_url: 'https://name:secret@openai.com/' },
    { published_at: 'invalid' }, { updated_at: 'invalid' },
  ]) assert.throws(() => renderBriefRss([story(invalid)], origin));
  for (const invalid of ['javascript:alert(1)', 'https://user:secret@knowai.example']) {
    assert.throws(() => renderBriefRss([story()], invalid));
  }
});

const parse = (xml: string) => {
  assert.equal(XMLValidator.validate(xml), true);
  return new XMLParser({ ignoreAttributes: false, isArray: name => name === 'item' }).parse(xml).rss;
};

test('RSS exposes approved story summaries with stable permalinks, dates and attribution', () => {
  const input = story();
  const rss = parse(renderBriefRss([input], origin));
  assert.equal(rss['@_version'], '2.0');
  const channel = rss.channel;
  assert.equal(channel.title, 'knowai — The Brief');
  assert.equal(channel.link, origin + '/');
  assert.equal(channel['atom:link']['@_href'], origin + '/feed.xml');
  assert.equal(channel['atom:link']['@_rel'], 'self');
  const item = channel.item[0];
  assert.equal(item.title, input.one_liner);
  assert.equal(item.link, origin + '/brief/fixture-story');
  assert.equal(item.guid['#text'], item.link);
  assert.equal(item.guid['@_isPermaLink'], 'true');
  assert.equal(item.pubDate, 'Sun, 04 Oct 2026 09:00:00 GMT');
  assert.equal(channel.lastBuildDate, 'Sun, 04 Oct 2026 10:00:00 GMT');
  assert.equal(item.category, 'Research');
  assert.ok(item.description.includes(input.short_version));
  assert.ok(item.description.includes('Why it matters'));
  assert.ok(item.description.includes(input.why_it_matters));
  assert.ok(item.description.includes('https://openai.com/news/fixture'));
  assert.ok(item.description.includes('OpenAI'));
  assert.ok(item.description.includes('AI assisted. Editor reviewed.'));
});
