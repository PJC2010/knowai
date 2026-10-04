-- Configurable shared daily reservations. Apply after the editorial desk migration.
-- Rerunnable: preserve the chosen cap, usage, selection and automatic drafting.
begin;
alter table public.brief_settings add column if not exists daily_attempt_limit integer not null default 10
 check(daily_attempt_limit between 1 and 1000);
-- Keep configuration private and prohibit direct client writes on reapplication too.
revoke all on public.brief_settings from public,anon,authenticated;
grant select on public.brief_settings to authenticated;

-- Internal fail-closed read: a missing/corrupt setting is never unlimited.
create or replace function public.brief_daily_attempt_limit() returns integer
language plpgsql stable security definer set search_path=public as $$
declare result integer;
begin
 select daily_attempt_limit into result from brief_settings where id;
 if result is null or result not between 1 and 1000 then
  raise exception 'Daily attempt limit configuration is unavailable. Apply the editorial daily cap migration.';
 end if;
 return result;
end; $$;
revoke all on function public.brief_daily_attempt_limit() from public,anon,authenticated;

-- This read/comparison shares the attempt lock with both reservation paths.
-- An editor confirming a decrease does not authorize a later concurrent increase.
create or replace function public.set_brief_daily_attempt_limit(p_limit integer,p_confirm_charge boolean) returns void
language plpgsql security definer set search_path=public as $$
declare current_limit integer;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_limit is null or p_limit not between 1 and 1000 then
  raise exception 'Daily attempt limit must be an integer between 1 and 1000';
 end if;
 perform pg_advisory_xact_lock(620104);
 current_limit:=brief_daily_attempt_limit();
 if p_limit>current_limit and p_confirm_charge is distinct from true then
  raise exception 'Confirm increasing the daily attempt limit may incur additional charges';
 end if;
 update brief_settings set daily_attempt_limit=p_limit where id;
end; $$;
revoke all on function public.set_brief_daily_attempt_limit(integer,boolean) from public,anon,authenticated;
grant execute on function public.set_brief_daily_attempt_limit(integer,boolean) to authenticated;

create or replace function public.claim_brief_selected_job(p_token uuid,p_job_ids uuid[] default null) returns setof public.brief_jobs
language plpgsql security definer set search_path=public as $$
declare job_id uuid;
begin
 perform pg_advisory_xact_lock(620104);
 if not exists(select 1 from brief_worker_lock where token=p_token and expires_at>now()) then return; end if;
 update brief_jobs set state='failed',error='Worker interrupted. Usage may have been charged; retry explicitly.',finished_at=now() where state='generating' and attempted_at<now()-interval '6 minutes';
 if brief_attempts_today()>=brief_daily_attempt_limit() then return; end if;
 select j.id into job_id from brief_jobs j join brief_sources s on s.id=j.story_id
  where j.state='queued' and j.selected and s.triage='selected' and (p_job_ids is null or j.id=any(p_job_ids))
  order by s.source_published_at desc,j.created_at,j.id for update of j skip locked limit 1;
 if job_id is null then return; end if;
 return query update brief_jobs set state='generating',attempted_at=now() where id=job_id returning *;
end; $$;
revoke all on function public.claim_brief_selected_job(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_brief_selected_job(uuid,uuid[]) to service_role;

create or replace function public.reserve_brief_suggestion(p_token uuid,p_id uuid,p_version integer,p_field text,p_instruction text,p_actor uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare r brief_revisions; result uuid;
begin
 perform pg_advisory_xact_lock(620104);
 if not exists(select 1 from brief_worker_lock where token=p_token and expires_at>now()) then raise exception 'Another worker is running; retry later'; end if;
 if not exists(select 1 from brief_editors where user_id=p_actor) then raise exception 'Editor access required'; end if;
 select * into r from brief_revisions where id=p_id for update;
 if r.id is null or r.version is distinct from p_version or r.state<>'needs_review' then raise exception 'Draft changed or is no longer editable'; end if;
 if p_field is null or p_field not in ('oneLiner','shortVersion','wholePicture','whyItMatters') or p_instruction is null or p_instruction not in ('simplify','shorten','alternative') then raise exception 'Invalid suggestion'; end if;
 if brief_attempts_today()>=brief_daily_attempt_limit() then raise exception 'The daily attempt limit has been reached'; end if;
 if exists(select 1 from brief_suggestions where revision_id=p_id and version=p_version and field=p_field and instruction=p_instruction and attempted_at>now()-interval '30 seconds') then raise exception 'This suggestion was already requested; wait before trying again'; end if;
 update brief_suggestions set state='failed',error='Worker interrupted. Usage may have been charged.',finished_at=now() where state='generating' and attempted_at<now()-interval '6 minutes';
 insert into brief_suggestions(revision_id,version,field,instruction,actor) values(p_id,p_version,p_field,p_instruction,p_actor) returning id into result;
 return result;
end; $$;
revoke all on function public.reserve_brief_suggestion(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_brief_suggestion(uuid,uuid,integer,text,text,uuid) to service_role;

create or replace function public.enqueue_brief_auto(p_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path=public as $$
declare s brief_sources; job_id uuid; result uuid[]:='{}'; slots integer; daily_limit integer;
begin
 -- Keep selection first, then the shared attempt lock, then source/job rows.
 perform brief_lock_selection('{}');
 perform pg_advisory_xact_lock(620104);
 daily_limit:=brief_daily_attempt_limit();
 if (select auto_draft from brief_settings where id) is distinct from true then return result; end if;
 select least(greatest(0,200-count(*)),greatest(0,daily_limit-brief_attempts_today())) into slots
  from brief_sources where triage='selected';
 for s in select src.* from brief_sources src join brief_publishers p on p.id=src.publisher_id
  where src.id=any(p_ids) and p.enabled and src.triage='inbox' order by src.id for update of src loop
  exit when slots=0;
  if exists(select 1 from brief_jobs where story_id=s.id) or exists(select 1 from brief_revisions where story_id=s.id) then continue; end if;
  update brief_sources set triage='selected' where id=s.id;
  slots:=slots-1;
  insert into brief_jobs(story_id,dedupe_key,selected) values(s.id,s.id::text||':auto',true) returning id into job_id;
  result:=array_append(result,job_id);
 end loop;
 return result;
end; $$;
revoke all on function public.enqueue_brief_auto(uuid[]) from public,anon,authenticated;
grant execute on function public.enqueue_brief_auto(uuid[]) to service_role;

create or replace function public.load_brief_desk(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v text := coalesce(p_query->>'view','inbox'); st text; pg integer:=1; sz integer:=25;
 total bigint; ids uuid[]; result jsonb; active jsonb; hist jsonb; since_date timestamptz;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if v not in ('inbox','drafts','published','sources') then v:='inbox'; end if;
 st:=coalesce(nullif(p_query->>'status',''),case when v='inbox' then 'inbox' else 'needs_review' end);
 if coalesce(p_query->>'page','') ~ '^[0-9]{1,8}$' then pg:=greatest(1,(p_query->>'page')::integer); end if;
 begin since_date:=nullif(p_query->>'since','')::timestamptz; exception when others then since_date:=null; end;
 -- Materialize IDs, not article captures. Counts and pagination cover the whole matching set.
 with filtered as (
  select s.id from brief_sources s where
   (coalesce(p_query->>'q','')='' or position(lower(left(p_query->>'q',200)) in lower(s.title||' '||s.source_name))>0)
   and (coalesce(p_query->>'publisher','')='' or s.publisher_id::text=p_query->>'publisher')
   and (coalesce(p_query->>'category','')='' or s.category=p_query->>'category')
   and (since_date is null or s.source_published_at>=since_date)
 ), items as (
  select s.id,s.source_published_at as sort from brief_sources s join filtered f on f.id=s.id
   where v='inbox' and (st='all' or s.triage=st)
  union all
  select r.id,r.created_at from brief_revisions r join filtered f on f.id=r.story_id
   where (v='published' and r.state='published') or (v='drafts' and st not in ('failed','queued') and r.state=case when st='rejected' then 'rejected' else 'needs_review' end)
  union all
  select j.id,j.created_at from brief_jobs j join filtered f on f.id=j.story_id
   where v='drafts' and st in ('failed','queued') and (j.state=st or (st='queued' and j.state='generating'))
 ) select coalesce(array_agg(id order by sort desc,id desc),'{}') into ids from items;
 total:=cardinality(ids); pg:=least(pg,greatest(1,ceil(total::numeric/sz)::integer));
 ids:=ids[((pg-1)*sz+1):(pg*sz)];
 select (to_jsonb(r)-'reviewed_by'-'job_id') || jsonb_build_object('brief_sources',brief_desk_source(r.story_id)) into active from brief_revisions r where r.id::text=p_query->>'id';
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'version',h.version,'created_at',h.created_at,'content',h.content) order by h.created_at desc,h.id desc),'[]') into hist
 from brief_revision_history h join brief_revisions r on r.id=h.revision_id where r.story_id::text=active->>'story_id';
 result:=jsonb_build_object(
 'sources',case when v='inbox' then (select coalesce(jsonb_agg(brief_desk_source(i) order by n),'[]') from unnest(ids) with ordinality a(i,n)) else '[]'::jsonb end,
 'revisions',case when v='published' or (v='drafts' and st not in ('failed','queued')) then
  (select coalesce(jsonb_agg((to_jsonb(r)-'reviewed_by'-'job_id'-'source_text')||jsonb_build_object('source_text','','brief_sources',brief_desk_source(r.story_id)) order by a.n),'[]') from unnest(ids) with ordinality a(i,n) join brief_revisions r on r.id=a.i) else '[]'::jsonb end,
 'jobs',case when v='drafts' and st in ('failed','queued') then
  (select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'story_id',j.story_id,'state',j.state,'error',j.error,'cost',j.cost,'created_at',j.created_at,'title',s.title,'source_url',s.url,'source_name',s.source_name,'selected',j.selected and s.triage='selected') order by a.n),'[]') from unnest(ids) with ordinality a(i,n) join brief_jobs j on j.id=a.i join brief_sources s on s.id=j.story_id) else '[]'::jsonb end,
 'publishers',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]') from brief_publishers p),
 'active',active,'history',hist,'total',total,'page',pg,'pageSize',sz,
 'selectedIds',(select coalesce(jsonb_agg(s.id order by s.id),'[]') from brief_sources s where s.triage='selected'),
 'attemptsToday',brief_attempts_today(),'dailyAttemptLimit',brief_daily_attempt_limit(),'autoDraft',(select auto_draft from brief_settings where id),
 'counts',jsonb_build_object(
  'inbox',(select count(*) from brief_sources where triage='inbox'),
  'selected',(select count(*) from brief_sources where triage='selected'),
  'saved',(select count(*) from brief_sources where triage='saved'),
  'dismissed',(select count(*) from brief_sources where triage='dismissed'),
  'drafts',(select count(*) from brief_revisions where state='needs_review'),
  'published',(select count(*) from brief_revisions where state='published'),
  'rejected',(select count(*) from brief_revisions where state='rejected'),
  'failed',(select count(*) from brief_jobs where state='failed'),
  'queued',(select count(*) from brief_jobs where state in ('queued','generating'))));
 return result;
end; $$;
revoke all on function public.brief_desk_source(uuid),public.load_brief_desk(jsonb) from public,anon,authenticated;
grant execute on function public.load_brief_desk(jsonb) to authenticated;
commit;
