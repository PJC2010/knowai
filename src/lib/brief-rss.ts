import { normalizeSourceUrl, type BriefStory } from './brief';

function escapeMarkup(value: string): string {
  // XML 1.0 excludes control characters and unpaired UTF-16 surrogates.
  return value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

// Only pass public, editor-approved publications to this serializer.
export function renderBriefRss(stories: readonly BriefStory[], origin: string): string {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
    throw new Error('Invalid feed origin.');
  for (const story of stories) {
    if (!/^[a-z0-9-]{1,180}$/.test(story.slug)
      || !Number.isFinite(Date.parse(story.published_at))
      || !Number.isFinite(Date.parse(story.updated_at)))
      throw new Error('Invalid publication metadata.');
  }
  const seen = new Set<string>();
  const recent = [...stories]
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)
      || a.slug.localeCompare(b.slug))
    .filter(story => {
      if (seen.has(story.slug)) return false;
      seen.add(story.slug);
      return true;
    })
    .slice(0, 50);
  const items = recent.map(story => {
    const link = new URL(`/brief/${story.slug}`, origin).href;
    const description = `<p>${escapeMarkup(story.short_version)}</p>`
      + `<p><strong>Why it matters</strong> — ${escapeMarkup(story.why_it_matters)}</p>`
      + `<p>Source: <a href="${escapeMarkup(normalizeSourceUrl(story.source_url))}">${escapeMarkup(story.source_name)}</a></p>`
      + '<p>AI assisted. Editor reviewed.</p>';
    return `<item>
<title>${escapeMarkup(story.one_liner)}</title>
<link>${escapeMarkup(link)}</link>
<guid isPermaLink="true">${escapeMarkup(link)}</guid>
<pubDate>${new Date(story.published_at).toUTCString()}</pubDate>
<category>${escapeMarkup(story.category)}</category>
<description>${escapeMarkup(description)}</description>
</item>`;
  });
  const lastUpdated = stories.length
    ? new Date(Math.max(...stories.map(story => Date.parse(story.updated_at)))).toUTCString()
    : null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>knowai — The Brief</title>
<link>${escapeMarkup(new URL('/', origin).href)}</link>
<description>AI news in plain English. Editor-reviewed summaries, why they matter, and links to the original sources.</description>
<language>en</language>
<atom:link href="${escapeMarkup(new URL('/feed.xml', origin).href)}" rel="self" type="application/rss+xml" />
${lastUpdated ? `<lastBuildDate>${lastUpdated}</lastBuildDate>` : ''}
${items.join('\n')}
</channel>
</rss>\n`;
}
