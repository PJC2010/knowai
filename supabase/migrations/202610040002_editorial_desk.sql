-- Additive editor workspace. Apply AFTER 202610040001_brief.sql.
-- Safe to reapply; legacy queues remain held until explicitly selected.
begin;
create table if not exists public.brief_publishers (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  feed_url text not null unique, enabled boolean not null default true,
  last_attempt_at timestamptz, last_success_at timestamptz, last_error text
);
insert into public.brief_publishers(name,feed_url) values
 ('OpenAI','https://openai.com/news/rss.xml'),
 ('Google','https://blog.google/technology/ai/rss/'),
 ('Hugging Face','https://huggingface.co/blog/feed.xml'),
 ('TechCrunch','https://techcrunch.com/category/artificial-intelligence/feed/')
 on conflict(name) do nothing;
create table if not exists public.brief_settings (
 id boolean primary key default true check(id), auto_draft boolean not null default false
);
insert into public.brief_settings(id) values(true) on conflict do nothing;
alter table public.brief_sources add column if not exists publisher_id uuid references public.brief_publishers(id);
alter table public.brief_sources add column if not exists triage text not null default 'inbox' check(triage in ('inbox','selected','saved','dismissed'));
alter table public.brief_jobs add column if not exists selected boolean not null default false;
alter table public.brief_jobs add column if not exists generation_authorized_at timestamptz;
create index if not exists brief_sources_triage on public.brief_sources(triage,source_published_at desc,id);
update public.brief_sources s set publisher_id=p.id from public.brief_publishers p
 where s.publisher_id is null and (s.source_name=p.name or (p.name='Hugging Face' and s.source_name like '% · Hugging Face'));
alter table public.brief_publishers enable row level security;
alter table public.brief_settings enable row level security;
drop policy if exists editor_publishers on public.brief_publishers;
create policy editor_publishers on public.brief_publishers for select to authenticated using(public.is_brief_editor());
drop policy if exists editor_settings on public.brief_settings;
create policy editor_settings on public.brief_settings for select to authenticated using(public.is_brief_editor());
revoke all on public.brief_publishers,public.brief_settings from anon,authenticated;
grant select on public.brief_publishers,public.brief_settings to authenticated;
grant all on public.brief_publishers,public.brief_settings to service_role;
-- All selection writers take this lock before source/job row locks. The count
-- runs after serialization, so concurrent editors cannot each use the last slot.
-- Existing over-cap selections may shrink or remain unchanged, never grow.
create or replace function public.brief_lock_selection(p_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(620105);
 if exists(select 1 from brief_sources where id=any(p_ids) and triage<>'selected')
  and (select count(*) from brief_sources where triage='selected' or id=any(p_ids))>200
 then raise exception 'Select at most 200 stories. Deselect a story before adding another.'; end if;
end; $$;
revoke all on function public.brief_lock_selection(uuid[]) from public,anon,authenticated;
create or replace function public.triage_brief_sources(p_ids uuid[],p_state text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_state is null or p_state not in ('inbox','selected','saved','dismissed') or coalesce(cardinality(p_ids),0) not between 1 and 200 then raise exception 'Invalid selection'; end if;
 perform brief_lock_selection(case when p_state='selected' then p_ids else '{}'::uuid[] end);
 if exists(select 1 from unnest(p_ids) i where not exists(select 1 from brief_sources where id=i)) then raise exception 'Source not found'; end if;
 perform id from brief_sources where id=any(p_ids) order by id for update;
 update brief_sources set triage=p_state where id=any(p_ids);
 if p_state <> 'selected' then update brief_jobs set selected=false where story_id=any(p_ids) and state='queued'; end if;
end; $$;
create or replace function public.enqueue_brief_selection(p_ids uuid[],p_regenerate boolean default false) returns uuid[]
language plpgsql security definer set search_path=public as $$
declare s brief_sources; j brief_jobs; result uuid[] := '{}';
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 200 or p_regenerate is null or (p_regenerate and cardinality(p_ids)<>1) then raise exception 'Invalid selection'; end if;
 perform brief_lock_selection(case when p_regenerate then p_ids else '{}'::uuid[] end);
 if exists(select 1 from unnest(p_ids) i where not exists(select 1 from brief_sources where id=i)) then raise exception 'Source not found'; end if;
 for s in select * from brief_sources where id=any(p_ids) order by id for update loop
  if not p_regenerate and s.triage<>'selected' then raise exception 'Only selected stories can generate'; end if;
  if p_regenerate then update brief_sources set triage='selected' where id=s.id; end if;
  select * into j from brief_jobs where story_id=s.id and (state in ('queued','generating') or (p_regenerate and selected and (generation_authorized_at>now()-interval '2 minutes' or finished_at>now()-interval '30 seconds'))) order by created_at desc,id limit 1;
  if j.id is null then
   -- Selection is not implicit regeneration. A reviewed/failed job needs explicit retry.
   if not p_regenerate and (exists(select 1 from brief_revisions where story_id=s.id) or exists(select 1 from brief_jobs where story_id=s.id)) then continue; end if;
   insert into brief_jobs(story_id,dedupe_key,selected,generation_authorized_at) values(s.id,s.id::text||':desk:'||gen_random_uuid()::text,true,now()) returning * into j;
  else update brief_jobs set selected=true,generation_authorized_at=case when not selected or generation_authorized_at is null then now() else generation_authorized_at end where id=j.id;
  end if;
  result := array_append(result,j.id);
 end loop;
 return result;
end; $$;
-- Called only by confirmed Run queued, never by selection/Undo. No new jobs.
create or replace function public.authorize_brief_selected_queue() returns uuid[]
language plpgsql security definer set search_path=public as $$
declare result uuid[];
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 perform brief_lock_selection('{}');
 perform id from brief_sources where triage='selected' order by id for update;
 with authorized as (
  update brief_jobs j set selected=true,
   generation_authorized_at=case when not j.selected or j.generation_authorized_at is null then now() else j.generation_authorized_at end
  from brief_sources s where s.id=j.story_id and s.triage='selected' and j.state='queued'
  returning j.id
 ) select coalesce(array_agg(id order by id),'{}') into result from authorized;
 return result;
end; $$;
revoke all on function public.authorize_brief_selected_queue() from public,anon,authenticated;
grant execute on function public.authorize_brief_selected_queue() to authenticated;
create or replace function public.brief_attempts_today() returns bigint
language sql stable security definer set search_path=public as $$
 select count(*) from brief_jobs where attempted_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
$$;
create or replace function public.claim_brief_selected_job(p_token uuid,p_job_ids uuid[] default null) returns setof public.brief_jobs
language plpgsql security definer set search_path=public as $$
declare job_id uuid;
begin
 perform pg_advisory_xact_lock(620104);
 if not exists(select 1 from brief_worker_lock where token=p_token and expires_at>now()) then return; end if;
 update brief_jobs set state='failed',error='Worker interrupted. Usage may have been charged; retry explicitly.',finished_at=now() where state='generating' and attempted_at<now()-interval '6 minutes';
 if brief_attempts_today()>=10 then return; end if;
 select j.id into job_id from brief_jobs j join brief_sources s on s.id=j.story_id
  where j.state='queued' and j.selected and s.triage='selected' and (p_job_ids is null or j.id=any(p_job_ids))
  order by s.source_published_at desc,j.created_at,j.id for update of j skip locked limit 1;
 if job_id is null then return; end if;
 return query update brief_jobs set state='generating',attempted_at=now() where id=job_id returning *;
end; $$;
-- Old worker entry point is safe as well: never process held legacy work.
create or replace function public.claim_brief_job(p_token uuid) returns setof public.brief_jobs
language sql security definer set search_path=public as $$ select * from claim_brief_selected_job(p_token,null); $$;
revoke all on function public.triage_brief_sources(uuid[],text),public.enqueue_brief_selection(uuid[],boolean),public.brief_attempts_today(),public.claim_brief_selected_job(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.triage_brief_sources(uuid[],text),public.enqueue_brief_selection(uuid[],boolean) to authenticated;
grant execute on function public.claim_brief_selected_job(uuid,uuid[]) to service_role;
create or replace function public.brief_desk_source(p_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select (to_jsonb(s)-'created_at') || jsonb_build_object(
 'job_state',(select j.state from brief_jobs j where j.story_id=s.id order by j.created_at desc,j.id desc limit 1),
 'revision_id',(select r.id from brief_revisions r where r.story_id=s.id order by r.created_at desc,r.id desc limit 1))
 from brief_sources s where s.id=p_id;
$$;
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
 'attemptsToday',brief_attempts_today(),'autoDraft',(select auto_draft from brief_settings where id),
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
create or replace function public.save_brief_desk(p_id uuid,p_version integer,p_content jsonb) returns integer
language plpgsql security definer set search_path=public as $$
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_content is null or jsonb_typeof(p_content)<>'object' or not(p_content ?& array['oneLiner','shortVersion','wholePicture','whyItMatters','evidence'])
  or jsonb_typeof(p_content->'oneLiner')<>'string' or jsonb_typeof(p_content->'shortVersion')<>'string' or jsonb_typeof(p_content->'whyItMatters')<>'string'
  or jsonb_typeof(p_content->'wholePicture')<>'array' or jsonb_typeof(p_content->'evidence')<>'array' then raise exception 'Invalid draft structure'; end if;
 if jsonb_array_length(p_content->'evidence')>8 or exists(select 1 from jsonb_array_elements(p_content->'wholePicture') x where jsonb_typeof(x)<>'string')
  or exists(select 1 from jsonb_array_elements(p_content->'evidence') x where not(x ?& array['claim','quote']) or jsonb_typeof(x->'claim')<>'string' or jsonb_typeof(x->'quote')<>'string') then raise exception 'Invalid draft structure'; end if;
 perform save_brief_revision(p_id,p_version,p_content);
 -- This is THIS write's version, never a read of a potentially newer concurrent save.
 return p_version+1;
end; $$;
create or replace function public.review_brief_desk(p_id uuid,p_version integer,p_publish boolean,p_source_checked boolean,p_tiers_checked boolean) returns text
language plpgsql security definer set search_path=public as $$
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_publish is null or (p_publish and (p_source_checked is distinct from true or p_tiers_checked is distinct from true)) then raise exception 'Confirm source and tier review before publication'; end if;
 return review_brief_revision(p_id,p_version,p_publish);
end; $$;
create or replace function public.restore_brief_revision(p_id uuid,p_history_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare r brief_revisions; historical brief_revisions; h brief_revision_history; new_id uuid;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select * into r from brief_revisions where id=p_id;
 select * into h from brief_revision_history where id=p_history_id;
 select * into historical from brief_revisions where id=h.revision_id;
 if r.id is null or h.id is null or r.story_id is distinct from historical.story_id then raise exception 'History must belong to the same story'; end if;
 insert into brief_revisions(story_id,content,source_text,source_hash) values(r.story_id,h.content,historical.source_text,historical.source_hash) returning id into new_id;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(new_id,h.content,1,'restore',auth.uid());
 return new_id;
end; $$;
revoke all on function public.save_brief_desk(uuid,integer,jsonb),public.review_brief_desk(uuid,integer,boolean,boolean,boolean),public.restore_brief_revision(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_brief_desk(uuid,integer,jsonb),public.review_brief_desk(uuid,integer,boolean,boolean,boolean),public.restore_brief_revision(uuid,uuid) to authenticated;
create or replace function public.set_brief_publisher(p_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_enabled is null then raise exception 'Invalid publisher setting'; end if;
 update brief_publishers set enabled=p_enabled where id=p_id;
 if not found then raise exception 'Publisher not found'; end if;
end; $$;
create or replace function public.set_brief_auto_draft(p_enabled boolean,p_confirm_charge boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_enabled is null or (p_enabled and p_confirm_charge is distinct from true) then raise exception 'Confirm automatic drafting may incur charges'; end if;
 update brief_settings set auto_draft=p_enabled where id;
end; $$;
create or replace function public.enqueue_brief_auto(p_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path=public as $$
declare s brief_sources; job_id uuid; result uuid[]:='{}'; slots integer;
begin
 perform brief_lock_selection('{}');
 if not (select auto_draft from brief_settings where id) then return result; end if;
 select greatest(0,200-count(*)) into slots from brief_sources where triage='selected';
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
revoke all on function public.set_brief_publisher(uuid,boolean),public.set_brief_auto_draft(boolean,boolean),public.enqueue_brief_auto(uuid[]) from public,anon,authenticated;
grant execute on function public.set_brief_publisher(uuid,boolean),public.set_brief_auto_draft(boolean,boolean) to authenticated;
grant execute on function public.enqueue_brief_auto(uuid[]) to service_role;
create table if not exists public.brief_suggestions (
 id uuid primary key default gen_random_uuid(), revision_id uuid not null references public.brief_revisions(id),
 version integer not null, field text not null check(field in ('oneLiner','shortVersion','wholePicture','whyItMatters')),
 instruction text not null check(instruction in ('simplify','shorten','alternative')), actor uuid not null references auth.users(id),
 state text not null default 'generating' check(state in ('generating','complete','failed')),
 attempted_at timestamptz not null default now(), finished_at timestamptz,
 model text, cost numeric check(cost>=0), input_tokens integer, output_tokens integer, error text
);
alter table public.brief_suggestions enable row level security;
drop policy if exists editor_suggestions on public.brief_suggestions;
create policy editor_suggestions on public.brief_suggestions for select to authenticated using(public.is_brief_editor());
revoke all on public.brief_suggestions from anon,authenticated;
grant select on public.brief_suggestions to authenticated;
grant all on public.brief_suggestions to service_role;
create or replace function public.brief_attempts_today() returns bigint
language sql stable security definer set search_path=public as $$
 select (select count(*) from brief_jobs where attempted_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') +
 (select count(*) from brief_suggestions where attempted_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');
$$;
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
 if brief_attempts_today()>=10 then raise exception 'The daily attempt limit has been reached'; end if;
 if exists(select 1 from brief_suggestions where revision_id=p_id and version=p_version and field=p_field and instruction=p_instruction and attempted_at>now()-interval '30 seconds') then raise exception 'This suggestion was already requested; wait before trying again'; end if;
 update brief_suggestions set state='failed',error='Worker interrupted. Usage may have been charged.',finished_at=now() where state='generating' and attempted_at<now()-interval '6 minutes';
 insert into brief_suggestions(revision_id,version,field,instruction,actor) values(p_id,p_version,p_field,p_instruction,p_actor) returning id into result;
 return result;
end; $$;
revoke all on function public.reserve_brief_suggestion(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_brief_suggestion(uuid,uuid,integer,text,text,uuid) to service_role;
-- Harden inherited entry points too; SQL NULL must never bypass a version check.
create or replace function public.save_brief_revision(p_id uuid,p_version integer,p_content jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare r brief_revisions;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select * into r from brief_revisions where id=p_id for update;
 if r.id is null or r.state<>'needs_review' or r.version is distinct from p_version then raise exception 'Draft changed or is no longer editable. Reload before saving.'; end if;
 if p_content is null or octet_length(p_content::text)>60000 then raise exception 'Invalid draft or draft is too large'; end if;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(r.id,r.content,r.version,'save',auth.uid());
 update brief_revisions set content=p_content,version=version+1 where id=r.id;
end; $$;
create or replace function public.review_brief_revision(p_id uuid,p_version integer,p_publish boolean) returns text
language plpgsql security definer set search_path=public as $$
declare r brief_revisions; s brief_sources;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select * into r from brief_revisions where id=p_id for update;
 if r.id is null or r.state<>'needs_review' or r.version is distinct from p_version then raise exception 'Draft changed or was already reviewed. Reload first.'; end if;
 if p_publish is null then raise exception 'Invalid review'; end if;
 select * into s from brief_sources where id=r.story_id for update;
 if p_publish then
  if exists(select 1 from brief_publications where id=s.id and updated_at>r.created_at) then raise exception 'A newer publication exists. Create a fresh revision before publishing.'; end if;
  if not brief_valid_content(r.content,r.source_text) then raise exception 'The draft fails length or evidence validation'; end if;
  insert into brief_publications(id,slug,source_url,source_name,source_published_at,category,one_liner,short_version,whole_picture,why_it_matters)
   values(s.id,s.slug,s.url,s.source_name,s.source_published_at,s.category,r.content->>'oneLiner',r.content->>'shortVersion',array(select jsonb_array_elements_text(r.content->'wholePicture')),r.content->>'whyItMatters')
   on conflict(id) do update set one_liner=excluded.one_liner,short_version=excluded.short_version,whole_picture=excluded.whole_picture,why_it_matters=excluded.why_it_matters,updated_at=now();
 end if;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(r.id,r.content,r.version,case when p_publish then 'publish' else 'reject' end,auth.uid());
 update brief_revisions set state=case when p_publish then 'published' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),version=version+1 where id=r.id;
 return s.slug;
end; $$;
-- Supabase may grant EXECUTE explicitly through default privileges. Revoking
-- PUBLIC alone does not revoke those inherited explicit role grants.
revoke all on function public.is_brief_editor(),public.brief_word_count(text),public.brief_valid_content(jsonb,text),public.save_brief_revision(uuid,integer,jsonb),public.review_brief_revision(uuid,integer,boolean),public.fork_brief_revision(uuid),public.acquire_brief_worker(uuid),public.release_brief_worker(uuid),public.claim_brief_job(uuid) from public,anon,authenticated;
grant execute on function public.is_brief_editor(),public.save_brief_revision(uuid,integer,jsonb),public.review_brief_revision(uuid,integer,boolean),public.fork_brief_revision(uuid) to authenticated;
grant execute on function public.acquire_brief_worker(uuid),public.release_brief_worker(uuid),public.claim_brief_job(uuid) to service_role;
commit;
