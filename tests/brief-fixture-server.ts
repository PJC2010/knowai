// Local-only Supabase fixture backed by the actual migrations. Never imported by app routes.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import starters from "../src/data/editorial-starters.json";
import { fixtureRest } from "./helpers/editorial-fixture-rest";

const actor = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-10-04T09:00:00.000Z";
const sourceId = (i:number) => `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
const revisionId = "10000000-0000-4000-8000-000000000001";
const sourceImage = (i: number) => i < 2 ? `https://images.example.test/article-${i + 1}.png` : null;
const storedImages = new Map<string, { body: Buffer; contentType: string }>();
const db = new PGlite();
await db.exec(`create schema auth; create table auth.users(id uuid primary key);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create role anon; create role authenticated; create role service_role bypassrls;
alter default privileges in schema public grant execute on functions to anon,authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;`);
const migrationDir = new URL('../supabase/migrations/',import.meta.url);
for(const file of (await readdir(migrationDir)).filter(f=>f.endsWith('.sql')).sort())
  await db.exec(await readFile(new URL(file,migrationDir),'utf8'));
await db.query('insert into auth.users(id) values($1)',[actor]);
await db.query('insert into brief_editors(user_id) values($1)',[actor]);
async function seed() {
  storedImages.clear();
  await db.exec('truncate brief_revision_history,brief_publications,brief_revisions,brief_jobs,brief_sources cascade');
  for(const [i,s] of starters.entries()) {
    await db.query('insert into brief_sources(id,slug,url,title,source_name,source_published_at,category,source_image_url) values($1,$2,$3,$4,$5,$6,$7,$8)',[sourceId(i),s.slug,s.url,s.title,s.source_name,s.source_published_at,s.category,sourceImage(i)]);
    await db.query('insert into brief_publications(id,slug,source_url,source_name,source_published_at,category,one_liner,short_version,whole_picture,why_it_matters,published_at,updated_at,edition_date,image_url,image_alt) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14)',[sourceId(i),s.slug,s.url,s.source_name,s.source_published_at,s.category,s.content.oneLiner,s.content.shortVersion,s.content.wholePicture,s.content.whyItMatters,stamp,'2026-10-04',sourceImage(i),sourceImage(i)?'An illustration supplied with the original article':null]);
  }
  await db.query('insert into brief_revisions(id,story_id,content,source_text,source_hash,created_at,image_url,image_alt,image_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[revisionId,sourceId(0),JSON.stringify(starters[0].content),'PRIVATE_CAPTURE_FOR_REVIEW '+starters[0].content.evidence.map(e=>e.quote).join(' '),'fixture',stamp,sourceImage(0),'An illustration supplied with the original article','source']);
  for(const [i,s] of starters.entries()) {
    await db.query('insert into brief_revisions(id,story_id,content,source_text,source_hash,state,reviewed_by,reviewed_at,created_at,image_url,image_alt,image_source) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)',[`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,sourceId(i),JSON.stringify(s.content),'PRIVATE_CAPTURE_FOR_REVIEW '+s.content.evidence.map(e=>e.quote).join(' '),'fixture','published',actor,stamp,sourceImage(i),sourceImage(i)?'An illustration supplied with the original article':null,sourceImage(i)?'source':'none']);
  }
  // Clearly identified example candidates, never represented as real reporting.
  for(let i=4;i<135;i++)
    await db.query('insert into brief_sources(id,slug,url,title,source_name,source_published_at,category) values($1,$2,$3,$4,$5,$6,$7)',[sourceId(i),`fixture-candidate-${i}`,`https://openai.com/fixture-candidate-${i}`,`Fixture candidate ${String(i).padStart(2,'0')} — a sample AI research story for editor testing`,'OpenAI',stamp,'Research']);
  if ((await db.query("select 1 from information_schema.tables where table_name='brief_publishers'")).rows.length) {
    await db.exec("update brief_sources s set publisher_id=p.id from brief_publishers p where s.source_name=p.name; update brief_publishers set enabled=true,last_attempt_at=null,last_success_at=null,last_error=null; update brief_settings set auto_draft=false,daily_attempt_limit=10; update brief_worker_lock set token=null,expires_at=null;");
  }
}
await seed();
const otpRequests:unknown[]=[];
let saveFailure:'none'|'conflict'|'network'='none';
let saveDelay=0;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://127.0.0.1:4310');
  const send=(status:number,body:unknown,extra:Record<string,string>={})=>{
    res.writeHead(status,{'Content-Type':'application/json','X-Supabase-Api-Version':'2024-01-01',...extra});
    res.end(req.method==='HEAD'?'':JSON.stringify(body));
  };
  try {
    const auth=req.headers.authorization||'';
    const editor=auth.startsWith('Bearer ey')&&auth.includes('.editor-fixture-signature');
    const service=auth==='Bearer fixture-service-key';
    const chunks: Buffer[]=[]; for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const payload=Buffer.concat(chunks);
    if(url.pathname.startsWith('/storage/v1/object/public/brief-images/')&&['GET','HEAD'].includes(req.method||'GET')) {
      const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/public/brief-images/'.length));
      const stored=storedImages.get(key);
      if(!stored)return send(404,{message:'Fixture image not found'});
      res.writeHead(200,{'Content-Type':stored.contentType,'Content-Length':String(stored.body.length)});
      return res.end(req.method==='HEAD'?undefined:stored.body);
    }
    if(url.pathname.startsWith('/storage/v1/object/brief-images/')&&req.method==='POST') {
      if(!service)return send(403,{message:'Fixture uploads require the server credential'});
      const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/brief-images/'.length));
      let body=payload,contentType=req.headers['content-type']||'application/octet-stream';
      if(contentType.startsWith('multipart/form-data')) {
        const form=await new Response(payload,{headers:{'content-type':contentType}}).formData();
        const file=[...form.values()].find((value): value is File => typeof value!=='string');
        if(!file)return send(400,{message:'Missing fixture upload'});
        body=Buffer.from(await file.arrayBuffer());contentType=file.type;
      }
      if(!['image/jpeg','image/png','image/webp'].includes(contentType)||body.length>3*1024*1024)return send(400,{message:'Invalid fixture image type or size'});
      if(storedImages.has(key))return send(409,{message:'Fixture image already exists'});
      storedImages.set(key,{body,contentType});
      return send(200,{Id:crypto.randomUUID(),Key:`brief-images/${key}`});
    }
    const args=payload.length?JSON.parse(payload.toString('utf8')):{};
    if(url.pathname==='/storage/v1/object/brief-images'&&req.method==='DELETE') {
      if(!service)return send(403,{message:'Fixture deletes require the server credential'});
      const prefixes=Array.isArray(args.prefixes)?args.prefixes:[];
      for(const prefix of prefixes)storedImages.delete(prefix);
      return send(200,prefixes.map((name: string)=>({name})));
    }
    if(url.pathname==='/health')return send(200,{ready:true});
    if(url.pathname==='/_fixture/otp-requests')return send(200,otpRequests);
    if(url.pathname==='/_fixture/reset'&&req.method==='POST'){await seed(); saveFailure='none'; saveDelay=0; return send(200,{ok:true});}
    if(url.pathname==='/_fixture/attempts'&&req.method==='POST'){
      if(!Number.isInteger(args.count)||args.count<0||args.count>1000)return send(400,{message:'Invalid fixture attempt count'});
      await db.query("insert into brief_jobs(story_id,dedupe_key,state,attempted_at,finished_at) select $1,'fixture-attempt-'||gen_random_uuid(),'failed',now(),now() from generate_series(1,$2::integer)",[sourceId(0),args.count]);
      return send(200,{ok:true});
    }
    if(url.pathname==='/_fixture/save-behavior'&&req.method==='POST'){saveFailure=args.failure||'none';saveDelay=Math.min(5000,Number(args.delay)||0);return send(200,{ok:true});}
    if(url.pathname==='/auth/v1/otp'){
      otpRequests.push({...args,redirect_to:url.searchParams.get('redirect_to')});
      return otpRequests.length>1?send(429,{code:'over_email_send_rate_limit',msg:'email rate limit exceeded'}):send(403,{code:'email_address_not_authorized',msg:'Email address not authorized'});
    }
    if(url.pathname==='/auth/v1/user')return editor?send(200,{id:actor,aud:'authenticated',role:'authenticated',email:'editor@example.test',email_confirmed_at:stamp,created_at:stamp,app_metadata:{provider:'email'},user_metadata:{},identities:[]}):send(401,{message:'Unauthorized'});
    if(url.pathname==='/rest/v1/brief_image_uploads'&&req.method==='POST') {
      if(!service)return send(403,{message:'Fixture upload registration requires the server credential'});
      await db.query('insert into brief_image_uploads(revision_id,actor,path,url) values($1,$2,$3,$4)',[args.revision_id,args.actor,args.path,args.url]);
      return send(201,null);
    }
    if(url.pathname==='/rest/v1/brief_image_uploads'&&req.method==='DELETE') {
      if(!service)return send(403,{message:'Fixture upload cleanup requires the server credential'});
      const filter=url.searchParams.get('url');
      if(!filter?.startsWith('eq.'))return send(400,{message:'Expected an exact upload URL filter'});
      await db.query('delete from brief_image_uploads where url=$1',[filter.slice(3)]);
      return send(200,null);
    }
    if(url.pathname==='/rest/v1/brief_sources'&&req.method==='PATCH') {
      if(!service)return send(403,{message:'Fixture source metadata writes require the server credential'});
      const filter=url.searchParams.get('id');
      if(!filter?.startsWith('eq.')||Object.keys(args).some(key=>key!=='source_image_url'))return send(400,{message:'Expected source image metadata and an exact source ID'});
      await db.query('update brief_sources set source_image_url=$1 where id=$2',[args.source_image_url,filter.slice(3)]);
      return send(200,null);
    }
    if(!url.pathname.startsWith('/rest/v1/'))return send(404,{message:'Unknown fixture route'});
    if(url.pathname.includes('/rpc/save_')&&editor){
      if(saveDelay)await new Promise(r=>setTimeout(r,saveDelay));
      if(saveFailure==='network')return send(503,{message:'Fixture temporarily unavailable'});
      if(saveFailure==='conflict'){
        await db.query('update brief_revisions set version=version+1 where id=$1',[revisionId]);saveFailure='none';
      }
    }
    const result=await fixtureRest(db,service?'service_role':editor?'authenticated':'anon',url.pathname.slice('/rest/v1'.length)+url.search,req.method||'GET',{accept:req.headers.accept},args,actor);
    return send(200,result.body,result.total===undefined?{}:{'Content-Range':`0-${Math.max(0,(Array.isArray(result.body)?result.body.length:0)-1)}/${result.total}`});
  } catch(error){
    const e=error as {message:string;code?:string};
    console.error('[fixture]',url.pathname,e.message);
    return send(e.code==='42501'?403:400,{message:e.message,code:e.code||'FIXTURE_ERROR'});
  }
});
server.listen(4310,'127.0.0.1',()=>console.log('Local editorial SQL fixture ready'));
process.on('SIGTERM',()=>server.close(()=>void db.close()));
