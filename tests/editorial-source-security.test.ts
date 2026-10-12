import './editorial-server-hook';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import starters from '../src/data/editorial-starters.json';
import { resolvePublisherArticle } from '../src/lib/editorial/publisher-catalog';

const { importStarterDrafts } = await import('../src/lib/editorial/starters');
const databaseOrigin = 'http://127.0.0.1:59999';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: {'content-type': 'application/json'},
});
type Access = 'approved' | 'blocked' | 'review_required' | 'missing' | 'missing-status' | 'lookup-error' | 'lookup-aborted';

function fixture(t: TestContext, access: Access) {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: databaseOrigin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
    SUPABASE_SECRET_KEY: 'fixture-service',
  };
  for (const [key, value] of Object.entries(env)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  const f = {
    publisherRequests: [] as string[],
    accessReads: [] as string[],
    revisions: [] as Record<string, unknown>[],
    jobs: [] as Record<string, unknown>[],
    unexpected: [] as string[],
  };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === databaseOrigin) {
      const table = url.pathname.replace('/rest/v1/', '');
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (table === 'brief_publishers' && method === 'GET') {
        f.accessReads.push(url.searchParams.get('catalog_key')!);
        if (access === 'lookup-error') return json({message: 'Fixture access lookup failed'}, 400);
        if (access === 'lookup-aborted') throw new DOMException('Fixture access lookup aborted', 'AbortError');
        if (access === 'missing') return json(null);
        return json(access === 'missing-status' ? {id: 'publisher'} : {id: 'publisher', access_status: access, enabled: false});
      }
      if (table === 'brief_sources' && method === 'POST') return json(null);
      if (table === 'brief_sources' && method === 'GET') {
        const index = starters.findIndex(starter => `eq.${starter.url}` === url.searchParams.get('url'));
        assert.notEqual(index, -1);
        return json({id: `source-${index}`});
      }
      if (table === 'brief_jobs' && method === 'POST') return json([{id: `job-${body.story_id}`}]);
      if (table === 'brief_jobs' && method === 'PATCH') { f.jobs.push(body); return json(null); }
      if (table === 'brief_revisions' && method === 'POST') { f.revisions.push(body); return json(null); }
    } else {
      f.publisherRequests.push(url.href);
      const starter = starters.find(starter => starter.url === url.href);
      if (starter) {
        // Exercise real article extraction and evidence validation, not a stubbed retrieval function.
        const paragraphs = [...starter.content.wholePicture, ...starter.content.evidence.map(e => e.quote)];
        const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        return new Response(`<html><head><title>Fixture source</title></head><body><article>${paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</article></body></html>`);
      }
    }
    f.unexpected.push(`${init?.method || 'GET'} ${url.href}`);
    throw new Error('Unexpected fixture request; no network is allowed.');
  });
  return f;
}

const expectedAccessReads = () => starters.map(starter => `eq.${resolvePublisherArticle(starter.url)!.key}`);

for (const access of ['blocked', 'review_required', 'missing', 'missing-status', 'lookup-error', 'lookup-aborted'] as const) {
  test(`starter access ${access} prevents any article fetch`, async t => {
    const f = fixture(t, access);
    const result = await importStarterDrafts();
    assert.deepEqual(f.publisherRequests, [], 'Unapproved or unavailable access must prevent the actual publisher fetch');
    assert.deepEqual(f.accessReads, expectedAccessReads());
    assert.deepEqual(f.revisions, []);
    assert.deepEqual(f.jobs.map(job => job.state), starters.map(() => 'failed'));
    assert.match(result, /^0 starter drafts imported/);
    assert.deepEqual(f.unexpected, []);
  });
}

test('starter access approved still imports verified drafts with scheduling disabled', async t => {
  const f = fixture(t, 'approved');
  const result = await importStarterDrafts();
  assert.deepEqual(f.accessReads, expectedAccessReads());
  assert.deepEqual(f.publisherRequests, starters.map(starter => starter.url));
  assert.deepEqual(f.revisions.map(revision => revision.content), starters.map(starter => starter.content));
  assert.deepEqual(f.jobs.map(job => job.state), starters.map(() => 'needs_review'));
  assert.match(result, new RegExp(`^${starters.length} starter drafts imported for review; 0 `));
  assert.deepEqual(f.unexpected, []);
});
