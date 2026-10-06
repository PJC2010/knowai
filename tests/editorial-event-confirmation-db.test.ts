import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = '11111111-1111-4111-8111-111111111111';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const confirmationMigration = '202610060002_editorial_event_confirmation.sql';

async function setup() {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  for (const file of (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && name < confirmationMigration).sort())
    await db.exec(await readFile(new URL(file, migrationDir), 'utf8'));
  await db.query('insert into auth.users(id) values($1)', [actor]);
  await db.query('insert into public.brief_editors(user_id) values($1)', [actor]);
  return db;
}
async function applyConfirmation(db: PGlite) {
  await db.exec('reset role');
  await db.exec(await readFile(new URL(confirmationMigration, migrationDir), 'utf8'));
}
async function addSource(db: PGlite, suffix: string) {
  return (await db.query<{ id: string }>(`insert into public.brief_sources(url,slug,title,source_name,source_published_at,category)
    values($1,$2,$3,'OpenAI','2026-10-05T15:00:00Z','Industry') returning id`,
  [`https://example.test/${suffix}`, suffix, `OpenAI ${suffix}`])).rows[0].id;
}
async function editor(db: PGlite) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
type EventContext = {
  eventId: string;
  version: number;
  leadSourceId: string;
  members: { id: string; title: string; source_name: string; url: string; source_published_at: string; category: string }[];
};
type MergePreview = { target: EventContext; other: EventContext };
async function context(db: PGlite, source: string) {
  return (await db.query<{ value: EventContext }>('select public.load_brief_event($1) as value', [source])).rows[0].value;
}
async function preview(db: PGlite, lead: string, other: string) {
  return (await db.query<{ value: MergePreview }>('select public.load_brief_event_merge_preview($1,$2) as value', [lead, other])).rows[0].value;
}
const confirmSql = 'select public.merge_brief_events($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::integer) as id';
async function confirm(db: PGlite, lead: string, other: string, expected: MergePreview) {
  return (await db.query<{ id: string }>(confirmSql,
    [lead, other, expected.target.eventId, expected.target.version, expected.other.eventId, expected.other.version])).rows[0].id;
}
async function merge(db: PGlite, lead: string, other: string) {
  return confirm(db, lead, other, await preview(db, lead, other));
}
async function unchangedConflict(db: PGlite, lead: string, other: string, expected: MergePreview) {
  const before = await eventState(db);
  await assert.rejects(confirm(db, lead, other, expected), { code: 'P0001', message: /^Event groups changed/ });
  assert.deepEqual(await eventState(db), before);
}
async function protectedState(db: PGlite) {
  return (await db.query(`select
    (select jsonb_agg(to_jsonb(s) order by s.id) from public.brief_sources s) as sources,
    (select jsonb_agg(to_jsonb(j) order by j.id) from public.brief_jobs j) as jobs,
    (select jsonb_agg(to_jsonb(r) order by r.id) from public.brief_revisions r) as revisions,
    (select jsonb_agg(to_jsonb(p) order by p.id) from public.brief_publications p) as publications`)).rows;
}
async function eventState(db: PGlite) {
  return (await db.query<{ events: unknown; members: unknown; history: unknown }>(`select
    (select jsonb_agg(to_jsonb(e) order by e.id) from public.brief_events e) as events,
    (select jsonb_agg(to_jsonb(m) order by m.source_id) from public.brief_event_sources m) as members,
    (select jsonb_agg(to_jsonb(h) order by h.id) from public.brief_event_history h) as history`)).rows;
}

test('invalid expected tokens and sources cannot mutate groups or audit', async () => {
  const db = await setup();
  try {
    await applyConfirmation(db);
    const a = await addSource(db, 'invalid-a');
    const b = await addSource(db, 'invalid-b');
    await editor(db);
    const expected = await preview(db, a, b);
    const valid = [a, b, expected.target.eventId, expected.target.version, expected.other.eventId, expected.other.version];
    const before = await eventState(db);
    for (const [index, value] of [[2, null], [4, null], [3, null], [5, null], [3, 0], [5, 0], [3, -1], [5, -1], [2, actor], [4, actor]] as const) {
      const args: (string | number | null)[] = [...valid];
      args[index] = value;
      await assert.rejects(db.query(confirmSql, args), { code: 'P0001', message: /^Event groups changed/ });
    }
    for (const [lead, other] of [[null, b], [a, null], [a, a]]) {
      await assert.rejects(db.query(confirmSql, [lead, other, ...valid.slice(2)]), /different sources/i);
    }
    for (const [lead, other] of [[actor, b], [a, actor]])
      await assert.rejects(db.query(confirmSql, [lead, other, ...valid.slice(2)]), { code: 'P0001', message: /^Event groups changed/ });
    await assert.rejects(db.query(confirmSql, [a, b, 'not-a-uuid', 1, expected.other.eventId, 1]), { code: '22P02' });
    assert.deepEqual(await eventState(db), before);
  } finally { await db.close(); }
});

test('vanished sources and replaced event identities reject old confirmations', async () => {
  const db = await setup();
  try {
    await applyConfirmation(db);
    for (const side of ['target', 'other'] as const) {
      await db.exec('reset role');
      const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(suffix => addSource(db, `vanished-${side}-${suffix}`)));
      await editor(db);
      let stale = await preview(db, a, b);
      const source = side === 'target' ? a : b;
      await db.exec('reset role; set role service_role');
      await db.query('delete from public.brief_events where id=$1', [stale[side].eventId]);
      await editor(db);
      await unchangedConflict(db, a, b, stale);
      await db.exec('reset role; set role service_role');
      await db.query(`with event as (insert into public.brief_events(lead_source_id) values($1) returning id)
        insert into public.brief_event_sources(event_id,source_id) select id,$1 from event`, [source]);
      await editor(db);
      assert.equal((await context(db, source)).version, stale[side].version);
      await unchangedConflict(db, a, b, stale);
      // Make the selected source a non-lead so its FK cascade can remove it.
      await merge(db, c, source);
      stale = await preview(db, a, b);
      await db.exec('reset role; set role service_role');
      await db.query('delete from public.brief_sources where id=$1', [source]);
      await editor(db);
      await unchangedConflict(db, a, b, stale);
    }
  } finally { await db.close(); }
});

test('20 sources succeed, 21 fail atomically, and migration reapply preserves changed groups', async () => {
  const db = await setup();
  try {
    await applyConfirmation(db);
    const sources = await Promise.all(Array.from({ length: 21 }, (_, i) => addSource(db, `cap-${i}`)));
    await editor(db);
    for (const other of sources.slice(1, 20)) await merge(db, sources[0], other);
    const twenty = await context(db, sources[0]);
    assert.equal(twenty.members.length, 20);
    assert.equal(twenty.version, 20);
    const before = await eventState(db);
    const protectedBefore = await protectedState(db);
    await assert.rejects(merge(db, sources[0], sources[20]), /at most 20/);
    assert.deepEqual(await eventState(db), before);
    await db.query('select public.set_brief_event_lead($1)', [sources[1]]);
    await db.query('select public.split_brief_event_source($1)', [sources[2]]);
    const changed = await eventState(db);
    await applyConfirmation(db);
    await applyConfirmation(db);
    await editor(db);
    assert.deepEqual(await eventState(db), changed);
    assert.deepEqual(await protectedState(db), protectedBefore);
    const stale = await preview(db, sources[0], sources[20]);
    await db.exec('reset role; set role service_role');
    await db.query('delete from public.brief_sources where id=$1', [sources[3]]);
    await editor(db);
    assert.equal((await context(db, sources[0])).version, stale.target.version + 1);
    await unchangedConflict(db, sources[0], sources[20], stale);
  } finally { await db.close(); }
});

test('RPC grants, RLS and qualified definer lookups resist anon, noneditors and temp shadows', async () => {
  const db = await setup();
  try {
    await applyConfirmation(db);
    const a = await addSource(db, 'security-a');
    const b = await addSource(db, 'security-b');
    const c = await addSource(db, 'security-c');
    await editor(db);
    const expected = await preview(db, a, b);
    const calls: [string, unknown[]][] = [
      ['select public.load_brief_event($1)', [a]],
      ['select public.load_brief_event_merge_preview($1,$2)', [a, b]],
      [confirmSql, [a, b, expected.target.eventId, expected.target.version, expected.other.eventId, expected.other.version]],
      ['select public.set_brief_event_lead($1)', [a]],
      ['select public.split_brief_event_source($1)', [a]],
    ];
    const signatures = ['load_brief_event(uuid)', 'load_brief_event_merge_preview(uuid,uuid)',
      'merge_brief_events(uuid,uuid,uuid,integer,uuid,integer)', 'set_brief_event_lead(uuid)',
      'split_brief_event_source(uuid)', 'invalidate_brief_event_member_delete()'];
    for (const signature of signatures) {
      const row = (await db.query<{ anon: boolean; authenticated: boolean; public_execute: boolean; prosecdef: boolean; proconfig: string[] }>(`select
        has_function_privilege('anon',p.oid,'execute') as anon,
        has_function_privilege('authenticated',p.oid,'execute') as authenticated,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,
        p.prosecdef,p.proconfig from pg_proc p where p.oid=$1::regprocedure`, [`public.${signature}`])).rows[0];
      assert.equal(row.anon, false);
      assert.equal(row.public_execute, false);
      assert.equal(row.authenticated, !signature.startsWith('invalidate_'));
      assert.equal(row.prosecdef, true);
      assert.ok(row.proconfig.includes('search_path=public, pg_temp'));
    }
    const before = await eventState(db);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", ['22222222-2222-4222-8222-222222222222']);
      for (const [sql, args] of calls)
        await assert.rejects(db.query(sql, args), role === 'anon' ? { code: '42501' } : /Editor access required/);
      await assert.rejects(db.query('select public.invalidate_brief_event_member_delete()'), { code: '42501' });
      for (const table of ['brief_events', 'brief_event_sources', 'brief_event_history']) {
        if (role === 'anon') await assert.rejects(db.query(`select * from public.${table}`), { code: '42501' });
        else assert.deepEqual((await db.query(`select * from public.${table}`)).rows, []);
        await assert.rejects(db.query(`delete from public.${table}`), { code: '42501' });
        await assert.rejects(db.query(`insert into public.${table} default values`), { code: '42501' });
        const key = table === 'brief_event_sources' ? 'source_id' : 'id';
        await assert.rejects(db.query(`update public.${table} set ${key}=${key}`), { code: '42501' });
      }
    }
    await db.exec(`create temp table brief_editors(user_id uuid);
      insert into brief_editors values('22222222-2222-4222-8222-222222222222');
      create temp table brief_events(like public.brief_events);
      create temp table brief_event_sources(like public.brief_event_sources);
      create temp table brief_sources(like public.brief_sources);
      create temp table brief_event_history(like public.brief_event_history);
      set search_path=pg_temp,public;`);
    for (const [sql, args] of calls) await assert.rejects(db.query(sql, args), /Editor access required/);
    await editor(db);
    assert.deepEqual(await eventState(db), before);
    assert.deepEqual(await preview(db, a, b), expected);
    await confirm(db, a, b, expected);
    await db.query('select public.set_brief_event_lead($1)', [b]);
    await db.query('select public.split_brief_event_source($1)', [b]);
    await merge(db, a, c);
    const deletionPreview = await preview(db, a, b);
    await db.exec('reset role; set role service_role');
    await db.query('delete from public.brief_sources where id=$1', [c]);
    await editor(db);
    await unchangedConflict(db, a, b, deletionPreview);
    for (const table of ['brief_events', 'brief_event_sources', 'brief_sources', 'brief_event_history'])
      assert.deepEqual((await db.query(`select * from pg_temp.${table}`)).rows, []);
  } finally { await db.close(); }
});

test('service deletion of a non-lead source invalidates reviewed membership on either side', async () => {
  const db = await setup();
  try {
    await applyConfirmation(db);
    for (const side of ['target', 'other'] as const) {
      await db.exec('reset role');
      const [a, b, removed] = await Promise.all(['a', 'b', 'removed'].map(suffix => addSource(db, `deleted-${side}-${suffix}`)));
      await editor(db);
      await merge(db, side === 'target' ? a : b, removed);
      const stale = await preview(db, a, b);
      const historyBefore = (await eventState(db))[0].history;
      await db.exec('reset role; set role service_role');
      await db.query('delete from public.brief_sources where id=$1', [removed]);
      await editor(db);
      const after = await context(db, side === 'target' ? a : b);
      assert.equal(after.version, stale[side].version + 1);
      assert.equal(after.members.length, 1);
      assert.deepEqual((await eventState(db))[0].history, historyBefore);
      await unchangedConflict(db, a, b, stale);
    }
  } finally { await db.close(); }
});

test('a stale legacy client cannot silently merge unseen group growth', async () => {
  const db = await setup();
  try {
    const a = await addSource(db, 'legacy-a');
    const b = await addSource(db, 'legacy-b');
    const unseen = await addSource(db, 'legacy-unseen');
    await editor(db);
    // The old client previewed B alone, before a different editor added another source.
    const before = (await db.query<{ value: { members: { id: string }[] } }>(
      'select public.load_brief_event($1) as value', [b])).rows[0].value;
    assert.deepEqual(before.members.map(member => member.id), [b]);
    await db.query('select public.merge_brief_events($1,$2)', [b, unseen]);
    await applyConfirmation(db);
    await editor(db);
    const state = await eventState(db);
    await assert.rejects(db.query('select public.merge_brief_events($1::uuid,$2::uuid)', [a, b]),
      { code: '42883' }, 'the unsafe two-argument RPC must be absent, not silently merge the unseen member');
    assert.deepEqual(await eventState(db), state);
  } finally { await db.close(); }
});

test('versioned stable preview returns both complete groups and rejects invalid pairs', async () => {
  const db = await setup();
  try {
    const a = await addSource(db, 'preview-a');
    const b = await addSource(db, 'preview-b');
    const c = await addSource(db, 'preview-c');
    const d = await addSource(db, 'preview-d');
    await editor(db);
    await db.query('select public.merge_brief_events($1,$2)', [a, b]);
    await db.query('select public.merge_brief_events($1,$2)', [c, d]);
    const identities = [(await context(db, a)).eventId, (await context(db, c)).eventId];
    await applyConfirmation(db);
    await editor(db);
    const pair = await preview(db, b, d);
    assert.deepEqual(pair, { target: await context(db, a), other: await context(db, c) });
    assert.deepEqual([pair.target.eventId, pair.other.eventId], identities);
    for (const [group, lead, ids] of [[pair.target, a, [a, b]], [pair.other, c, [c, d]]] as const) {
      assert.equal(group.version, 1);
      assert.equal(group.leadSourceId, lead);
      assert.equal(group.members[0].id, lead);
      assert.deepEqual(new Set(group.members.map(member => member.id)), new Set(ids));
      assert.ok(group.members.every(member => member.title.startsWith('OpenAI ') && member.source_name === 'OpenAI'
        && member.url.startsWith('https://example.test/') && member.category === 'Industry' && member.source_published_at));
    }
    assert.deepEqual((await db.query<{ provolatile: string }>(`select provolatile from pg_proc
      where oid in ('public.load_brief_event(uuid)'::regprocedure,
        'public.load_brief_event_merge_preview(uuid,uuid)'::regprocedure)`)).rows.map(row => row.provolatile), ['s', 's']);
    await assert.rejects(preview(db, a, a), /different sources/i);
    await assert.rejects(preview(db, a, b), /different event groups/i);
    await assert.rejects(preview(db, a, actor), /Source not found/i);
    await assert.rejects(db.query('select public.load_brief_event_merge_preview(null,$1)', [a]), /different sources/i);
    await db.exec('reset role');
    await assert.rejects(db.query('update public.brief_events set version=0'), { code: '23514' });
    await assert.rejects(db.query('update public.brief_events set version=-1'), { code: '23514' });
    await assert.rejects(db.query('update public.brief_events set version=null'), { code: '23502' });
    const fresh = await addSource(db, 'preview-fresh');
    await editor(db);
    assert.equal((await context(db, fresh)).version, 1);
  } finally { await db.close(); }
});

test('confirmation rejects either group growing, then merges exactly the refreshed membership once', async () => {
  const db = await setup();
  try {
    const [a, b, c, d, e, f] = await Promise.all(
      ['growth-a', 'growth-b', 'growth-c', 'growth-d', 'growth-e', 'growth-f'].map(suffix => addSource(db, suffix)));
    await db.query(`insert into public.brief_publications(id,slug,source_url,source_name,source_published_at,category,
      one_liner,short_version,whole_picture,why_it_matters)
      select id,slug,url,source_name,source_published_at,category,'Original headline','Original short copy',
        array['Original paragraph'],'Original conclusion' from public.brief_sources where id=$1`, [a]);
    await db.query("insert into public.brief_jobs(story_id,dedupe_key,state) values($1,'confirmation-job','queued')", [b]);
    await db.query(`insert into public.brief_revisions(story_id,content,source_text,source_hash)
      values($1,'{"draft":"unchanged"}','Original private source','unchanged-hash')`, [c]);
    const protectedBefore = await protectedState(db);
    await applyConfirmation(db);
    await editor(db);
    for (const [lead, other, added, side] of [[a, b, c, 'target'], [d, e, f, 'other']] as const) {
      const stale = await preview(db, lead, other);
      const growing = side === 'target' ? lead : other;
      await merge(db, growing, added);
      const grown = await context(db, growing);
      assert.equal(grown.version, stale[side].version + 1);
      await unchangedConflict(db, lead, other, stale);
      const fresh = await preview(db, lead, other);
      assert.equal(await confirm(db, lead, other, fresh), fresh.target.eventId);
      const merged = await context(db, lead);
      assert.equal(merged.version, fresh.target.version + 1);
      assert.equal(merged.leadSourceId, lead);
      assert.deepEqual(new Set(merged.members.map(member => member.id)),
        new Set([...fresh.target.members, ...fresh.other.members].map(member => member.id)));
      const audit = (await db.query<{ source_ids: string[]; actor: string; source_id: string }>(
        "select source_ids,actor,source_id from public.brief_event_history where action='merge' and from_event_id=$1", [fresh.other.eventId])).rows;
      assert.deepEqual(audit, [{ source_ids: fresh.other.members.map(member => member.id).sort(), actor, source_id: lead }]);
      await unchangedConflict(db, lead, other, fresh); // A duplicate is a conflict, not a successful no-op.
      assert.deepEqual(await protectedState(db), protectedBefore);
    }
  } finally { await db.close(); }
});

test('lead changes invalidate previews even after reverting, while a no-op leaves version and audit alone', async () => {
  const db = await setup();
  try {
    const [a, b, c, d] = await Promise.all(['lead-a', 'lead-b', 'lead-c', 'lead-d'].map(suffix => addSource(db, suffix)));
    await applyConfirmation(db);
    await editor(db);
    await merge(db, a, b);
    await merge(db, c, d);
    for (const [lead, replacement, side] of [[a, b, 'target'], [c, d, 'other']] as const) {
      const stale = await preview(db, a, c);
      const beforeNoop = await eventState(db);
      await db.query('select public.set_brief_event_lead($1)', [lead]);
      assert.deepEqual(await eventState(db), beforeNoop);
      await db.query('select public.set_brief_event_lead($1)', [replacement]);
      assert.equal((await context(db, lead)).version, stale[side].version + 1);
      await unchangedConflict(db, a, c, stale);
      await db.query('select public.set_brief_event_lead($1)', [lead]);
      const reverted = await context(db, lead);
      assert.deepEqual({ ...reverted, version: stale[side].version }, stale[side]);
      assert.equal(reverted.version, stale[side].version + 2);
      await unchangedConflict(db, a, c, stale);
    }
  } finally { await db.close(); }
});

test('lead and non-lead splits invalidate either group, including shrink-and-restore and moved source identities', async () => {
  const db = await setup();
  try {
    await applyConfirmation(db);
    for (const side of ['target', 'other'] as const) {
      for (const splitLead of [false, true]) {
        await db.exec('reset role');
        const prefix = `split-${side}-${splitLead}`;
        const [a, b, c, d, e, f] = await Promise.all(
          ['a', 'b', 'c', 'd', 'e', 'f'].map(suffix => addSource(db, `${prefix}-${suffix}`)));
        await editor(db);
        await merge(db, a, b);
        await merge(db, a, c);
        await merge(db, d, e);
        await merge(db, d, f);
        const stale = await preview(db, a, d);
        const splitSource = side === 'target' ? (splitLead ? a : b) : (splitLead ? d : e);
        const stayingSource = side === 'target' ? c : f;
        const singleton = (await db.query<{ id: string }>('select public.split_brief_event_source($1) as id', [splitSource])).rows[0].id;
        const remaining = await context(db, stayingSource);
        const split = await context(db, splitSource);
        assert.equal(remaining.eventId, stale[side].eventId);
        assert.equal(remaining.version, stale[side].version + 1);
        assert.equal(split.eventId, singleton);
        assert.notEqual(split.eventId, stale[side].eventId);
        assert.equal(split.version, 1);
        assert.deepEqual(split.members.map(member => member.id), [splitSource]);
        assert.deepEqual(new Set(remaining.members.map(member => member.id)),
          new Set(stale[side].members.map(member => member.id).filter(id => id !== splitSource)));
        assert.ok(remaining.members.some(member => member.id === remaining.leadSourceId));
        await unchangedConflict(db, a, d, stale);
        const beforeInvalidSplit = await eventState(db);
        await assert.rejects(db.query('select public.split_brief_event_source($1)', [splitSource]), /already alone/i);
        assert.deepEqual(await eventState(db), beforeInvalidSplit);
        if (!splitLead) {
          // Restore exactly the original IDs, lead and members; the old token must still expire.
          await merge(db, side === 'target' ? a : d, splitSource);
          const restored = await context(db, stayingSource);
          assert.deepEqual({ ...restored, version: stale[side].version }, stale[side]);
          assert.equal(restored.version, stale[side].version + 2);
          await unchangedConflict(db, a, d, stale);
        }
      }
    }
  } finally { await db.close(); }
});
