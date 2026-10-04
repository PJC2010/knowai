-- Run once in a Supabase project's SQL editor, or with `supabase db push`.
create table public.brief_editors (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.brief_editors enable row level security;

create function public.is_brief_editor() returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from brief_editors where user_id = auth.uid()); $$;
revoke all on function public.is_brief_editor() from public;
grant execute on function public.is_brief_editor() to authenticated;

create table public.brief_sources (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  slug text not null unique,
  title text not null,
  source_name text not null,
  source_published_at timestamptz not null,
  category text not null check (category in ('Models','Research','Industry','Tools')),
  created_at timestamptz not null default now()
);
create table public.brief_jobs (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.brief_sources(id),
  dedupe_key text not null unique,
  state text not null default 'queued' check (state in ('queued','generating','needs_review','failed')),
  error text,
  model text,
  cost numeric check (cost >= 0),
  input_tokens integer,
  output_tokens integer,
  attempted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.brief_revisions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.brief_sources(id),
  job_id uuid unique references public.brief_jobs(id),
  content jsonb not null,
  source_text text not null,
  source_hash text not null,
  state text not null default 'needs_review' check (state in ('needs_review','published','rejected')),
  version integer not null default 1,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.brief_revision_history (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.brief_revisions(id),
  content jsonb not null,
  version integer not null,
  action text not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
-- Deliberately contains public fields only: no evidence excerpts, account IDs, or drafts.
create table public.brief_publications (
  id uuid primary key references public.brief_sources(id),
  slug text not null unique,
  source_url text not null,
  source_name text not null,
  source_published_at timestamptz not null,
  category text not null,
  one_liner text not null,
  short_version text not null,
  whole_picture text[] not null,
  why_it_matters text not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edition_date date not null default (now() at time zone 'UTC')::date
);
create index brief_jobs_queue on public.brief_jobs(state, created_at);
create index brief_revisions_story on public.brief_revisions(story_id, created_at);
create index brief_publications_edition on public.brief_publications(edition_date desc);

alter table public.brief_sources enable row level security;
alter table public.brief_jobs enable row level security;
alter table public.brief_revisions enable row level security;
alter table public.brief_revision_history enable row level security;
alter table public.brief_publications enable row level security;
create policy editor_sources on public.brief_sources for select to authenticated using (public.is_brief_editor());
create policy editor_jobs on public.brief_jobs for select to authenticated using (public.is_brief_editor());
create policy editor_revisions on public.brief_revisions for select to authenticated using (public.is_brief_editor());
create policy editor_history on public.brief_revision_history for select to authenticated using (public.is_brief_editor());
create policy public_stories on public.brief_publications for select to anon, authenticated using (true);
revoke all on public.brief_editors, public.brief_sources, public.brief_jobs, public.brief_revisions, public.brief_revision_history, public.brief_publications from anon, authenticated;
grant select on public.brief_sources, public.brief_jobs, public.brief_revisions, public.brief_revision_history to authenticated;
grant select on public.brief_publications to anon, authenticated;
grant all on public.brief_editors, public.brief_sources, public.brief_jobs, public.brief_revisions, public.brief_revision_history, public.brief_publications to service_role;

create function public.brief_word_count(t text) returns integer
language sql immutable set search_path = public
as $$ select case when trim(t) = '' then 0 else cardinality(regexp_split_to_array(trim(t), '\s+')) end; $$;

create function public.brief_valid_content(c jsonb, source_text text) returns boolean
language plpgsql immutable set search_path = public as $$
declare whole text; e jsonb;
begin
  if jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'oneLiner') <> 'string'
    or jsonb_typeof(c->'shortVersion') <> 'string' or jsonb_typeof(c->'whyItMatters') <> 'string'
    or jsonb_typeof(c->'wholePicture') <> 'array' or jsonb_typeof(c->'evidence') <> 'array'
    or not (c ?& array['oneLiner','shortVersion','wholePicture','whyItMatters','evidence']) then return false; end if;
  if char_length(trim(c->>'oneLiner')) not between 1 and 140 or (c->>'oneLiner') ~ E'[\n\r]'
    or brief_word_count(c->>'shortVersion') not between 40 and 80 or (c->>'shortVersion') ~ E'[\n\r]'
    or char_length(trim(c->>'whyItMatters')) not between 1 and 240
    or jsonb_array_length(c->'wholePicture') not between 2 and 3
    or jsonb_array_length(c->'evidence') not between 2 and 8 then return false; end if;
  if exists(select 1 from jsonb_array_elements(c->'wholePicture') p where jsonb_typeof(p) <> 'string' or trim(p #>> '{}') = '') then return false; end if;
  select string_agg(p, ' ') into whole from jsonb_array_elements_text(c->'wholePicture') p;
  if brief_word_count(whole) not between 150 and 300 then return false; end if;
  for e in select * from jsonb_array_elements(c->'evidence') loop
    if not (e ?& array['claim','quote']) or jsonb_typeof(e->'claim') <> 'string' or jsonb_typeof(e->'quote') <> 'string'
      or trim(e->>'claim') = '' or char_length(e->>'quote') not between 20 and 600 or position(e->>'quote' in source_text) = 0 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;

create function public.save_brief_revision(p_id uuid, p_version integer, p_content jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r brief_revisions;
begin
  if not is_brief_editor() then raise exception 'Editor access required'; end if;
  select * into r from brief_revisions where id = p_id for update;
  if r.id is null or r.state <> 'needs_review' or r.version <> p_version then raise exception 'Draft changed or is no longer editable. Reload before saving.'; end if;
  if octet_length(p_content::text) > 60000 then raise exception 'Draft is too large'; end if;
  insert into brief_revision_history(revision_id,content,version,action,actor) values(r.id,r.content,r.version,'save',auth.uid());
  update brief_revisions set content=p_content, version=version+1 where id=r.id;
end; $$;

create function public.review_brief_revision(p_id uuid, p_version integer, p_publish boolean) returns text
language plpgsql security definer set search_path = public as $$
declare r brief_revisions; s brief_sources;
begin
  if not is_brief_editor() then raise exception 'Editor access required'; end if;
  select * into r from brief_revisions where id=p_id for update;
  if r.id is null or r.state <> 'needs_review' or r.version <> p_version then raise exception 'Draft changed or was already reviewed. Reload first.'; end if;
  select * into s from brief_sources where id=r.story_id for update;
  if p_publish then
    if exists(select 1 from brief_publications where id=s.id and updated_at>r.created_at) then raise exception 'A newer publication exists. Create a fresh revision before publishing.'; end if;
    if not brief_valid_content(r.content,r.source_text) then raise exception 'The draft fails length or evidence validation'; end if;
    insert into brief_publications(id,slug,source_url,source_name,source_published_at,category,one_liner,short_version,whole_picture,why_it_matters)
    values(s.id,s.slug,s.url,s.source_name,s.source_published_at,s.category,r.content->>'oneLiner',r.content->>'shortVersion',array(select jsonb_array_elements_text(r.content->'wholePicture')),r.content->>'whyItMatters')
    on conflict(id) do update set one_liner=excluded.one_liner, short_version=excluded.short_version,
      whole_picture=excluded.whole_picture, why_it_matters=excluded.why_it_matters, updated_at=now();
  end if;
  insert into brief_revision_history(revision_id,content,version,action,actor) values(r.id,r.content,r.version,case when p_publish then 'publish' else 'reject' end,auth.uid());
  update brief_revisions set state=case when p_publish then 'published' else 'rejected' end,
    reviewed_by=auth.uid(), reviewed_at=now(), version=version+1 where id=r.id;
  return s.slug;
end; $$;

create function public.fork_brief_revision(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r brief_revisions; new_id uuid;
begin
  if not is_brief_editor() then raise exception 'Editor access required'; end if;
  select * into r from brief_revisions where id=p_id;
  if r.id is null then raise exception 'Revision not found'; end if;
  insert into brief_revisions(story_id,content,source_text,source_hash)
    values(r.story_id,r.content,r.source_text,r.source_hash) returning id into new_id;
  insert into brief_revision_history(revision_id,content,version,action,actor) values(new_id,r.content,1,'fork',auth.uid());
  return new_id;
end; $$;

-- Global lease prevents overlapping cron/manual batches. Expired calls are never silently retried.
create table public.brief_worker_lock (id boolean primary key default true check(id), token uuid, expires_at timestamptz);
insert into public.brief_worker_lock(id) values(true);
alter table public.brief_worker_lock enable row level security;
revoke all on public.brief_worker_lock from anon, authenticated;
grant all on public.brief_worker_lock to service_role;
create function public.acquire_brief_worker(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update brief_worker_lock set token=p_token, expires_at=now()+interval '6 minutes' where id=true and (expires_at is null or expires_at<now());
  return found;
end; $$;
create function public.release_brief_worker(p_token uuid) returns void
language sql security definer set search_path = public as $$
  update brief_worker_lock set token=null, expires_at=null where token=p_token;
$$;
create function public.claim_brief_job(p_token uuid) returns setof public.brief_jobs
language plpgsql security definer set search_path = public as $$
declare job_id uuid;
begin
  perform pg_advisory_xact_lock(620104);
  if not exists(select 1 from brief_worker_lock where token=p_token and expires_at>now()) then return; end if;
  update brief_jobs set state='failed', error='Worker interrupted. Usage may have been charged; retry explicitly.', finished_at=now()
    where state='generating' and attempted_at<now()-interval '6 minutes';
  if (select count(*) from brief_jobs where attempted_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= 10 then return; end if;
  select j.id into job_id from brief_jobs j join brief_sources s on s.id=j.story_id where j.state='queued' order by s.source_published_at desc,j.created_at for update of j skip locked limit 1;
  if job_id is null then return; end if;
  return query update brief_jobs set state='generating',attempted_at=now() where id=job_id returning *;
end; $$;

revoke all on function public.save_brief_revision(uuid,integer,jsonb), public.review_brief_revision(uuid,integer,boolean), public.fork_brief_revision(uuid), public.acquire_brief_worker(uuid), public.release_brief_worker(uuid), public.claim_brief_job(uuid), public.brief_valid_content(jsonb,text), public.brief_word_count(text) from public;
grant execute on function public.save_brief_revision(uuid,integer,jsonb), public.review_brief_revision(uuid,integer,boolean), public.fork_brief_revision(uuid) to authenticated;
grant execute on function public.acquire_brief_worker(uuid), public.release_brief_worker(uuid), public.claim_brief_job(uuid) to service_role;
