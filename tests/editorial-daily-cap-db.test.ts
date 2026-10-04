import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import starters from '../src/data/editorial-starters.json';
import type { DeskData } from '../src/lib/editorial/desk-types';

const actor = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
async function setup() {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  for (const file of (await readdir(migrationDir)).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, migrationDir), 'utf8'));
  }
  await db.query('insert into auth.users values($1)', [actor]);
  await db.query('insert into brief_editors values($1)', [actor]);
  return db;
}
async function editor(db: PGlite) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
async function desk(db: PGlite, query = {}) {
  return (await db.query<{ data: DeskData }>('select load_brief_desk($1) as data', [JSON.stringify(query)])).rows[0].data;
}
async function setLimit(db: PGlite, limit: number | null, consent: boolean | null = false) {
  await db.query('select set_brief_daily_attempt_limit($1,$2)', [limit, consent]);
}
async function source(db: PGlite, n = 0) {
  return (await db.query<{ id: string }>("insert into brief_sources(url,slug,title,source_name,source_published_at,category) values($1,$2,$3,'OpenAI','2026-10-01','Models') returning id", [`https://openai.com/cap/${n}`, `cap-${n}`, `Story ${n}`])).rows[0].id;
}
async function revision(db: PGlite, story: string) {
  const c = starters[0].content;
  return (await db.query<{ id: string }>("insert into brief_revisions(story_id,content,source_text,source_hash) values($1,$2,$3,'hash') returning id", [story, JSON.stringify(c), c.evidence.map(e => e.quote).join(' ')])).rows[0].id;
}

test('editors can raise with consent or lower/same without consent, preserving all usage and work', async () => {
  const db = await setup();
  try {
    const s = await source(db), r = await revision(db, s);
    await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at) values($1,'spent','failed',now()),($1,'waiting','queued',null)", [s]);
    await db.query("insert into brief_suggestions(revision_id,version,field,instruction,actor,state) values($1,1,'oneLiner','simplify',$2,'failed')", [r, actor]);
    await editor(db);
    await db.query('select set_brief_auto_draft(true,true)');
    const jobs = (await db.query('select * from brief_jobs order by id')).rows;
    const suggestions = (await db.query('select * from brief_suggestions order by id')).rows;
    await assert.rejects(setLimit(db, 25, false), /Confirm.*charg/i);
    await assert.rejects(setLimit(db, 25, null), /Confirm.*charg/i);
    assert.equal((await desk(db)).dailyAttemptLimit, 10);
    await setLimit(db, 25, true);
    assert.equal((await desk(db)).dailyAttemptLimit, 25);
    await setLimit(db, 25, false);
    await setLimit(db, 5, false);
    await setLimit(db, 5, null);
    assert.equal((await desk(db)).dailyAttemptLimit, 5);
    // Consent is compared to the stored current value, not a stale client's ten.
    await assert.rejects(setLimit(db, 6, false), /Confirm.*charg/i);
    assert.equal((await desk(db)).attemptsToday, 2);
    assert.equal((await desk(db)).autoDraft, true);
    assert.deepEqual((await db.query('select * from brief_jobs order by id')).rows, jobs);
    assert.deepEqual((await db.query('select * from brief_suggestions order by id')).rows, suggestions);
    assert.equal((await desk(db, { id: r })).active?.version, 1);
  } finally { await db.close(); }
});

test('invalid and null limits are rejected explicitly, with database constraints as defense in depth', async () => {
  const db = await setup();
  try {
    await editor(db);
    for (const limit of [null, 0, -1, 1001, 2147483647]) {
      await assert.rejects(setLimit(db, limit, true), /between 1 and 1000/);
      assert.equal((await desk(db)).dailyAttemptLimit, 10);
    }
    await setLimit(db, 1000, true);
    await setLimit(db, 1, false);
    assert.equal((await desk(db)).dailyAttemptLimit, 1);
    await db.exec('reset role');
    for (const limit of [null, 0, 1001]) await assert.rejects(db.query('update brief_settings set daily_attempt_limit=$1', [limit]), /constraint/);
  } finally { await db.close(); }
});

test('raising an exhausted ten to 25 permits selected work; lowering below consumption blocks without resetting usage', async () => {
  const db = await setup();
  try {
    const a = await source(db), b = await source(db, 1), held = await source(db, 2);
    await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at) select $1,'spent-'||n,'failed',now() from generate_series(1,10) n", [held]);
    await db.query("insert into brief_jobs(story_id,dedupe_key) values($1,'legacy')", [held]);
    await editor(db);
    await db.query("select triage_brief_sources($1,'selected')", [[a,b]]);
    const jobs = (await db.query<{ ids: string[] }>('select enqueue_brief_selection($1,false) as ids', [[a,b]])).rows[0].ids;
    await db.exec('set role service_role');
    await db.query('select acquire_brief_worker($1)', [token]);
    const claim = (ids: string[] | null = jobs) => db.query<{ id: string }>('select * from claim_brief_selected_job($1,$2)', [token,ids]);
    assert.equal((await claim()).rows.length, 0);
    await editor(db); await setLimit(db, 25, true);
    await db.exec('set role service_role');
    assert.equal((await claim([])).rows.length, 0, 'An empty exact-ID authorization must not become unscoped');
    assert.deepEqual((await claim([jobs[1]])).rows.map(j => j.id), [jobs[1]]);
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 11);
    await setLimit(db, 1);
    await db.exec('set role service_role');
    assert.equal((await claim()).rows.length, 0);
    assert.equal((await db.query('select * from claim_brief_job($1)', [token])).rows.length, 0);
    await editor(db); await setLimit(db, 25, true);
    await db.query("select triage_brief_sources($1,'saved')", [[a,b]]);
    await db.exec('set role service_role');
    assert.equal((await claim(null)).rows.length, 0, 'Neither deselected nor held legacy jobs are eligible');
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 11);
  } finally { await db.close(); }
});

test('generation and suggestions share the changed cap, count failed attempts, and reset at UTC midnight', async () => {
  const db = await setup();
  try {
    const s = await source(db), r = await revision(db, s);
    await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at) select $1,'spent-'||n,'failed',now() from generate_series(1,10) n", [s]);
    await editor(db); await setLimit(db, 12, true);
    await db.query("select enqueue_brief_selection($1,true)", [[s]]);
    await db.exec("set role service_role; set time zone 'Pacific/Honolulu'");
    await db.query('select acquire_brief_worker($1)', [token]);
    const reserve = (field = 'oneLiner') => db.query('select reserve_brief_suggestion($1,$2,1,$3,\'simplify\',$4)', [token,r,field,actor]);
    await reserve();
    await db.exec("update brief_suggestions set state='failed'");
    assert.equal((await db.query('select * from claim_brief_job($1)', [token])).rows.length, 1);
    await assert.rejects(reserve('whyItMatters'), /daily attempt limit/);
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 12);
    // The exact UTC boundary is included even in a non-UTC session; just before is not.
    await db.exec("reset role; update brief_jobs set attempted_at=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 millisecond'; update brief_suggestions set attempted_at=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'");
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 1);
    await db.exec("reset role; update brief_suggestions set attempted_at=attempted_at-interval '1 millisecond'; set role service_role");
    await reserve('whyItMatters');
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 1);
    assert.equal((await desk(db)).dailyAttemptLimit, 12);
  } finally { await db.close(); }
});

test('automatic enqueue respects remaining daily capacity while retaining selection headroom and consent', async () => {
  const db = await setup();
  try {
    const a = await source(db), b = await source(db,1), c = await source(db,2);
    await db.exec("update brief_sources set publisher_id=(select id from brief_publishers where name='OpenAI')");
    await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at) select $1,'spent-'||n,'failed',now() from generate_series(1,10) n", [a]);
    const auto = async () => (await db.query<{ ids: string[] }>('select enqueue_brief_auto($1) as ids', [[b,c]])).rows[0].ids;
    await editor(db); await db.query('select set_brief_auto_draft(true,true)');
    await db.exec('set role service_role');
    assert.deepEqual(await auto(), [], 'An exhausted cap leaves new discoveries in the inbox');
    await editor(db); await setLimit(db,11,true);
    await db.exec('set role service_role');
    const jobs = await auto();
    assert.equal(jobs.length,1,'Only remaining daily headroom is selected and queued');
    await db.query('select acquire_brief_worker($1)',[token]);
    assert.equal((await db.query('select * from claim_brief_selected_job($1,$2)',[token,jobs])).rows.length,1);
    assert.deepEqual(await auto(),[]);
    await editor(db); await setLimit(db,25,true);
    await db.query('select set_brief_auto_draft(false,false)');
    await db.exec('set role service_role');
    assert.deepEqual(await auto(),[],'Changing the cap cannot turn on automatic drafting');
    await editor(db); await db.query('select set_brief_auto_draft(true,true)');
    await db.exec("reset role; insert into brief_sources(url,slug,title,source_name,source_published_at,category,triage) select 'https://openai.com/selected/'||n,'selected-'||n,'Selected '||n,'OpenAI',now(),'Models','selected' from generate_series(1,199) n; set role service_role");
    assert.deepEqual(await auto(),[],'The 200-story selection limit remains independent');
  } finally { await db.close(); }
});

test('missing cap configuration fails closed for desk reads, changes and all reservation paths', async () => {
  const db = await setup();
  try {
    const s = await source(db), r = await revision(db,s);
    await editor(db);
    await db.query('select enqueue_brief_selection($1,true)',[[s]]);
    await db.exec('reset role; delete from brief_settings');
    await editor(db);
    await assert.rejects(desk(db), /Daily attempt limit.*unavailable/i);
    await assert.rejects(setLimit(db,25,true), /Daily attempt limit.*unavailable/i);
    await db.exec('set role service_role');
    await db.query('select acquire_brief_worker($1)',[token]);
    await assert.rejects(db.query('select * from claim_brief_selected_job($1,null)',[token]), /Daily attempt limit.*unavailable/i);
    await assert.rejects(db.query("select reserve_brief_suggestion($1,$2,1,'oneLiner','simplify',$3)",[token,r,actor]), /Daily attempt limit.*unavailable/i);
    await assert.rejects(db.query('select enqueue_brief_auto($1)',[[s]]), /Daily attempt limit.*unavailable/i);
    assert.equal((await db.query('select * from brief_jobs where attempted_at is not null')).rows.length,0);
    assert.equal((await db.query('select * from brief_suggestions')).rows.length,0);
  } finally { await db.close(); }
});

test('reapplying 003 preserves cap, usage and leases and restores editor-only settings permissions', async () => {
  const db = await setup();
  try {
    const s=await source(db), r=await revision(db,s);
    await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at) values($1,'spent','failed',now())",[s]);
    await editor(db); await setLimit(db,25,true);
    await db.query('select set_brief_auto_draft(true,true)');
    await db.exec('set role service_role'); await db.query('select acquire_brief_worker($1)',[token]);
    const lease=(await db.query('select * from brief_worker_lock')).rows;
    await db.exec('reset role; grant all on brief_settings to anon,authenticated; grant execute on function set_brief_daily_attempt_limit(integer,boolean) to anon');
    await db.exec(await readFile(new URL('202610040003_editorial_daily_cap.sql',migrationDir),'utf8'));
    assert.deepEqual((await db.query('select * from brief_worker_lock')).rows,lease);
    await editor(db);
    const data=await desk(db);
    assert.equal(data.dailyAttemptLimit,25); assert.equal(data.attemptsToday,1); assert.equal(data.autoDraft,true);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      for (const query of ['update brief_settings set daily_attempt_limit=1000','delete from brief_settings','insert into brief_settings(id) values(true)']) {
        await assert.rejects(db.query(query),/permission denied/);
      }
      for (const query of ["select brief_daily_attempt_limit()", "select * from claim_brief_selected_job($1,null)", "select enqueue_brief_auto($1::uuid[])", "select reserve_brief_suggestion($1,$2,1,'oneLiner','simplify',$3)"]) {
        const args=query.includes('$3')?[token,r,actor]:query.includes('uuid[]')?[[s]]:query.includes('$1')?[token]:[];
        await assert.rejects(db.query(query,args),/permission denied/);
      }
    }
    await db.exec('set role anon');
    await assert.rejects(setLimit(db,1000,true),/permission denied/);
    await assert.rejects(desk(db),/permission denied/);
    await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false)");
    await assert.rejects(setLimit(db,1000,true),/Editor access/);
    await assert.rejects(desk(db),/Editor access/);
    await editor(db); await setLimit(db,24,false);
    assert.equal((await desk(db)).dailyAttemptLimit,24);
  } finally { await db.close(); }
});

test('cap changes, claims, suggestions and auto enqueue hold the shared transaction lock until commit or rollback', async () => {
  const db=await setup();
  try {
    const s=await source(db), r=await revision(db,s);
    await editor(db); await db.query('select enqueue_brief_selection($1,true)',[[s]]);
    await db.query('select set_brief_auto_draft(true,true)');
    await db.exec('set role service_role'); await db.query('select acquire_brief_worker($1)',[token]);
    const locks=async()=>(await db.query<{objid:number}>("select objid from pg_locks where locktype='advisory' and classid=0 and mode='ExclusiveLock' and granted order by objid")).rows.map(r=>r.objid);
    // PGlite is one connection: these are held-lock/atomicity checks, NOT concurrent-session proof.
    for (const [role,sql,args,expected] of [
      ['authenticated','select set_brief_daily_attempt_limit(25,true)',[],[620104]],
      ['service_role','select * from claim_brief_selected_job($1,null)',[token],[620104]],
      ['service_role',"select reserve_brief_suggestion($1,$2,1,'oneLiner','simplify',$3)",[token,r,actor],[620104]],
      ['service_role','select enqueue_brief_auto($1)',[[s]],[620104,620105]],
    ] as const) {
      await db.exec(`set role ${role}; begin`);
      try { await db.query(sql,[...args]); assert.deepEqual(await locks(),expected); }
      finally { await db.exec('rollback'); }
      assert.deepEqual(await locks(),[]);
    }
    await editor(db);
    assert.equal((await desk(db)).dailyAttemptLimit,10); assert.equal((await desk(db)).attemptsToday,0);
    await db.exec('begin'); await setLimit(db,25,true); await db.exec('commit');
    assert.deepEqual(await locks(),[]); assert.equal((await desk(db)).dailyAttemptLimit,25);
    const definition=(await db.query<{sql:string}>("select pg_get_functiondef('enqueue_brief_auto(uuid[])'::regprocedure) as sql")).rows[0].sql;
    assert.ok(definition.indexOf("brief_lock_selection('{}')") < definition.indexOf('pg_advisory_xact_lock(620104)'), 'Selection serialization must precede attempt serialization');
  } finally { await db.close(); }
});

test('the persisted daily cap defaults to ten and the authorized desk returns it as a number', async () => {
  const db = await setup();
  try {
    await editor(db);
    assert.equal((await desk(db)).dailyAttemptLimit, 10);
    assert.equal((await desk(db)).attemptsToday, 0);
    assert.deepEqual((await db.query('select daily_attempt_limit from brief_settings')).rows, [{ daily_attempt_limit: 10 }]);
  } finally { await db.close(); }
});
