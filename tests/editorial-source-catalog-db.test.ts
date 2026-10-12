import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PUBLISHERS } from '../src/lib/editorial/publisher-catalog';
import starters from '../src/data/editorial-starters.json';

const actor = '11111111-1111-4111-8111-111111111111';
const stranger = '99999999-9999-4999-8999-999999999999';
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const catalogMigration = '202610120001_editorial_source_catalog.sql';
const expected = [
  ['openai', 'OpenAI', 'company', 'https://openai.com/news/rss.xml'],
  ['google', 'Google', 'company', 'https://blog.google/technology/ai/rss/'],
  ['hugging-face', 'Hugging Face', 'community', 'https://huggingface.co/blog/feed.xml'],
  ['techcrunch', 'TechCrunch', 'journalism', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['deepmind', 'Google DeepMind', 'research', 'https://deepmind.google/blog/rss.xml'],
  ['google-research', 'Google Research', 'research', 'https://research.google/blog/rss/'],
  ['meta-engineering', 'Meta Engineering', 'company', 'https://engineering.fb.com/feed/'],
  ['microsoft-research', 'Microsoft Research', 'research', 'https://www.microsoft.com/en-us/research/feed/'],
  ['nvidia', 'NVIDIA', 'company', 'https://blogs.nvidia.com/feed/'],
  ['aws-ml', 'AWS Machine Learning', 'company', 'https://aws.amazon.com/blogs/machine-learning/feed/'],
  ['mistral', 'Mistral', 'company', 'https://mistral.ai/news/rss'],
  ['bair', 'Berkeley BAIR', 'research', 'https://bair.berkeley.edu/blog/feed.xml'],
  ['ars-technica', 'Ars Technica', 'journalism', 'https://arstechnica.com/feed/'],
  ['the-verge', 'The Verge', 'journalism', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['mit-tech-review', 'MIT Technology Review', 'journalism', 'https://www.technologyreview.com/topic/artificial-intelligence/feed/'],
  ['the-decoder', 'The Decoder', 'journalism', 'https://the-decoder.com/feed/'],
  ['anthropic', 'Anthropic', 'company', 'https://www.anthropic.com/news'],
] as const;

type Publisher = {
  id: string; name: string; feed_url: string | null; enabled: boolean;
  catalog_key: string | null; source_kind: string | null;
  discovery_method: string; discovery_url: string;
  access_status: 'approved' | 'review_required' | 'blocked'; access_note: string | null;
};

async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const file of (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && name < catalogMigration).sort())
      await db.exec(await readFile(new URL(file, migrationDir), 'utf8'));
    await db.query('insert into auth.users(id) values($1),($2)', [actor, stranger]);
    await db.query('insert into public.brief_editors(user_id) values($1)', [actor]);
    // Exercise Supabase-style explicit defaults for newly created functions/tables.
    await db.exec(`alter default privileges in schema public grant execute on functions to anon,authenticated;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function applyCatalog(db: PGlite) {
  await db.exec('reset role');
  await db.exec(await readFile(new URL(catalogMigration, migrationDir), 'utf8'));
}
async function editor(db: PGlite, user = actor) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function publishers(db: PGlite) {
  return (await db.query<Publisher>('select * from public.brief_publishers order by name')).rows;
}

type DeskSource = { id: string; source_kind: string | null; title: string; [key: string]: unknown };
type Desk = {
  sources: DeskSource[]; revisions: { id: string; source_text: string; brief_sources: DeskSource }[];
  jobs: { id: string; source_kind: string | null; [key: string]: unknown }[];
  publishers: Publisher[]; total: number; page: number; pageSize: number;
  selectedIds: string[]; counts: Record<string, number>; dailyAttemptLimit: number;
  attemptsToday: number; autoDraft: boolean;
  active: { id: string; source_text: string; brief_sources: DeskSource; [key: string]: unknown } | null;
  history: { id: string; [key: string]: unknown }[];
};
async function desk(db: PGlite, query: Record<string, unknown> = {}) {
  return (await db.query<{ data: Desk }>('select public.load_brief_desk($1) as data', [JSON.stringify(query)])).rows[0].data;
}
async function addSource(db: PGlite, name: string, suffix: string, triage = 'inbox') {
  return (await db.query<{ id: string }>(`insert into public.brief_sources(url,slug,title,source_name,source_published_at,category,publisher_id,triage)
    select $1,$2,$3,p.name,'2026-10-08','Models',p.id,$4 from public.brief_publishers p where p.name=$5 returning id`,
  [`https://example.test/${suffix}`, suffix, `AI ${suffix}`, triage, name])).rows[0].id;
}

test('sourceKind filters the entire SQL result before totals and pagination without losing selection', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    for (const [name, count, day] of [['Microsoft Research', 61, 8], ['Mistral', 70, 9], ['The Decoder', 39, 10]] as const) {
      await db.query(`insert into public.brief_sources(url,slug,title,source_name,source_published_at,category,publisher_id)
        select 'https://example.test/'||p.name||'/'||n,p.name||'-'||n,
        case when n<=30 then 'Keep ' else 'Other ' end||n,p.name,
        make_timestamptz(2026,10,$3,0,0,0,'UTC')+n*interval '1 minute',
        case when n%2=0 then 'Models' else 'Industry' end,p.id
        from public.brief_publishers p cross join generate_series(1,$2::integer) n where p.name=$1`, [name, count, day]);
    }
    const selected = await addSource(db, 'Mistral', 'selected', 'selected');
    await editor(db);
    const all = await desk(db);
    const data = await desk(db, { sourceKind: 'research', page: '3' });
    assert.equal(data.total, 61);
    assert.equal(data.page, 3);
    assert.equal(data.pageSize, 25);
    assert.equal(data.sources.length, 11);
    assert.ok(data.sources.every(s => s.source_kind === 'research'));
    assert.deepEqual(data.selectedIds, [selected]);
    assert.deepEqual(data.counts, all.counts, 'Navigation counts remain global, like the other desk filters');
    assert.equal((await desk(db, { sourceKind: 'research', page: '9999' })).page, 3);
    const publisher = data.publishers.find(p => p.catalog_key === 'microsoft-research')!;
    const combined = await desk(db, { sourceKind: 'research', publisher: publisher.id, q: 'Keep', category: 'Models', since: '2026-10-08T00:10:00Z' });
    const expectedIds = (await db.query<{ id: string }>(`select id from public.brief_sources
      where publisher_id=$1 and category='Models' and title like 'Keep %' and source_published_at>='2026-10-08T00:10:00Z'
      order by source_published_at desc,id desc`, [publisher.id])).rows.map(s => s.id);
    assert.equal(combined.total, expectedIds.length);
    assert.deepEqual(combined.sources.map(s => s.id), expectedIds);
    assert.equal((await desk(db, { sourceKind: 'community' })).total, 0);
    assert.equal((await desk(db, { sourceKind: 'company', publisher: publisher.id })).total, 0);
    for (const sourceKind of ['bogus', 'COMPANY', 'all', 123, [], {}])
      await assert.rejects(desk(db, { sourceKind }), /Invalid source kind/);
    assert.equal((await desk(db, { sourceKind: '' })).total, all.total);
    assert.equal((await desk(db, { sourceKind: null })).total, all.total);
  } finally { await db.close(); }
});

test('publisher controls reject unconfigured sources and remain editor-only after reapplication', async () => {
  const db = await setup();
  try {
    const unknown = (await db.query<{ id: string }>(`insert into public.brief_publishers(name,feed_url,enabled)
      values('Unconfigured legacy feed','https://unknown.example.test/rss',false) returning id`)).rows[0].id;
    await applyCatalog(db);
    const anthropic = (await publishers(db)).find(p => p.catalog_key === 'anthropic')!.id;
    await db.query("update public.brief_publishers set access_status='approved',access_note='Synthetic test approval' where id=$1", [anthropic]);
    await editor(db);
    await assert.rejects(db.query('select public.set_brief_publisher($1,true)', [unknown]), /Publisher not configured/);
    await db.query('select public.set_brief_publisher($1,false)', [unknown]);
    await assert.rejects(db.query('select public.set_brief_publisher($1,false)', [stranger]), /Publisher not found/);
    await assert.rejects(db.query('select public.set_brief_publisher(null,true)'), /Publisher not found/);
    await assert.rejects(db.query('select public.set_brief_publisher($1,null)', [anthropic]), /Invalid publisher setting/);
    await db.query('select public.set_brief_publisher($1,true)', [anthropic]);
    await db.exec('reset role');
    // Reapplication also removes accidental/default client grants.
    await db.exec(`grant all on public.brief_publishers to public,anon,authenticated;
      grant execute on function public.set_brief_publisher(uuid,boolean) to public,anon,authenticated;
      grant execute on function public.brief_desk_source(uuid),public.load_brief_desk(jsonb) to public,anon,authenticated;`);
    await applyCatalog(db);
    await db.exec('set role anon');
    await assert.rejects(publishers(db), /permission denied/);
    await assert.rejects(desk(db), /permission denied/);
    await assert.rejects(db.query('select public.set_brief_publisher($1,false)', [anthropic]), /permission denied/);
    await editor(db, stranger);
    assert.equal((await publishers(db)).length, 0);
    await assert.rejects(desk(db), /Editor access required/);
    await assert.rejects(db.query('select public.set_brief_publisher($1,false)', [anthropic]), /Editor access required/);
    for (const user of [stranger, actor]) {
      await editor(db, user);
      await assert.rejects(db.query('update public.brief_publishers set enabled=false where id=$1', [anthropic]), /permission denied/);
      await assert.rejects(db.query('select public.brief_desk_source($1)', [stranger]), /permission denied/);
    }
    assert.equal((await publishers(db)).find(p => p.id === anthropic)!.enabled, true);
    assert.equal((await desk(db)).publishers.length, 18);
    await db.query('select public.set_brief_publisher($1,false)', [anthropic]);
    assert.equal((await publishers(db)).find(p => p.id === anthropic)!.enabled, false);
  } finally { await db.close(); }
});

for (const intent of ['Generate', 'Regenerate', 'Run queued'] as const) {
  test(`explicit ${intent} recovers the existing stale automatic job only by authorized exact ID`, async () => {
    const db = await setup();
    try {
      await applyCatalog(db);
      await db.exec("update public.brief_publishers set enabled=true,access_status='approved',access_note='Synthetic test approval' where catalog_key='mistral'");
      const selected = await addSource(db, 'Mistral', 'stale-recovery', 'selected');
      const unrelated = await addSource(db, 'Mistral', 'unrelated-stale-recovery', 'saved');
      const jobs = (await db.query<{ id: string; story_id: string }>(`insert into public.brief_jobs(story_id,dedupe_key,selected,created_at)
        select id,id::text||':auto',true,now()-interval '1 day' from public.brief_sources where id=any($1) returning id,story_id`,
      [[selected, unrelated]])).rows;
      const target = jobs.find(j => j.story_id === selected)!.id;
      const unrelatedBefore = (await db.query('select * from public.brief_jobs where story_id=$1', [unrelated])).rows;
      await db.exec('set role service_role');
      assert.equal((await db.query<{ acquired: boolean }>('select public.acquire_brief_worker($1) as acquired', [actor])).rows[0].acquired, true);
      const claim = (ids: string[] | null) => db.query<{ id: string; state: string; attempted_at: string | null }>(
        'select * from public.claim_brief_selected_job($1,$2)', [actor, ids]);
      assert.deepEqual((await claim(null)).rows, [], 'The scheduled path cannot start a new-publisher automatic job');
      assert.deepEqual((await claim([target])).rows, [], 'Exact IDs alone are not explicit manual authorization');
      await editor(db);
      const authorized = intent === 'Run queued'
        ? (await db.query<{ ids: string[] }>('select public.authorize_brief_selected_queue() as ids')).rows[0].ids
        : (await db.query<{ ids: string[] }>('select public.enqueue_brief_selection($1,$2) as ids', [[selected], intent === 'Regenerate'])).rows[0].ids;
      assert.deepEqual(authorized, [target], 'The actual editor RPC must reuse the stale job, not insert a replacement');
      const authorizedJob = (await db.query<{ generation_authorized_at: string | null; attempted_at: string | null; selected: boolean }>(
        'select generation_authorized_at,attempted_at,selected from public.brief_jobs where id=$1', [target])).rows[0];
      assert.ok(authorizedJob.generation_authorized_at, 'Manual confirmation is persisted by the editor RPC');
      assert.equal(authorizedJob.selected, true);
      assert.equal(authorizedJob.attempted_at, null, 'Authorization does not itself spend an attempt');
      assert.equal((await desk(db)).attemptsToday, 0);
      await db.exec('set role service_role');
      assert.deepEqual((await claim(null)).rows, [], 'Manual recovery must not widen unscoped scheduled eligibility');
      assert.deepEqual((await db.query('select * from public.claim_brief_job($1)', [actor])).rows, []);
      assert.deepEqual((await claim([])).rows, [], 'An empty exact-ID list must not fall back to the whole queue');
      assert.deepEqual((await claim([stranger])).rows, [], 'An unrelated ID cannot claim the authorized target');
      const claimed = (await claim(authorized)).rows;
      assert.deepEqual(claimed.map(j => j.id), [target], `${intent} must make the reused automatic job claimable`);
      assert.equal(claimed[0].state, 'generating');
      assert.ok(claimed[0].attempted_at);
      assert.deepEqual((await claim(authorized)).rows, [], 'A repeated claim must not spend another attempt');
      assert.deepEqual((await db.query('select * from public.brief_jobs where story_id=$1', [unrelated])).rows, unrelatedBefore);
      assert.equal((await db.query('select id from public.brief_jobs')).rows.length, jobs.length);
      await editor(db);
      assert.equal((await desk(db)).attemptsToday, 1);
    } finally { await db.close(); }
  });
}

test('stale automatic recovery retains selection, worker lease, exact-ID and shared daily-cap boundaries', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    await db.exec("update public.brief_publishers set enabled=true,access_status='approved',access_note='Synthetic test approval' where catalog_key='mistral'");
    const target = await addSource(db, 'Mistral', 'guarded-recovery', 'selected');
    const peer = await addSource(db, 'Mistral', 'newer-authorized-peer', 'selected');
    await db.query("update public.brief_sources set source_published_at='2026-10-09' where id=$1", [peer]);
    const jobs = (await db.query<{ id: string; story_id: string }>(`insert into public.brief_jobs(story_id,dedupe_key,selected)
      select id,id::text||':auto',true from public.brief_sources where id=any($1) returning id,story_id`, [[target, peer]])).rows;
    const targetJob = jobs.find(j => j.story_id === target)!.id;
    const peerJob = jobs.find(j => j.story_id === peer)!.id;
    const claim = (token = actor, ids = [targetJob]) => db.query<{ id: string }>(
      'select * from public.claim_brief_selected_job($1,$2)', [token, ids]);
    await editor(db);
    const authorized = (await db.query<{ ids: string[] }>('select public.enqueue_brief_selection($1,false) as ids', [[target, peer]])).rows[0].ids;
    assert.deepEqual([...authorized].sort(), jobs.map(j => j.id).sort());
    await db.query('select public.set_brief_daily_attempt_limit(1,false)');
    await db.exec('set role service_role');
    const before = (await db.query('select * from public.brief_jobs order by id')).rows;
    assert.deepEqual((await claim()).rows, [], 'Recorded consent and exact IDs cannot replace the worker lease');
    assert.equal((await db.query<{ acquired: boolean }>('select public.acquire_brief_worker($1) as acquired', [actor])).rows[0].acquired, true);
    assert.deepEqual((await claim(stranger)).rows, [], 'Another worker token cannot use this lease');
    await db.query("update public.brief_worker_lock set expires_at=now()-interval '1 second' where token=$1", [actor]);
    assert.deepEqual((await claim()).rows, [], 'An expired lease cannot reserve an attempt');
    await db.query('select public.acquire_brief_worker($1)', [actor]);
    // Isolate source triage from the separate job.selected check.
    await db.query("update public.brief_sources set triage='saved' where id=$1", [target]);
    assert.deepEqual((await claim()).rows, [], 'A selected job cannot bypass its source triage');
    await db.query("update public.brief_sources set triage='selected' where id=$1", [target]);
    assert.deepEqual((await db.query('select * from public.brief_jobs order by id')).rows, before, 'Rejected claims spend nothing');
    await editor(db);
    await db.query("select public.triage_brief_sources($1,'saved')", [[target]]);
    await db.query("select public.triage_brief_sources($1,'selected')", [[target]]);
    const undone = (await db.query<{ selected: boolean; generation_authorized_at: string | null }>(
      'select selected,generation_authorized_at from public.brief_jobs where id=$1', [targetJob])).rows[0];
    assert.equal(undone.selected, false, 'Selection/Undo does not renew charge consent');
    assert.ok(undone.generation_authorized_at, 'An old authorization timestamp alone is insufficient');
    await db.exec('set role service_role');
    assert.deepEqual((await claim()).rows, [], 'The selected job flag is still required after Undo');
    await editor(db);
    assert.deepEqual((await db.query<{ ids: string[] }>('select public.enqueue_brief_selection($1,false) as ids', [[target]])).rows[0].ids, [targetJob]);
    await db.exec('set role service_role');
    const peerBefore = (await db.query('select * from public.brief_jobs where id=$1', [peerJob])).rows;
    const targetBefore = (await db.query('select * from public.brief_jobs where id=$1', [targetJob])).rows;
    const revision = (await db.query<{ id: string }>(`insert into public.brief_revisions(story_id,content,source_text,source_hash)
      values($1,$2,'Fixture capture','cap-test') returning id`, [peer, JSON.stringify(starters[0].content)])).rows[0].id;
    await db.query("select public.reserve_brief_suggestion($1,$2,1,'oneLiner','simplify',$3)", [actor, revision, actor]);
    assert.deepEqual((await claim()).rows, [], 'A suggestion reservation consumes the same daily cap as recovery');
    assert.deepEqual((await db.query('select * from public.brief_jobs where id=$1', [targetJob])).rows, targetBefore);
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 1);
    await db.query('select public.set_brief_daily_attempt_limit(2,true)');
    await db.exec('set role service_role; begin');
    try {
      assert.deepEqual((await claim()).rows.map(j => j.id), [targetJob], 'Only the requested ID is claimed, not the newer authorized peer');
      assert.equal((await db.query(`select * from pg_locks where locktype='advisory' and classid=0
        and objid=620104 and mode='ExclusiveLock' and granted`)).rows.length, 1, 'Recovery holds the shared attempt lock until commit');
      await db.exec('commit');
    } catch (error) { await db.exec('rollback'); throw error; }
    assert.deepEqual((await claim(actor, [peerJob])).rows, [], 'Recovery cannot exceed the cap for another authorized job');
    assert.deepEqual((await db.query('select * from public.brief_jobs where id=$1', [peerJob])).rows, peerBefore);
    await editor(db);
    assert.equal((await desk(db)).attemptsToday, 2);
  } finally { await db.close(); }
});

test('stale automatic recovery remains editor-authorized and service-claimed after migration reapplication', async () => {
  const db = await setup();
  try {
    const autoDefinition = (await db.query("select pg_get_functiondef('public.enqueue_brief_auto(uuid[])'::regprocedure) as definition")).rows;
    await applyCatalog(db);
    await db.exec("update public.brief_publishers set enabled=true,access_status='approved',access_note='Synthetic test approval' where catalog_key='mistral'");
    const source = await addSource(db, 'Mistral', 'private-recovery', 'selected');
    const job = (await db.query<{ id: string }>(`insert into public.brief_jobs(story_id,dedupe_key,selected)
      values($1::uuid,$1::uuid::text||':auto',true) returning id`, [source])).rows[0].id;
    const manualCalls = [
      ['select public.enqueue_brief_selection($1,false)', [[source]]],
      ['select public.enqueue_brief_selection($1,true)', [[source]]],
      ['select public.authorize_brief_selected_queue()', []],
    ] as const;
    const before = await workflowState(db);
    await db.exec('set role anon');
    for (const [sql, args] of manualCalls) await assert.rejects(db.query(sql, [...args]), /permission denied/);
    await assert.rejects(db.query('select * from public.claim_brief_selected_job($1,$2)', [actor, [job]]), /permission denied/);
    await editor(db, stranger);
    for (const [sql, args] of manualCalls) await assert.rejects(db.query(sql, [...args]), /Editor access required/);
    for (const user of [stranger, actor]) {
      await editor(db, user);
      await assert.rejects(db.query('update public.brief_jobs set generation_authorized_at=now(),selected=true where id=$1', [job]), /permission denied/);
      await assert.rejects(db.query('select * from public.claim_brief_selected_job($1,$2)', [actor, [job]]), /permission denied/);
    }
    await db.exec('reset role');
    assert.deepEqual(await workflowState(db), before, 'Rejected controls do not authorize, select, enqueue or reserve any work');
    await db.query('delete from public.brief_editors where user_id=$1', [actor]);
    await editor(db);
    for (const [sql, args] of manualCalls) await assert.rejects(db.query(sql, [...args]), /Editor access required/);
    await db.exec('reset role');
    await db.query('insert into public.brief_editors(user_id) values($1)', [actor]);
    await editor(db);
    assert.deepEqual((await db.query<{ ids: string[] }>('select public.enqueue_brief_selection($1,false) as ids', [[source]])).rows[0].ids, [job]);
    await db.exec('reset role');
    const authorized = await workflowState(db);
    // The changed worker function must revoke accidental Supabase/client grants on reapply.
    await db.exec('grant execute on function public.claim_brief_selected_job(uuid,uuid[]) to public,anon,authenticated');
    await applyCatalog(db);
    await applyCatalog(db);
    assert.deepEqual(await workflowState(db), authorized, 'Reapplication preserves explicit consent, dedupe, selection and all history');
    assert.deepEqual((await db.query("select pg_get_functiondef('public.enqueue_brief_auto(uuid[])'::regprocedure) as definition")).rows,
      autoDefinition, 'The original-four automatic enqueue implementation is unchanged');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.claim_brief_selected_job($1,$2)', [actor, [job]]), /permission denied/);
    }
    await editor(db, stranger);
    for (const [sql, args] of manualCalls) await assert.rejects(db.query(sql, [...args]), /Editor access required/);
    await db.exec('set role service_role');
    await db.query('select public.acquire_brief_worker($1)', [actor]);
    assert.deepEqual((await db.query('select * from public.claim_brief_selected_job($1,null)', [actor])).rows, [], 'Reapply does not admit the job to scheduled claims');
    assert.deepEqual((await db.query<{ id: string }>('select * from public.claim_brief_selected_job($1,$2)', [actor, [job]])).rows.map(j => j.id), [job]);
  } finally { await db.close(); }
});

test('old-worker enqueue and stale automatic jobs cannot authorize the ten new publishers', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    await db.exec("update public.brief_publishers set enabled=true,access_status='approved',access_note='Synthetic test approval'; update public.brief_settings set auto_draft=true");
    const original = expected.slice(0, 4), additions = expected.slice(7);
    const oldIds: string[] = [], newIds: string[] = [];
    for (const [, name] of original) oldIds.push(await addSource(db, name, `old-${oldIds.length}`));
    for (const [, name] of additions) newIds.push(await addSource(db, name, `new-${newIds.length}`));
    await db.exec('set role service_role');
    const enqueue = async (ids: string[]) => (await db.query<{ ids: string[] }>('select public.enqueue_brief_auto($1) as ids', [ids])).rows[0].ids;
    assert.deepEqual(await enqueue(newIds), []);
    assert.equal((await enqueue([...oldIds, ...newIds])).length, 4);
    assert.ok((await db.query<{ triage: string }>('select triage from public.brief_sources where id=any($1)', [newIds])).rows.every(s => s.triage === 'inbox'));
    // An older/partial rollout could have left new-publisher :auto jobs. Without
    // explicit editor authorization, even exact job IDs cannot start attempts.
    const staleJobs: string[] = [];
    for (const id of newIds) {
      await db.query("update public.brief_sources set triage='selected' where id=$1", [id]);
      staleJobs.push((await db.query<{ id: string }>(`insert into public.brief_jobs(story_id,dedupe_key,selected)
        values($1::uuid,$1::uuid::text||':auto',true) returning id`, [id])).rows[0].id);
    }
    await db.query('select public.acquire_brief_worker($1)', [actor]);
    assert.equal((await db.query('select * from public.claim_brief_selected_job($1,$2)', [actor, staleJobs])).rows.length, 0);
    assert.ok((await db.query<{ attempted_at: null }>('select attempted_at from public.brief_jobs where id=any($1)', [staleJobs])).rows.every(j => j.attempted_at === null));
    const allowedJobs = (await db.query<{ id: string }>('select id from public.brief_jobs where story_id=any($1)', [oldIds])).rows.map(j => j.id);
    assert.equal((await db.query<{ id: string }>('select * from public.claim_brief_selected_job($1,$2)', [actor, [allowedJobs[1]]])).rows[0].id, allowedJobs[1]);
    assert.equal((await db.query('select * from public.claim_brief_selected_job($1,$2)', [stranger, [allowedJobs[0]]])).rows.length, 0);
    // Explicit manual generation remains supported for new sources and retains
    // exact-job claims; do not ban a publisher from all drafting.
    const manual = (await db.query<{ id: string }>(`insert into public.brief_jobs(story_id,dedupe_key,selected)
      values($1,'manual:desk',true) returning id`, [newIds[0]])).rows[0].id;
    assert.equal((await db.query<{ id: string }>('select * from public.claim_brief_selected_job($1,$2)', [actor, [manual]])).rows[0].id, manual);
    await db.exec('update public.brief_settings set daily_attempt_limit=2');
    assert.equal((await db.query('select * from public.claim_brief_selected_job($1,$2)', [actor, [allowedJobs[0]]])).rows.length, 0);
    assert.deepEqual(await enqueue(newIds), []);
    await db.exec('update public.brief_settings set daily_attempt_limit=10');
    await db.query("update public.brief_jobs set state='failed' where id=any($1)", [allowedJobs]);
    assert.equal((await db.query('select * from public.claim_brief_job($1)', [actor])).rows.length, 0,
      'The legacy wrapper also refuses every stale new-publisher automatic job');
  } finally { await db.close(); }
});

test('access policy seeds safe states and only a service-approved source can be enabled', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    const rows = await publishers(db);
    for (const [index, [key]] of expected.entries()) {
      const row = rows.find(p => p.catalog_key === key)!;
      assert.equal(row.access_status, index < 7 ? 'approved' : ['aws-ml','ars-technica','the-verge','mit-tech-review','the-decoder'].includes(key) ? 'blocked' : 'review_required', key);
      if (index >= 7) assert.ok(row.access_note && row.access_note.length <= 1000, key);
    }
    const anthropic = rows.find(p => p.catalog_key === 'anthropic')!;
    const decoder = rows.find(p => p.catalog_key === 'the-decoder')!;
    await editor(db);
    for (const row of [anthropic, decoder]) {
      await assert.rejects(db.query('select public.set_brief_publisher($1,true)', [row.id]), /access.*(?:review|approved|blocked)/i);
      await db.query('select public.set_brief_publisher($1,false)', [row.id]);
    }
    await assert.rejects(db.query("update public.brief_publishers set access_status='approved' where id=$1", [anthropic.id]), /permission denied/);
    await db.exec('set role service_role');
    await db.query("update public.brief_publishers set access_status='approved',access_note='Synthetic fixture approval only' where id=$1", [anthropic.id]);
    await editor(db);
    await db.query('select public.set_brief_publisher($1,true)', [anthropic.id]);
    await db.exec('reset role');
    await db.exec("update public.brief_publishers set access_status='blocked',access_note='Revised access restriction' where catalog_key='openai'");
    for (const assignment of ["access_status='unknown'", 'access_status=null', "access_note=repeat('x',1001)"])
      await assert.rejects(db.exec(`update public.brief_publishers set ${assignment} where catalog_key='openai'`),
        (error: { code?: string }) => ['23514', '23502'].includes(error.code ?? ''));
    const before = await publishers(db);
    await applyCatalog(db);
    assert.deepEqual(await publishers(db), before, 'Review decisions, notes and switches survive reapplication');
    await editor(db);
    assert.deepEqual((await desk(db)).publishers.map(p => [p.id,p.access_status,p.access_note]), before.map(p => [p.id,p.access_status,p.access_note]));
    await assert.rejects(db.query('select public.set_brief_publisher($1,true)', [rows.find(p => p.catalog_key === 'openai')!.id]), /access/i);
    await db.query('select public.set_brief_publisher($1,false)', [rows.find(p => p.catalog_key === 'openai')!.id]);
  } finally { await db.close(); }
});

test('database catalog identities and discovery endpoints match the pure application catalog', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    const project = (key: string, name: string, kind: string, method: string, url: string) => ({ key, name, kind, method, url });
    const order = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
    assert.deepEqual((await publishers(db)).map(p => project(p.catalog_key!, p.name, p.source_kind!, p.discovery_method, p.discovery_url)).sort(order),
      PUBLISHERS.map(p => project(p.key, p.name, p.kind, p.discovery.method, p.discovery.method === 'feed' ? p.discovery.feedUrl : p.discovery.listingUrl)).sort(order));
  } finally { await db.close(); }
});

test('sourceKind applies to draft and publication pages with provenance on job rows', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    await db.exec("update public.brief_publishers set access_status='approved',access_note='Synthetic test approval' where catalog_key in ('mistral','the-decoder')");
    for (const name of ['Mistral', 'The Decoder']) {
      await db.query(`insert into public.brief_sources(url,slug,title,source_name,source_published_at,category,publisher_id)
        select 'https://example.test/'||p.catalog_key||'/'||n,p.catalog_key||'-'||n,'Fixture '||n,p.name,
        '2026-10-08'::timestamptz+n*interval '1 minute','Models',p.id
        from public.brief_publishers p cross join generate_series(1,61) n where p.name=$1`, [name]);
    }
    await db.exec(`insert into public.brief_jobs(story_id,dedupe_key,selected)
      select id,id::text||':desk',false from public.brief_sources`);
    await db.query(`insert into public.brief_revisions(story_id,content,source_text,source_hash,state)
      select id,$1,'PRIVATE_CAPTURE','test',state from public.brief_sources
      cross join (values('needs_review'),('published')) states(state)`, [JSON.stringify(starters[0].content)]);
    const activeId = (await db.query<{ id: string }>(`select r.id from public.brief_revisions r
      join public.brief_sources s on s.id=r.story_id where s.source_name='Mistral' limit 1`)).rows[0].id;
    await editor(db);
    const jobs = await desk(db, { view: 'drafts', status: 'queued', sourceKind: 'journalism', page: '3', id: activeId });
    assert.equal(jobs.total, 61);
    assert.equal(jobs.jobs.length, 11);
    assert.ok(jobs.jobs.every(j => j.source_kind === 'journalism'));
    assert.equal(jobs.active?.id, activeId, 'Filtering does not replace the explicitly opened revision');
    assert.equal(jobs.active?.brief_sources.source_kind, 'company');
    assert.equal(jobs.active?.source_text, 'PRIVATE_CAPTURE');
    for (const view of ['drafts', 'published']) {
      const data = await desk(db, { view, sourceKind: 'company', page: '3' });
      assert.equal(data.total, 61);
      assert.equal(data.revisions.length, 11);
      assert.ok(data.revisions.every(r => r.brief_sources.source_kind === 'company' && r.source_text === ''));
    }
    await db.exec("reset role; update public.brief_jobs set state='failed'");
    await editor(db);
    const failed = await desk(db, { view: 'drafts', status: 'failed', sourceKind: 'company', page: '3' });
    assert.equal(failed.total, 61);
    assert.equal(failed.jobs.length, 11);
    assert.ok(failed.jobs.every(j => j.source_kind === 'company'));
  } finally { await db.close(); }
});

async function workflowState(db: PGlite) {
  const state: Record<string, unknown> = {};
  for (const table of ['brief_sources', 'brief_jobs', 'brief_revisions', 'brief_revision_history', 'brief_publications',
    'brief_settings', 'brief_events', 'brief_event_sources', 'brief_event_history', 'brief_image_uploads', 'brief_suggestions']) {
    state[table] = (await db.query<{ rows: unknown }>(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as rows from public.${table} t`)).rows[0].rows;
  }
  return state;
}

test('complete ordered migration replay preserves history, triage, images, publications, event versions and the desk contract', async t => {
  const db = await setup();
  try {
    const selected = await addSource(db, 'OpenAI', 'selected-history', 'selected');
    const saved = await addSource(db, 'Hugging Face', 'saved-history', 'saved');
    await addSource(db, 'Google Research', 'dismissed-history', 'dismissed');
    await addSource(db, 'Meta Engineering', 'inbox-history');
    const unattributed = (await db.query<{ id: string }>(`insert into public.brief_sources(url,slug,title,source_name,source_published_at,category)
      values('https://example.test/legacy-unknown','legacy-unknown','Historical unknown','Legacy attribution','2026-10-07','Research') returning id`)).rows[0].id;
    await db.query("update public.brief_sources set source_name='Named Author · Hugging Face' where id=$1", [saved]);
    await db.query("update public.brief_sources set source_image_url='https://images.example.test/original.png' where id=$1", [selected]);
    await db.exec(`update public.brief_publishers set enabled=false where name in ('Google','Google Research');
      update public.brief_publishers set feed_url='https://blog.google/technology/ai/rss/?preserved=1' where name='Google';
      update public.brief_settings set auto_draft=true,daily_attempt_limit=23;`);
    await db.query(`insert into public.brief_jobs(story_id,dedupe_key,state,cost,attempted_at)
      values($1,'historical-job','failed',0.02,now())`, [selected]);
    const content = starters[0].content;
    const revision = (await db.query<{ id: string }>(`insert into public.brief_revisions(story_id,content,source_text,source_hash,image_url,image_alt)
      values($1,$2,$3,'history-test','https://images.example.test/revision.png','Original image') returning id`,
    [selected, JSON.stringify(content), content.evidence.map(e => e.quote).join(' ')])).rows[0].id;
    await editor(db);
    await db.query('select public.save_brief_desk($1,1,$2)', [revision, JSON.stringify(content)]);
    await db.query('select public.review_brief_desk($1,2,true,true,true)', [revision]);
    await db.query("select public.set_brief_feature($1,'2026-10-12')", [revision]);
    const preview = (await db.query<{ data: { target: { eventId: string; version: number }; other: { eventId: string; version: number } } }>(
      'select public.load_brief_event_merge_preview($1,$2) as data', [selected, saved])).rows[0].data;
    const mergeArgs = [selected, saved, preview.target.eventId, preview.target.version, preview.other.eventId, preview.other.version];
    const mergeSql = 'select public.merge_brief_events($1,$2,$3,$4,$5,$6)';
    await db.query(mergeSql, mergeArgs);
    const queries = [{ view: 'inbox', status: 'all', id: revision }, { view: 'drafts', status: 'failed', id: revision },
      { view: 'drafts', id: revision }, { view: 'published', id: revision }, { view: 'sources' }];
    const priorDesks = await Promise.all(queries.map(q => desk(db, q)));
    const oldPublishers = await publishers(db);
    await db.exec('reset role');
    const before = await workflowState(db);
    await applyCatalog(db);
    await db.exec(await readFile(new URL('202610120002_editorial_discovery_health.sql', migrationDir), 'utf8'));
    assert.deepEqual(await workflowState(db), before, 'First application must not rewrite editorial history');
    const currentPublishers = await publishers(db);
    for (const old of oldPublishers) {
      const current = currentPublishers.find(p => p.id === old.id)!;
      for (const [key, value] of Object.entries(old)) assert.deepEqual(current[key as keyof Publisher], value, `${old.name}.${key}`);
    }
    await editor(db);
    const stripAdditions = (data: Desk) => JSON.parse(JSON.stringify(data, (key, value) => ['publishers', 'source_kind'].includes(key) ? undefined : value));
    for (const [index, query] of queries.entries()) assert.deepEqual(stripAdditions(await desk(db, query)), stripAdditions(priorDesks[index]));
    const current = await desk(db, { status: 'all', id: revision });
    assert.equal(current.sources.find(s => s.id === unattributed)?.source_kind, null, 'Historical null publisher is neither lost nor misattributed');
    assert.equal(current.sources.find(s => s.id === saved)?.source_kind, 'community');
    assert.equal(current.active?.brief_sources.featured_week, '2026-10-12');
    assert.equal(current.dailyAttemptLimit, 23);
    assert.equal(current.attemptsToday, 1);
    await assert.rejects(db.query(mergeSql, mergeArgs), /Event groups changed/);
    await db.exec('reset role');
    await db.exec(`update public.brief_publishers set enabled=false,access_status='blocked',access_note='Revised access restriction' where catalog_key='openai';
      update public.brief_publishers set last_warning='Keep this warning' where catalog_key='anthropic'`);
    const operational = await publishers(db);
    const additions = operational.filter(p => !oldPublishers.some(old => old.id === p.id));
    assert.equal(operational.length, 17);
    assert.equal(additions.length, 10);
    assert.ok(additions.every(p => !p.enabled));
    assert.equal(additions.filter(p => p.access_status === 'blocked').length, 5);
    assert.equal(additions.filter(p => p.access_status === 'review_required').length, 5);
    assert.equal(additions.find(p => p.catalog_key === 'anthropic')!.feed_url, null);
    const functionDefinitions = async () => (await db.query(`select oid::regprocedure::text as signature,pg_get_functiondef(oid) as definition
      from pg_proc where oid in (
        'public.set_brief_publisher(uuid,boolean)'::regprocedure,
        'public.enqueue_brief_selection(uuid[],boolean)'::regprocedure,
        'public.authorize_brief_selected_queue()'::regprocedure,
        'public.claim_brief_selected_job(uuid,uuid[])'::regprocedure,
        'public.enqueue_brief_auto(uuid[])'::regprocedure,
        'public.load_brief_desk(jsonb)'::regprocedure,
        'public.merge_brief_events(uuid,uuid,uuid,integer,uuid,integer)'::regprocedure
      ) order by signature`)).rows;
    const definitions = await functionDefinitions();
    await editor(db);
    const replayDesks = await Promise.all(queries.map(q => desk(db, q)));
    await db.exec('reset role');
    const migrations = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
    assert.equal(migrations.length, 9, 'The repair contract covers all nine complete migrations');
    t.diagnostic(`Pass 1 completed ${migrations.length} ordered migrations (setup plus catalog and health)`);
    for (const file of migrations) {
      t.diagnostic(`Pass 2 applying ${file}`);
      try {
        await db.exec(await readFile(new URL(file, migrationDir), 'utf8'));
      } catch (error) {
        const failure = error as Error & { code?: string; detail?: string };
        assert.fail(`Complete migration pass 2 failed in ${file}: SQLSTATE ${failure.code}; ${failure.message}; ${failure.detail}`);
      }
    }
    t.diagnostic(`Pass 2 completed ${migrations.length} ordered migrations`);
    assert.deepEqual(await workflowState(db), before, 'Repeated application must preserve state byte-for-byte');
    assert.deepEqual(await publishers(db), operational, 'All publisher IDs, switches, restrictions, endpoints and health survive together');
    assert.deepEqual(await functionDefinitions(), definitions, 'The complete replay restores editor, recovery, auto-eligibility and versioned-merge overrides');
    t.diagnostic(`Replay preserved ${oldPublishers.length} original publisher IDs, ${additions.length} disabled additions (5 blocked, 5 review_required), ${definitions.length} hardened functions and ${Object.keys(before).length} workflow tables`);
    await editor(db);
    for (const [index, query] of queries.entries()) assert.deepEqual(await desk(db, query), replayDesks[index]);
    await assert.rejects(db.query(mergeSql, mergeArgs), /Event groups changed/);
    for (const row of operational.filter(p => ['openai', 'anthropic', 'the-decoder'].includes(p.catalog_key!)))
      await assert.rejects(db.query('select public.set_brief_publisher($1,true)', [row.id]), /access.*(?:review|approved|blocked)/i);
    await assert.rejects(db.exec('update public.brief_publishers set enabled=true'), /permission denied/);
    await assert.rejects(db.query('select * from public.claim_brief_selected_job($1,null)', [actor]), /permission denied/);
    await editor(db, stranger);
    assert.deepEqual(await publishers(db), []);
    await assert.rejects(desk(db), /Editor access required/);
    await assert.rejects(db.query('select public.enqueue_brief_selection($1,false)', [[selected]]), /Editor access required/);
    await assert.rejects(db.query('select public.set_brief_publisher($1,false)', [operational[0].id]), /Editor access required/);
    await db.exec('set role anon');
    await assert.rejects(publishers(db), /permission denied/);
    await assert.rejects(desk(db), /permission denied/);
    const publicRows = (await db.query<Record<string, unknown>>('select * from public.brief_publications')).rows;
    assert.equal(publicRows.length, 1);
    assert.ok(!('source_text' in publicRows[0]) && !('catalog_key' in publicRows[0]) && !('discovery_cursor' in publicRows[0]));
  } finally { await db.close(); }
});

test('legacy feed insert compatibility preserves strict discovery constraints and private controls', async t => {
  const db = await setup();
  try {
    await applyCatalog(db);
    await db.exec('set role service_role');
    const legacy = (await db.query<Publisher>(`insert into public.brief_publishers(name,feed_url,enabled)
      values('Legacy feed fixture','https://legacy.example.test/rss',false) returning *`)).rows[0];
    assert.equal(legacy.discovery_url, legacy.feed_url, 'Compatibility uses only the actual supplied feed URL');
    assert.equal(legacy.discovery_method, 'feed');
    assert.equal(legacy.catalog_key, null, 'No catalog identity or source type is invented');
    assert.equal(legacy.source_kind, null);
    assert.equal(legacy.access_status, 'review_required', 'Normalization cannot approve a source');
    assert.equal(legacy.enabled, false);
    const newsroom = (await publishers(db)).find(p => p.catalog_key === 'anthropic')!;
    assert.equal(newsroom.feed_url, null);
    assert.equal(newsroom.discovery_url, 'https://www.anthropic.com/news');
    const invalid = [
      ["(name) values('Missing feed')", '23502'],
      ["(name,feed_url) values('Empty feed','')", '23514'],
      ["(name,feed_url) values('Blank feed','   ')", '23514'],
      ["(name,feed_url,discovery_url) values('Conflicting feed','https://fixture.test/feed','https://fixture.test/other')", '23514'],
      ["(name,catalog_key,source_kind,feed_url) values('Missing catalog endpoint','fixture','company','https://fixture.test/feed')", '23502'],
      ["(name,discovery_method) values('Missing newsroom endpoint','newsroom')", '23502'],
      ["(name,discovery_method,discovery_url,feed_url) values('Newsroom with feed','newsroom','https://fixture.test/news','https://fixture.test/feed')", '23514'],
      ["(name,discovery_method,feed_url) values('Unknown method','crawler','https://fixture.test/feed')", '23502'],
    ] as const;
    const before = await publishers(db);
    for (const [row, code] of invalid)
      await assert.rejects(db.exec(`insert into public.brief_publishers ${row}`), { code }, row);
    await assert.rejects(db.query('update public.brief_publishers set discovery_url=null where id=$1', [legacy.id]), { code: '23502' },
      'The insert compatibility path must not normalize invalid updates');
    assert.deepEqual(await publishers(db), before, 'Rejected rows and updates change nothing');
    await db.exec('reset role');
    await db.exec('grant execute on function public.fill_brief_publisher_feed_discovery() to public,anon,authenticated');
    await applyCatalog(db);
    assert.deepEqual(await publishers(db), before, 'Reapplying the compatibility trigger does not rewrite existing rows');
    assert.deepEqual((await db.query(`select prosecdef,has_function_privilege('anon',oid,'execute') as anon,
      has_function_privilege('authenticated',oid,'execute') as authenticated
      from pg_proc where oid='public.fill_brief_publisher_feed_discovery()'::regprocedure`)).rows,
    [{ prosecdef: false, anon: false, authenticated: false }]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.exec("insert into public.brief_publishers(name,feed_url) values('Unauthorized feed','https://fixture.test/feed')"), /permission denied/);
    }
    await editor(db);
    await assert.rejects(db.query('select public.set_brief_publisher($1,true)', [legacy.id]), /Publisher not configured/);
    await assert.rejects(db.query('select public.set_brief_publisher($1,true)', [newsroom.id]), /access.*(?:review|approved|blocked)/i);
    t.diagnostic(`Legacy compatibility rejected ${invalid.length} malformed inserts and a null discovery URL update; newsroom and access restrictions remain intact`);
  } finally { await db.close(); }
});

test('catalog method and identity constraints reject inconsistent or ambiguous records', async () => {
  const db = await setup();
  try {
    await applyCatalog(db);
    for (const assignment of [
      "source_kind='advertising'", "discovery_method='crawler'", "discovery_method=null",
      'discovery_url=null', "discovery_url=''", "feed_url=null",
      "discovery_url='https://example.test/not-the-feed'", "discovery_method='newsroom'",
      'source_kind=null', "catalog_key=''",
    ]) {
      await assert.rejects(db.exec(`update public.brief_publishers set ${assignment} where catalog_key='openai'`),
        (error: { code?: string }) => ['23514', '23502'].includes(error.code ?? ''), assignment);
    }
    await assert.rejects(db.exec("update public.brief_publishers set feed_url=discovery_url where catalog_key='anthropic'"), { code: '23514' });
    await assert.rejects(db.exec("update public.brief_publishers set discovery_method='feed' where catalog_key='anthropic'"), { code: '23514' });
    await assert.rejects(db.exec("update public.brief_publishers set catalog_key='openai' where catalog_key='google'"), { code: '23505' });
    assert.equal((await publishers(db)).length, 17);
  } finally { await db.close(); }
});

test('catalog backfills seven identities and adds ten disabled publishers including a real newsroom', async () => {
  const db = await setup();
  try {
    await db.exec("update public.brief_publishers set enabled=false where name in ('Google','Google Research')");
    const before = await publishers(db);
    await applyCatalog(db);
    const rows = await publishers(db);
    assert.equal(rows.length, 17);
    for (const [key, name, kind, url] of expected) {
      const row = rows.find(p => p.catalog_key === key);
      assert.ok(row, key);
      assert.equal(row.name, name);
      assert.equal(row.source_kind, kind);
      assert.equal(row.discovery_method, key === 'anthropic' ? 'newsroom' : 'feed');
      assert.equal(row.discovery_url, url);
      assert.equal(row.feed_url, key === 'anthropic' ? null : url);
      const old = before.find(p => p.name === name);
      assert.equal(row.enabled, old?.enabled ?? false, `${name} keeps its switch`);
      if (old) assert.equal(row.id, old.id, `${name} keeps its identity`);
    }
  } finally { await db.close(); }
});
