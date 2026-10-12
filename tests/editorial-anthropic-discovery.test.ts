import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { normalizePublisherUrl, publisherByKey } from '../src/lib/editorial/publisher-catalog';

const moduleUrl = new URL('../src/lib/editorial/connectors/anthropic.ts', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/editorial-anthropic/${name}`, import.meta.url), 'utf8');
const now = () => Date.parse('2026-10-12T12:00:00Z');
const origin = 'https://www.anthropic.com';
const articleUrl = `${origin}/news/synthetic-model`;
async function connector() {
  assert.ok(existsSync(moduleUrl), 'The standalone Anthropic connector must exist');
  return import('../src/lib/editorial/connectors/anthropic');
}

function listing(links: string[], more = false): string {
  return fixture('listing.html').replace(/<li>[\s\S]*?<\/li>/, links.map(href =>
    `<li><a class="PublicationList-module-scss-module__fixture__listItem" href="${href}"><span>Synthetic news</span></a></li>`).join(''))
    .replace('</ul>', `</ul>${more ? '<a href="#" class="PublicationList-module-scss-module__fixture__seeMore">See more</a>' : ''}`);
}

test('listing rejects layout loss and challenge pages instead of reporting healthy empty', async () => {
  const { parseAnthropicListing } = await connector();
  for (const html of ['<html><body>Something changed</body></html>',
    '<main><h1>Newsroom</h1><a href="/news/unscoped">A link alone</a></main>',
    listing([]), listing(['/research/not-news']),
    listing(['/news/one']).replace('PublicationList-module-scss-module__fixture__root', 'changed-root'),
    listing(['/news/one']).replace('<title>Newsroom</title>', '<title>Just a moment...</title>')]) {
    assert.throws(() => parseAnthropicListing(html), /layout|challenge/i);
  }
  const explicitEmpty = listing([]).replace('</ul>', '</ul><p role="status">No results found.</p>');
  assert.deepEqual(parseAnthropicListing(explicitEmpty), {urls: [], truncated: false});
});

for (const slug of ['category', 'categories', 'tag', 'tags', 'rss', 'feed']) {
  test(`reserved Anthropic path ${slug} is skipped before discovery fetch`, async () => {
    const { parseAnthropicListing, discoverAnthropic } = await connector();
    const publisher = publisherByKey('anthropic')!;
    const links = ['', '/', '?utm_source=fixture#top', '/?utm_medium=fixture'].map(suffix => `/news/${slug}${suffix}`);
    for (const link of links) assert.throws(() => normalizePublisherUrl(`${origin}${link}`, publisher, 'article'), /purpose/);
    const page = listing([...links, articleUrl]);
    const requests: string[] = [];
    const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
      fetchText: async url => {
        requests.push(url);
        if (url === `${origin}/news`) return page;
        normalizePublisherUrl(url, publisher, 'article');
        return article(url);
      },
    });
    assert.deepEqual(result.candidates.map(candidate => candidate.url), [articleUrl], 'Reserved entries must not block the later valid article');
    assert.deepEqual(requests, [`${origin}/news`, articleUrl]);
    assert.equal(result.scanned, 1);
    assert.equal(result.attempted, 1);
    assert.equal(result.invalid, 0);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.errorCode, null);
    assert.deepEqual(parseAnthropicListing(page), {urls: [articleUrl], truncated: false});
  });

  test(`reserved Anthropic path ${slug} cannot become an article identity`, async () => {
    const { parseAnthropicArticle, discoverAnthropic } = await connector();
    const publisher = publisherByKey('anthropic')!;
    for (const suffix of ['', '/', '?utm_source=fixture#top', '/?utm_medium=fixture']) {
      const reserved = `${origin}/news/${slug}${suffix}`;
      assert.throws(() => normalizePublisherUrl(reserved, publisher, 'article'), /purpose/);
      assert.throws(() => parseAnthropicArticle(article(reserved), articleUrl, now()), /canonical|URL/i, 'A valid request must not emit a reserved canonical');
      assert.throws(() => parseAnthropicArticle(article(), reserved, now()), /URL/i, 'The requested identity must also be an article');
      assert.throws(() => parseAnthropicArticle(article().replace('</head>', `<meta property="og:url" content="${reserved}"></head>`), articleUrl, now()), /URL/i);
    }
    const later = `${origin}/news/later-model`;
    const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
      fetchText: async url => {
        if (url === `${origin}/news`) return listing([articleUrl, later]);
        normalizePublisherUrl(url, publisher, 'article');
        return article(url === articleUrl ? `${origin}/news/${slug}` : url);
      },
    });
    assert.deepEqual(result.candidates.map(candidate => candidate.url), [later]);
    assert.equal(result.invalid, 1);
    assert.equal(result.attempted, 2);
    assert.equal(result.outcome, 'partial');
    assert.equal(result.errorCode, null);
    for (const candidate of result.candidates) assert.equal(normalizePublisherUrl(candidate.url, publisher, 'article'), candidate.url);
  });
}

test('reserved Anthropic path exclusions preserve ordinary article slugs', async () => {
  const { parseAnthropicListing, parseAnthropicArticle, discoverAnthropic } = await connector();
  const publisher = publisherByKey('anthropic')!;
  const urls = ['category-model', 'categories-model', 'tag-model', 'tags-model', 'rss-model', 'feed-model'].map(slug => `${origin}/news/${slug}`);
  const links = urls.map(url => `${url}/?utm_source=fixture#top`);
  assert.deepEqual(parseAnthropicListing(listing(links)), {urls, truncated: false});
  for (const [index, url] of urls.entries()) {
    const candidate = parseAnthropicArticle(article(links[index]), url, now());
    assert.equal(candidate.url, url);
    assert.equal(normalizePublisherUrl(candidate.url, publisher, 'article'), url);
  }
  const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
    fetchText: async url => {
      if (url === `${origin}/news`) return listing(links);
      normalizePublisherUrl(url, publisher, 'article');
      return article(url);
    },
  });
  assert.deepEqual(result.candidates.map(candidate => candidate.url), urls);
  assert.equal(result.invalid, 0);
  assert.equal(result.outcome, 'ok');
});

test('article requires consistent valid original timestamps bound to this article', async () => {
  const { parseAnthropicArticle } = await connector();
  const html = fixture('article.html');
  const withoutMetaDate = html.replace(/<meta property="article:published_time"[^>]*>/, '');
  const invalidPages = [
    html.replace('"datePublished":"2026-10-01T12:30:00.000Z"', '"datePublished":"2026-10-02T12:30:00Z"'),
    html.replace('content="2026-10-01T12:30:00Z"', 'content="invalid-date"'),
    html.replaceAll('2026-10-01T12:30:00', '2026-11-01T12:30:00'),
    html.replaceAll('2026-10-01T12:30:00', '2026-02-30T12:30:00'),
    withoutMetaDate.replace(/,"datePublished":"[^"]+"/, ''),
    withoutMetaDate.replaceAll('"https://www.anthropic.com/news/synthetic-model"', '"https://www.anthropic.com/news/unrelated"').replace('href="https://www.anthropic.com/news/unrelated"', `href="${articleUrl}"`),
    withoutMetaDate.replace('"@type":"NewsArticle"', '"@type":"Organization"'),
  ];
  for (const page of invalidPages) assert.throws(() => parseAnthropicArticle(page, articleUrl, now()), /publication|metadata/i);
  const equivalent = html.replace('"datePublished":"2026-10-01T12:30:00.000Z"', '"datePublished":"2026-10-01T08:30:00-04:00"');
  assert.equal(parseAnthropicArticle(equivalent, articleUrl, now()).source_published_at, '2026-10-01T12:30:00.000Z');
  assert.equal(parseAnthropicArticle(withoutMetaDate, articleUrl, now()).source_published_at, '2026-10-01T12:30:00.000Z');
});

test('article validates canonical identities and reads article-bound graph nodes without borrowing unrelated dates', async () => {
  const { parseAnthropicArticle } = await connector();
  const html = fixture('article.html');
  for (const bad of ['https://evil.test/news/model', 'https://www.anthropic.com:444/news/model',
    'http://www.anthropic.com/news/model', `${origin}/research/model`, `${origin}/news/model/nested`,
    `${origin}/news/model?category=ai`, `${origin}/news/%6dodel`, `${origin}/news/../news/model`]) {
    assert.throws(() => parseAnthropicArticle(html.replace(`href="${articleUrl}"`, `href="${bad}"`), articleUrl, now()), /canonical|URL/i);
    assert.throws(() => parseAnthropicArticle(html, bad, now()), /URL/i);
  }
  assert.throws(() => parseAnthropicArticle(html.replace('</head>', '<link rel="canonical" href="/news/other"></head>'), articleUrl, now()), /canonical/i);
  assert.throws(() => parseAnthropicArticle(html.replace('</head>', '<meta property="og:url" content="https://evil.test/news/other"></head>'), articleUrl, now()), /canonical|URL/i);
  const graph = {'@graph': [
    {'@type': 'WebSite', url: articleUrl, datePublished: '2020-01-01T00:00:00Z'},
    {'@type': 'NewsArticle', url: `${origin}/news/other`, datePublished: '2021-01-01T00:00:00Z'},
    {'@type': ['Article', 'NewsArticle'], mainEntityOfPage: {'@id': articleUrl}, datePublished: '2026-10-01T12:30:00Z'},
  ]};
  const graphPage = html.replace(/<meta property="article:published_time"[^>]*>/, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(graph)}</script>`);
  assert.equal(parseAnthropicArticle(graphPage, articleUrl, now()).source_published_at, '2026-10-01T12:30:00.000Z');
  assert.throws(() => parseAnthropicArticle(graphPage.replace(`"@id":"${articleUrl}"`, '"@id":"https://www.anthropic.com/news"'), articleUrl, now()), /publication/i);
});

test('article requires a nonempty bounded title and discards unsafe optional images', async () => {
  const { parseAnthropicArticle } = await connector();
  const html = fixture('article.html');
  const noTitles = html.replace(/<meta property="og:title"[^>]*>/, '').replace(/,"headline":"[^"]+"/, '').replace(/<h1>[\s\S]*?<\/h1>/, '<h1> </h1>');
  assert.throws(() => parseAnthropicArticle(noTitles, articleUrl, now()), /title/i);
  const jsonTitleOnly = html.replace(/<meta property="og:title"[^>]*>/, '').replace(/<h1>[\s\S]*?<\/h1>/, '');
  assert.equal(parseAnthropicArticle(jsonTitleOnly, articleUrl, now()).title, 'Synthetic model & tools');
  assert.equal(parseAnthropicArticle(html.replace('Synthetic model &amp; tools', 'x'.repeat(1000)), articleUrl, now()).title.length, 500);
  for (const image of ['javascript:alert(1)', 'http://images.test/a.png', 'https://user:pass@images.test/a.png']) {
    assert.equal(parseAnthropicArticle(html.replace('https://www-cdn.anthropic.com/images/synthetic.png', image), articleUrl, now()).source_image_url, null);
  }
  assert.throws(() => parseAnthropicArticle(html.replace('<head>', '<head><title>Verify you are human</title>'), articleUrl, now()), /challenge/i);
});

for (const image of ['https://127.0.0.1/private', 'https://localhost/private', 'https://internal.local/preview',
  'https://10.0.0.1/private', 'https://[::1]/private', 'https://preview.internal/a.png', 'https://cdn.localhost/a.png']) {
  test(`Anthropic image policy discards ${image}`, async t => {
    const { parseAnthropicArticle, discoverAnthropic } = await connector();
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => { requests.push(String(input)); throw new Error('No image fetch is allowed'); });
    const page = article().replace('https://www-cdn.anthropic.com/images/synthetic.png', image);
    assert.equal(parseAnthropicArticle(page, articleUrl, now()).source_image_url, null);
    const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
      fetchText: async url => url === `${origin}/news` ? fixture('listing.html') : page,
    });
    assert.equal(result.outcome, 'ok', 'Unsafe optional images must not discard valid article metadata');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source_image_url, null, 'Unsafe image must not reach persistence candidates');
    assert.deepEqual(requests, []);
  });
}

test('Anthropic image policy retains approved public HTTPS origins', async () => {
  const { parseAnthropicArticle } = await connector();
  for (const image of ['https://www-cdn.anthropic.com/images/synthetic.png', 'https://images.example.com/preview.png']) {
    assert.equal(parseAnthropicArticle(article().replace('https://www-cdn.anthropic.com/images/synthetic.png', image), articleUrl, now()).source_image_url, image);
  }
});

test('listing returns at most forty canonical links and flags unpaged overflow', async () => {
  const { parseAnthropicListing } = await connector();
  const links = Array.from({length: 41}, (_, i) => `/news/item-${i}`);
  const capped = parseAnthropicListing(listing(links));
  assert.equal(capped.urls.length, 40);
  assert.equal(capped.truncated, true);
  assert.equal(capped.urls.at(-1), `${origin}/news/item-39`);
  assert.equal(parseAnthropicListing(listing(links.slice(0, 40))).truncated, false);
  assert.equal(parseAnthropicListing(listing(['/news/one', '/news/one?utm_source=duplicate'])).truncated, false);
  assert.deepEqual(parseAnthropicListing(listing(['/news/one'], true)), {urls: [`${origin}/news/one`], truncated: true});
});

function article(url = articleUrl): string {
  return fixture('article.html').replaceAll(articleUrl, url);
}

test('discovery skips known URLs before its eight sequential metadata attempts inside the forty-link window', async () => {
  const { discoverAnthropic } = await connector();
  const links = Array.from({length: 45}, (_, i) => `${origin}/news/item-${i}`);
  const knownUrls = new Set(links.slice(0, 2));
  const requests: string[] = [];
  let active = 0;
  const result = await discoverAnthropic({knownUrls, signal: new AbortController().signal, now,
    fetchText: async (url) => {
      assert.equal(active++, 0, 'same-host requests must be sequential');
      requests.push(url);
      await Promise.resolve();
      active--;
      if (url === `${origin}/news`) return listing(links);
      return url === links[2] ? article(url).replaceAll('datePublished', 'dateModified').replace('article:published_time', 'article:modified_time') : article(url);
    },
  });
  assert.deepEqual(requests, [`${origin}/news`, ...links.slice(2, 10)]);
  assert.equal(result.scanned, 40);
  assert.equal(result.duplicates, 2);
  assert.equal(result.attempted, 8);
  assert.equal(result.invalid, 1);
  assert.equal(result.remaining, 30);
  assert.equal(result.candidates.length, 7);
  assert.equal(result.continuation, links[10]);
  assert.equal(result.outcome, 'partial');
  assert.match(result.warning!, /40|window/i);
  assert.equal(knownUrls.size, 2);
});

test('validated continuation advances past invalid leaders and safely remaps changed listings', async () => {
  const { discoverAnthropic } = await connector();
  const links = Array.from({length: 10}, (_, i) => `${origin}/news/item-${i}`);
  const requests: string[] = [];
  const options = {knownUrls: new Set<string>(), signal: new AbortController().signal, now,
    fetchText: async (url: string) => {
      requests.push(url);
      if (url === `${origin}/news`) return listing(links);
      return links.indexOf(url) < 8 ? article(url).replaceAll('datePublished', 'dateModified').replace('article:published_time', 'article:modified_time') : article(url);
    },
  };
  const first = await discoverAnthropic(options);
  assert.equal(first.attempted, 8);
  assert.equal(first.invalid, 8);
  assert.equal(first.continuation, links[8]);
  requests.length = 0;
  const second = await discoverAnthropic({...options, continuation: first.continuation});
  assert.deepEqual(requests.slice(0, 3), [`${origin}/news`, links[8], links[9]]);
  assert.deepEqual(second.candidates.map(c => c.url), links.slice(8));
  assert.equal(second.continuation, links[6]);
  for (const continuation of ['https://evil.test/news/injected', `${origin}/news/${'x'.repeat(2048)}`, `${origin}/news/removed`, '/news/item-8']) {
    requests.length = 0;
    const reset = await discoverAnthropic({...options, continuation});
    assert.equal(requests[1], links[0]);
    assert.ok(!requests.includes(continuation));
    assert.match(reset.warning!, /continuation.*reset/i);
    assert.ok(reset.continuation!.length <= 2048);
  }
});

test('discovery exposes empty, unavailable, partial and HTTP retry health without retrying or leaking errors', async () => {
  const { discoverAnthropic } = await connector();
  const base = {knownUrls: new Set<string>(), signal: new AbortController().signal, now};
  const empty = await discoverAnthropic({...base, fetchText: async () => listing([]).replace('</ul>', '</ul><p role="status">No results found.</p>')});
  assert.equal(empty.outcome, 'empty');
  const duplicate = await discoverAnthropic({...base, knownUrls: new Set([articleUrl]), fetchText: async url => {
    assert.equal(url, `${origin}/news`); return fixture('listing.html');
  }});
  assert.equal(duplicate.outcome, 'empty');
  assert.equal(duplicate.duplicates, 1);
  for (const status of [403, 429, 503]) {
    let calls = 0;
    const failed = await discoverAnthropic({...base, fetchText: async () => {
      calls++; throw Object.assign(new Error('PRIVATE_RAW_RESPONSE'), {status, retryAfter: status === 429 ? '120' : null});
    }});
    assert.equal(calls, 1);
    assert.equal(failed.outcome, 'unavailable');
    assert.equal(failed.errorCode, `http-${status}`);
    assert.equal(failed.retryAfter, status === 429 ? '120' : null);
    assert.ok(!JSON.stringify(failed).includes('PRIVATE_RAW_RESPONSE'));
  }
  const layout = await discoverAnthropic({...base, fetchText: async () => '<html><title>Changed layout</title></html>'});
  assert.equal(layout.outcome, 'unavailable');
  assert.equal(layout.errorCode, 'layout-changed');
  const requests: string[] = [];
  const partial = await discoverAnthropic({...base, fetchText: async url => {
    requests.push(url);
    if (url === `${origin}/news`) return listing(['/news/one', '/news/two', '/news/three']);
    if (url.endsWith('/one')) return article(url);
    throw Object.assign(new Error('rate limited'), {status: 429, retryAfter: 'Mon, 12 Oct 2026 13:00:00 GMT'});
  }});
  assert.equal(requests.length, 3);
  assert.equal(partial.candidates.length, 1);
  assert.equal(partial.attempted, 2);
  assert.equal(partial.invalid, 0);
  assert.equal(partial.remaining, 1);
  assert.equal(partial.continuation, `${origin}/news/three`);
  assert.equal(partial.outcome, 'partial');
  assert.equal(partial.errorCode, 'http-429');
  assert.equal(partial.retryAfter, 'Mon, 12 Oct 2026 13:00:00 GMT');
});

test('connector respects inherited cancellation and a shared sixty-second deadline between requests', async () => {
  const { discoverAnthropic } = await connector();
  const aborted = new AbortController();
  aborted.abort(new Error('PARENT_PRIVATE_REASON'));
  let calls = 0;
  const cancelled = await discoverAnthropic({knownUrls: new Set(), signal: aborted.signal, now,
    fetchText: async () => { calls++; return fixture('listing.html'); },
  });
  assert.equal(calls, 0);
  assert.equal(cancelled.outcome, 'unavailable');
  assert.equal(cancelled.errorCode, 'aborted');
  let time = now();
  const signals: AbortSignal[] = [];
  const requests: string[] = [];
  const expired = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now: () => time,
    fetchText: async (url, signal) => {
      signals.push(signal); requests.push(url);
      if (url === `${origin}/news`) return listing(['/news/one', '/news/two', '/news/three']);
      time += 30_000;
      return article(url);
    },
  });
  assert.deepEqual(requests, [`${origin}/news`, `${origin}/news/one`, `${origin}/news/two`]);
  assert.equal(new Set(signals).size, 1, 'all requests inherit the same non-reset deadline');
  assert.equal(signals[0].aborted, true);
  assert.equal(expired.candidates.length, 1, 'a response arriving at expiry must not become a candidate');
  assert.equal(expired.outcome, 'partial');
  assert.equal(expired.errorCode, 'deadline');
  assert.equal(expired.remaining, 1);
  assert.equal(expired.continuation, `${origin}/news/three`);
  assert.ok(!JSON.stringify(cancelled).includes('PARENT_PRIVATE_REASON'));
});

test('deadline actively aborts an in-flight fetch that ignores cancellation', async t => {
  const { discoverAnthropic } = await connector();
  t.mock.timers.enable({apis: ['setTimeout']});
  const parent = new AbortController();
  let seen: AbortSignal | undefined;
  const pending = discoverAnthropic({knownUrls: new Set(), signal: parent.signal, now,
    fetchText: async (_url, signal) => { seen = signal; return new Promise<string>(() => {}); },
  });
  assert.ok(seen);
  t.mock.timers.tick(59_999);
  assert.equal(seen.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(seen.aborted, true);
  const result = await Promise.race([pending, new Promise<null>(resolve => setImmediate(() => resolve(null)))]);
  assert.ok(result, 'connector must settle even when the dependency ignores abort');
  assert.equal(result.errorCode, 'deadline');
  assert.equal(result.outcome, 'unavailable');
  assert.equal(parent.signal.aborted, false, 'connector must not abort its parent');
  t.mock.timers.reset();
});

test('canonical aliases deduplicate against both stored metadata and candidates already found in this refresh', async () => {
  const { discoverAnthropic } = await connector();
  const canonical = `${origin}/news/canonical`;
  for (const known of [false, true]) {
    const requests: string[] = [];
    const result = await discoverAnthropic({knownUrls: new Set(known ? [canonical] : []), signal: new AbortController().signal, now,
      fetchText: async url => {
        requests.push(url);
        return url === `${origin}/news` ? listing(['/news/alias-one', '/news/canonical', '/news/alias-two']) : article(canonical);
      },
    });
    assert.deepEqual(requests, [`${origin}/news`, `${origin}/news/alias-one`, `${origin}/news/alias-two`]);
    assert.equal(result.attempted, 2);
    assert.equal(result.duplicates, known ? 3 : 2);
    assert.equal(result.remaining, 0);
    assert.equal(result.continuation, null);
    assert.equal(result.candidates.length, known ? 0 : 1);
    assert.equal(result.outcome, known ? 'empty' : 'ok');
  }
});

test('an article access challenge stops the connector rather than probing later articles', async () => {
  const { discoverAnthropic } = await connector();
  let calls = 0;
  const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
    fetchText: async url => {
      calls++;
      return url === `${origin}/news` ? listing(['/news/one', '/news/two']) : '<html><title>Just a moment...</title><form id="challenge-form"></form></html>';
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.errorCode, 'challenge');
  assert.equal(result.invalid, 0);
  assert.equal(result.remaining, 1);
});

test('a completed window with only invalid metadata is unavailable, not healthy empty', async () => {
  const { discoverAnthropic } = await connector();
  const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
    fetchText: async url => url === `${origin}/news` ? fixture('listing.html') : article().replaceAll('datePublished', 'dateModified').replace('article:published_time', 'article:modified_time'),
  });
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.errorCode, 'invalid-metadata');
  assert.equal(result.invalid, 1);
  assert.equal(result.attempted, 1);
  assert.equal(result.remaining, 0);
  assert.equal(result.continuation, null);
});

test('lookalike list items outside the verified roots cannot inject candidates', async () => {
  const { parseAnthropicListing } = await connector();
  const outside = '<ul class="PublicationList-module-scss-module__fixture__list"><li><a class="PublicationList-module-scss-module__fixture__listItem" href="/news/not-the-news-list">Outside</a></li></ul>'
    + '<div class="FeaturedGrid-module-scss-module__fixture__featuredItem"><a class="FeaturedGrid-module-scss-module__fixture__content" href="/news/not-the-feature-grid">Outside</a></div>';
  const html = fixture('listing.html').replace('</main>', `${outside}</main>`);
  assert.deepEqual(parseAnthropicListing(html).urls, [articleUrl]);
});

test('encoded traversal is rejected before the URL parser can repair it into an allowed news path', async () => {
  const { parseAnthropicListing, parseAnthropicArticle } = await connector();
  const repaired = `${origin}/news/%2e%2e/news/repaired`;
  assert.deepEqual(parseAnthropicListing(listing([articleUrl, repaired])).urls, [articleUrl]);
  assert.throws(() => parseAnthropicArticle(article(), repaired, now()), /URL/i);
  assert.throws(() => parseAnthropicArticle(article().replace(`href="${articleUrl}"`, `href="${repaired}"`), articleUrl, now()), /canonical/i);
});

test('unreadable or excessively nested JSON-LD fails closed instead of accepting only the convenient meta date', async () => {
  const { parseAnthropicArticle } = await connector();
  const script = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;
  for (const data of ['{"@type":"NewsArticle","datePublished":', '{"@graph":'.repeat(2000) + '{}' + '}'.repeat(2000)]) {
    const page = article().replace(script, `<script type="application/ld+json">${data}</script>`);
    assert.throws(() => parseAnthropicArticle(page, articleUrl, now()), /metadata|JSON-LD/i);
  }
});

test('a dated listing-style page returned at an article URL cannot masquerade as article metadata', async () => {
  const { parseAnthropicArticle } = await connector();
  const page = article().replace('content="article"', 'content="website"');
  assert.throws(() => parseAnthropicArticle(page, articleUrl, now()), /article|metadata/i);
  const unbound = article().replace(/<meta property="article:published_time"[^>]*>/, '')
    .replace('"mainEntityOfPage":"https://www.anthropic.com/news/synthetic-model"', '"mainEntityOfPage":"https://www.anthropic.com/news/other"');
  assert.throws(() => parseAnthropicArticle(unbound, articleUrl, now()), /metadata/i);
});

test('failure health preserves a safe continuation and does not falsely blame the eight-request cap', async () => {
  const { discoverAnthropic } = await connector();
  const base = {knownUrls: new Set<string>(), signal: new AbortController().signal, now};
  for (const continuation of [`${origin}/news/retry-here`, 'https://evil.test/news/injected']) {
    const result = await discoverAnthropic({...base, continuation, fetchText: async () => {
      throw Object.assign(new Error('blocked'), {status: 429, retryAfter: '30'});
    }});
    assert.equal(result.continuation, continuation.startsWith(origin) ? continuation : null);
  }
  const failed = await discoverAnthropic({...base, fetchText: async url => {
    if (url === `${origin}/news`) return listing(['/news/one', '/news/two']);
    throw Object.assign(new Error('blocked'), {status: 403});
  }});
  assert.equal(failed.attempted, 1);
  assert.equal(failed.remaining, 1);
  assert.doesNotMatch(failed.warning!, /Eight-article.*reached/i);
});

test('metadata parsing cannot admit a candidate when the connector clock reaches its deadline', async () => {
  const { discoverAnthropic } = await connector();
  let time = now() - 10_000;
  const result = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal,
    now: () => time += 10_000,
    fetchText: async url => url === `${origin}/news` ? fixture('listing.html') : article(),
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.errorCode, 'deadline');
  assert.equal(result.invalid, 0);
});

test('one newsroom entry yields original canonical metadata, never an article body', async () => {
  const { discoverAnthropic } = await connector();
  const requests: string[] = [];
  const result = await discoverAnthropic({
    fetchText: async (url, signal) => {
      assert.ok(signal instanceof AbortSignal);
      requests.push(url);
      assert.ok(url === `${origin}/news` || url === articleUrl);
      return fixture(url === `${origin}/news` ? 'listing.html' : 'article.html');
    },
    knownUrls: new Set(), signal: new AbortController().signal, now,
  });
  assert.deepEqual(requests, [`${origin}/news`, articleUrl]);
  assert.deepEqual(result, {
    candidates: [{url: articleUrl, title: 'Synthetic model & tools', source_name: 'Anthropic',
      source_published_at: '2026-10-01T12:30:00.000Z',
      source_image_url: 'https://www-cdn.anthropic.com/images/synthetic.png'}],
    scanned: 1, duplicates: 0, filtered: 0, invalid: 0, attempted: 1, remaining: 0,
    warning: null, continuation: null, outcome: 'ok', errorCode: null, retryAfter: null,
  });
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_BODY_MUST_NOT_ESCAPE'));
});

test('listing admits only deduplicated strict newsroom links in observed publication and featured regions', async () => {
  const { parseAnthropicListing } = await connector();
  const bad = ['https://anthropic.com/news/bad', 'https://www.anthropic.com.evil.test/news/bad',
    'http://www.anthropic.com/news/bad', 'https://user@www.anthropic.com/news/bad',
    'https://www.anthropic.com:444/news/bad', '//evil.test/news/bad', '/research/bad', '/news',
    '/news?category=ai', '/news/category/ai', '/news/%2e%2e/bad', '/news/../news/bad',
    '/news/a%2Fb', '/news/a\\b', '/news/bad?category=ai', '/news/bad?url=https://evil.test'];
  const html = listing(['/news/first?utm_source=fixture#top', `${origin}/news/first/`, '/news/second', ...bad])
    .replace('<main>', '<main><div class="FeaturedGrid-module-scss-module__fixture__root"><div class="FeaturedGrid-module-scss-module__fixture__featuredItem"><a href="/news/featured" class="FeaturedGrid-module-scss-module__fixture__content"><h2>Featured synthetic</h2></a></div></div>')
    .replace('</ul>', '<li><a href="/news/not-a-list-item">Unrelated anchor</a></li></ul>');
  assert.deepEqual(parseAnthropicListing(html), {
    urls: [`${origin}/news/featured`, `${origin}/news/first`, `${origin}/news/second`], truncated: false,
  });
});
