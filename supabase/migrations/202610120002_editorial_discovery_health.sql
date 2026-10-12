-- Private discovery health; independent from generation accounting and leases.
begin;
alter table public.brief_publishers add column if not exists last_result jsonb;
alter table public.brief_publishers add column if not exists last_warning text;
alter table public.brief_publishers add column if not exists retry_after timestamptz;
alter table public.brief_publishers add column if not exists discovery_cursor text;
alter table public.brief_publishers drop constraint if exists brief_publishers_discovery_cursor;
alter table public.brief_publishers add constraint brief_publishers_discovery_cursor
 check(char_length(discovery_cursor)<=2048);
alter table public.brief_publishers drop constraint if exists brief_publishers_last_result;
alter table public.brief_publishers add constraint brief_publishers_last_result
 check(last_result is null or jsonb_typeof(last_result)='object');
-- load_brief_desk projects publisher rows, including these nullable fields. An
-- unchecked source stays NULL, not a fabricated successful zero-count refresh.
-- A singleton conditional UPDATE is atomic across sessions: a contender waits
-- for the row lock then rechecks expiry. No generation/advisory lock is reused.
create table if not exists public.brief_discovery_lock (
 id boolean primary key default true check(id),
 token uuid,
 expires_at timestamptz,
 check((token is null)=(expires_at is null))
);
insert into public.brief_discovery_lock(id) values(true) on conflict(id) do nothing;
alter table public.brief_discovery_lock enable row level security;
revoke all on public.brief_discovery_lock from public,anon,authenticated;
grant all on public.brief_discovery_lock to service_role;

create or replace function public.acquire_brief_discovery(p_token uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_token is null then return false; end if;
 update public.brief_discovery_lock set token=p_token,expires_at=clock_timestamp()+interval '120 seconds'
  where id and (expires_at is null or expires_at<=clock_timestamp());
 return found;
end; $$;
create or replace function public.release_brief_discovery(p_token uuid) returns void
language sql security definer set search_path=public,pg_temp as $$
 update public.brief_discovery_lock set token=null,expires_at=null where id and token=p_token;
$$;
-- Revoke explicit Supabase default grants, not just PUBLIC inheritance.
revoke all on function public.acquire_brief_discovery(uuid),public.release_brief_discovery(uuid) from public,anon,authenticated;
grant execute on function public.acquire_brief_discovery(uuid),public.release_brief_discovery(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
