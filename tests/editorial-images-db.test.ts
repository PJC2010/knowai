import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import starters from '../src/data/editorial-starters.json';

const actor='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const migrationDir=new URL('../supabase/migrations/',import.meta.url);
const migrations=await Promise.all((await readdir(migrationDir)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(new URL(f,migrationDir),'utf8')));
async function setup() {
 const db=new PGlite();
 await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to anon,authenticated,service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const sql of migrations) await db.exec(sql);
 await db.query('insert into auth.users values($1),($2)',[actor,other]);
 await db.query('insert into brief_editors values($1)',[actor]);
 return db;
}
async function editor(db:PGlite,id=actor) { await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
async function revision(db:PGlite,n:number) {
 const c=starters[0].content;
 const story=(await db.query<{id:string}>("insert into brief_sources(url,slug,title,source_name,source_published_at,category,source_image_url) values($1,$2,'Story','OpenAI','2026-10-01','Models','https://cdn.example.com/source.jpg') returning id",[`https://openai.com/story-${n}`,`story-${n}`])).rows[0].id;
 const id=(await db.query<{id:string}>('insert into brief_revisions(story_id,content,source_text,source_hash) values($1,$2,$3,\'hash\') returning id',[story,JSON.stringify(c),c.evidence.map(e=>e.quote).join(' ')])).rows[0].id;
 return {id,story};
}
async function image(db:PGlite,id:string,version:number,source:string,url:string|null=null,alt='Article photograph') {
 return (await db.query<{result:{version:number;imageUrl:string|null;imageSource:string;imageAlt:string|null}}>('select set_brief_revision_image($1,$2,$3,$4,$5) as result',[id,version,source,url,alt])).rows[0].result;
}
const publish=(db:PGlite,id:string,version:number)=>db.query('select review_brief_desk($1,$2,true,true,true)',[id,version]);

test('story image changes are versioned, audited, restored and isolated from live publication',async()=>{
 const db=await setup();
 try {
  const {id,story}=await revision(db,1);
  await editor(db);
  const selected=await image(db,id,1,'source');
  assert.deepEqual(selected,{version:2,imageUrl:'https://cdn.example.com/source.jpg',imageSource:'source',imageAlt:'Article photograph',sourceImageUrl:'https://cdn.example.com/source.jpg'});
  await assert.rejects(image(db,id,1,'none'),/Draft changed/);
  await assert.rejects(image(db,id,2,'upload','https://attacker.example.com/image.jpg'),/Upload an image/);
  await publish(db,id,2);
  assert.equal((await db.query<{image_url:string}>('select image_url from brief_publications where id=$1',[story])).rows[0].image_url,selected.imageUrl);
  await assert.rejects(image(db,id,3,'none'),/no longer editable/);
  const fork=(await db.query<{id:string}>('select fork_brief_revision($1) as id',[id])).rows[0].id;
  assert.equal((await db.query<{image_url:string}>('select image_url from brief_revisions where id=$1',[fork])).rows[0].image_url,selected.imageUrl);
  await image(db,fork,1,'none');
  assert.equal((await db.query<{image_url:string}>('select image_url from brief_publications where id=$1',[story])).rows[0].image_url,selected.imageUrl);
  const history=(await db.query<{id:string}>("select id from brief_revision_history where revision_id=$1 and action='image'",[fork])).rows[0].id;
  const restored=(await db.query<{id:string}>('select restore_brief_revision($1,$2) as id',[fork,history])).rows[0].id;
  assert.equal((await db.query<{image_url:string}>('select image_url from brief_revisions where id=$1',[restored])).rows[0].image_url,selected.imageUrl,'Restore uses historical image snapshot, not current source');
  await publish(db,fork,2);
  assert.equal((await db.query<{image_url:null}>('select image_url from brief_publications where id=$1',[story])).rows[0].image_url,null);
  await assert.rejects(publish(db,restored,1),/newer publication/);
  await db.exec('reset role');
  await db.exec(migrations.at(-1)!);
  assert.equal((await db.query<{n:number}>('select count(*)::int as n from brief_publications')).rows[0].n,1,'Reapplying media migration preserves publication');
 } finally { await db.close(); }
});

test('registered uploads can be attached only to their revision and survive fork and alt edits',async()=>{
 const db=await setup();
 try {
  const a=await revision(db,1),b=await revision(db,2),url='https://project.supabase.co/storage/v1/object/public/brief-images/test.png';
  await db.query('insert into brief_image_uploads(revision_id,actor,path,url) values($1,$2,$3,$4)',[a.id,actor,'test.png',url]);
  await editor(db);
  await assert.rejects(image(db,b.id,1,'upload',url),/Upload an image/);
  await image(db,b.id,1,'source');
  await db.exec('reset role');
  await db.query("update brief_sources set source_image_url='https://cdn.example.com/new.jpg' where id=$1",[b.story]);
  await editor(db);
  assert.equal((await image(db,b.id,2,'source',null,'Updated description')).imageUrl,'https://cdn.example.com/source.jpg','Alt-only updates retain the saved snapshot');
  assert.equal((await image(db,b.id,3,'source','https://cdn.example.com/source.jpg')).imageUrl,'https://cdn.example.com/source.jpg','The exact old preview remains selectable');
  await assert.rejects(image(db,b.id,4,'source','https://attacker.example.com/fake.jpg'),/source image changed/);
  assert.equal((await image(db,b.id,4,'source','https://cdn.example.com/new.jpg')).imageUrl,'https://cdn.example.com/new.jpg','Explicit selection persists the latest preview');
  assert.equal((await image(db,a.id,1,'upload',url)).imageUrl,url);
  assert.equal((await image(db,a.id,2,'upload',null,'Updated description')).imageAlt,'Updated description');
  const fork=(await db.query<{id:string}>('select fork_brief_revision($1) as id',[a.id])).rows[0].id;
  assert.equal((await image(db,fork,1,'upload')).imageUrl,url);
  await assert.rejects(db.query('select * from brief_image_uploads'),/permission denied/);
  await assert.rejects(db.query('insert into brief_image_uploads(revision_id,actor,path,url) values($1,$2,$3,$4)',[b.id,actor,'fake','https://evil.example.com/fake']),/permission denied/);
  await db.exec('reset role');
  const bucket=(await db.query<{public:boolean;file_size_limit:number;allowed_mime_types:string[]}>('select * from storage.buckets')).rows[0];
  assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),3145728);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp']);
 } finally { await db.close(); }
});

test('weekly feature is editor-only, exclusive per Monday, audited, and independent from publication versions',async()=>{
 const db=await setup();
 try {
  const a=await revision(db,1),b=await revision(db,2);
  await editor(db);
  const feature=(id:string,week:string|null)=>(db.query<{result:{slug:string;featuredWeek:string|null}}>('select set_brief_feature($1,$2) as result',[id,week]));
  await assert.rejects(feature(a.id,'2026-10-05'),/Publish the story/);
  await publish(db,a.id,1);await publish(db,b.id,1);
  await assert.rejects(feature(a.id,'2026-10-04'),/Monday/);
  assert.deepEqual((await feature(a.id,'2026-10-05')).rows[0].result,{slug:'story-1',featuredWeek:'2026-10-05'});
  await feature(b.id,'2026-10-05');
  assert.equal((await db.query<{n:number}>('select count(*)::int as n from brief_publications where featured_week is not null')).rows[0].n,1);
  assert.equal((await db.query<{featured_week:null}>('select featured_week from brief_publications where id=$1',[a.story])).rows[0].featured_week,null);
  const desk=(await db.query<{data:{active:{brief_sources:{featured_week:string}}}}>('select load_brief_desk($1) as data',[JSON.stringify({id:b.id})])).rows[0].data;
  assert.equal(desk.active.brief_sources.featured_week,'2026-10-05');
  const fork=(await db.query<{id:string}>('select fork_brief_revision($1) as id',[b.id])).rows[0].id;
  await publish(db,fork,1);
  await assert.rejects(feature(b.id,null),/newer publication/);
  assert.equal((await db.query<{featured_week:string}>('select featured_week::text from brief_publications where id=$1',[b.story])).rows[0].featured_week,'2026-10-05','Republishing retains weekly feature');
  await feature(fork,null);
  assert.equal((await db.query<{n:number}>("select count(*)::int as n from brief_revision_history where action like 'feature:%' or action like 'unfeature:%'")).rows[0].n,4);
  await editor(db,other); await assert.rejects(feature(fork,'2026-10-05'),/Editor access required/);
  await assert.rejects(image(db,fork,1,'none'),/Editor access required/);
  await db.exec('set role anon');await assert.rejects(feature(fork,'2026-10-05'),/permission denied/);
  assert.equal((await db.query('select image_url,image_alt,featured_week from brief_publications')).rows.length,2);
  await assert.rejects(db.query('select * from brief_image_uploads'),/permission denied/);
 } finally {await db.close();}
});
