import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { install as installBase } from './editorial-cap.mjs';

const actor = '11111111-1111-4111-8111-111111111111';
const sources = {
  alpha: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  beta: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  gamma: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  delta: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  outside: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const memberIds = group => group.members.map(member => member.id).sort();
const previewSql = (lead, other) => `select public.load_brief_event_merge_preview('${lead}','${other}');`;
const mergeSql = (lead, other, reviewed) => `select public.merge_brief_events(
  '${lead}','${other}','${reviewed.target.eventId}',${reviewed.target.version},
  '${reviewed.other.eventId}',${reviewed.other.version});`;

export async function install(observer) {
  // Reuse the local fixture auth/roles and the original prerequisite migrations.
  await installBase(observer);
  for (const file of ['20261005040933_brief_story_images_featured.sql',
    '20261005224600_primary_source_feeds.sql', '202610060001_editorial_events.sql',
    '202610060002_editorial_event_confirmation.sql']) {
    await observer.run(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    console.log(`MIGRATION ${file}`);
  }
}

async function editor(session) {
  await session.run(`set role authenticated; set request.jwt.claim.sub='${actor}';`);
}

async function fixture(observer) {
  const [{ content }] = JSON.parse(await readFile(new URL('../../src/data/editorial-starters.json', import.meta.url), 'utf8'));
  await observer.run(`truncate public.brief_event_history,public.brief_event_sources,public.brief_events,
    public.brief_image_uploads,public.brief_suggestions,public.brief_revision_history,
    public.brief_publications,public.brief_revisions,public.brief_jobs,public.brief_sources;
    insert into public.brief_sources(id,url,slug,title,source_name,source_published_at,category) values
      ${Object.entries(sources).map(([name, id]) => `('${id}','https://example.invalid/event-${name}',
        'event-${name}','Local event ${name}','Local','2026-10-05T15:00:00Z','Industry')`).join(',')};
    insert into public.brief_jobs(story_id,dedupe_key,state)
      values('${sources.beta}','local-event-job','queued');
    insert into public.brief_revisions(story_id,content,source_text,source_hash)
      values('${sources.alpha}',${quote(JSON.stringify(content))},
        ${quote(content.evidence.map(item => item.quote).join(' '))},'local-event-fixture');
    insert into public.brief_publications(id,slug,source_url,source_name,source_published_at,category,
      one_liner,short_version,whole_picture,why_it_matters)
      select id,slug,url,source_name,source_published_at,category,'Original headline','Original short copy',
        array['Original paragraph'],'Original conclusion' from public.brief_sources where id='${sources.alpha}';`);
}

async function snapshot(session) {
  return session.json(`select jsonb_build_object(
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.brief_events e),
    'members',(select coalesce(jsonb_agg(to_jsonb(m) order by m.source_id),'[]'::jsonb) from public.brief_event_sources m),
    'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from public.brief_event_history h),
    'sources',(select jsonb_agg(to_jsonb(s) order by s.id) from public.brief_sources s),
    'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.brief_jobs j),
    'revisions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.brief_revisions r),
    'publications',(select jsonb_agg(to_jsonb(p) order by p.id) from public.brief_publications p));`);
}

async function preview(session, lead = sources.alpha, other = sources.beta) {
  const reviewed = await session.json(previewSql(lead, other));
  for (const [side, source] of [['target', lead], ['other', other]]) {
    const group = reviewed[side];
    assert.match(group.eventId, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isSafeInteger(group.version) && group.version > 0, `${side}: positive version`);
    assert.ok(memberIds(group).includes(source), `${side}: requested source is present`);
    assert.ok(memberIds(group).includes(group.leadSourceId), `${side}: lead is a member`);
    assert.equal(new Set(memberIds(group)).size, group.members.length, `${side}: unique members`);
  }
  assert.notEqual(reviewed.target.eventId, reviewed.other.eventId);
  return reviewed;
}

async function mergeFresh(session, lead, other) {
  const reviewed = await preview(session, lead, other);
  assert.equal(await session.run(mergeSql(lead, other, reviewed)), reviewed.target.eventId);
}

function stale(result) {
  assert.equal(result.state, 'P0001', `Expected stale rejection, got ${JSON.stringify(result)}`);
  assert.match(result.message, /^Event groups changed/);
}

async function waitForEventLock(observer, holder, waiter, task, label) {
  const deadline = performance.now() + 5000;
  let observed;
  while (performance.now() < deadline) {
    observed = await observer.json(`select coalesce((select jsonb_build_object(
      'holder',h.pid,'waiter',a.pid,'state',a.state,'waitType',a.wait_event_type,
      'waitEvent',a.wait_event,'lock',w.objid,'granted',w.granted,'blockers',pg_blocking_pids(a.pid))
      from pg_stat_activity a join pg_locks w on w.pid=a.pid
      join pg_locks h on h.locktype=w.locktype and h.database=w.database
        and h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid
      where a.pid=${waiter.pid} and h.pid=${holder.pid} and h.granted and not w.granted
        and w.locktype='advisory' and w.classid=0 and w.objid=620106 and w.objsubid=1
        and w.mode='ExclusiveLock' and h.mode='ExclusiveLock'
        and a.state='active' and a.wait_event_type='Lock' and a.wait_event='advisory'
        and ${holder.pid}=any(pg_blocking_pids(a.pid)) limit 1),'null'::jsonb);`);
    assert.ok(!task.done, `EXPECTED_ADVISORY_WAIT ${label}: RPC finished without blocking: ${JSON.stringify(task.result ?? String(task.error))}`);
    if (observed) {
      console.log(`BLOCK ${label} ${JSON.stringify(observed)}`);
      return;
    }
    // Cadence only: pg_stat_activity, pg_blocking_pids and both lock rows are proof.
    await delay(20);
  }
  assert.fail(`EXPECTED_ADVISORY_WAIT ${label}: no observed lock 620106 wait in 5s; last=${JSON.stringify(observed)}`);
}

function unchangedEditorialData(after, before) {
  for (const key of ['sources', 'jobs', 'revisions', 'publications']) {
    assert.deepEqual(after[key], before[key], `Event decisions must not change ${key}`);
  }
}

function assertMerged(after, before, reviewed, lead) {
  const target = reviewed.target.eventId, other = reviewed.other.eventId;
  const merged = after.events.find(event => event.id === target);
  assert.ok(merged, 'Reviewed target event survives');
  assert.equal(merged.version, reviewed.target.version + 1);
  assert.equal(merged.lead_source_id, lead);
  assert.deepEqual(after.events.filter(event => event.id !== target),
    before.events.filter(event => event.id !== target && event.id !== other), 'Only the two reviewed groups change');
  assert.deepEqual(after.members, before.members.map(member => member.event_id === other
    ? { ...member, event_id: target } : member), 'Only reviewed memberships move; no source is lost');
  assert.deepEqual(after.members.filter(member => member.event_id === target).map(member => member.source_id).sort(),
    [...memberIds(reviewed.target), ...memberIds(reviewed.other)].sort(), 'Merge includes exactly the reviewed members');
  const added = after.history.filter(row => !before.history.some(old => old.id === row.id));
  assert.equal(added.length, 1, 'Exactly one successful merge is audited');
  assert.deepEqual(after.history.filter(row => row.id !== added[0].id), before.history);
  assert.equal(added[0].action, 'merge');
  assert.equal(added[0].actor, actor);
  assert.equal(added[0].source_id, lead);
  assert.equal(added[0].from_event_id, other);
  assert.equal(added[0].to_event_id, target);
  assert.deepEqual([...added[0].source_ids].sort(), memberIds(reviewed.other));
  unchangedEditorialData(after, before);
}

async function staleMutation(observer, a, b, kind, side) {
  const changedSource = side === 'target' ? sources.alpha : sources.beta;
  const unchangedSource = side === 'target' ? sources.beta : sources.alpha;
  // Both preview sides are exercised; a fifth source must always remain outside.
  await mergeFresh(b, unchangedSource, sources.delta);
  if (kind !== 'growth') await mergeFresh(b, changedSource, sources.gamma);
  const reviewed = await preview(a);
  if (kind === 'split') {
    assert.notEqual(reviewed[side].leadSourceId, sources.gamma,
      'Split a non-lead: event ID and lead stay unchanged, so the version must invalidate confirmation');
  }
  const before = await snapshot(observer);
  await b.run('begin isolation level read committed;');
  if (kind === 'growth') await mergeFresh(b, changedSource, sources.gamma);
  else await b.run(`select public.${kind === 'lead' ? 'set_brief_event_lead' : 'split_brief_event_source'}('${sources.gamma}');`);
  const writerState = await snapshot(b);
  const changed = writerState.events.find(event => event.id === reviewed[side].eventId);
  assert.equal(changed.lead_source_id, kind === 'lead' ? sources.gamma : reviewed[side].leadSourceId);
  assert.equal(writerState.history.length, before.history.length + 1);
  assert.equal(writerState.history.find(row => !before.history.some(old => old.id === row.id)).action,
    kind === 'growth' ? 'merge' : kind);
  unchangedEditorialData(writerState, before);

  // A genuinely read-only transaction can preview both groups while B holds its
  // uncommitted mutation. It must neither wait on B nor mix old/new group data.
  await a.run('begin isolation level read committed read only;');
  assert.deepEqual(await preview(a), reviewed, 'Uncommitted membership/lead/version changes must not leak into either preview side');
  await a.run('commit;');
  assert.deepEqual(await snapshot(observer), before, 'Preview does not write and B has not committed');
  console.log(`PREVIEW ${kind}-${side}: read-only snapshot consistent while writer is uncommitted`);

  const task = a.start(mergeSql(sources.alpha, sources.beta, reviewed), { allowError: true });
  await waitForEventLock(observer, b, a, task, `${kind}-${side}`);
  await b.run('commit;');
  stale(await task.promise);
  assert.deepEqual(await snapshot(observer), writerState, 'Stale confirmation must not change any group, audit or editorial data');
  assert.equal(changed.version, reviewed[side].version + 1, `${kind} must bump the surviving event version`);

  const refreshed = await preview(a);
  assert.equal(refreshed[side].version, changed.version);
  assert.deepEqual(refreshed[side === 'target' ? 'other' : 'target'], reviewed[side === 'target' ? 'other' : 'target']);
  const expectedMembers = kind === 'split' ? [changedSource] : [changedSource, sources.gamma].sort();
  assert.deepEqual(memberIds(refreshed[side]), expectedMembers);
  assert.equal(await a.run(mergeSql(sources.alpha, sources.beta, refreshed)), refreshed.target.eventId);
  assertMerged(await snapshot(observer), writerState, refreshed, sources.alpha);
}

export async function runSuite(observer, a, b, only) {
  const tests = [];
  const add = (name, fn) => tests.push({ name, fn });
  add('confirmation-contract', async () => {
    const contract = await observer.json(`select jsonb_build_object(
      'legacyAbsent',to_regprocedure('public.merge_brief_events(uuid,uuid)') is null,
      'confirmedPresent',to_regprocedure('public.merge_brief_events(uuid,uuid,uuid,integer,uuid,integer)') is not null,
      'stablePreview',exists(select 1 from pg_proc where oid=to_regprocedure('public.load_brief_event_merge_preview(uuid,uuid)') and provolatile='s'));`);
    assert.deepEqual(contract, { legacyAbsent: true, confirmedPresent: true, stablePreview: true });
    const reviewed = await preview(a);
    const before = await snapshot(observer);
    const legacy = await a.start(`select public.merge_brief_events('${sources.alpha}'::uuid,'${sources.beta}'::uuid);`, { allowError: true }).promise;
    assert.equal(legacy.state, '42883', 'Old clients cannot bypass confirmation');
    await a.run('set role anon;');
    for (const sql of [previewSql(sources.alpha, sources.beta), mergeSql(sources.alpha, sources.beta, reviewed)]) {
      const result = await a.start(sql, { allowError: true }).promise;
      assert.equal(result.state, '42501', 'Anonymous clients cannot call private event RPCs');
    }
    await editor(a);
    await a.run("set request.jwt.claim.sub='99999999-9999-4999-8999-999999999999';");
    for (const sql of [previewSql(sources.alpha, sources.beta), mergeSql(sources.alpha, sources.beta, reviewed)]) {
      const result = await a.start(sql, { allowError: true }).promise;
      assert.equal(result.state, 'P0001');
      assert.match(result.message, /Editor access required/);
    }
    assert.deepEqual(await snapshot(observer), before);
  });

  for (const kind of ['growth', 'split', 'lead']) {
    for (const side of ['target', 'other']) {
      add(`stale-${kind}-${side}`, () => staleMutation(observer, a, b, kind, side));
    }
  }

  for (const first of ['a', 'b']) {
    add(`duplicate-confirmation-${first}-first`, async () => {
      await mergeFresh(a, sources.alpha, sources.gamma);
      await mergeFresh(b, sources.beta, sources.delta);
      const reviewed = await preview(a);
      assert.deepEqual(await preview(b), reviewed, 'Both editors reviewed the same groups');
      const before = await snapshot(observer);
      const [winner, loser] = first === 'a' ? [a, b] : [b, a];
      await winner.run('begin isolation level read committed;');
      assert.equal(await winner.run(mergeSql(sources.alpha, sources.beta, reviewed)), reviewed.target.eventId);
      const winnerState = await snapshot(winner);
      const task = loser.start(mergeSql(sources.alpha, sources.beta, reviewed), { allowError: true });
      await waitForEventLock(observer, winner, loser, task, `duplicate-${first}-first`);
      assert.deepEqual(await snapshot(observer), before, 'Winning merge is not committed yet');
      await winner.run('commit;');
      stale(await task.promise);
      const after = await snapshot(observer);
      assert.deepEqual(after, winnerState, 'Duplicate must reject rather than succeed as a same-event no-op');
      assertMerged(after, before, reviewed, sources.alpha);
    });
  }

  const selected = only ? tests.filter(test => test.name === only) : tests;
  assert.ok(selected.length, `Unknown --case ${only}`);
  let passed = 0;
  for (const { name, fn } of selected) {
    await a.run('rollback; reset role;');
    await b.run('rollback; reset role;');
    await fixture(observer);
    await editor(a);
    await editor(b);
    try {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}: ${error.message}`);
      throw error;
    }
  }
  console.log(`RESULT ${passed}/${selected.length} PostgreSQL event tests passed`);
}
