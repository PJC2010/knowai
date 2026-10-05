import './editorial-server-hook';
import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

// Next's persistent cache needs a running server. Browser tests cover actual
// invalidation; here only replace that wrapper, not the public reader/query.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/cache') return {
    url: 'data:text/javascript,export const unstable_cache=(fn)=>fn;', shortCircuit: true,
  };
  return next(specifier, context);
} });
const { GET } = await import('../src/app/feed.xml/route');
process.env.NEXT_PUBLIC_SITE_URL = 'https://knowai.example/';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:59999';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'fixture-public';
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.EDITORIAL_OPENROUTER_API_KEY;
const publication = {
  id: 'fixture-id', slug: 'approved-fixture', category: 'Research',
  source_url: 'https://openai.com/news/fixture', source_name: 'OpenAI',
  source_published_at: '2026-10-01T08:00:00Z', one_liner: 'Approved fixture headline.',
  short_version: 'Approved fixture summary.', whole_picture: ['Approved fixture context.'],
  why_it_matters: 'Approved fixture stakes.', published_at: '2026-10-04T09:00:00Z',
  updated_at: '2026-10-04T09:00:00Z', edition_date: '2026-10-04',
};

test('feed HTTP route reads only public publications without service/model keys, discovery or generation', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.origin, 'http://127.0.0.1:59999');
    assert.equal(url.pathname, '/rest/v1/brief_publications');
    assert.equal(init?.method || 'GET', 'GET');
    assert.equal(new Headers(init?.headers).get('apikey'), 'fixture-public');
    return new Response(JSON.stringify([publication]), { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') || '', /^application\/rss\+xml; charset=utf-8$/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  const xml = await response.text();
  assert.equal(XMLValidator.validate(xml), true);
  assert.match(xml, /Approved fixture summary\./);
  assert.match(xml, /https:\/\/knowai\.example\/brief\/approved-fixture/);
  assert.deepEqual(calls, ['/rest/v1/brief_publications']);
});

for (const failure of ['database', 'transport', 'invalid-publication'] as const) {
  test(`feed returns a safe non-cacheable 503 for ${failure} failure`, async t => {
    t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'transport') throw new Error('PRIVATE_UPSTREAM_DIAGNOSTIC');
      return new Response(JSON.stringify(failure === 'database'
        ? { message: 'PRIVATE_DATABASE_DIAGNOSTIC' }
        : [{ ...publication, published_at: 'invalid' }]), {
        status: failure === 'database' ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const response = await GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Retry-After'), '300');
    const body = await response.text();
    assert.equal(body, 'The published briefing feed is temporarily unavailable.');
    assert.doesNotMatch(body, /PRIVATE_|fixture|Invalid publication/);
  });
}

test('no publications yields valid empty XML; unconfigured database never contacts any upstream', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });
  const configured = await GET();
  assert.equal(configured.status, 200);
  const xml = await configured.text();
  assert.equal(XMLValidator.validate(xml), true);
  assert.equal(new XMLParser().parse(xml).rss.channel.item, undefined);
  assert.equal(calls, 1);
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const unconfigured = await GET();
    assert.equal(unconfigured.status, 200);
    assert.equal(await unconfigured.text(), xml);
    assert.equal(calls, 1);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});
