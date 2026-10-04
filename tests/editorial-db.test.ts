import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import starters from "../src/data/editorial-starters.json";

const migration = await readFile(
  new URL("../supabase/migrations/202610040001_brief.sql", import.meta.url),
  "utf8",
);
const authSetup = `create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to anon,authenticated,service_role;`;

test("database enforces editorial permissions, review, immutable publications, optimistic saves, and bounded job claims", async () => {
  const db = new PGlite();
  const actor = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(authSetup);
    await db.exec(migration);
    await db.query("insert into auth.users(id) values($1)", [actor]);
    await db.query("insert into brief_editors(user_id) values($1)", [actor]);
    const s = starters[0];
    const content = s.content;
    const text = content.evidence.map((e) => e.quote).join(" ");
    const source = (
      await db.query<{ id: string }>(
        "insert into brief_sources(url,slug,title,source_name,source_published_at,category) values($1,$2,$3,$4,$5,$6) returning id",
        [
          s.url,
          s.slug,
          s.title,
          s.source_name,
          s.source_published_at,
          s.category,
        ],
      )
    ).rows[0].id;
    const revision = (
      await db.query<{ id: string }>(
        "insert into brief_revisions(story_id,content,source_text,source_hash) values($1,$2,$3,'hash') returning id",
        [source, JSON.stringify(content), text],
      )
    ).rows[0].id;
    await db.exec("set role anon");
    assert.equal(
      (await db.query("select * from brief_publications")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select * from brief_revisions"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select review_brief_revision($1,1,true)", [revision]),
      /permission denied/,
    );
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from brief_revisions")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select review_brief_revision($1,1,true)", [revision]),
      /Editor access/,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
    assert.equal(
      (await db.query("select * from brief_revisions")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("update brief_publications set one_liner='bypass'"),
      /permission denied/,
    );
    await db.query("select save_brief_revision($1,1,$2)", [
      revision,
      JSON.stringify({ ...content, shortVersion: "Too short." }),
    ]);
    await assert.rejects(
      db.query("select review_brief_revision($1,2,true)", [revision]),
      /validation/,
    );
    await assert.rejects(
      db.query("select save_brief_revision($1,1,$2)", [
        revision,
        JSON.stringify(content),
      ]),
      /Draft changed/,
    );
    await db.query("select save_brief_revision($1,2,$2)", [
      revision,
      JSON.stringify(content),
    ]);
    await db.query("select review_brief_revision($1,3,true)", [revision]);
    const first = (
      await db.query<{
        one_liner: string;
        published_at: string;
        edition_date: string;
      }>("select * from brief_publications")
    ).rows[0];
    assert.equal(first.one_liner, content.oneLiner);
    await assert.rejects(
      db.query("select save_brief_revision($1,4,$2)", [
        revision,
        JSON.stringify(content),
      ]),
      /no longer editable/,
    );
    const fork = (
      await db.query<{ fork_brief_revision: string }>(
        "select fork_brief_revision($1)",
        [revision],
      )
    ).rows[0].fork_brief_revision;
    const changed = {
      ...content,
      oneLiner:
        "Amazon says it ended data center NDAs with government agencies.",
    };
    await db.query("select save_brief_revision($1,1,$2)", [
      fork,
      JSON.stringify(changed),
    ]);
    assert.equal(
      (
        await db.query<{ one_liner: string }>(
          "select one_liner from brief_publications",
        )
      ).rows[0].one_liner,
      content.oneLiner,
    );
    await db.query("select review_brief_revision($1,2,true)", [fork]);
    const corrected = (
      await db.query<{
        one_liner: string;
        published_at: string;
        edition_date: string;
      }>("select * from brief_publications")
    ).rows[0];
    assert.equal(corrected.one_liner, changed.oneLiner);
    assert.equal(String(corrected.edition_date), String(first.edition_date));
    assert.equal(String(corrected.published_at), String(first.published_at));
    assert.equal(
      (await db.query("select * from brief_revision_history")).rows.length,
      6,
    );
    await db.exec("set role anon");
    const publicFields = Object.keys(
      (
        await db.query<Record<string, unknown>>(
          "select * from brief_publications",
        )
      ).rows[0],
    );
    assert.ok(
      !publicFields.some((k) =>
        /source_text|reviewed_by|content|evidence/.test(k),
      ),
    );
    await db.exec("reset role");
    for (let i = 0; i < 12; i++)
      await db.query(
        "insert into brief_jobs(story_id,dedupe_key) values($1,$2)",
        [source, `job-${i}`],
      );
    await assert.rejects(
      db.query(
        "insert into brief_jobs(story_id,dedupe_key) values($1,'job-0')",
        [source],
      ),
      /duplicate key/,
    );
    await db.exec("set role service_role");
    const lease = "22222222-2222-4222-8222-222222222222";
    assert.equal(
      (
        await db.query<{ acquire_brief_worker: boolean }>(
          "select acquire_brief_worker($1)",
          [lease],
        )
      ).rows[0].acquire_brief_worker,
      true,
    );
    assert.equal(
      (
        await db.query<{ acquire_brief_worker: boolean }>(
          "select acquire_brief_worker($1)",
          [actor],
        )
      ).rows[0].acquire_brief_worker,
      false,
    );
    assert.equal(
      (await db.query("select * from claim_brief_job($1)", [actor])).rows
        .length,
      0,
    );
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await db.query("select * from claim_brief_job($1)", [lease])).rows
          .length,
        1,
      );
    assert.equal(
      (await db.query("select * from claim_brief_job($1)", [lease])).rows
        .length,
      0,
    );

    // Reapplying setup must preserve every row, including the live lease,
    // publication timestamps, editor access, private drafts, and audit history.
    await db.exec("reset role");
    const tables = [
      "brief_editors", "brief_sources", "brief_jobs", "brief_revisions",
      "brief_revision_history", "brief_publications", "brief_worker_lock",
    ];
    const snapshot = async () => Promise.all(tables.map(async (table) =>
      (await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows,
    ));
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
    await db.exec("set role anon");
    assert.equal((await db.query("select * from brief_publications")).rows.length, 1);
    await assert.rejects(db.query("select * from brief_revisions"), /permission denied/);
    await assert.rejects(db.query("select acquire_brief_worker($1)", [actor]), /permission denied/);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    assert.equal((await db.query("select * from brief_revisions")).rows.length, 0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    assert.equal((await db.query("select * from brief_revisions")).rows.length, 2);
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from claim_brief_job($1)", [lease])).rows.length, 0);
    await db.query("select release_brief_worker($1)", [lease]);
  } finally {
    await db.close();
  }
});

test("setup completes when brief_editors already exists from a partial run", async () => {
  const db = new PGlite();
  const actor = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(authSetup);
    await db.exec("create table public.brief_editors (user_id uuid primary key references auth.users(id) on delete cascade)");
    await db.query("insert into auth.users(id) values($1)", [actor]);
    await db.query("insert into brief_editors(user_id) values($1)", [actor]);
    await db.exec(migration);
    assert.deepEqual((await db.query("select * from brief_editors")).rows, [{user_id: actor}]);
    const tables = await db.query<{relname: string; relrowsecurity: boolean}>("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'brief_%'");
    assert.equal(tables.rows.length, 7);
    assert.ok(tables.rows.every((table) => table.relrowsecurity));
    assert.equal((await db.query("select * from brief_worker_lock")).rows.length, 1);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    assert.equal((await db.query<{is_brief_editor: boolean}>("select is_brief_editor()")).rows[0].is_brief_editor, true);
  } finally {
    await db.close();
  }
});
