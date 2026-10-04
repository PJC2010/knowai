import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import starters from "../src/data/editorial-starters.json";
import type { DeskData } from "../src/lib/editorial/desk-types";

const actor = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const oldSql = await readFile(new URL("../supabase/migrations/202610040001_brief.sql", import.meta.url), "utf8");
const newSql = await readFile(new URL("../supabase/migrations/202610040002_editorial_desk.sql", import.meta.url), "utf8").catch(() => "");
async function setup() {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(oldSql);
  await db.query("insert into auth.users values($1);", [actor]);
  await db.query("insert into brief_editors values($1);", [actor]);
  await db.exec(newSql);
  return db;
}
async function editor(db: PGlite) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
async function source(db: PGlite, n = 0) {
  return (await db.query<{id: string}>("insert into brief_sources(url,slug,title,source_name,source_published_at,category) values($1,$2,$3,'OpenAI','2026-10-01','Models') returning id", [`https://openai.com/news/${n}`, `story-${n}`, `Story ${n}`])).rows[0].id;
}
async function revision(db: PGlite, story: string) {
  const c = starters[0].content;
  return (await db.query<{id: string}>("insert into brief_revisions(story_id,content,source_text,source_hash) values($1,$2,$3,'hash') returning id", [story, JSON.stringify(c), c.evidence.map(e=>e.quote).join(" ")])).rows[0].id;
}
async function desk(db: PGlite, query = {}) {
  return (await db.query<{data: DeskData}>("select load_brief_desk($1) as data", [JSON.stringify(query)])).rows[0].data;
}

test('confirmed queue authorization releases only selected queued jobs without creating attempts', async () => {
 const db=await setup();
 try {
  const legacy=await source(db,1), undone=await source(db,2), held=await source(db,3);
  const fresh=await source(db,4), failed=await source(db,5), reviewed=await source(db,6), running=await source(db,7);
  for (const [story,state] of [[legacy,'queued'],[undone,'queued'],[held,'queued'],[failed,'failed'],[reviewed,'needs_review'],[running,'generating']]) {
   await db.query('insert into brief_jobs(story_id,dedupe_key,state) values($1,$2,$3)',[story,story,state]);
  }
  await editor(db);
  await db.query("select triage_brief_sources($1,'selected')",[[undone]]);
  await db.query('select enqueue_brief_selection($1,false)',[[undone]]);
  await db.query("select triage_brief_sources($1,'dismissed')",[[undone]]);
  await db.query("select triage_brief_sources($1,'selected')",[[legacy,undone,fresh,failed,reviewed,running]]);
  const before=(await db.query<{id:string;story_id:string;selected:boolean}>('select * from brief_jobs order by id')).rows;
  assert.equal(before.find(j=>j.story_id===legacy)?.selected,false);
  assert.equal(before.find(j=>j.story_id===undone)?.selected,false,'Undo alone must not renew charge consent');
  await db.exec('set role service_role');
  await db.query('select acquire_brief_worker($1)',[token]);
  assert.equal((await db.query('select * from claim_brief_selected_job($1,null)',[token])).rows.length,0);
  await editor(db);
  const authorize=async()=>(await db.query<{ids:string[]}>('select authorize_brief_selected_queue() as ids')).rows[0].ids;
  const ids=await authorize();
  assert.deepEqual([...ids].sort(),before.filter(j=>[legacy,undone].includes(j.story_id)).map(j=>j.id).sort());
  const after=(await db.query<{id:string;story_id:string;selected:boolean}>('select * from brief_jobs order by id')).rows;
  assert.equal(after.length,before.length,'No fresh, failed or reviewed job may be enqueued');
  assert.deepEqual(await authorize(),ids,'Double confirmation reuses the same queue');
  assert.deepEqual((await db.query('select * from brief_jobs order by id')).rows,after,'Repeat authorization preserves timestamps');
  assert.deepEqual(after.filter(j=>!ids.includes(j.id as string)),before.filter(j=>!ids.includes(j.id)));
  await db.exec(newSql.replace('begin;','reset role; begin;'));
  await editor(db);
  assert.deepEqual(await authorize(),ids,'Migration reapplication preserves authorization');
  await db.exec('set role service_role');
  for(let n=0;n<ids.length;n++) assert.ok(ids.includes((await db.query<{id:string}>('select * from claim_brief_selected_job($1,$2)',[token,ids])).rows[0].id));
  assert.equal((await db.query('select * from claim_brief_selected_job($1,null)',[token])).rows.length,0);
  await editor(db);
  assert.deepEqual(await authorize(),[],'No new attempts when all authorized jobs are already running');
 } finally {await db.close();}
});

test('triage caps persisted selection at 200 atomically and allows deselection and legacy recovery', async () => {
 const db=await setup();
 try {
  await db.exec("insert into brief_sources(url,slug,title,source_name,source_published_at,category,triage) select 'https://openai.com/cap/'||n,'cap-'||n,'Cap '||n,'OpenAI','2026-10-01','Models',case when n<=198 then 'selected' else 'inbox' end from generate_series(1,204) n");
  const ids=(await db.query<{id:string}>("select id from brief_sources where triage='inbox' order by slug")).rows.map(s=>s.id);
  await editor(db);
  await assert.rejects(db.query("select triage_brief_sources($1,'selected')",[ids.slice(0,3)]),/200/);
  assert.equal((await desk(db)).selectedIds.length,198,'A rejected batch must not select a partial subset');
  await db.query("select triage_brief_sources($1,'selected')",[[ids[0],ids[0],ids[1]]]);
  assert.equal((await desk(db)).selectedIds.length,200,'Duplicate IDs count only once');
  await db.query("select triage_brief_sources($1,'selected')",[[ids[0]]]);
  await assert.rejects(db.query("select triage_brief_sources($1,'selected')",[[ids[2]]]),/200/);
  await db.query("select triage_brief_sources($1,'saved')",[[ids[0]]]);
  await db.query("select triage_brief_sources($1,'selected')",[[ids[2]]]);
  await db.exec('reset role');
  await db.query("update brief_sources set triage='selected' where id=any($1)",[ids]);
  await db.exec(newSql);
  await editor(db);
  assert.equal((await desk(db)).selectedIds.length,204,'Migration must not discard pre-existing selections');
  await db.query("select triage_brief_sources($1,'selected')",[[ids[0]]]);
  await db.query("select triage_brief_sources($1,'dismissed')",[[ids[0]]]);
  assert.equal((await desk(db)).selectedIds.length,203,'Over-cap legacy selection can shrink');
  await assert.rejects(db.query("select triage_brief_sources($1,'selected')",[[ids[0]]]),/200/);
  await db.query("select triage_brief_sources($1,'inbox')",[ids.slice(1,5)]);
  await db.query("select triage_brief_sources($1,'selected')",[[ids[0]]]);
  assert.equal((await desk(db)).selectedIds.length,200);
 } finally {await db.close();}
});

test('regeneration cannot grow selection beyond 200 or create a job when rejected', async () => {
 const db=await setup();
 try {
  await db.exec("insert into brief_sources(url,slug,title,source_name,source_published_at,category,triage) select 'https://openai.com/regen/'||n,'regen-'||n,'Regen '||n,'OpenAI','2026-10-01','Models','selected' from generate_series(1,200) n");
  const other=await source(db);
  const existing=(await db.query<{id:string}>("select id from brief_sources where triage='selected' limit 1")).rows[0].id;
  await editor(db);
  await assert.rejects(db.query('select enqueue_brief_selection($1,true)',[[other]]),/200/);
  assert.equal((await desk(db)).selectedIds.length,200);
  assert.equal((await db.query('select * from brief_jobs')).rows.length,0);
  assert.equal((await db.query<{ids:string[]}>('select enqueue_brief_selection($1,true) as ids',[[existing]])).rows[0].ids.length,1,'Regenerating an already selected source needs no extra slot');
  await db.query("select triage_brief_sources($1,'inbox')",[[existing]]);
  assert.equal((await db.query<{ids:string[]}>('select enqueue_brief_selection($1,true) as ids',[[other]])).rows[0].ids.length,1);
  assert.equal((await desk(db)).selectedIds.length,200);
 } finally {await db.close();}
});

test('automatic drafting uses only remaining selection capacity and leaves excess sources in inbox', async () => {
 const db=await setup();
 try {
  await db.exec("insert into brief_sources(url,slug,title,source_name,source_published_at,category,triage) select 'https://openai.com/auto/'||n,'auto-'||n,'Auto '||n,'OpenAI','2026-10-01','Models','selected' from generate_series(1,199) n");
  const a=await source(db,1), b=await source(db,2);
  await db.exec("update brief_sources set publisher_id=(select id from brief_publishers where name='OpenAI')");
  await editor(db);
  await db.query('select set_brief_auto_draft(true,true)');
  await db.exec('set role service_role');
  const auto=async()=>(await db.query<{ids:string[]}>('select enqueue_brief_auto($1) as ids',[[a,b]])).rows[0].ids;
  assert.equal((await auto()).length,1);
  assert.deepEqual(await auto(),[],'No queue growth after capacity is consumed');
  assert.equal((await db.query("select * from brief_sources where triage='inbox'")).rows.length,1);
  await editor(db);
  assert.equal((await desk(db)).selectedIds.length,200);
  const first=(await db.query<{story_id:string}>('select story_id from brief_jobs')).rows[0].story_id;
  await db.query("select triage_brief_sources($1,'saved')",[[first]]);
  await db.exec('set role service_role');
  assert.equal((await auto()).length,1);
  assert.equal((await db.query("select * from brief_sources where triage='selected'")).rows.length,200);
 } finally {await db.close();}
});

test('selection writers and queue authorization hold the same transaction lock', async () => {
 const db=await setup();
 try {
  const s=await source(db);
  await db.query("update brief_sources set triage='selected',publisher_id=(select id from brief_publishers where name='OpenAI') where id=$1",[s]);
  await editor(db);
  await db.query('select set_brief_auto_draft(true,true)');
  // PGlite is single-connection: inspect the real held lock, not pretend that
  // Promise.all on its serialized query queue proves cross-session blocking.
  for(const [role,sql,args] of [
   ['authenticated',"select triage_brief_sources($1,'selected')",[[s]]],
   ['authenticated',"select triage_brief_sources($1,'dismissed')",[[s]]],
   ['authenticated','select enqueue_brief_selection($1,false)',[[s]]],
   ['authenticated','select enqueue_brief_selection($1,true)',[[s]]],
   ['service_role','select enqueue_brief_auto($1)',[[s]]],
   ['authenticated','select authorize_brief_selected_queue()',[]],
  ] as const) {
   await db.exec(`set role ${role}; begin`);
   try {
    await db.query(sql,[...args]);
    const locks=(await db.query("select * from pg_locks where locktype='advisory' and classid=0 and objid=620105 and mode='ExclusiveLock' and granted")).rows;
    assert.equal(locks.length,1,`${sql} must hold selection serialization until commit`);
   } finally {await db.exec('rollback');}
   assert.equal((await db.query("select * from pg_locks where locktype='advisory' and objid=620105")).rows.length,0);
  }
 } finally {await db.close();}
});

test('regeneration double click reuses a newly authorized old held job even after completion',async()=>{
 const db=await setup();
 try{
  const s=await source(db);
  await db.query("insert into brief_jobs(story_id,dedupe_key,created_at) values($1,'yesterday',now()-interval '1 day')",[s]);
  await editor(db);
  const enqueue=async()=>(await db.query<{ids:string[]}>('select enqueue_brief_selection($1,true) as ids',[[s]])).rows[0].ids;
  const first=await enqueue();
  await db.exec('reset role');await db.query("update brief_jobs set state='needs_review',finished_at=now() where id=$1",[first[0]]);await editor(db);
  assert.deepEqual(await enqueue(),first);
  assert.equal((await db.query('select * from brief_jobs')).rows.length,1);
 }finally{await db.close();}
});

test('null versions cannot bypass optimistic concurrency through either old or desk RPCs',async()=>{
 const db=await setup();
 try {
  const s=await source(db),r=await revision(db,s);await editor(db);
  for(const fn of ['save_brief_revision','save_brief_desk']) await assert.rejects(db.query(`select ${fn}($1,null,$2)`,[r,JSON.stringify(starters[0].content)]),/Draft changed/);
  await assert.rejects(db.query('select review_brief_revision($1,null,true)',[r]),/Draft changed/);
  await assert.rejects(db.query('select review_brief_desk($1,null,true,true,true)',[r]),/Draft changed/);
  assert.equal((await desk(db,{id:r})).active?.version,1);
  assert.equal((await db.query('select * from brief_publications')).rows.length,0);
 }finally{await db.close();}
});

test('Supabase default function grants cannot expose privileged worker or private helper RPCs',async()=>{
 const db=await setup();
 try {
  await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated');
  // Simulate both existing explicit defaults and functions created after those defaults.
  await db.exec('grant execute on all functions in schema public to anon,authenticated');
  await db.exec('drop function authorize_brief_selected_queue()');
  await db.exec(newSql);
  await db.exec('set role anon');
  for(const query of ["select brief_lock_selection('{}'::uuid[])","select authorize_brief_selected_queue()","select load_brief_desk('{}')","select brief_attempts_today()","select brief_desk_source($1)","select acquire_brief_worker($1)","select release_brief_worker($1)","select * from claim_brief_job($1)","select * from claim_brief_selected_job($1,null)","select enqueue_brief_auto($1::uuid[])"]) {
   await assert.rejects(db.query(query,query.includes('$1')?[query.includes('uuid[]')?[token]:token]:[]),/permission denied/);
  }
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select authorize_brief_selected_queue()'),/Editor access/);
  await assert.rejects(db.query("select brief_lock_selection('{}')"),/permission denied/);
  await editor(db);
  assert.deepEqual((await db.query<{ids:string[]}>('select authorize_brief_selected_queue() as ids')).rows[0].ids,[]);
  await assert.rejects(db.query("select brief_lock_selection('{}')"),/permission denied/);
  await assert.rejects(db.query('select acquire_brief_worker($1)',[token]),/permission denied/);
  assert.equal((await desk(db)).sources.length,0);
 } finally {await db.close();}
});

test("suggestions reserve the shared daily cap under the worker lease without changing drafts", async () => {
 const db=await setup();
 try {
  const s=await source(db), r=await revision(db,s);
  await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at) select $1,'spent-'||n,'failed',now() from generate_series(1,9) n",[s]);
  await editor(db);
  await assert.rejects(db.query("select reserve_brief_suggestion($1,$2,1,'oneLiner','shorten',$3)",[token,r,actor]),/permission denied/);
  await db.exec("set role service_role");
  await assert.rejects(db.query("select reserve_brief_suggestion($1,$2,1,'oneLiner','shorten',$3)",[token,r,actor]),/worker/i);
  await db.query("select acquire_brief_worker($1)",[token]);
  await assert.rejects(db.query("select reserve_brief_suggestion($1,$2,2,'oneLiner','shorten',$3)",[token,r,actor]),/Draft changed/);
  const id=(await db.query<{id:string}>("select reserve_brief_suggestion($1,$2,1,'oneLiner','shorten',$3) as id",[token,r,actor])).rows[0].id;
  await db.query("update brief_suggestions set state='failed',cost=0.02,error='Invalid output' where id=$1",[id]);
  await assert.rejects(db.query("select reserve_brief_suggestion($1,$2,1,'whyItMatters','simplify',$3)",[token,r,actor]),/daily/i);
  await db.query("update brief_sources set triage='selected' where id=$1",[s]);
  await db.query("insert into brief_jobs(story_id,dedupe_key,selected) values($1,'pending',true)",[s]);
  assert.equal((await db.query("select * from claim_brief_job($1)",[token])).rows.length,0);
  await editor(db);
  assert.equal((await desk(db)).attemptsToday,10);
  assert.deepEqual((await desk(db,{id:r})).active?.content,starters[0].content);
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from brief_suggestions"),/permission denied/);
 } finally {await db.close();}
});

test("publisher and automatic drafting require consent and never adopt held legacy jobs", async () => {
 const db=await setup();
 try {
  const a=await source(db), b=await source(db,1);
  const p=(await db.query<{id:string}>("select id from brief_publishers where name='OpenAI'")).rows[0].id;
  await db.query("update brief_sources set publisher_id=$1",[p]);
  await db.query("insert into brief_jobs(story_id,dedupe_key) values($1,'legacy')",[a]);
  await editor(db);
  await assert.rejects(db.query("select set_brief_auto_draft(true,false)"),/Confirm/);
  await db.query("select set_brief_publisher($1,false)",[p]);
  await db.query("select set_brief_auto_draft(true,true)");
  await db.exec("set role service_role");
  assert.deepEqual((await db.query<{ids:string[]}>("select enqueue_brief_auto($1) as ids",[[a,b]])).rows[0].ids,[]);
  await editor(db); await db.query("select set_brief_publisher($1,true)",[p]);
  await db.exec("set role service_role");
  assert.equal((await db.query<{ids:string[]}>("select enqueue_brief_auto($1) as ids",[[a,b]])).rows[0].ids.length,1);
  assert.equal((await db.query<{selected:boolean}>("select selected from brief_jobs where dedupe_key='legacy'")).rows[0].selected,false);
  await editor(db); await db.query("select set_brief_auto_draft(false,false)");
  assert.equal((await desk(db)).autoDraft,false);
 } finally {await db.close();}
});

test("desk saves return their own version and restore creates a same-story private draft", async () => {
  const db = await setup();
  try {
    const s = await source(db), other = await source(db,1);
    const r = await revision(db,s), foreign = await revision(db,other);
    await editor(db);
    const c = starters[0].content;
    assert.equal((await db.query<{v:number}>("select save_brief_desk($1,1,$2) as v", [r,JSON.stringify({...c,oneLiner:'Edited.'})])).rows[0].v,2);
    await assert.rejects(db.query("select save_brief_desk($1,1,$2)",[r,JSON.stringify(c)]), /Draft changed/);
    const h = (await db.query<{id:string}>("select id from brief_revision_history where revision_id=$1",[r])).rows[0].id;
    await assert.rejects(db.query("select restore_brief_revision($1,$2)",[foreign,h]), /same story/);
    const restored = (await db.query<{id:string}>("select restore_brief_revision($1,$2) as id",[r,h])).rows[0].id;
    const data = await desk(db,{id:restored});
    assert.equal(data.active?.state,'needs_review'); assert.equal(data.active?.version,1);
    assert.deepEqual(data.active?.content,c);
    await assert.rejects(db.query("select review_brief_desk($1,1,true,false,true)",[restored]), /review/);
    await db.query("select review_brief_desk($1,1,true,true,true)",[restored]);
    await assert.rejects(db.query("select save_brief_desk($1,2,$2)",[restored,JSON.stringify(c)]), /editable/);
    const live = (await db.query("select * from brief_publications")).rows;
    await db.query("select restore_brief_revision($1,$2)",[restored,h]);
    assert.deepEqual((await db.query("select * from brief_publications")).rows,live);
  } finally { await db.close(); }
});

test("desk loads exact filtered pages beyond 100 and keeps captures in active revision only", async () => {
  const db = await setup();
  try {
    const s = await source(db);
    const r = await revision(db,s);
    await db.exec("insert into brief_sources(url,slug,title,source_name,source_published_at,category) select 'https://openai.com/news/bulk-'||n,'bulk-'||n,'Bulk '||n,'OpenAI','2026-10-02','Models' from generate_series(1,125) n");
    await db.exec("set role anon");
    await assert.rejects(desk(db), /permission denied/);
    await db.exec("set role authenticated");
    await assert.rejects(desk(db), /Editor access/);
    await editor(db);
    const data = await desk(db,{view:'inbox',page:'5',q:'Bulk',id:r});
    assert.equal(data.total,125); assert.equal(data.counts.inbox,126);
    assert.equal(data.page,5); assert.equal(data.sources.length,25);
    assert.equal(data.active?.id,r); assert.ok(data.active?.source_text);
    const drafts = await desk(db,{view:'drafts',id:r});
    assert.equal(drafts.total,1); assert.equal(drafts.revisions[0].source_text,'');
    assert.equal((await desk(db,{view:'inbox',q:'no match'})).total,0);
    assert.equal((await desk(db,{view:'inbox',page:'9999'})).page,6);
    await db.query("select triage_brief_sources($1,'selected')", [[s]]);
    const selected = await desk(db,{status:'selected'});
    assert.deepEqual(selected.selectedIds,[s]); assert.equal(selected.total,1);
    assert.equal((await desk(db,{category:'Research'})).total,0);
    assert.equal((await desk(db,{since:'2026-10-03'})).total,0);
  } finally { await db.close(); }
});

test("desk migration persists private publisher settings and holds legacy jobs idempotently", async () => {
  const db = await setup();
  try {
    const s = await source(db);
    await db.query("insert into brief_jobs(story_id,dedupe_key) values($1,'legacy')", [s]);
    assert.equal((await db.query<{selected: boolean}>("select selected from brief_jobs")).rows[0].selected, false);
    assert.equal((await db.query("select * from brief_publishers")).rows.length, 4);
    assert.equal((await db.query<{auto_draft: boolean}>("select auto_draft from brief_settings")).rows[0].auto_draft, false);
    await db.exec(newSql);
    assert.equal((await db.query("select * from brief_publishers")).rows.length, 4);
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from brief_publishers"), /permission denied/);
    await assert.rejects(db.query("select * from brief_settings"), /permission denied/);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from brief_publishers")).rows.length, 0);
    await editor(db);
    assert.equal((await db.query("select * from brief_publishers")).rows.length, 4);
    await assert.rejects(db.query("update brief_settings set auto_draft=true"), /permission denied/);
  } finally { await db.close(); }
});

test("selection authorizes exact jobs, holds legacy work and deduplicates double clicks", async () => {
  const db = await setup();
  try {
    const a = await source(db, 1), b = await source(db, 2), c = await source(db, 3);
    await db.query("insert into brief_jobs(story_id,dedupe_key) values($1,'legacy')", [c]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select triage_brief_sources($1,'selected')", [[a]]), /Editor access/);
    await editor(db);
    await assert.rejects(db.query("select enqueue_brief_selection($1,false)", [[a]]), /selected/);
    await db.query("select triage_brief_sources($1,'selected')", [[a,b]]);
    const enqueue = async (ids: string[], regen = false) => (await db.query<{ids: string[]}>("select enqueue_brief_selection($1,$2) as ids", [ids,regen])).rows[0].ids;
    const jobs = await enqueue([a,b]);
    assert.equal(jobs.length, 2);
    assert.deepEqual(await enqueue([a,b]), jobs);
    const bJob = (await db.query<{id: string}>("select id from brief_jobs where story_id=$1", [b])).rows[0].id;
    await db.exec("set role service_role");
    await db.query("select acquire_brief_worker($1)", [token]);
    assert.equal((await db.query("select * from claim_brief_selected_job($1,$2)", [actor,jobs])).rows.length, 0);
    assert.equal((await db.query<{story_id: string}>("select * from claim_brief_selected_job($1,$2)", [token,[bJob]])).rows[0].story_id, b);
    assert.equal((await db.query("select * from claim_brief_selected_job($1,$2)", [token,[bJob]])).rows.length, 0);
    assert.equal((await db.query<{story_id: string}>("select * from claim_brief_job($1)", [token])).rows[0].story_id, a);
    assert.equal((await db.query("select * from claim_brief_job($1)", [token])).rows.length, 0);
    await editor(db);
    const regen = await enqueue([c], true);
    assert.deepEqual(await enqueue([c], true), regen);
    await db.query("select triage_brief_sources($1,'saved')", [[c]]);
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from claim_brief_selected_job($1,$2)", [token,regen])).rows.length, 0);
  } finally { await db.close(); }
});
