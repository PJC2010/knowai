-- Private, editor-reviewed event identities. No publication or draft data changes.
-- Apply after 20261005224600_primary_source_feeds.sql. Safe to reapply.
begin;
-- Migration 001's editor helper used an unqualified table with an implicit
-- pg_temp-first lookup. Harden it before any new policies or RPCs call it.
create or replace function public.is_brief_editor() returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.brief_editors where user_id=auth.uid()); $$;
revoke all on function public.is_brief_editor() from public,anon,authenticated;
grant execute on function public.is_brief_editor() to authenticated;

create table if not exists public.brief_events (
 id uuid primary key default gen_random_uuid(),
 lead_source_id uuid not null unique references public.brief_sources(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.brief_event_sources (
 source_id uuid primary key references public.brief_sources(id) on delete cascade,
 event_id uuid not null references public.brief_events(id) on delete cascade,
 added_at timestamptz not null default now()
);
create index if not exists brief_event_sources_event on public.brief_event_sources(event_id,source_id);

-- Existing links remain separate until a human editor explicitly groups them.
insert into public.brief_events(lead_source_id)
 select s.id from public.brief_sources s
 where not exists(select 1 from public.brief_event_sources m where m.source_id=s.id)
 on conflict(lead_source_id) do nothing;
insert into public.brief_event_sources(event_id,source_id)
 select e.id,e.lead_source_id from public.brief_events e
 where not exists(select 1 from public.brief_event_sources m where m.source_id=e.lead_source_id)
 on conflict(source_id) do nothing;

create or replace function public.create_brief_event_for_source() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid;
begin
 insert into brief_events(lead_source_id) values(new.id) returning id into v_event;
 insert into brief_event_sources(source_id,event_id) values(new.id,v_event);
 return new;
end; $$;
revoke all on function public.create_brief_event_for_source() from public,anon,authenticated;
drop trigger if exists brief_source_new_event on public.brief_sources;
create trigger brief_source_new_event after insert on public.brief_sources
 for each row execute function public.create_brief_event_for_source();

alter table public.brief_events enable row level security;
alter table public.brief_event_sources enable row level security;
drop policy if exists editor_events on public.brief_events;
create policy editor_events on public.brief_events for select to authenticated using(public.is_brief_editor());
drop policy if exists editor_event_sources on public.brief_event_sources;
create policy editor_event_sources on public.brief_event_sources for select to authenticated using(public.is_brief_editor());
revoke all on public.brief_events,public.brief_event_sources from anon,authenticated;
grant select on public.brief_events,public.brief_event_sources to authenticated;
grant all on public.brief_events,public.brief_event_sources to service_role;

create or replace function public.load_brief_event(p_source_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_event brief_events; result jsonb;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select e.* into v_event from brief_event_sources m join brief_events e on e.id=m.event_id where m.source_id=p_source_id;
 if v_event.id is null then raise exception 'Source not found in event groups'; end if;
 select jsonb_build_object('eventId',v_event.id,'leadSourceId',v_event.lead_source_id,'members',
   (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'source_name',s.source_name,
      'url',s.url,'source_published_at',s.source_published_at,'category',s.category)
     order by (s.id=v_event.lead_source_id) desc,s.source_published_at desc,s.id),'[]'::jsonb)
    from brief_event_sources m join brief_sources s on s.id=m.source_id where m.event_id=v_event.id)) into result;
 return result;
end; $$;
revoke all on function public.load_brief_event(uuid) from public,anon,authenticated;
grant execute on function public.load_brief_event(uuid) to authenticated;

-- Search the editor's stored metadata, not private captures or external sites.
-- Literal substring matching makes %, _ and quotes ordinary search text.
create or replace function public.search_brief_event_sources(p_source_id uuid,p_term text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_event uuid; result jsonb;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select event_id into v_event from brief_event_sources where source_id=p_source_id;
 if v_event is null then raise exception 'Source not found in event groups'; end if;
 if p_term is null or length(trim(p_term)) not between 3 and 80 then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'source_name',s.source_name,
   'url',s.url,'source_published_at',s.source_published_at) order by s.source_published_at desc,s.id),'[]'::jsonb) into result
 from (select src.id,src.title,src.source_name,src.url,src.source_published_at
   from brief_sources src join brief_event_sources m on m.source_id=src.id
   where m.event_id<>v_event and position(lower(trim(p_term)) in lower(src.title||' '||src.source_name))>0
   order by src.source_published_at desc,src.id limit 20) s;
 return result;
end; $$;
revoke all on function public.search_brief_event_sources(uuid,text) from public,anon,authenticated;
grant execute on function public.search_brief_event_sources(uuid,text) to authenticated;

-- Immutable private audit of human decisions; IDs remain even after a merge
-- deletes an empty event. Grouping never changes a source, draft, or publication.
create table if not exists public.brief_event_history (
 id uuid primary key default gen_random_uuid(),
 action text not null check(action in ('merge','split','lead')),
 source_id uuid not null,
 from_event_id uuid,
 to_event_id uuid,
 source_ids uuid[] not null,
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.brief_event_history enable row level security;
drop policy if exists editor_event_history on public.brief_event_history;
create policy editor_event_history on public.brief_event_history for select to authenticated using(public.is_brief_editor());
revoke all on public.brief_event_history from anon,authenticated;
grant select on public.brief_event_history to authenticated;
grant all on public.brief_event_history to service_role;

create or replace function public.merge_brief_events(p_lead_source uuid,p_other_source uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_target uuid; v_other uuid; v_moved uuid[];
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_lead_source is null or p_other_source is null or p_lead_source=p_other_source then raise exception 'Choose two different sources'; end if;
 perform pg_advisory_xact_lock(620106);
 select event_id into v_target from brief_event_sources where source_id=p_lead_source;
 select event_id into v_other from brief_event_sources where source_id=p_other_source;
 if v_target is null or v_other is null then raise exception 'Source not found in event groups'; end if;
 if v_target=v_other then return v_target; end if;
 if (select count(*) from brief_event_sources where event_id in (v_target,v_other))>20 then raise exception 'Group at most 20 sources'; end if;
 select array_agg(source_id order by source_id) into v_moved from brief_event_sources where event_id=v_other;
 update brief_event_sources set event_id=v_target where event_id=v_other;
 update brief_events set lead_source_id=p_lead_source,updated_at=now() where id=v_target;
 delete from brief_events where id=v_other;
 insert into brief_event_history(action,source_id,from_event_id,to_event_id,source_ids,actor)
  values('merge',p_lead_source,v_other,v_target,v_moved,auth.uid());
 return v_target;
end; $$;

create or replace function public.set_brief_event_lead(p_source_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_old uuid;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 perform pg_advisory_xact_lock(620106);
 select m.event_id,e.lead_source_id into v_event,v_old from brief_event_sources m join brief_events e on e.id=m.event_id where m.source_id=p_source_id;
 if v_event is null then raise exception 'Source not found in event groups'; end if;
 if v_old=p_source_id then return v_event; end if;
 update brief_events set lead_source_id=p_source_id,updated_at=now() where id=v_event;
 insert into brief_event_history(action,source_id,from_event_id,to_event_id,source_ids,actor)
  values('lead',p_source_id,v_event,v_event,array[p_source_id],auth.uid());
 return v_event;
end; $$;

create or replace function public.split_brief_event_source(p_source_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_lead uuid; v_new uuid; v_replacement uuid;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 perform pg_advisory_xact_lock(620106);
 select m.event_id,e.lead_source_id into v_event,v_lead from brief_event_sources m join brief_events e on e.id=m.event_id where m.source_id=p_source_id;
 if v_event is null then raise exception 'Source not found in event groups'; end if;
 if (select count(*) from brief_event_sources where event_id=v_event)<2 then raise exception 'Source is already alone in its event group'; end if;
 if v_lead=p_source_id then
  select s.id into v_replacement from brief_event_sources m join brief_sources s on s.id=m.source_id
   where m.event_id=v_event and s.id<>p_source_id order by s.source_published_at,s.id limit 1;
  update brief_events set lead_source_id=v_replacement,updated_at=now() where id=v_event;
 end if;
 insert into brief_events(lead_source_id) values(p_source_id) returning id into v_new;
 update brief_event_sources set event_id=v_new where source_id=p_source_id;
 insert into brief_event_history(action,source_id,from_event_id,to_event_id,source_ids,actor)
  values('split',p_source_id,v_event,v_new,array[p_source_id],auth.uid());
 return v_new;
end; $$;
revoke all on function public.merge_brief_events(uuid,uuid),public.set_brief_event_lead(uuid),public.split_brief_event_source(uuid) from public,anon,authenticated;
grant execute on function public.merge_brief_events(uuid,uuid),public.set_brief_event_lead(uuid),public.split_brief_event_source(uuid) to authenticated;
commit;
