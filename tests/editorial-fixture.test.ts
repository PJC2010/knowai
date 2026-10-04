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

test("local REST fixture enforces role permissions and refuses arbitrary SQL identifiers", async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create table private_rows(id int);');
    await assert.rejects(fixtureRest(db,'anon','/private_rows','GET',{},null), /permission denied/);
    await assert.rejects(fixtureRest(db,'anon','/private_rows;drop table private_rows','GET',{},null), /identifier/);
  } finally {await db.close();}
});
