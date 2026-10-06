-- Add three primary AI research/engineering feeds to the private editorial desk.
-- Apply after the existing editorial and image migrations; preserve every editor's enabled setting on reapplication.
begin;
insert into public.brief_publishers(name,feed_url,enabled) values
 ('Google DeepMind','https://deepmind.google/blog/rss.xml',true),
 ('Google Research','https://research.google/blog/rss/',true),
 ('Meta Engineering','https://engineering.fb.com/feed/',true)
on conflict(name) do nothing;

-- The old cron sends every discovered ID. Enforce the existing automatic
-- drafting boundary in the database before these new feeds become visible;
-- migrations run before an app deployment and may be applied independently.
create or replace function public.enqueue_brief_auto(p_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.brief_sources; job_id uuid; result uuid[]:='{}'; slots integer; daily_limit integer;
begin
 perform public.brief_lock_selection('{}');
 perform pg_advisory_xact_lock(620104);
 daily_limit:=public.brief_daily_attempt_limit();
 if (select auto_draft from public.brief_settings where id) is distinct from true then return result; end if;
 select least(greatest(0,200-count(*)),greatest(0,daily_limit-public.brief_attempts_today())) into slots
  from public.brief_sources where triage='selected';
 for s in select src.* from public.brief_sources src join public.brief_publishers p on p.id=src.publisher_id
  where src.id=any(p_ids) and p.enabled and p.name in ('OpenAI','Google','Hugging Face','TechCrunch')
   and src.triage='inbox' order by src.id for update of src loop
  exit when slots=0;
  if exists(select 1 from public.brief_jobs where story_id=s.id) or exists(select 1 from public.brief_revisions where story_id=s.id) then continue; end if;
  update public.brief_sources set triage='selected' where id=s.id;
  slots:=slots-1;
  insert into public.brief_jobs(story_id,dedupe_key,selected) values(s.id,s.id::text||':auto',true) returning id into job_id;
  result:=array_append(result,job_id);
 end loop;
 return result;
end; $$;
revoke all on function public.enqueue_brief_auto(uuid[]) from public,anon,authenticated;
grant execute on function public.enqueue_brief_auto(uuid[]) to service_role;
commit;
