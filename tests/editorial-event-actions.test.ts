import './editorial-server-hook';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import type { DeskMutation } from '../src/lib/editorial/desk-types';
const { executeDeskMutation } = await import('../src/lib/editorial/desk');
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const targetEvent = '33333333-3333-4333-8333-333333333333';
const otherEvent = '44444444-4444-4444-8444-444444444444';
const session = { db: createClient('http://127.0.0.1:59999', 'fixture-session', { auth: { persistSession: false } }), user: { id } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const source = (id: string) => ({ id, title: `Article ${id}`, source_name: 'OpenAI', url: 'https://openai.com/article', source_published_at: '2026-10-05T15:00:00Z' });
const preview = {
  target: { eventId: targetEvent, version: 2, leadSourceId: id, members: [source(id)] },
  other: { eventId: otherEvent, version: 5, leadSourceId: otherId, members: [source(otherId)] },
};

test('merge preview loads both complete groups in one authenticated RPC without paid or public actions', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = String(input).split('/').pop()!;
    calls.push(name);
    assert.equal(new Headers(init?.headers).get('apikey'), 'fixture-session');
    assert.deepEqual(JSON.parse(String(init?.body)), { p_lead_source: id, p_other_source: otherId });
    return json(preview);
  });
  const result = await executeDeskMutation({ intent: 'event-merge-preview', id, otherId } as DeskMutation, session);
  assert.equal(result.ok, true);
  assert.deepEqual((result as Record<string, unknown>).mergePreview, preview);
  assert.deepEqual(calls, ['load_brief_event_merge_preview']);
});

const confirmation = {
  intent: 'event-merge' as const, id, otherId,
  expectedTarget: { eventId: targetEvent, version: 2 },
  expectedOther: { eventId: otherEvent, version: 5 },
};
test('merge sends exactly the reviewed identities and versions without reading a fresher snapshot', async t => {
  const calls: { name: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ name: String(input).split('/').pop()!, body: JSON.parse(String(init?.body)) });
    assert.equal(new Headers(init?.headers).get('apikey'), 'fixture-session');
    return json(targetEvent);
  });
  assert.equal((await executeDeskMutation(confirmation, session)).ok, true);
  assert.deepEqual(calls, [{ name: 'merge_brief_events', body: {
    p_lead_source: id, p_other_source: otherId,
    p_target_event: targetEvent, p_target_version: 2, p_other_event: otherEvent, p_other_version: 5,
  } }]);
});

test('missing, malformed or unsafe expected snapshots fail before any RPC', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => { calls.push(String(input)); return json(targetEvent); });
  for (const bad of [undefined, null, {}, { eventId: 'bad', version: 1 },
    ...[undefined, null, 0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER, 2147483648].map(version => ({ eventId: targetEvent, version }))]) {
    for (const key of ['expectedTarget', 'expectedOther']) {
      const result = await executeDeskMutation({ ...confirmation, [key]: bad } as DeskMutation, session);
      assert.equal(result.ok, false, `${key}: ${JSON.stringify(bad)}`);
      assert.equal(result.code, 'invalid');
    }
  }
  const same = { ...confirmation, expectedOther: confirmation.expectedTarget };
  assert.equal((await executeDeskMutation(same, session)).ok, false);
  assert.deepEqual(calls, []);
});

test('a stale group conflict is returned without retrying, refreshing or adopting new versions', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input).split('/').pop()!);
    return json({ code: 'P0001', message: 'Event groups changed. Reload both groups and confirm again.' }, 400);
  });
  const result = await executeDeskMutation(confirmation, session);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'conflict');
  assert.match(result.message, /Nothing was merged/);
  assert.equal(result.mergePreview, undefined);
  assert.deepEqual(calls, ['merge_brief_events']);
});
