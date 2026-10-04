import './editorial-server-hook';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import starters from '../src/data/editorial-starters.json';
import type { DeskMutation } from '../src/lib/editorial/desk-types';
const { executeDeskMutation } = await import('../src/lib/editorial/desk');
const actor = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const reservationId = '33333333-3333-4333-8333-333333333333';
const session = { db: createClient('http://127.0.0.1:59999', 'fixture-session', { auth: { persistSession: false } }), user: { id: actor } };
const input = (): Extract<DeskMutation, { intent: 'suggest' }> => ({ intent: 'suggest', id, version: 1, field: 'oneLiner', instruction: 'simplify', confirmCharge: true });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const modelResponse = () => ({ usage: { cost: 0.012, prompt_tokens: 90, completion_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ value: 'A simpler source-backed line.' }) } }] });
type Call = { path: string; search: string; method: string; body: Record<string, unknown>; headers: Headers };
function fixture(t: TestContext) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:59999';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'fixture-public';
  process.env.SUPABASE_SECRET_KEY = 'fixture-service';
  process.env.EDITORIAL_OPENROUTER_API_KEY = 'fixture-editorial-only';
  process.env.OPENROUTER_API_KEY = 'fixture-never-use';
  process.env.EDITORIAL_MODEL = 'fixture/structured-model';
  const state = {
    active: { id, version: 1, state: 'needs_review', content: structuredClone(starters[0].content), source_text: 'Immutable original captured reporting, not a fresh article fetch.', brief_sources: { title: 'Original source headline' } },
    response: modelResponse() as unknown,
    calls: [] as Call[],
    attempts: 7,
    respond: undefined as ((call: Call) => Response | undefined) | undefined,
  };
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const call = { path: parsed.pathname.split('/').pop()!, search: parsed.search, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : {}, headers: new Headers(init?.headers) };
    state.calls.push(call);
    const custom = state.respond?.(call);
    if (custom) return custom;
    if (parsed.hostname === 'openrouter.ai') return json(state.response);
    assert.equal(parsed.origin, 'http://127.0.0.1:59999', 'No source refetches or real network calls');
    if (call.path === 'load_brief_desk') return json({ active: state.active, attemptsToday: state.attempts });
    if (call.path === 'acquire_brief_worker') return json(true);
    if (call.path === 'reserve_brief_suggestion') return json(reservationId);
    if (call.path === 'release_brief_worker' || call.path === 'brief_suggestions') return json(null);
    assert.fail(`Unexpected operation ${call.method} ${call.path}`);
  });
  return state;
}

test('transport failures audit unknown charges once, release the lease and never expose upstream diagnostics', async t => {
  const f = fixture(t);
  for (const failure of ['timeout', 'malformed', 'oversize', 'http']) {
    f.calls.length = 0;
    f.respond = c => {
      if (c.path !== 'completions') return;
      if (failure === 'timeout') throw new Error('private token diagnostic');
      if (failure === 'malformed') return new Response('{');
      if (failure === 'oversize') return new Response('x'.repeat(100001));
      return json({ error: 'private token diagnostic' }, 429);
    };
    const result = await executeDeskMutation(input(), session);
    assert.equal(result.ok, false);
    assert.match(result.message, /charge/);
    assert.equal(result.message.includes('private token diagnostic'), false);
    const failed = f.calls.find(c => c.path === 'brief_suggestions' && c.body.state === 'failed');
    assert.equal(failed?.body.cost, null);
    assert.equal(f.calls.filter(c => c.path === 'completions').length, 1);
    assert.equal(f.calls.filter(c => c.path === 'release_brief_worker').length, 1);
  }
});

test('audit outages fail closed and missing authoritative attempt counts are not guessed', async t => {
  const f = fixture(t);
  f.respond = c => c.path === 'brief_suggestions' ? json({ code: 'XX000', message: 'private storage error' }, 500) : undefined;
  assert.equal((await executeDeskMutation(input(), session)).ok, false);
  assert.equal(f.calls.some(c => c.path === 'completions'), false);
  assert.equal(f.calls.filter(c => c.path === 'release_brief_worker').length, 1);
  f.calls.length = 0;
  f.respond = c => c.path === 'load_brief_desk' && (c.body.p_query as { view?: string }).view === 'sources' ? json({ code: 'XX000', message: 'unavailable' }, 500) : undefined;
  const result = await executeDeskMutation(input(), session);
  assert.equal(result.ok, true);
  assert.equal(result.attemptsToday, undefined);
});

test('every supported field uses the immutable read snapshot even if a later read changes', async t => {
  const f = fixture(t);
  delete process.env.EDITORIAL_MODEL;
  for (const field of ['oneLiner', 'shortVersion', 'wholePicture', 'whyItMatters'] as const) {
    f.calls.length = 0;
    const captured = structuredClone(f.active);
    f.response = { usage: { cost: 0, prompt_tokens: 0, completion_tokens: 0 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ value: starters[0].content[field] }) } }] };
    f.respond = c => {
      if (c.path === 'reserve_brief_suggestion') f.active.content.oneLiner = 'A later saved edit, not this request snapshot.';
    };
    const result = await executeDeskMutation({ ...input(), field }, session);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.suggestion, { field, value: starters[0].content[field], cost: 0 });
    const request = f.calls.find(c => c.path === 'completions')!;
    assert.equal(request.body.model, 'openai/gpt-4.1-mini');
    assert.equal(request.body.max_tokens, 1200);
    assert.deepEqual(JSON.parse((request.body.messages as { content: string }[])[1].content).currentValue, captured.content[field]);
    assert.ok(f.calls.filter(c => c.path === 'brief_suggestions').every(c => c.search === `?id=eq.${reservationId}`));
  }
});

test('a missing reservation receipt fails closed before any audit update or model request', async t => {
  const f = fixture(t);
  f.respond = c => c.path === 'reserve_brief_suggestion' ? json(null) : undefined;
  const result = await executeDeskMutation(input(), session);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'failed');
  assert.equal(f.calls.some(c => ['brief_suggestions', 'completions'].includes(c.path)), false);
  assert.equal(f.calls.filter(c => c.path === 'release_brief_worker').length, 1);
});

test('suggestions require a bounded nonempty saved source capture before reserving a paid attempt', async t => {
  const f = fixture(t);
  for (const source_text of ['', '   ', 'x'.repeat(60001), null]) {
    f.respond = c => c.path === 'load_brief_desk' ? json({ active: { ...f.active, source_text }, attemptsToday: 7 }) : undefined;
    const result = await executeDeskMutation(input(), session);
    assert.equal(result.ok, false);
    assert.match(result.message, /source capture/i);
  }
  assert.equal(f.calls.some(c => ['reserve_brief_suggestion', 'completions'].includes(c.path)), false);
});

test('a failed usage audit cannot return success and retries known charges only in the failure record', async t => {
  const f = fixture(t);
  let rejected = false;
  f.respond = c => {
    if (c.path === 'brief_suggestions' && c.body.cost === 0.012 && !rejected) {
      rejected = true;
      return json({ code: 'XX000', message: 'private storage error' }, 500);
    }
  };
  const result = await executeDeskMutation(input(), session);
  assert.equal(result.ok, false);
  assert.equal(result.suggestion, undefined);
  assert.match(result.message, /audit/);
  const failed = f.calls.find(c => c.path === 'brief_suggestions' && c.body.state === 'failed');
  assert.equal(failed?.body.cost, 0.012);
  assert.equal(failed?.body.input_tokens, 90);
  assert.equal(failed?.body.output_tokens, 20);
  assert.equal(f.calls.filter(c => c.path === 'completions').length, 1);
  assert.equal(f.calls.filter(c => c.path === 'release_brief_worker').length, 1);
});

test('missing or invalid usage is unavailable, never a made-up cost or unsafe token count', async t => {
  const f = fixture(t);
  for (const usage of [undefined, { cost: -1, prompt_tokens: -2, completion_tokens: 1.5 }, { cost: '0.5', prompt_tokens: '9', completion_tokens: 2147483648 }]) {
    f.calls.length = 0;
    f.response = { ...modelResponse(), usage };
    const result = await executeDeskMutation(input(), session);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.suggestion?.cost, null);
    assert.ok(f.calls.some(c => c.path === 'brief_suggestions' && c.body.cost === null && c.body.input_tokens === null && c.body.output_tokens === null));
  }
  f.respond = c => c.path === 'completions' ? new Response(JSON.stringify(modelResponse()).replace('0.012', '1e999'), { headers: { 'Content-Type': 'application/json' } }) : undefined;
  assert.equal((await executeDeskMutation(input(), session)).suggestion?.cost, null);
});

test('invalid and truncated responses retain known charges in a failed audit without applying content', async t => {
  const f = fixture(t);
  for (const response of [
    { ...modelResponse(), choices: [{ finish_reason: 'length', message: { content: '{"value":' } }] },
    { ...modelResponse(), choices: [{ finish_reason: 'stop', message: { content: '{"wrong":"shape"}' } }] },
    { ...modelResponse(), error: { message: 'private upstream diagnostic' } },
  ]) {
    f.calls.length = 0;
    f.response = response;
    const result = await executeDeskMutation(input(), session);
    assert.equal(result.ok, false);
    assert.equal(result.suggestion, undefined);
    assert.equal(result.attemptsToday, 7);
    const audits = f.calls.filter(c => c.path === 'brief_suggestions');
    assert.ok(audits.some(c => c.body.cost === 0.012 && c.body.input_tokens === 90 && c.body.output_tokens === 20));
    assert.ok(audits.some(c => c.body.state === 'failed' && typeof c.body.finished_at === 'string'));
    assert.equal(audits.some(c => c.body.state === 'complete'), false);
    assert.equal(f.calls.filter(c => c.path === 'completions').length, 1);
    assert.equal(f.calls.filter(c => c.path === 'release_brief_worker').length, 1);
    assert.equal(JSON.stringify({ result, audits }).includes('private upstream diagnostic'), false);
    assert.match(result.message, /charge/);
  }
});

test('a busy lease prevents reservations and is never released by a different request', async t => {
  const f = fixture(t);
  f.respond = c => c.path === 'acquire_brief_worker' ? json(false) : undefined;
  const result = await executeDeskMutation(input(), session);
  assert.equal(result.ok, false);
  assert.match(result.message, /already running/);
  assert.equal(result.attemptsToday, 7);
  assert.equal(f.calls.some(c => ['reserve_brief_suggestion', 'completions', 'release_brief_worker'].includes(c.path)), false);
});

test('SQL cap, duplicate, editor revocation and save-race denials release the lease without a paid call', async t => {
  const f = fixture(t);
  for (const [message, code] of [
    ['The daily attempt limit has been reached', 'invalid'],
    ['This suggestion was already requested; wait before trying again', 'invalid'],
    ['Editor access required', 'invalid'],
    ['Draft changed or is no longer editable', 'conflict'],
  ]) {
    f.calls.length = 0;
    f.respond = c => c.path === 'reserve_brief_suggestion' ? json({ code: 'P0001', message }, 400) : undefined;
    const result = await executeDeskMutation(input(), session);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(result.attemptsToday, 7);
    assert.equal(f.calls.filter(c => c.path === 'release_brief_worker').length, 1);
    assert.equal(f.calls.some(c => ['completions', 'brief_suggestions'].includes(c.path)), false);
  }
});

test('stale, mismatched, missing or reviewed snapshots cannot fund a suggestion', async t => {
  const f = fixture(t);
  for (const active of [null, { ...f.active, version: 2 }, { ...f.active, state: 'published' }, { ...f.active, id: actor }]) {
    f.respond = c => c.path === 'load_brief_desk' ? json({ active, attemptsToday: 7 }) : undefined;
    const result = await executeDeskMutation(input(), session);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'conflict');
    assert.equal(result.attemptsToday, 7);
  }
  assert.equal(f.calls.some(c => ['acquire_brief_worker', 'reserve_brief_suggestion', 'completions'].includes(c.path)), false);
});

test('unconfirmed, unconfigured or unsupported suggestions never reserve or call a model', async t => {
  const f = fixture(t);
  const cases = [
    { ...input(), confirmCharge: false },
    { ...input(), field: 'evidence' },
    { ...input(), instruction: 'invent' },
    { ...input(), id: undefined },
    { ...input(), version: undefined },
  ];
  for (const unsafe of cases) {
    const result = await executeDeskMutation(unsafe as DeskMutation, session);
    assert.equal(result.ok, false, JSON.stringify(unsafe));
    assert.equal(result.code, 'invalid');
  }
  delete process.env.EDITORIAL_OPENROUTER_API_KEY;
  const result = await executeDeskMutation(input(), session);
  assert.equal(result.ok, false);
  assert.match(result.message, /dedicated editorial OpenRouter key/);
  assert.equal(f.calls.some(c => ['acquire_brief_worker', 'reserve_brief_suggestion', 'completions'].includes(c.path)), false);
});

test('suggestion returns only a review candidate grounded in the saved capture and audited under the shared lease', async t => {
  const f = fixture(t);
  const original = structuredClone(f.active);
  const result = await executeDeskMutation(input(), session);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.suggestion, { field: 'oneLiner', value: 'A simpler source-backed line.', cost: 0.012 });
  assert.equal(result.attemptsToday, 7);
  assert.deepEqual(f.active, original, 'No draft or source changes');
  const lease = f.calls.find(c => c.path === 'acquire_brief_worker')!;
  assert.match(String(lease.body.p_token), /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.calls.find(c => c.path === 'reserve_brief_suggestion')?.body, { p_token: lease.body.p_token, p_id: id, p_version: 1, p_field: 'oneLiner', p_instruction: 'simplify', p_actor: actor });
  const request = f.calls.find(c => c.path === 'completions')!;
  assert.equal(request.headers.get('authorization'), 'Bearer fixture-editorial-only');
  assert.equal(request.body.model, 'fixture/structured-model');
  const messages = request.body.messages as { content: string }[];
  assert.deepEqual(JSON.parse(messages[1].content), { sourceTitle: f.active.brief_sources.title, sourceText: f.active.source_text, field: 'oneLiner', currentValue: f.active.content.oneLiner, evidence: f.active.content.evidence });
  const audits = f.calls.filter(c => c.path === 'brief_suggestions');
  assert.ok(audits.some(c => c.body.model === 'fixture/structured-model'));
  assert.ok(audits.some(c => c.body.cost === 0.012 && c.body.input_tokens === 90 && c.body.output_tokens === 20));
  assert.ok(audits.some(c => c.body.state === 'complete' && typeof c.body.finished_at === 'string'));
  assert.deepEqual(f.calls.find(c => c.path === 'release_brief_worker')?.body, { p_token: lease.body.p_token });
  assert.ok(f.calls.findIndex(c => c.path === 'reserve_brief_suggestion') < f.calls.findIndex(c => c.path === 'completions'));
  assert.ok(f.calls.filter(c => c.path === 'load_brief_desk').every(c => c.headers.get('authorization') === 'Bearer fixture-session'));
  assert.ok(f.calls.filter(c => c.path === 'reserve_brief_suggestion' || c.path === 'brief_suggestions').every(c => c.headers.get('authorization') === 'Bearer fixture-service'));
});
