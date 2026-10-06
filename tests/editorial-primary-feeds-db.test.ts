import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = (name: string) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('new publisher migration is private, repeatable, and preserves existing editor switches', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
   create role anon; create role authenticated; create role service_role bypassrls;
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(await migration('202610040001_brief.sql'));
  await db.exec(await migration('202610040002_editorial_desk.sql'));
  await db.exec(await migration('202610040003_editorial_daily_cap.sql'));
  const sql=await migration('20261005224600_primary_source_feeds.sql');
  await db.exec(sql);
  const expected=[
   ['Google DeepMind','https://deepmind.google/blog/rss.xml'],
   ['Google Research','https://research.google/blog/rss/'],
   ['Meta Engineering','https://engineering.fb.com/feed/'],
  ];
  const rows=(await db.query<{name:string;feed_url:string;enabled:boolean}>('select name,feed_url,enabled from public.brief_publishers order by name')).rows;
  assert.equal(rows.length,7);
  for(const [name,url] of expected) assert.deepEqual(rows.find(r=>r.name===name),{name,feed_url:url,enabled:true});
  await db.exec("update public.brief_publishers set enabled=false where name='Google Research'");
  await db.exec(sql);
  assert.equal((await db.query<{count:number}>('select count(*)::integer as count from public.brief_publishers')).rows[0].count,7);
  assert.equal((await db.query<{enabled:boolean}>("select enabled from public.brief_publishers where name='Google Research'")).rows[0].enabled,false);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.brief_publishers'),/permission denied/);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select * from public.brief_publishers')).rows.length,0);
 } finally { await db.close(); }
});

test('migration rejects new-feed auto drafting even when the old cron sends their IDs', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
   create role anon; create role authenticated; create role service_role bypassrls;
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  for (const name of ['202610040001_brief.sql','202610040002_editorial_desk.sql','202610040003_editorial_daily_cap.sql'])
   await db.exec(await migration(name));
  const sql=await migration('20261005224600_primary_source_feeds.sql');
  await db.exec(sql);
  await db.exec('update public.brief_settings set auto_draft=true where id=true');
  const ids: string[]=[];
  for (const name of ['OpenAI','Google DeepMind','Google Research','Meta Engineering']) {
   const slug=name.toLowerCase().replaceAll(' ','-');
   const row=await db.query<{id:string}>(`insert into public.brief_sources(url,slug,title,source_name,source_published_at,category,publisher_id)
    select $1,$2,'Test story',p.name,'2026-10-05','Models',p.id from public.brief_publishers p where p.name=$3 returning id`,
    [`https://example.test/${slug}`,slug,name]);
   ids.push(row.rows[0].id);
  }
  const result=await db.query<{ids:string[]}>('select public.enqueue_brief_auto($1::uuid[]) as ids',[ids]);
  assert.equal(result.rows[0].ids.length,1);
  assert.equal((await db.query<{story_id:string}>("select story_id from public.brief_jobs where dedupe_key like '%:auto'")).rows[0].story_id,ids[0]);
  assert.deepEqual((await db.query<{triage:string}>("select triage from public.brief_sources where id=any($1::uuid[]) order by id",[ids.slice(1)])).rows.map(r=>r.triage),['inbox','inbox','inbox']);
  await db.exec(sql);
  assert.deepEqual((await db.query<{ids:string[]}>('select public.enqueue_brief_auto($1::uuid[]) as ids',[ids.slice(1)])).rows[0].ids,[]);
 } finally { await db.close(); }
});
