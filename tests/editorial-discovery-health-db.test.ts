import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = '11111111-1111-4111-8111-111111111111';
const tokenA = '22222222-2222-4222-8222-222222222222';
const tokenB = '33333333-3333-4333-8333-333333333333';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const healthMigration = '202610120002_editorial_discovery_health.sql';
async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const file of (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && name < healthMigration).sort())
      await db.exec(await readFile(new URL(file, migrationDir), 'utf8'));
    await db.query('insert into auth.users(id) values($1)', [actor]);
    await db.query('insert into public.brief_editors(user_id) values($1)', [actor]);
    await db.exec(`alter default privileges in schema public grant execute on functions to anon,authenticated;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function applyHealth(db: PGlite) {
  await db.exec('reset role');
  await db.exec(await readFile(new URL(healthMigration, migrationDir), 'utf8'));
}
async function editor(db: PGlite, user = actor) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function publisher(db: PGlite) {
  return (await db.query<{ data: Record<string, unknown> }>("select to_jsonb(p) as data from public.brief_publishers p where catalog_key='anthropic'")).rows[0].data;
}

test('discovery has a service-only 120-second owner lease independent of generation', async () => {
  const db = await setup();
  try {
    await applyHealth(db);
    assert.ok((await db.query<{ fn: string | null }>("select to_regprocedure('public.acquire_brief_discovery(uuid)')::text as fn")).rows[0].fn,
      'Discovery needs its own acquire RPC');
    const acquire = async (token: string | null) => (await db.query<{ acquired: boolean }>('select public.acquire_brief_discovery($1) as acquired', [token])).rows[0].acquired;
    const release = (token: string | null) => db.query('select public.release_brief_discovery($1)', [token]);
    const lock = async () => (await db.query('select * from public.brief_discovery_lock')).rows;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(acquire(tokenA), /permission denied/);
      await assert.rejects(release(tokenA), /permission denied/);
      await assert.rejects(lock(), /permission denied/);
    }
    await editor(db);
    await assert.rejects(acquire(tokenA), /permission denied/, 'Being an editor does not grant lease operations');
    await assert.rejects(release(tokenA), /permission denied/);
    await assert.rejects(db.exec('update public.brief_discovery_lock set token=null,expires_at=null'), /permission denied/);
    await assert.rejects(db.exec("update public.brief_publishers set discovery_cursor='forged'"), /permission denied/);
    await db.exec('set role service_role');
    assert.equal(await acquire(null), false);
    assert.equal(await acquire(tokenA), true);
    const initial = await lock();
    const ttl = (await db.query<{ seconds: number }>('select extract(epoch from expires_at-clock_timestamp())::float8 as seconds from public.brief_discovery_lock')).rows[0].seconds;
    assert.ok(ttl > 118 && ttl <= 120, `Expected a 120s lease, got ${ttl}`);
    // PGlite serializes queries on one connection. This verifies overlapping
    // lease ownership/recovery, not a claim of real multi-session contention.
    assert.equal(await acquire(tokenB), false);
    assert.equal(await acquire(tokenA), false, 'Reusing a token must not extend a live run');
    await release(tokenB);
    await release(null);
    assert.deepEqual(await lock(), initial);
    assert.equal((await db.query<{ acquired: boolean }>('select public.acquire_brief_worker($1) as acquired', [tokenB])).rows[0].acquired, true);
    const generation = (await db.query('select * from public.brief_worker_lock')).rows;
    await applyHealth(db);
    await db.exec('set role service_role');
    assert.deepEqual(await lock(), initial, 'Migration reapplication preserves an active discovery owner');
    assert.deepEqual((await db.query('select * from public.brief_worker_lock')).rows, generation);
    await db.exec("update public.brief_discovery_lock set expires_at=clock_timestamp()-interval '1 second'");
    assert.equal(await acquire(tokenB), true, 'An expired owner does not block recovery');
    const replacement = await lock();
    await release(tokenA);
    assert.deepEqual(await lock(), replacement, 'A stale owner cannot release its successor');
    assert.equal(await acquire(tokenA), false);
    await release(tokenB);
    assert.deepEqual(await lock(), [{ id: true, token: null, expires_at: null }]);
    assert.equal(await acquire(tokenA), true);
    assert.deepEqual((await db.query('select * from public.brief_worker_lock')).rows, generation);
    await db.query('select public.release_brief_worker($1)', [tokenB]);
    assert.equal(await acquire(tokenB), false, 'Generation release cannot clear discovery');
    await release(tokenA);
  } finally { await db.close(); }
});

test('lease RLS remains fail-closed under accidental grants and transactions can roll back acquisition', async () => {
  const db = await setup();
  try {
    await applyHealth(db);
    await db.exec('grant all on public.brief_discovery_lock to public,anon,authenticated');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      assert.equal((await db.query('select * from public.brief_discovery_lock')).rows.length, 0);
      assert.equal((await db.query('update public.brief_discovery_lock set token=null,expires_at=null returning *')).rows.length, 0);
    }
    await applyHealth(db);
    await editor(db, tokenB);
    assert.equal((await db.query('select last_result,last_warning,retry_after,discovery_cursor from public.brief_publishers')).rows.length, 0);
    await assert.rejects(db.query('select * from public.brief_discovery_lock'), /permission denied/);
    // Keep SET ROLE outside the rollback transaction; one multi-statement exec
    // groups it with BEGIN and would roll the service role back as well.
    await db.exec('set role service_role');
    await db.exec('begin');
    await db.query('select public.acquire_brief_discovery($1)', [tokenA]);
    assert.equal((await db.query<{ token: string }>('select token from public.brief_discovery_lock')).rows[0].token, tokenA);
    await db.exec('rollback');
    assert.deepEqual((await db.query('select * from public.brief_discovery_lock')).rows, [{ id: true, token: null, expires_at: null }]);
    // Constraints prevent malformed ownership or more than one lock slot.
    await assert.rejects(db.query('insert into public.brief_discovery_lock(id) values(false)'), { code: '23514' });
    await assert.rejects(db.query('update public.brief_discovery_lock set token=$1', [tokenA]), { code: '23514' });
    await db.query('select public.acquire_brief_discovery($1)', [tokenB]);
    assert.equal((await db.query<{ token: string }>('select token from public.brief_discovery_lock')).rows[0].token, tokenB);
    await db.query('select public.release_brief_discovery($1)', [tokenB]);
  } finally { await db.close(); }
});

test('health rejects an oversized continuation or non-object result and permits explicit reset', async () => {
  const db = await setup();
  try {
    await applyHealth(db);
    await db.exec('set role service_role');
    await db.query("update public.brief_publishers set discovery_cursor=$1 where catalog_key='anthropic'", ['x'.repeat(2048)]);
    await assert.rejects(db.query("update public.brief_publishers set discovery_cursor=$1 where catalog_key='anthropic'", ['x'.repeat(2049)]), { code: '23514' });
    for (const value of ['[]', '123', '"string"', 'null'])
      await assert.rejects(db.query("update public.brief_publishers set last_result=$1 where catalog_key='anthropic'", [value]), { code: '23514' });
    await db.exec("update public.brief_publishers set last_result='{}',last_warning='No new stories',retry_after=null,discovery_cursor=null where catalog_key='anthropic'");
    assert.deepEqual((await publisher(db)).last_result, {});
    assert.equal((await publisher(db)).discovery_cursor, null);
    await db.exec("update public.brief_publishers set last_result=null,last_warning=null where catalog_key='anthropic'");
    assert.equal((await publisher(db)).last_result, null);
  } finally { await db.close(); }
});

test('health persists counts, warnings, retry and continuation without resetting successful retrieval', async () => {
  const db = await setup();
  try {
    await db.exec(`update public.brief_publishers set last_attempt_at='2026-10-11T09:00:00Z',
      last_success_at='2026-10-11T09:00:00Z',last_error='Legacy retrieval warning' where catalog_key='anthropic'`);
    const before = await publisher(db);
    await applyHealth(db);
    const initial = await publisher(db);
    for (const key of ['last_result', 'last_warning', 'retry_after', 'discovery_cursor']) assert.equal(initial[key], null, key);
    for (const [key, value] of Object.entries(before)) assert.deepEqual(initial[key], value, key);
    const result = { publisherId: before.id, outcome: 'partial', scanned: 40, inserted: 2, duplicates: 5, filtered: 1,
      invalid: 3, attempted: 8, remaining: 24, warning: 'Unpaged scan is incomplete', errorCode: 'rate_limited' };
    await db.exec('set role service_role');
    await db.query(`update public.brief_publishers set last_attempt_at='2026-10-12T09:00:00Z',last_result=$1,
      last_warning=$2,last_error='HTTP 429',retry_after='2026-10-12T10:00:00Z',discovery_cursor=$3 where catalog_key='anthropic'`,
    [JSON.stringify(result), result.warning, 'https://www.anthropic.com/news/next-story']);
    const stored = await publisher(db);
    assert.deepEqual(stored.last_result, result);
    assert.equal(stored.last_success_at, before.last_success_at);
    assert.equal(stored.last_error, 'HTTP 429');
    assert.equal(stored.last_warning, result.warning);
    assert.equal(stored.discovery_cursor, 'https://www.anthropic.com/news/next-story');
    assert.equal(Date.parse(stored.retry_after as string), Date.parse('2026-10-12T10:00:00Z'));
    await applyHealth(db);
    assert.deepEqual(await publisher(db), stored, 'Reapplying preserves all operational state');
    await editor(db);
    const data = (await db.query<{ data: { publishers: Record<string, unknown>[] } }>('select public.load_brief_desk() as data')).rows[0].data;
    assert.deepEqual(data.publishers.find(p => p.id === before.id), stored, 'Desk returns real persisted health');
    assert.equal((await db.query('select * from public.brief_jobs')).rows.length, 0);
    assert.equal((await db.query('select * from public.brief_revisions')).rows.length, 0);
    assert.equal((await db.query('select * from public.brief_publications')).rows.length, 0);
  } finally { await db.close(); }
});
