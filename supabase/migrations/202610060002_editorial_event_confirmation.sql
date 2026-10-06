-- Retire unconfirmed merges: stale clients must reload rather than silently
-- include sources added after their preview. Safe to reapply.
begin;
alter table public.brief_events
 add column if not exists version integer not null default 1 check(version>0);

create or replace function public.load_brief_event(p_source_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 select jsonb_build_object('eventId',e.id,'version',e.version,'leadSourceId',e.lead_source_id,'members',
   (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'source_name',s.source_name,
      'url',s.url,'source_published_at',s.source_published_at,'category',s.category)
     order by (s.id=e.lead_source_id) desc,s.source_published_at desc,s.id),'[]'::jsonb)
    from public.brief_event_sources members join public.brief_sources s on s.id=members.source_id
    where members.event_id=e.id)) into result
 from public.brief_event_sources m join public.brief_events e on e.id=m.event_id
 where m.source_id=p_source_id;
 if result is null then raise exception 'Source not found in event groups'; end if;
 return result;
end; $$;

create or replace function public.load_brief_event_merge_preview(p_lead_source uuid,p_other_source uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_lead_source is null or p_other_source is null or p_lead_source=p_other_source then
  raise exception 'Choose two different sources';
 end if;
 -- One statement invokes two STABLE readers: both full contexts use the same
 -- statement snapshot, including identities, versions, leads and members.
 select jsonb_build_object('target',public.load_brief_event(p_lead_source),
   'other',public.load_brief_event(p_other_source)) into result;
 if result->'target'->>'eventId'=result->'other'->>'eventId' then
  raise exception 'Choose sources from different event groups';
 end if;
 return result;
end; $$;
revoke all on function public.load_brief_event(uuid),public.load_brief_event_merge_preview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.load_brief_event(uuid),public.load_brief_event_merge_preview(uuid,uuid) to authenticated;

drop function if exists public.merge_brief_events(uuid,uuid);
create or replace function public.merge_brief_events(
 p_lead_source uuid,p_other_source uuid,
 p_target_event uuid,p_target_version integer,p_other_event uuid,p_other_version integer
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_target uuid; v_other uuid; v_target_version integer; v_other_version integer; v_moved uuid[];
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_lead_source is null or p_other_source is null or p_lead_source=p_other_source then
  raise exception 'Choose two different sources';
 end if;
 perform pg_advisory_xact_lock(620106);
 -- This VOLATILE writer rereads after the lock, not from the preview snapshot.
 select e.id,e.version into v_target,v_target_version
 from public.brief_event_sources m join public.brief_events e on e.id=m.event_id where m.source_id=p_lead_source;
 select e.id,e.version into v_other,v_other_version
 from public.brief_event_sources m join public.brief_events e on e.id=m.event_id where m.source_id=p_other_source;
 if p_target_event is null or p_other_event is null
   or p_target_version is null or p_target_version<=0 or p_other_version is null or p_other_version<=0
   or v_target is null or v_other is null or v_target=v_other
   or v_target is distinct from p_target_event or v_target_version is distinct from p_target_version
   or v_other is distinct from p_other_event or v_other_version is distinct from p_other_version then
  raise exception using errcode='P0001',message='Event groups changed. Reload the preview and confirm again.';
 end if;
 -- No same-group no-op: repeat submissions must fail the checks above, without audit.
 if (select count(*) from public.brief_event_sources where event_id in (v_target,v_other))>20 then
  raise exception 'Group at most 20 sources';
 end if;
 select array_agg(source_id order by source_id) into v_moved from public.brief_event_sources where event_id=v_other;
 update public.brief_event_sources set event_id=v_target where event_id=v_other;
 update public.brief_events set lead_source_id=p_lead_source,version=version+1,updated_at=now() where id=v_target;
 delete from public.brief_events where id=v_other;
 insert into public.brief_event_history(action,source_id,from_event_id,to_event_id,source_ids,actor)
  values('merge',p_lead_source,v_other,v_target,v_moved,auth.uid());
 return v_target;
end; $$;
revoke all on function public.merge_brief_events(uuid,uuid,uuid,integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.merge_brief_events(uuid,uuid,uuid,integer,uuid,integer) to authenticated;

create or replace function public.set_brief_event_lead(p_source_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_old uuid;
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 perform pg_advisory_xact_lock(620106);
 select m.event_id,e.lead_source_id into v_event,v_old
 from public.brief_event_sources m join public.brief_events e on e.id=m.event_id where m.source_id=p_source_id;
 if v_event is null then raise exception 'Source not found in event groups'; end if;
 if v_old=p_source_id then return v_event; end if;
 update public.brief_events set lead_source_id=p_source_id,version=version+1,updated_at=now() where id=v_event;
 insert into public.brief_event_history(action,source_id,from_event_id,to_event_id,source_ids,actor)
  values('lead',p_source_id,v_event,v_event,array[p_source_id],auth.uid());
 return v_event;
end; $$;
revoke all on function public.set_brief_event_lead(uuid) from public,anon,authenticated;
grant execute on function public.set_brief_event_lead(uuid) to authenticated;

create or replace function public.split_brief_event_source(p_source_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_lead uuid; v_new uuid; v_replacement uuid;
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 perform pg_advisory_xact_lock(620106);
 select m.event_id,e.lead_source_id into v_event,v_lead
 from public.brief_event_sources m join public.brief_events e on e.id=m.event_id where m.source_id=p_source_id;
 if v_event is null then raise exception 'Source not found in event groups'; end if;
 if (select count(*) from public.brief_event_sources where event_id=v_event)<2 then
  raise exception 'Source is already alone in its event group';
 end if;
 v_replacement := v_lead;
 if v_lead=p_source_id then
  select s.id into v_replacement from public.brief_event_sources m join public.brief_sources s on s.id=m.source_id
   where m.event_id=v_event and s.id<>p_source_id order by s.source_published_at,s.id limit 1;
 end if;
 -- Every real split changes the surviving group's membership, not only lead splits.
 update public.brief_events set lead_source_id=v_replacement,version=version+1,updated_at=now() where id=v_event;
 insert into public.brief_events(lead_source_id) values(p_source_id) returning id into v_new;
 update public.brief_event_sources set event_id=v_new where source_id=p_source_id;
 insert into public.brief_event_history(action,source_id,from_event_id,to_event_id,source_ids,actor)
  values('split',p_source_id,v_event,v_new,array[p_source_id],auth.uid());
 return v_new;
end; $$;
revoke all on function public.split_brief_event_source(uuid) from public,anon,authenticated;
grant execute on function public.split_brief_event_source(uuid) to authenticated;

-- A service-role source deletion cascades to membership without using an RPC.
-- Serialize this path too, and invalidate surviving groups without fabricating
-- an editor decision/audit entry. Deleting an event itself has no survivor.
create or replace function public.invalidate_brief_event_member_delete() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(620106);
 update public.brief_events set version=version+1,updated_at=now() where id=old.event_id;
 return old;
end; $$;
revoke all on function public.invalidate_brief_event_member_delete() from public,anon,authenticated;
drop trigger if exists brief_event_member_deleted on public.brief_event_sources;
create trigger brief_event_member_deleted before delete on public.brief_event_sources
 for each row execute function public.invalidate_brief_event_member_delete();
commit;
