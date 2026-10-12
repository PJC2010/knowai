-- Private, additive publisher catalog. Apply after the event-confirmation migration.
-- Deploy the compatible application before enabling a new source. Disable newsroom
-- sources before reverting to a feed-only application; retain this schema/history.
begin;
alter table public.brief_publishers add column if not exists catalog_key text;
alter table public.brief_publishers add column if not exists source_kind text;
alter table public.brief_publishers add column if not exists access_status text;
alter table public.brief_publishers add column if not exists access_note text;
alter table public.brief_publishers add column if not exists discovery_method text not null default 'feed';
alter table public.brief_publishers add column if not exists discovery_url text;
alter table public.brief_publishers alter column feed_url drop not null;

-- Older seed INSERTs omit discovery_url; NOT NULL is checked before ON CONFLICT.
-- Derive only legacy feed-only inserts from their supplied URL, never a newsroom
-- endpoint or catalog identity. Updates and explicit discovery URLs stay strict.
create or replace function public.fill_brief_publisher_feed_discovery() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.catalog_key is null and new.discovery_method='feed' and new.discovery_url is null then
  new.discovery_url:=new.feed_url;
 end if;
 return new;
end; $$;
revoke all on function public.fill_brief_publisher_feed_discovery() from public,anon,authenticated;
drop trigger if exists brief_publisher_feed_discovery on public.brief_publishers;
create trigger brief_publisher_feed_discovery before insert on public.brief_publishers
 for each row execute function public.fill_brief_publisher_feed_discovery();

-- Match legacy identities without rewriting their IDs, feed URLs, health or switches.
update public.brief_publishers p set catalog_key=c.key,source_kind=c.kind
from (values
 ('openai','OpenAI','company'),
 ('google','Google','company'),
 ('hugging-face','Hugging Face','community'),
 ('techcrunch','TechCrunch','journalism'),
 ('deepmind','Google DeepMind','research'),
 ('google-research','Google Research','research'),
 ('meta-engineering','Meta Engineering','company')
) as c(key,name,kind)
where p.name=c.name and p.catalog_key is null;
update public.brief_publishers set discovery_url=feed_url
where discovery_url is null and discovery_method='feed';

-- Backfill policy once. Reapplication must not overwrite an administrator's
-- later approval/restriction or claim that endpoint reachability grants rights.
update public.brief_publishers set
 access_status=case when catalog_key in ('openai','google','hugging-face','techcrunch','deepmind','google-research','meta-engineering')
  then 'approved' else 'review_required' end,
 access_note=coalesce(access_note,case when catalog_key in ('openai','google','hugging-face','techcrunch','deepmind','google-research','meta-engineering')
  then null else 'Publisher terms and access review required before discovery or import.' end)
where access_status is null;

insert into public.brief_publishers(catalog_key,name,source_kind,discovery_method,discovery_url,feed_url,enabled,access_status,access_note)
select c.*,false,
 case when c.catalog_key in ('aws-ml','ars-technica','the-verge','mit-tech-review','the-decoder') then 'blocked' else 'review_required' end,
 case when c.catalog_key='the-decoder' then 'Blocked: publisher robots.txt disallows */feed/. Do not fetch this endpoint.'
  when c.catalog_key in ('aws-ml','ars-technica','the-verge','mit-tech-review') then 'Blocked pending resolution of observed automated-access restrictions. See docs/editorial-sources.md before discovery or import.'
  else 'Publisher terms and access review required before discovery or import.' end
from (values
 ('microsoft-research','Microsoft Research','research','feed','https://www.microsoft.com/en-us/research/feed/','https://www.microsoft.com/en-us/research/feed/'),
 ('nvidia','NVIDIA','company','feed','https://blogs.nvidia.com/feed/','https://blogs.nvidia.com/feed/'),
 ('aws-ml','AWS Machine Learning','company','feed','https://aws.amazon.com/blogs/machine-learning/feed/','https://aws.amazon.com/blogs/machine-learning/feed/'),
 ('mistral','Mistral','company','feed','https://mistral.ai/news/rss','https://mistral.ai/news/rss'),
 ('bair','Berkeley BAIR','research','feed','https://bair.berkeley.edu/blog/feed.xml','https://bair.berkeley.edu/blog/feed.xml'),
 ('ars-technica','Ars Technica','journalism','feed','https://arstechnica.com/feed/','https://arstechnica.com/feed/'),
 ('the-verge','The Verge','journalism','feed','https://www.theverge.com/rss/ai-artificial-intelligence/index.xml','https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'),
 ('mit-tech-review','MIT Technology Review','journalism','feed','https://www.technologyreview.com/topic/artificial-intelligence/feed/','https://www.technologyreview.com/topic/artificial-intelligence/feed/'),
 ('the-decoder','The Decoder','journalism','feed','https://the-decoder.com/feed/','https://the-decoder.com/feed/'),
 ('anthropic','Anthropic','company','newsroom','https://www.anthropic.com/news',null)
) as c(catalog_key,name,source_kind,discovery_method,discovery_url,feed_url)
on conflict(name) do nothing;
alter table public.brief_publishers alter column access_status set default 'review_required';
alter table public.brief_publishers alter column access_status set not null;
alter table public.brief_publishers drop constraint if exists brief_publishers_access_status;
alter table public.brief_publishers add constraint brief_publishers_access_status
 check(access_status in ('approved','review_required','blocked'));
alter table public.brief_publishers drop constraint if exists brief_publishers_access_note;
alter table public.brief_publishers add constraint brief_publishers_access_note check(char_length(access_note)<=1000);

-- Unknown legacy publishers retain their history but have no invented catalog
-- identity/provenance. Retrieval must resolve the reviewed catalog, not just a URL.
create unique index if not exists brief_publishers_catalog_key on public.brief_publishers(catalog_key);
alter table public.brief_publishers alter column discovery_url set not null;
alter table public.brief_publishers drop constraint if exists brief_publishers_catalog_identity;
alter table public.brief_publishers add constraint brief_publishers_catalog_identity
 check(catalog_key is null or (catalog_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and source_kind is not null));
alter table public.brief_publishers drop constraint if exists brief_publishers_source_kind;
alter table public.brief_publishers add constraint brief_publishers_source_kind
 check(source_kind in ('company','journalism','research','community'));
alter table public.brief_publishers drop constraint if exists brief_publishers_discovery;
alter table public.brief_publishers add constraint brief_publishers_discovery
 check(char_length(trim(discovery_url))>0 and (
  (discovery_method='feed' and feed_url is not null and feed_url=discovery_url)
  or (discovery_method='newsroom' and feed_url is null)));
-- Keep source controls private even when platform defaults grant client access.
alter table public.brief_publishers enable row level security;
revoke all on public.brief_publishers from public,anon,authenticated;
grant select on public.brief_publishers to authenticated;
grant all on public.brief_publishers to service_role;
create or replace function public.set_brief_publisher(p_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare publisher public.brief_publishers;
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_enabled is null then raise exception 'Invalid publisher setting'; end if;
 select * into publisher from public.brief_publishers where id=p_id for update;
 if not found then raise exception 'Publisher not found'; end if;
 if p_enabled and (publisher.catalog_key is null or publisher.catalog_key not in (
  'openai','google','hugging-face','techcrunch','deepmind','google-research','meta-engineering',
  'microsoft-research','nvidia','aws-ml','mistral','bair','ars-technica','the-verge','mit-tech-review','the-decoder','anthropic'
 )) then raise exception 'Publisher not configured'; end if;
 if p_enabled and publisher.access_status<>'approved' then
  raise exception 'Publisher access must be approved before enabling; review required or blocked';
 end if;
 update public.brief_publishers set enabled=p_enabled where id=publisher.id;
end; $$;
revoke all on function public.set_brief_publisher(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_brief_publisher(uuid,boolean) to authenticated;

-- Keep the existing enqueue_brief_auto original-four allowlist. Scheduled claims
-- still exclude stale :auto jobs from a partial/older rollout. The editor-only
-- Generate/Regenerate/Run queued RPCs may explicitly authorize those same rows;
-- recovery requires both that recorded consent and exact job IDs, never just IDs.
-- Selection, worker lease and the shared daily cap remain unchanged.
create or replace function public.claim_brief_selected_job(p_token uuid,p_job_ids uuid[] default null) returns setof public.brief_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare job_id uuid;
begin
 perform pg_advisory_xact_lock(620104);
 if not exists(select 1 from public.brief_worker_lock where token=p_token and expires_at>now()) then return; end if;
 update public.brief_jobs set state='failed',error='Worker interrupted. Usage may have been charged; retry explicitly.',finished_at=now() where state='generating' and attempted_at<now()-interval '6 minutes';
 if public.brief_attempts_today()>=public.brief_daily_attempt_limit() then return; end if;
 select j.id into job_id from public.brief_jobs j join public.brief_sources s on s.id=j.story_id
  where j.state='queued' and j.selected and s.triage='selected' and (p_job_ids is null or j.id=any(p_job_ids))
   and (j.dedupe_key not like '%:auto'
    or (p_job_ids is not null and j.generation_authorized_at is not null)
    or exists(select 1 from public.brief_publishers p where p.id=s.publisher_id and p.name in ('OpenAI','Google','Hugging Face','TechCrunch')))
  order by s.source_published_at desc,j.created_at,j.id for update of j skip locked limit 1;
 if job_id is null then return; end if;
 return query update public.brief_jobs set state='generating',attempted_at=now() where id=job_id returning *;
end; $$;
revoke all on function public.claim_brief_selected_job(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_brief_selected_job(uuid,uuid[]) to service_role;

-- Preserve the image/feature projection while attaching relational provenance.
create or replace function public.brief_desk_source(p_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select (to_jsonb(s)-'created_at') || jsonb_build_object(
 'source_kind',p.source_kind,
 'job_state',(select j.state from public.brief_jobs j where j.story_id=s.id order by j.created_at desc,j.id desc limit 1),
 'revision_id',(select r.id from public.brief_revisions r where r.story_id=s.id order by r.created_at desc,r.id desc limit 1),
 'featured_week',(select pub.featured_week from public.brief_publications pub where pub.id=s.id))
 from public.brief_sources s left join public.brief_publishers p on p.id=s.publisher_id where s.id=p_id;
$$;

-- Extend the latest daily-cap desk implementation, not the pre-cap RPC. The
-- shared filtered source set applies to inbox, revisions and jobs before paging.
-- Sidebar counts and persisted selection deliberately remain workspace-global.
create or replace function public.load_brief_desk(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v text := coalesce(p_query->>'view','inbox'); st text; pg integer:=1; sz integer:=25;
 total bigint; ids uuid[]; result jsonb; active jsonb; hist jsonb; since_date timestamptz;
 source_kind_filter text:=nullif(p_query->>'sourceKind','');
begin
 if not public.is_brief_editor() then raise exception 'Editor access required'; end if;
 if source_kind_filter is not null and source_kind_filter not in ('company','journalism','research','community') then
  raise exception 'Invalid source kind';
 end if;
 if v not in ('inbox','drafts','published','sources') then v:='inbox'; end if;
 st:=coalesce(nullif(p_query->>'status',''),case when v='inbox' then 'inbox' else 'needs_review' end);
 if coalesce(p_query->>'page','') ~ '^[0-9]{1,8}$' then pg:=greatest(1,(p_query->>'page')::integer); end if;
 begin since_date:=nullif(p_query->>'since','')::timestamptz; exception when others then since_date:=null; end;
 with filtered as (
  select s.id from public.brief_sources s left join public.brief_publishers p on p.id=s.publisher_id where
   (coalesce(p_query->>'q','')='' or position(lower(left(p_query->>'q',200)) in lower(s.title||' '||s.source_name))>0)
   and (coalesce(p_query->>'publisher','')='' or s.publisher_id::text=p_query->>'publisher')
   and (coalesce(p_query->>'category','')='' or s.category=p_query->>'category')
   and (since_date is null or s.source_published_at>=since_date)
   and (source_kind_filter is null or p.source_kind=source_kind_filter)
 ), items as (
  select s.id,s.source_published_at as sort from public.brief_sources s join filtered f on f.id=s.id
   where v='inbox' and (st='all' or s.triage=st)
  union all
  select r.id,r.created_at from public.brief_revisions r join filtered f on f.id=r.story_id
   where (v='published' and r.state='published') or (v='drafts' and st not in ('failed','queued') and r.state=case when st='rejected' then 'rejected' else 'needs_review' end)
  union all
  select j.id,j.created_at from public.brief_jobs j join filtered f on f.id=j.story_id
   where v='drafts' and st in ('failed','queued') and (j.state=st or (st='queued' and j.state='generating'))
 ) select coalesce(array_agg(id order by sort desc,id desc),'{}') into ids from items;
 total:=cardinality(ids); pg:=least(pg,greatest(1,ceil(total::numeric/sz)::integer));
 ids:=ids[((pg-1)*sz+1):(pg*sz)];
 select (to_jsonb(r)-'reviewed_by'-'job_id') || jsonb_build_object('brief_sources',public.brief_desk_source(r.story_id)) into active from public.brief_revisions r where r.id::text=p_query->>'id';
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'version',h.version,'created_at',h.created_at,'content',h.content) order by h.created_at desc,h.id desc),'[]') into hist
 from public.brief_revision_history h join public.brief_revisions r on r.id=h.revision_id where r.story_id::text=active->>'story_id';
 result:=jsonb_build_object(
 'sources',case when v='inbox' then (select coalesce(jsonb_agg(public.brief_desk_source(i) order by n),'[]') from unnest(ids) with ordinality a(i,n)) else '[]'::jsonb end,
 'revisions',case when v='published' or (v='drafts' and st not in ('failed','queued')) then
  (select coalesce(jsonb_agg((to_jsonb(r)-'reviewed_by'-'job_id'-'source_text')||jsonb_build_object('source_text','','brief_sources',public.brief_desk_source(r.story_id)) order by a.n),'[]') from unnest(ids) with ordinality a(i,n) join public.brief_revisions r on r.id=a.i) else '[]'::jsonb end,
 'jobs',case when v='drafts' and st in ('failed','queued') then
  (select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'story_id',j.story_id,'state',j.state,'error',j.error,'cost',j.cost,'created_at',j.created_at,'title',s.title,'source_url',s.url,'source_name',s.source_name,'source_kind',p.source_kind,'selected',j.selected and s.triage='selected') order by a.n),'[]') from unnest(ids) with ordinality a(i,n) join public.brief_jobs j on j.id=a.i join public.brief_sources s on s.id=j.story_id left join public.brief_publishers p on p.id=s.publisher_id) else '[]'::jsonb end,
 'publishers',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]') from public.brief_publishers p),
 'active',active,'history',hist,'total',total,'page',pg,'pageSize',sz,
 'selectedIds',(select coalesce(jsonb_agg(s.id order by s.id),'[]') from public.brief_sources s where s.triage='selected'),
 'attemptsToday',public.brief_attempts_today(),'dailyAttemptLimit',public.brief_daily_attempt_limit(),'autoDraft',(select auto_draft from public.brief_settings where id),
 'counts',jsonb_build_object(
  'inbox',(select count(*) from public.brief_sources where triage='inbox'),
  'selected',(select count(*) from public.brief_sources where triage='selected'),
  'saved',(select count(*) from public.brief_sources where triage='saved'),
  'dismissed',(select count(*) from public.brief_sources where triage='dismissed'),
  'drafts',(select count(*) from public.brief_revisions where state='needs_review'),
  'published',(select count(*) from public.brief_revisions where state='published'),
  'rejected',(select count(*) from public.brief_revisions where state='rejected'),
  'failed',(select count(*) from public.brief_jobs where state='failed'),
  'queued',(select count(*) from public.brief_jobs where state in ('queued','generating'))));
 return result;
end; $$;
revoke all on function public.brief_desk_source(uuid),public.load_brief_desk(jsonb) from public,anon,authenticated;
grant execute on function public.load_brief_desk(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
