import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { fixtureRest } from "./helpers/editorial-fixture-rest";

test("local REST fixture supports named RPCs, exact counts and filtered pagination", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role service_role;
      create table stories(id int, title text, state text);
      insert into stories values(1,'First story','inbox'),(2,'Second story','saved'),(3,'Third story','inbox');
      grant select on stories to authenticated;
      create function fixture_add(p_a int,p_b int) returns int language sql as $$select p_a+p_b$$;`);
    const result = await fixtureRest(db, 'authenticated', '/stories?select=id,title&state=eq.inbox&order=id.desc&offset=0&limit=1', 'GET', {}, null);
    assert.deepEqual(result.body, [{id:3,title:'Third story'}]);
    assert.equal(result.total,2);
    const rpc = await fixtureRest(db, 'authenticated', '/rpc/fixture_add','POST',{}, {p_a:4,p_b:5});
    assert.equal(rpc.body,9);
    const count = await fixtureRest(db, 'authenticated', '/stories?state=eq.saved','HEAD',{},null);
    assert.equal(count.total,1);
    assert.equal(count.body,null);
  } finally { await db.close(); }
});

test('discovery fixture writes real source rows without resetting duplicate triage',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role service_role; create role authenticated;
   create table brief_sources(id serial primary key,url text unique,title text,triage text default 'inbox');
   grant all on brief_sources to service_role; grant usage,select on sequence brief_sources_id_seq to service_role;`);
  const insert=()=>fixtureRest(db,'service_role','/brief_sources?on_conflict=url&select=id','POST',{'prefer':'resolution=ignore-duplicates,return=representation'},{url:'https://mistral.ai/news/model',title:'Model'});
  const first=await insert();
  assert.deepEqual(first.body,[{id:1}]);
  await db.exec("update brief_sources set triage='selected'");
  assert.deepEqual((await insert()).body,[]);
  assert.equal((await db.query<{triage:string}>('select triage from brief_sources')).rows[0].triage,'selected');
  await assert.rejects(fixtureRest(db,'authenticated','/brief_sources','POST',{},{}),/service/);
 } finally {await db.close();}
});

test('fixture publisher health updates require a service role and exact publisher ID',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role service_role; create role authenticated;
   create table brief_publishers(id uuid primary key,last_error text,last_result jsonb);
   insert into brief_publishers values('11111111-1111-4111-8111-111111111111',null,null);
   grant all on brief_publishers to service_role;`);
  const path='/brief_publishers?id=eq.11111111-1111-4111-8111-111111111111';
  await fixtureRest(db,'service_role',path,'PATCH',{}, {last_error:'Unavailable',last_result:{inserted:0}});
  assert.deepEqual((await db.query('select last_error,last_result from brief_publishers')).rows,[{last_error:'Unavailable',last_result:{inserted:0}}]);
  await assert.rejects(fixtureRest(db,'service_role','/brief_publishers','PATCH',{}, {last_error:'Bad'}),/exact/);
  await assert.rejects(fixtureRest(db,'authenticated',path,'PATCH',{}, {last_error:'Bad'}),/service/);
  await assert.rejects(fixtureRest(db,'service_role',path,'PATCH',{}, {enabled:true}),/health/);
 } finally {await db.close();}
});

test("local REST fixture enforces role permissions and refuses arbitrary SQL identifiers", async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create table private_rows(id int);');
    await assert.rejects(fixtureRest(db,'anon','/private_rows','GET',{},null), /permission denied/);
    await assert.rejects(fixtureRest(db,'anon','/private_rows;drop table private_rows','GET',{},null), /identifier/);
  } finally {await db.close();}
});
