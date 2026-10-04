import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const actor = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const story = '33333333-3333-4333-8333-333333333333';
const revision = '44444444-4444-4444-8444-444444444444';
const queued = '55555555-5555-4555-8555-555555555555';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const claim = `select coalesce(jsonb_agg(id),'[]'::jsonb) from claim_brief_selected_job('${token}',array['${queued}']::uuid[]);`;
const suggestion = `select reserve_brief_suggestion('${token}','${revision}',1,'oneLiner','simplify','${actor}');`;
const reserve = kind => kind === 'generator' ? claim : suggestion;
const setter = limit => `select set_brief_daily_attempt_limit(${limit},false);`;

export async function install(observer) {
  await observer.run(`create schema auth;
    create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  // Execute the repository migrations unchanged, in their real prerequisite order.
  for (const file of ['202610040001_brief.sql', '202610040002_editorial_desk.sql', '202610040003_editorial_daily_cap.sql']) {
    await observer.run(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    console.log(`MIGRATION ${file}`);
  }
  await observer.run(`insert into auth.users values('${actor}'); insert into brief_editors values('${actor}');`);
}

export async function mutate(observer, kind) {
  const signature = {
    generator: 'claim_brief_selected_job(uuid,uuid[])',
    suggestion: 'reserve_brief_suggestion(uuid,uuid,integer,text,text,uuid)',
    setter: 'set_brief_daily_attempt_limit(integer,boolean)',
  }[kind];
  assert.ok(signature, 'Unknown mutation');
  const definition = await observer.run(`select pg_get_functiondef('${signature}'::regprocedure);`);
  const lock = 'perform pg_advisory_xact_lock(620104);';
  assert.equal(definition.split(lock).length, 2, 'Mutation must remove exactly one shared lock');
  // pg_get_functiondef returns a definition without the psql statement terminator.
  await observer.run(definition.replace(lock, '-- TEST MUTANT: shared attempt lock removed') + ';');
  console.log(`MUTATION ${kind}: removed lock in disposable database ONLY`);
}

async function role(session, name) {
  await session.run(`set role ${name};`);
  if (name === 'authenticated') await session.run(`set request.jwt.claim.sub='${actor}';`);
}

async function snapshot(session) {
  return session.json(`select jsonb_build_object(
    'usage',brief_attempts_today(),
    'settings',(select to_jsonb(s)-'daily_attempt_limit' from brief_settings s),
    'lease',(select to_jsonb(l) from brief_worker_lock l),
    'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by id),'[]'::jsonb) from brief_jobs j),
    'suggestions',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb) from brief_suggestions s),
    'revisions',(select jsonb_agg(to_jsonb(r) order by id) from brief_revisions r),
    'sources',(select jsonb_agg(to_jsonb(s) order by id) from brief_sources s));`);
}

async function fixture(observer, cap = 10) {
  const [{ content }] = JSON.parse(await readFile(new URL('../../src/data/editorial-starters.json', import.meta.url), 'utf8'));
  await observer.run(`truncate brief_suggestions,brief_revision_history,brief_publications,brief_revisions,brief_jobs,brief_sources;
    update brief_settings set daily_attempt_limit=${cap},auto_draft=true;
    update brief_worker_lock set token=null,expires_at=null;
    insert into brief_sources(id,url,slug,title,source_name,source_published_at,category,triage)
      values('${story}','https://example.invalid/local-cap-test','local-cap-test','Local test','Local',now(),'Models','selected');
    insert into brief_revisions(id,story_id,content,source_text,source_hash)
      values('${revision}','${story}',${quote(JSON.stringify(content))},${quote(content.evidence.map(e => e.quote).join(' '))},'local-fixture');
    insert into brief_jobs(story_id,dedupe_key,state,attempted_at,error,cost)
      values('${story}','spent','failed',now(),'Existing charged failure',0.25);
    insert into brief_jobs(id,story_id,dedupe_key,selected) values('${queued}','${story}','waiting',true);`);
  await role(observer, 'service_role');
  assert.equal(await observer.run(`select acquire_brief_worker('${token}');`), 't');
  await observer.run('reset role;');
  assert.equal((await snapshot(observer)).usage, 1);
}

async function rejected(result, pattern) {
  assert.equal(result.state, 'P0001', `Expected RPC rejection, got ${JSON.stringify(result)}`);
  assert.match(result.message, pattern);
}

function accepted(kind, result) {
  assert.equal(result.state, '00000', JSON.stringify(result));
  if (kind === 'generator') assert.deepEqual(JSON.parse(result.output), [queued]);
  else assert.match(result.output, /^[0-9a-f-]{36}$/);
}

async function denied(kind, result) {
  if (kind === 'generator') {
    assert.equal(result.state, '00000');
    assert.deepEqual(JSON.parse(result.output), []);
  } else await rejected(result, /daily attempt limit has been reached/);
}

async function waitForSharedLock(observer, holder, waiter, task, label) {
  const deadline = performance.now() + 5000;
  let observed;
  while (performance.now() < deadline) {
    observed = await observer.json(`select coalesce((select jsonb_build_object(
      'holder',h.pid,'waiter',a.pid,'state',a.state,'waitType',a.wait_event_type,
      'waitEvent',a.wait_event,'lock',w.objid,'granted',w.granted,'blockers',pg_blocking_pids(a.pid))
      from pg_stat_activity a
      join pg_locks w on w.pid=a.pid
      join pg_locks h on h.locktype=w.locktype and h.database=w.database
        and h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
      where a.pid=${waiter.pid} and h.pid=${holder.pid} and h.granted and not w.granted
        and w.locktype='advisory' and w.classid=0 and w.objid=620104 and w.objsubid=1
        and w.mode='ExclusiveLock' and h.mode='ExclusiveLock'
        and a.state='active' and a.wait_event_type='Lock' and a.wait_event='advisory'
        and ${holder.pid}=any(pg_blocking_pids(a.pid)) limit 1),'null'::jsonb);`);
    assert.ok(!task.done, `EXPECTED_ADVISORY_WAIT ${label}: RPC finished without shared-lock blocking: ${JSON.stringify(task.result ?? String(task.error))}`);
    if (observed) {
      console.log(`BLOCK ${label} ${JSON.stringify(observed)}`);
      return;
    }
    // Polling cadence only; pg_stat_activity + both pg_locks rows are the proof.
    await delay(20);
  }
  assert.fail(`EXPECTED_ADVISORY_WAIT ${label}: no observed shared-lock wait in 5s; last=${JSON.stringify(observed)}`);
}

async function unchangedAfterDenials(observer, worker, expected) {
  await role(worker, 'service_role');
  await denied('generator', await worker.start(claim, { allowError: true }).promise);
  await denied('suggestion', await worker.start(suggestion, { allowError: true }).promise);
  assert.deepEqual(await snapshot(observer), expected,
    'Lowering/denials must not reset usage, cancel work, change selected queue, draft/version, auto-draft or lease');
}

export async function runSuite(observer, a, b, only) {
  const tests = [];
  const add = (name, fn) => tests.push({ name, fn });
  add('default-grants', async () => {
    const acl = await observer.json(`select jsonb_build_object(
      'anonSetter',has_function_privilege('anon','set_brief_daily_attempt_limit(integer,boolean)','EXECUTE'),
      'authSetter',has_function_privilege('authenticated','set_brief_daily_attempt_limit(integer,boolean)','EXECUTE'),
      'privateRPCs',not exists(select 1 from unnest(array['anon','authenticated']) r
        cross join unnest(array['brief_daily_attempt_limit()','claim_brief_selected_job(uuid,uuid[])',
          'reserve_brief_suggestion(uuid,uuid,integer,text,text,uuid)']) f where has_function_privilege(r,f,'EXECUTE')));`);
    assert.deepEqual(acl, { anonSetter: false, authSetter: true, privateRPCs: true });
    await role(a, 'anon');
    const result = await a.start(setter(1), { allowError: true }).promise;
    assert.equal(result.state, '42501');
    assert.match(result.message, /permission denied/);
    await role(a, 'authenticated');
    await a.run("set request.jwt.claim.sub='66666666-6666-4666-8666-666666666666';");
    await rejected(await a.start(setter(1), { allowError: true }).promise, /Editor access required/);
  });

  for (const kind of ['generator', 'suggestion']) {
    add(`setter-first-${kind}`, async () => {
      const before = await snapshot(observer);
      await role(a, 'authenticated');
      await a.run('begin isolation level read committed;');
      await a.run(setter(1));
      await role(b, 'service_role');
      const task = b.start(reserve(kind), { allowError: true });
      await waitForSharedLock(observer, a, b, task, `setter-first-${kind}`);
      assert.equal(await observer.run('select daily_attempt_limit from brief_settings;'), '10');
      assert.deepEqual(await snapshot(observer), before, 'Uncommitted decrease must not leak');
      await a.run('commit;');
      await denied(kind, await task.promise);
      assert.equal(await observer.run('select daily_attempt_limit from brief_settings;'), '1');
      await unchangedAfterDenials(observer, b, before);
    });

    add(`reservation-first-${kind}`, async () => {
      await role(a, 'service_role');
      await a.run('begin isolation level read committed;');
      accepted(kind, await a.start(reserve(kind)).promise);
      // Snapshot the successful, still-uncommitted reservation in its own backend.
      await a.run('reset role;');
      const reserved = await snapshot(a);
      assert.equal(reserved.usage, 2);
      await role(b, 'authenticated');
      const task = b.start(setter(1), { allowError: true });
      await waitForSharedLock(observer, a, b, task, `reservation-first-${kind}`);
      assert.equal((await snapshot(observer)).usage, 1, 'Reservation not committed yet');
      await a.run('commit;');
      assert.equal((await task.promise).state, '00000');
      assert.equal(await observer.run('select daily_attempt_limit from brief_settings;'), '1');
      await unchangedAfterDenials(observer, b, reserved);
      assert.equal(kind === 'generator' ? reserved.jobs.find(j => j.id === queued).state : reserved.suggestions[0].state,
        'generating', 'Committed in-flight work remains running even above the lowered limit');
    });
  }

  add('stale-unconfirmed-setter', async () => {
    const before = await snapshot(observer);
    await role(b, 'authenticated');
    assert.equal(await b.run('select daily_attempt_limit from brief_settings;'), '10', 'Stale client intends a decrease to five');
    await role(a, 'authenticated');
    await a.run('begin isolation level read committed;');
    await a.run(setter(3));
    const task = b.start(setter(5), { allowError: true });
    await waitForSharedLock(observer, a, b, task, 'stale-unconfirmed-setter');
    await a.run('commit;');
    await rejected(await task.promise, /Confirm increasing.*additional charges/);
    assert.equal(await observer.run('select daily_attempt_limit from brief_settings;'), '3');
    assert.deepEqual(await snapshot(observer), before);
  });

  for (const winner of ['generator', 'suggestion']) {
    const loser = winner === 'generator' ? 'suggestion' : 'generator';
    add(`last-slot-${winner}-first`, async () => {
      await role(a, 'service_role');
      await role(b, 'service_role');
      await a.run('begin isolation level read committed;');
      accepted(winner, await a.start(reserve(winner)).promise);
      await a.run('reset role;');
      const reserved = await snapshot(a);
      const task = b.start(reserve(loser), { allowError: true });
      await waitForSharedLock(observer, a, b, task, `last-slot-${winner}-first`);
      assert.equal((await snapshot(observer)).usage, 1);
      await a.run('commit;');
      await denied(loser, await task.promise);
      const final = await snapshot(observer);
      assert.equal(final.usage, 2, 'Exactly one of the two concurrent reservations consumes the last shared slot');
      assert.deepEqual(final, reserved, 'Losing reservation must not change any work');
      await unchangedAfterDenials(observer, b, final);
    });
  }

  const selected = only ? tests.filter(t => t.name === only) : tests;
  assert.ok(selected.length, `Unknown --case ${only}`);
  let passed = 0;
  for (const { name, fn } of selected) {
    await a.run('rollback; reset role;');
    await b.run('rollback; reset role;');
    await fixture(observer, name.startsWith('last-slot-') ? 2 : 10);
    try {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}: ${error.message}`);
      throw error;
    }
  }
  console.log(`RESULT ${passed}/${selected.length} PostgreSQL tests passed`);
}
