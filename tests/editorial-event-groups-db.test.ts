import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = '11111111-1111-4111-8111-111111111111';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const eventMigration = '202610060001_editorial_events.sql';

async function setup() {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  for (const file of (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && name < eventMigration).sort())
    await db.exec(await readFile(new URL(file, migrationDir), 'utf8'));
  await db.query('insert into auth.users(id) values($1)', [actor]);
  await db.query('insert into brief_editors(user_id) values($1)', [actor]);
  return db;
}
async function addSource(db: PGlite, suffix: string) {
  return (await db.query<{id:string}>(`insert into brief_sources(url,slug,title,source_name,source_published_at,category)
    values($1,$2,$3,'OpenAI','2026-10-05T15:00:00Z','Industry') returning id`,
    [`https://openai.com/${suffix}`, suffix, `OpenAI ${suffix}`])).rows[0].id;
}
async function editor(db: PGlite) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}

test('event migration backfills private singleton groups, covers new sources and preserves prior identities', async () => {
  const db = await setup();
  try {
    const first = await addSource(db,'first');
    const second = await addSource(db,'second');
    const before = (await db.query('select id,url,slug from brief_sources order by id')).rows;
    const migration = await readFile(new URL(eventMigration,migrationDir),'utf8');
    await db.exec(migration);
    const third = await addSource(db,'third');
    await editor(db);
    const context = async (id:string) => (await db.query<{value:{eventId:string;leadSourceId:string;members:{id:string;title:string;source_name:string;url:string}[]}}>('select load_brief_event($1) as value',[id])).rows[0].value;
    const one = await context(first);
    assert.equal(one.leadSourceId,first);
    assert.deepEqual(one.members.map(member => member.id),[first]);
    assert.notEqual((await context(second)).eventId,one.eventId);
    const matches = (await db.query<{value:{id:string;title:string;source_name:string;url:string}[]}>('select search_brief_event_sources($1,$2) as value',[first,'second'])).rows[0].value;
    assert.deepEqual(matches.map(item=>item.id),[second]);
    assert.deepEqual((await db.query<{value:unknown[]}>('select search_brief_event_sources($1,$2) as value',[first,'se'])).rows[0].value,[]);
    assert.deepEqual((await db.query('select id,url,slug from brief_sources where id<>$1 order by id',[third])).rows,before);
    assert.deepEqual((await context(third)).members.map(member => member.id),[third]);
    await db.exec('reset role');
    await db.exec(migration);
    await editor(db);
    assert.equal((await db.query<{n:number}>('select count(*)::integer as n from brief_events')).rows[0].n,3);
    assert.equal((await db.query<{n:number}>('select count(*)::integer as n from brief_event_sources')).rows[0].n,3);
    assert.equal((await context(first)).eventId,one.eventId);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from brief_events'),/permission denied/i);
    await assert.rejects(db.query('select * from brief_event_sources'),/permission denied/i);
    await assert.rejects(db.query('select load_brief_event($1)',[first]),/permission denied/i);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(db.query('select load_brief_event($1)',[first]),/Editor access/i);
    await editor(db);
    assert.equal((await context(first)).leadSourceId,first);
    await assert.rejects(db.query('update brief_events set lead_source_id=$1',[second]),/permission denied/i);
  } finally { await db.close(); }
});

test('editor merges groups, chooses a lead and splits a source without changing publications or jobs', async () => {
  const db = await setup();
  try {
    const a = await addSource(db,'alpha');
    const b = await addSource(db,'beta');
    const c = await addSource(db,'gamma');
    const d = await addSource(db,'delta');
    await db.query(`insert into brief_publications(id,slug,source_url,source_name,source_published_at,category,
      one_liner,short_version,whole_picture,why_it_matters)
      select id,slug,url,source_name,source_published_at,category,'Original headline','Original short copy',array['Original paragraph'],'Original conclusion'
      from brief_sources where id=$1`,[a]);
    await db.query("insert into brief_jobs(story_id,dedupe_key,state) values($1,'manual-job','queued')",[b]);
    const publications = (await db.query('select * from brief_publications')).rows;
    const jobs = (await db.query('select * from brief_jobs')).rows;
    const migration = await readFile(new URL(eventMigration,migrationDir),'utf8');
    await db.exec(migration);
    await editor(db);
    const context = async (id:string) => (await db.query<{value:{eventId:string;leadSourceId:string;members:{id:string}[]}}>('select load_brief_event($1) as value',[id])).rows[0].value;
    const initial = await context(a);
    const merge = async (lead:string,other:string) => (await db.query<{id:string}>('select merge_brief_events($1,$2) as id',[lead,other])).rows[0].id;
    assert.equal(await merge(a,b),initial.eventId);
    assert.deepEqual(new Set((await context(b)).members.map(s=>s.id)),new Set([a,b]));
    await merge(c,d);
    await merge(a,c);
    assert.deepEqual(new Set((await context(a)).members.map(s=>s.id)),new Set([a,b,c,d]));
    assert.equal((await context(d)).eventId,initial.eventId);
    await db.query('select set_brief_event_lead($1)',[b]);
    assert.equal((await context(a)).leadSourceId,b);
    await db.query('select split_brief_event_source($1)',[b]);
    assert.deepEqual((await context(b)).members.map(s=>s.id),[b]);
    const remaining = await context(a);
    assert.deepEqual(new Set(remaining.members.map(s=>s.id)),new Set([a,c,d]));
    assert.ok([a,c,d].includes(remaining.leadSourceId));
    assert.equal(remaining.eventId,initial.eventId);
    await db.query('select split_brief_event_source($1)',[d]);
    assert.deepEqual(new Set((await context(a)).members.map(s=>s.id)),new Set([a,c]));
    await assert.rejects(db.query('select split_brief_event_source($1)',[d]),/already alone/i);
    await assert.rejects(db.query('select merge_brief_events($1,$2)',[a,a]),/different sources/i);
    assert.deepEqual((await db.query('select * from brief_publications')).rows,publications);
    assert.deepEqual((await db.query('select * from brief_jobs')).rows,jobs);
    const history = (await db.query<{action:string;actor:string}>('select action,actor from brief_event_history order by created_at,id')).rows;
    assert.deepEqual(history.map(row=>row.action).sort(),['merge','merge','merge','lead','split','split'].sort());
    assert.ok(history.every(row=>row.actor===actor));
    await db.exec('set role anon');
    await assert.rejects(db.query('select merge_brief_events($1,$2)',[a,b]),/permission denied/i);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(db.query('select split_brief_event_source($1)',[a]),/Editor access/i);
    await editor(db);
    await db.exec('reset role');
    await db.exec(migration);
    await editor(db);
    assert.deepEqual(new Set((await context(a)).members.map(s=>s.id)),new Set([a,c]));
  } finally { await db.close(); }
});

test('private RPCs resolve public event tables ahead of same-named temporary tables',async()=>{
  const db=await setup();
  try {
    const first=await addSource(db,'first');
    const second=await addSource(db,'second');
    await db.exec(await readFile(new URL(eventMigration,migrationDir),'utf8'));
    await editor(db);
    const context=async(id:string)=>(await db.query<{value:{eventId:string}}>('select load_brief_event($1) as value',[id])).rows[0].value;
    const expected=(await context(first)).eventId;
    const secondEvent=(await context(second)).eventId;
    await db.exec('create temporary table brief_event_sources (source_id uuid, event_id uuid)');
    await db.query('insert into brief_event_sources(source_id,event_id) values($1,$2)',[first,secondEvent]);
    assert.equal((await context(first)).eventId,expected);
  } finally {await db.close();}
});

test('a non-editor cannot impersonate an editor with a temporary brief_editors table',async()=>{
  const db=await setup();
  try {
    const first=await addSource(db,'first');
    const second=await addSource(db,'second');
    const stranger='22222222-2222-4222-8222-222222222222';
    await db.query('insert into auth.users(id) values($1)',[stranger]);
    await db.exec(await readFile(new URL(eventMigration,migrationDir),'utf8'));
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[stranger]);
    assert.equal((await db.query<{allowed:boolean}>('select is_brief_editor() as allowed')).rows[0].allowed,false);
    await db.exec('create temporary table brief_editors(user_id uuid)');
    await db.query('insert into brief_editors(user_id) values($1)',[stranger]);
    assert.equal((await db.query<{allowed:boolean}>('select is_brief_editor() as allowed')).rows[0].allowed,false);
    await assert.rejects(db.query('select load_brief_event($1)',[first]),/Editor access/i);
    await assert.rejects(db.query('select merge_brief_events($1,$2)',[first,second]),/Editor access/i);
    assert.equal((await db.query<{n:number}>('select count(*)::integer as n from brief_events')).rows[0].n,0);
  } finally {await db.close();}
});
