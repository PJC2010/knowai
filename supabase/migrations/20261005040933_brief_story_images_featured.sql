-- Apply after the editorial daily cap migration. Existing publications remain
-- unchanged until an editor publishes an image revision or selects a feature.
begin;
alter table public.brief_sources add column if not exists source_image_url text;
alter table public.brief_revisions add column if not exists image_url text;
alter table public.brief_revisions add column if not exists image_alt text;
alter table public.brief_revisions add column if not exists image_source text not null default 'source' check(image_source in ('source','upload','none'));
alter table public.brief_revision_history add column if not exists image_url text;
alter table public.brief_revision_history add column if not exists image_alt text;
alter table public.brief_revision_history add column if not exists image_source text not null default 'source' check(image_source in ('source','upload','none'));
alter table public.brief_publications add column if not exists image_url text;
alter table public.brief_publications add column if not exists image_alt text;
alter table public.brief_publications add column if not exists featured_week date check(featured_week is null or extract(isodow from featured_week)=1);
create unique index if not exists brief_publications_featured_week on public.brief_publications(featured_week) where featured_week is not null;

-- Only the authenticated server uploads bytes and registers their immutable URL.
-- Editors cannot forge arbitrary URLs by calling the attachment RPC directly.
create table if not exists public.brief_image_uploads (
 id uuid primary key default gen_random_uuid(),
 revision_id uuid not null references public.brief_revisions(id) on delete cascade,
 actor uuid not null references auth.users(id),
 path text not null unique, url text not null unique,
 created_at timestamptz not null default now()
);
create index if not exists brief_image_uploads_revision on public.brief_image_uploads(revision_id);
alter table public.brief_image_uploads enable row level security;
revoke all on public.brief_image_uploads from public,anon,authenticated;
grant all on public.brief_image_uploads to service_role;
-- PGlite database tests omit Supabase Storage; real Supabase always has buckets.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('brief-images','brief-images',true,3145728,array['image/jpeg','image/png','image/webp'])
   on conflict(id) do update set public=true,file_size_limit=3145728,allowed_mime_types=excluded.allowed_mime_types;
 end if;
end; $$;
-- No storage.objects write policies: only the server's service client can upload.

create or replace function public.capture_brief_image_history() returns trigger
language plpgsql set search_path=public as $$
begin
 select image_url,image_alt,image_source into new.image_url,new.image_alt,new.image_source from brief_revisions where id=new.revision_id;
 return new;
end; $$;
revoke all on function public.capture_brief_image_history() from public,anon,authenticated;
drop trigger if exists capture_brief_image_history on public.brief_revision_history;
create trigger capture_brief_image_history before insert on public.brief_revision_history for each row execute function public.capture_brief_image_history();

create or replace function public.set_brief_revision_image(p_id uuid,p_version integer,p_source text,p_url text,p_alt text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r brief_revisions; selected_url text; source_url text;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select * into r from brief_revisions where id=p_id for update;
 if r.id is null or r.state<>'needs_review' or r.version is distinct from p_version then raise exception 'Draft changed or is no longer editable'; end if;
 if p_source is null or p_source not in ('source','upload','none') or p_alt is null or char_length(p_alt)>500 then raise exception 'Invalid image selection or description'; end if;
 select source_image_url into source_url from brief_sources where id=r.story_id;
 if p_source='source' then
  -- Save the exact preview: either this revision's immutable snapshot or the
  -- latest discovered source image. Reject arbitrary client-supplied URLs.
  if p_url is not null then
   if p_url is distinct from coalesce(source_url,'') and not (r.image_source='source' and p_url=coalesce(r.image_url,'')) then raise exception 'The source image changed. Refresh the image before saving.'; end if;
   selected_url:=nullif(p_url,'');
  else selected_url:=case when r.image_source='source' and r.image_url is not null then r.image_url else source_url end;
  end if;
 elsif p_source='upload' then
  if p_url is null and r.image_source='upload' and r.image_url is not null then selected_url:=r.image_url;
  elsif exists(select 1 from brief_image_uploads where revision_id=r.id and actor=auth.uid() and url=p_url) then selected_url:=p_url;
  else raise exception 'Upload an image before selecting it'; end if;
 end if;
 if selected_url is not null and (char_length(selected_url)>2048 or selected_url !~ '^https?://') then raise exception 'Invalid image URL'; end if;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(r.id,r.content,r.version,'image',auth.uid());
 update brief_revisions set image_source=p_source,image_url=selected_url,image_alt=case when selected_url is null then null else nullif(trim(p_alt),'') end,version=version+1 where id=r.id returning * into r;
 return jsonb_build_object('version',r.version,'imageSource',r.image_source,'imageUrl',r.image_url,'imageAlt',r.image_alt,'sourceImageUrl',source_url);
end; $$;
revoke all on function public.set_brief_revision_image(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.set_brief_revision_image(uuid,integer,text,text,text) to authenticated;

create or replace function public.fork_brief_revision(p_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare r brief_revisions; new_id uuid;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 select * into r from brief_revisions where id=p_id;
 if r.id is null then raise exception 'Revision not found'; end if;
 insert into brief_revisions(story_id,content,source_text,source_hash,image_url,image_alt,image_source)
  values(r.story_id,r.content,r.source_text,r.source_hash,r.image_url,r.image_alt,r.image_source) returning id into new_id;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(new_id,r.content,1,'fork',auth.uid());
 return new_id;
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
 insert into brief_revisions(story_id,content,source_text,source_hash,image_url,image_alt,image_source)
  values(r.story_id,h.content,historical.source_text,historical.source_hash,h.image_url,h.image_alt,h.image_source) returning id into new_id;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(new_id,h.content,1,'restore',auth.uid());
 return new_id;
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
  insert into brief_publications(id,slug,source_url,source_name,source_published_at,category,one_liner,short_version,whole_picture,why_it_matters,image_url,image_alt)
   values(s.id,s.slug,s.url,s.source_name,s.source_published_at,s.category,r.content->>'oneLiner',r.content->>'shortVersion',array(select jsonb_array_elements_text(r.content->'wholePicture')),r.content->>'whyItMatters',r.image_url,r.image_alt)
   on conflict(id) do update set one_liner=excluded.one_liner,short_version=excluded.short_version,whole_picture=excluded.whole_picture,why_it_matters=excluded.why_it_matters,image_url=excluded.image_url,image_alt=excluded.image_alt,updated_at=now();
 end if;
 insert into brief_revision_history(revision_id,content,version,action,actor) values(r.id,r.content,r.version,case when p_publish then 'publish' else 'reject' end,auth.uid());
 update brief_revisions set state=case when p_publish then 'published' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),version=version+1 where id=r.id;
 return s.slug;
end; $$;
revoke all on function public.fork_brief_revision(uuid),public.restore_brief_revision(uuid,uuid),public.review_brief_revision(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.fork_brief_revision(uuid),public.restore_brief_revision(uuid,uuid),public.review_brief_revision(uuid,integer,boolean) to authenticated;

create or replace function public.set_brief_feature(p_id uuid,p_week date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r brief_revisions; publication brief_publications; displaced brief_revisions;
begin
 if not is_brief_editor() then raise exception 'Editor access required'; end if;
 if p_week is not null and extract(isodow from p_week)<>1 then raise exception 'Choose the Monday that starts the featured week'; end if;
 -- Serialize feature replacement, then follow publication's revision/source order.
 perform pg_advisory_xact_lock(620106);
 select * into r from brief_revisions where id=p_id for update;
 if r.id is null or r.state<>'published' then raise exception 'Publish the story before featuring it'; end if;
 perform id from brief_sources where id=r.story_id for update;
 select * into publication from brief_publications where id=r.story_id for update;
 if publication.id is null or r.reviewed_at is distinct from publication.updated_at then raise exception 'A newer publication exists. Reload its published revision before featuring.'; end if;
 if p_week is not null then
  for displaced in select rev.* from brief_revisions rev join brief_publications p on p.id=rev.story_id
   where p.featured_week=p_week and p.id<>r.story_id and rev.state='published' and rev.reviewed_at=p.updated_at loop
   insert into brief_revision_history(revision_id,content,version,action,actor) values(displaced.id,displaced.content,displaced.version,'unfeature:'||p_week::text,auth.uid());
  end loop;
  update brief_publications set featured_week=null where featured_week=p_week and id<>r.story_id;
 end if;
 update brief_publications set featured_week=p_week where id=r.story_id;
 insert into brief_revision_history(revision_id,content,version,action,actor)
  values(r.id,r.content,r.version,case when p_week is null then 'unfeature:'||coalesce(publication.featured_week::text,'none') else 'feature:'||p_week::text end,auth.uid());
 return jsonb_build_object('slug',publication.slug,'featuredWeek',p_week);
end; $$;
revoke all on function public.set_brief_feature(uuid,date) from public,anon,authenticated;
grant execute on function public.set_brief_feature(uuid,date) to authenticated;

create or replace function public.brief_desk_source(p_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select (to_jsonb(s)-'created_at') || jsonb_build_object(
 'job_state',(select j.state from brief_jobs j where j.story_id=s.id order by j.created_at desc,j.id desc limit 1),
 'revision_id',(select r.id from brief_revisions r where r.story_id=s.id order by r.created_at desc,r.id desc limit 1),
 'featured_week',(select p.featured_week from brief_publications p where p.id=s.id))
 from brief_sources s where s.id=p_id;
$$;
revoke all on function public.brief_desk_source(uuid) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
