import './editorial-server-hook';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import { fixtureRest } from './helpers/editorial-fixture-rest';
import { addedSourceFixtures, syntheticSourceResponses } from './helpers/editorial-source-fixtures';
const { discoverStories } = await import('../src/lib/editorial/pipeline');

const actor='11111111-1111-4111-8111-111111111111';
const stamp='2026-10-01T12:00:00.000Z';
const rss=(links:{url:string;title:string}[])=>`<rss><channel>${links.map(s=>`<item><title>${s.title}</title><link>${s.url}</link><pubDate>${stamp}</pubDate></item>`).join('')}</channel></rss>`;
const newsroomUrl='https://www.anthropic.com/news';
const anthropicListing=(urls:string[])=>`<html><body><main><h1>Newsroom</h1><div class="PublicationList-module-scss-module__fixture__root"><ul class="PublicationList-module-scss-module__fixture__list">${urls.map(url=>`<li><a class="PublicationList-module-scss-module__fixture__listItem" href="${url}">Fixture article</a></li>`).join('')}</ul></div></main></body></html>`;
const anthropicArticle=(url:string)=>`<html><head><link rel="canonical" href="${url}"><meta property="og:title" content="Fixture Claude model"><meta property="article:published_time" content="${stamp}"></head><body><main><h1>Fixture Claude model</h1></main></body></html>`;
function controlGlobalDeadline(t:TestContext) {
 let expire:(()=>void)|undefined;
 const setTimer=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',(callback:(...args:unknown[])=>void,ms?:number,...args:unknown[])=>{
  if(ms===90_000)expire=()=>callback(...args);
  return setTimer(callback,ms,...args);
 });
 return ()=>{assert.ok(expire,'the global discovery deadline is armed');expire();};
}
async function fixture(t:TestContext, sources:Record<string,string|Response|((init?:RequestInit)=>Promise<Response>)>) {
 const hooks:{beforeRest?:(url:URL,init?:RequestInit)=>Promise<Response|void>}={};
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec(`create schema auth; create table auth.users(id uuid primary key);
  create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant execute on functions to anon,authenticated;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to anon,authenticated,service_role;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(directory)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file,directory),'utf8'));
 await db.query('insert into auth.users(id) values($1)',[actor]);
 await db.query('insert into brief_editors(user_id) values($1)',[actor]);
 await db.exec('update brief_publishers set enabled=false');
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:59999';
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public';
 process.env.SUPABASE_SECRET_KEY='fixture-service';
 delete process.env.EDITORIAL_OPENROUTER_API_KEY;
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  requests.push(url.href);
  if(url.origin==='http://127.0.0.1:59999') {
   init?.signal?.throwIfAborted();
   const injected=await hooks.beforeRest?.(url,init);
   init?.signal?.throwIfAborted();
   if(injected)return injected;
   const args=init?.body?JSON.parse(String(init.body)):null;
   const value=await fixtureRest(db,'service_role',url.pathname.replace('/rest/v1','')+url.search,init?.method||'GET',Object.fromEntries(new Headers(init?.headers)),args);
   return new Response(JSON.stringify(value.body),{headers:{'content-type':'application/json'}});
  }
  if(!(url.href in sources)) throw new Error('Unexpected external request '+url.href);
  const source=sources[url.href];return typeof source==='function'?source(init):source instanceof Response?source.clone():new Response(source);
 });
 return {db,requests,hooks,enable:async(name:string)=>{
  const result=await db.query<{id:string}>("update brief_publishers set enabled=true,access_status='approved',access_note='Synthetic local fixture approval, not real source permission.' where name=$1 returning id",[name]);
  assert.equal(result.rows.length,1,'configured source '+name);return result.rows[0].id;
 }};
}

test('individual refresh only fetches its enabled configured publisher',async(t)=>{
 const url='https://mistral.ai/news/rss';
 const f=await fixture(t,{[url]:rss([{url:'https://mistral.ai/news/fixture-single',title:'Fixture single model'}])});
 const id=await f.enable('Mistral');await f.enable('NVIDIA');
 const result=await discoverStories(id);
 assert.equal(result.discovered,1);
 assert.deepEqual(f.requests.filter(url=>url.startsWith('https:')),[url]);
 await f.db.query('update brief_publishers set enabled=false where id=$1',[id]);
 const before=f.requests.length;
 await assert.rejects(discoverStories(id),/disabled|enabled|unavailable|configured/i);
 assert.equal(f.requests.slice(before).filter(url=>url.startsWith('https:')).length,0);
 await assert.rejects(discoverStories('https://evil.test'),/publisher|valid/i);
});

test('broad feed relevance filters gaming without losing dated AI stories',async(t)=>{
 const feed='https://blogs.nvidia.com/feed/';
 const f=await fixture(t,{[feed]:rss([
  {url:'https://blogs.nvidia.com/blog/fixture-ai',title:'Fixture AI inference release'},
  {url:'https://blogs.nvidia.com/blog/fixture-game',title:'A new gaming adventure on GeForce NOW'},
 ])});
 const id=await f.enable('NVIDIA');
 const result=await discoverStories(id);
 assert.equal(result.discovered,1);
 assert.deepEqual((await f.db.query('select title from brief_sources')).rows,[{title:'Fixture AI inference release'}]);
});

test('Anthropic newsroom discovery stores only original dated metadata and never auto-drafts',async(t)=>{
 const url='https://www.anthropic.com/news/fixture-claude-release';
 const listing='<html><body><main><h1>Newsroom</h1><div class="PublicationList-module-scss-module__test__root"><ul class="PublicationList-module-scss-module__test__list"><li><a class="PublicationList-module-scss-module__test__listItem" href="/news/fixture-claude-release">Fixture Claude release</a></li></ul></div></main></body></html>';
 const article=`<html><head><title>Fixture Claude release</title><link rel="canonical" href="${url}"><meta property="og:title" content="Fixture Claude release"><meta property="article:published_time" content="${stamp}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url,headline:'Fixture Claude release',datePublished:stamp,mainEntityOfPage:{'@id':url}})}</script></head><body><main><h1>Fixture Claude release</h1>Transient article body must not persist.</main></body></html>`;
 const f=await fixture(t,{'https://www.anthropic.com/news':listing,[url]:article});
 const id=await f.enable('Anthropic');
 const result=await discoverStories(id);
 assert.equal(result.discovered,1);assert.deepEqual(result.autoDraftIds,[]);
 const row=(await f.db.query<{url:string;title:string;source_name:string;source_published_at:Date}>('select * from brief_sources')).rows[0];
 assert.equal(row.url,url);assert.equal(row.title,'Fixture Claude release');assert.equal(row.source_name,'Anthropic');assert.ok(!JSON.stringify(row).includes('Transient article body'));
 assert.equal((await f.db.query('select * from brief_revisions')).rows.length,0);
 assert.equal(new Date(row.source_published_at).toISOString(),stamp);
 const before=f.requests.filter(u=>u===url).length;
 assert.equal((await discoverStories(id)).discovered,0);
 assert.equal(f.requests.filter(u=>u===url).length,before,'known article does not need another metadata GET');
 assert.equal((await f.db.query('select * from brief_jobs')).rows.length,0);
 assert.equal((await f.db.query('select * from brief_publications')).rows.length,0);
});

test('unapproved source cannot fetch even when enabled directly',async(t)=>{
 const url='https://mistral.ai/news/rss';
 const f=await fixture(t,{[url]:rss([{url:'https://mistral.ai/news/fixture-unapproved',title:'Fixture AI model'}])});
 const id=await f.enable('Mistral');
 await f.db.query("update brief_publishers set access_status='review_required' where id=$1",[id]);
 const result=await discoverStories(id);
 assert.equal(result.discovered,0);
 assert.equal(f.requests.filter(u=>u.startsWith('https:')).length,0);
 assert.equal((await f.db.query('select * from brief_sources')).rows.length,0);
});

test('shared discovery lease stops overlapping refresh without source requests',async(t)=>{
 const f=await fixture(t,{});const id=await f.enable('Mistral');
 const token='22222222-2222-4222-8222-222222222222';
 await f.db.query('select acquire_brief_discovery($1)',[token]);
 const result=await discoverStories(id);
 assert.equal(result.busy,true);
 assert.equal(f.requests.filter(u=>u.startsWith('https:')).length,0);
 const lock=(await f.db.query<{token:string}>('select token from brief_discovery_lock')).rows[0];
 assert.equal(lock.token,token,'contending request cannot release another owner');
});

test('source rate limit is isolated, recorded and respected on the next refresh',async(t)=>{
 const bad='https://blogs.nvidia.com/feed/',good='https://mistral.ai/news/rss';
 const f=await fixture(t,{[bad]:new Response('upstream private body',{status:429,headers:{'retry-after':'300'}}),[good]:rss([{url:'https://mistral.ai/news/fixture-healthy',title:'Fixture AI model'}])});
 await f.enable('NVIDIA');await f.enable('Mistral');
 const result=await discoverStories();
 assert.equal(result.discovered,1);
 const row=(await f.db.query<{last_result:{outcome:string};retry_after:Date;last_error:string}>('select last_result,retry_after,last_error from brief_publishers where name=$1',['NVIDIA'])).rows[0];
 assert.equal(row.last_result.outcome,'unavailable');assert.ok(new Date(row.retry_after).getTime()>Date.now());
 assert.ok(!row.last_error.includes('upstream private body'));
 const before=f.requests.filter(u=>u===bad).length;
 await discoverStories();
 assert.equal(f.requests.filter(u=>u===bad).length,before);
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
});

test('refresh reads rate-limit state after a competing owner completes',async(t)=>{
 const feed='https://mistral.ai/news/rss';
 let fetches=0;
 const f=await fixture(t,{[feed]:async()=>{
  fetches++;
  return new Response('fixture throttled',{status:429,headers:{'retry-after':'300'}});
 }});
 const id=await f.enable('Mistral');
 let competingRetry:string|undefined;
 f.hooks.beforeRest=async(url)=>{
  if(!url.pathname.endsWith('/rpc/acquire_brief_discovery'))return;
  // A is about to acquire. B acquires, fetches, records backoff and releases.
  f.hooks.beforeRest=undefined;
  await discoverStories(id);
  const row=(await f.db.query<{retry_after:Date}>('select retry_after from brief_publishers where id=$1',[id])).rows[0];
  competingRetry=new Date(row.retry_after).toISOString();
 };
 const result=await discoverStories(id);
 assert.equal(fetches,1,'A must honor the retry window written by B under its lease');
 assert.equal(result.results[0].outcome,'skipped');
 const row=(await f.db.query<{retry_after:Date}>('select retry_after from brief_publishers where id=$1',[id])).rows[0];
 assert.equal(new Date(row.retry_after).toISOString(),competingRetry);
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
});

for(const change of ['enabled=false',"access_status='review_required'"]) {
 test(`refresh honors ${change} written before lease acquisition`,async(t)=>{
  const feed='https://mistral.ai/news/rss';
  const f=await fixture(t,{[feed]:rss([{url:'https://mistral.ai/news/fixture-revoked',title:'Fixture AI model'}])});
  const id=await f.enable('Mistral');
  f.hooks.beforeRest=async(url)=>{
   if(!url.pathname.endsWith('/rpc/acquire_brief_discovery'))return;
   f.hooks.beforeRest=undefined;
   const token='22222222-2222-4222-8222-222222222222';
   await f.db.query('select acquire_brief_discovery($1)',[token]);
   await f.db.query(`update brief_publishers set ${change} where id=$1`,[id]);
   await f.db.query('select release_brief_discovery($1)',[token]);
  };
  if(change==='enabled=false')await assert.rejects(discoverStories(id),/disabled or not configured/);
  else assert.equal((await discoverStories(id)).results[0].outcome,'unavailable');
  assert.deepEqual(f.requests.filter(u=>u.startsWith('https:')),[]);
  assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
 });
}

test('refresh starts from the continuation written by the previous lease owner',async(t)=>{
 const urls=['fixture-first','fixture-second','fixture-third'].map(slug=>`${newsroomUrl}/${slug}`);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),...Object.fromEntries(urls.map(url=>[url,anthropicArticle(url)]))});
 const id=await f.enable('Anthropic');
 await f.db.query('update brief_publishers set discovery_cursor=$1 where id=$2',[urls[0],id]);
 f.hooks.beforeRest=async(url)=>{
  if(!url.pathname.endsWith('/rpc/acquire_brief_discovery'))return;
  f.hooks.beforeRest=undefined;
  const token='22222222-2222-4222-8222-222222222222';
  await f.db.query('select acquire_brief_discovery($1)',[token]);
  await f.db.query('update brief_publishers set discovery_cursor=$1 where id=$2',[urls[1],id]);
  await f.db.query('select release_brief_discovery($1)',[token]);
 };
 const result=await discoverStories(id);
 assert.equal(result.discovered,3);
 assert.deepEqual(f.requests.filter(u=>urls.includes(u)),[urls[1],urls[2],urls[0]]);
});

test('publisher query failure releases the lease acquired before the read',async(t)=>{
 const f=await fixture(t,{});const id=await f.enable('Mistral');
 let ownerAtRead:string|null=null;
 f.hooks.beforeRest=async(url,init)=>{
  if(!url.pathname.endsWith('/brief_publishers')||init?.method!=='GET')return;
  ownerAtRead=(await f.db.query<{token:string|null}>('select token from brief_discovery_lock')).rows[0].token;
  return new Response(JSON.stringify({message:'fixture read failed'}),{status:400,headers:{'content-type':'application/json'}});
 };
 await assert.rejects(discoverStories(id),/Editorial storage operation failed/);
 assert.ok(ownerAtRead,'operational read must take place under an owned lease');
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
 assert.deepEqual(f.requests.filter(u=>u.startsWith('https:')),[]);
});

test('lease acquisition and state loading share a bounded preflight before publisher work',async(t)=>{
 const budget=new AbortController();
 const timeout=AbortSignal.timeout.bind(AbortSignal);
 let first=true;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{
  if(ms===5000&&first){first=false;return budget.signal;}
  return timeout(ms);
 });
 const feed='https://mistral.ai/news/rss';
 const f=await fixture(t,{[feed]:rss([{url:'https://mistral.ai/news/fixture-preflight',title:'Fixture AI model'}])});
 const id=await f.enable('Mistral');
 let acquisitionSignal:AbortSignal|undefined,readSignal:AbortSignal|undefined;
 f.hooks.beforeRest=async(url,init)=>{
  if(url.pathname.endsWith('/rpc/acquire_brief_discovery'))acquisitionSignal=init?.signal??undefined;
  if(!url.pathname.endsWith('/brief_publishers')||init?.method!=='GET')return;
  readSignal=init.signal??undefined;
  const value=await fixtureRest(f.db,'service_role',url.pathname.replace('/rest/v1','')+url.search,'GET',Object.fromEntries(new Headers(init.headers)),null);
  // An already-delivered response can finish decoding after its request budget.
  return new Response(new ReadableStream({pull(controller){
   budget.abort(new Error('Fixture preflight deadline'));
   controller.enqueue(new TextEncoder().encode(JSON.stringify(value.body)));controller.close();
  }},{highWaterMark:0}),{headers:{'content-type':'application/json'}});
 };
 const error=await discoverStories(id).then(()=>null,error=>error);
 assert.ok(acquisitionSignal,'lease acquisition must be bounded');
 assert.equal(acquisitionSignal,readSignal,'state loading must use the remaining acquisition budget, not restart it');
 assert.ok(error instanceof Error,'late state data must not start a fresh discovery budget');
 assert.deepEqual(f.requests.filter(u=>u.startsWith('https:')),[]);
 assert.equal(f.requests.some(u=>u.includes('/brief_sources')),false);
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
});

test('an acquisition response arriving after preflight expiry is released without reading publishers',async(t)=>{
 const budget=new AbortController(),timeout=AbortSignal.timeout.bind(AbortSignal);
 let first=true;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{
  if(ms===5000&&first){first=false;return budget.signal;}
  return timeout(ms);
 });
 const f=await fixture(t,{});const id=await f.enable('Mistral');
 f.hooks.beforeRest=async(url,init)=>{
  if(!url.pathname.endsWith('/rpc/acquire_brief_discovery'))return;
  const value=await fixtureRest(f.db,'service_role','/rpc/acquire_brief_discovery','POST',{},JSON.parse(String(init?.body)));
  return new Response(new ReadableStream({pull(controller){
   budget.abort(new Error('Fixture acquisition deadline'));
   controller.enqueue(new TextEncoder().encode(JSON.stringify(value.body)));controller.close();
  }},{highWaterMark:0}),{headers:{'content-type':'application/json'}});
 };
 await assert.rejects(discoverStories(id),/Fixture acquisition deadline/);
 assert.equal(f.requests.some(u=>u.includes('/brief_publishers')),false);
 assert.deepEqual(f.requests.filter(u=>u.startsWith('https:')),[]);
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
});

test('Anthropic article throttling persists a retry timestamp rather than a raw header',async(t)=>{
 const a=addedSourceFixtures.find(s=>s.key==='anthropic')!;
 const f=await fixture(t,{...syntheticSourceResponses,[a.url]:new Response('private upstream body',{status:429,headers:{'retry-after':'300'}})});
 const id=await f.enable('Anthropic');const result=await discoverStories(id);
 assert.equal(result.discovered,0);assert.deepEqual(result.unavailable,['Anthropic']);
 const row=(await f.db.query<{retry_after:Date;last_error:string}>('select retry_after,last_error from brief_publishers where id=$1',[id])).rows[0];
 assert.ok(new Date(row.retry_after).getTime()>Date.now());assert.match(row.last_error,/http-429/);
 const before=f.requests.filter(u=>u.startsWith('https:')).length;
 await discoverStories(id);assert.equal(f.requests.filter(u=>u.startsWith('https:')).length,before);
});

test('metadata storage failure preserves the retry window from a later Anthropic 429',async(t)=>{
 const now=Date.parse('2026-10-12T12:00:00Z');
 t.mock.method(Date,'now',()=>now);
 const urls=['fixture-valid','fixture-throttled'].map(slug=>`${newsroomUrl}/${slug}`);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),[urls[0]]:anthropicArticle(urls[0]),
  [urls[1]]:new Response('private upstream body',{status:429,headers:{'retry-after':'300'}})});
 const id=await f.enable('Anthropic');
 let storageFailures=0;
 f.hooks.beforeRest=async(url,init)=>{
  if(!url.pathname.endsWith('/brief_sources')||init?.method!=='POST')return;
  storageFailures++;
  return new Response(JSON.stringify({message:'private storage error'}),{status:400,headers:{'content-type':'application/json'}});
 };
 const result=await discoverStories(id);
 assert.equal(storageFailures,1,'the completed article reaches persistence after the 429');
 assert.equal(result.discovered,0);assert.equal(result.results[0].attempted,2);
 const row=(await f.db.query<{retry_after:Date|null;last_error:string}>('select retry_after,last_error from brief_publishers where id=$1',[id])).rows[0];
 assert.ok(row.retry_after,'storage failure must not clear the established upstream backoff');
 assert.equal(new Date(row.retry_after).toISOString(),new Date(now+300_000).toISOString());
 assert.match(row.last_error,/Editorial storage operation failed/);assert.ok(!row.last_error.includes('private'));
 const before=f.requests.filter(u=>u.startsWith('https:')).length;
 assert.equal((await discoverStories(id)).results[0].outcome,'skipped');
 assert.equal(f.requests.filter(u=>u.startsWith('https:')).length,before);
});

test('collection deadline preserves completed Anthropic metadata within the owned global budget',async(t)=>{
 const collection=new AbortController();
 const timeout=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',(ms:number)=>ms===60_000?collection.signal:timeout(ms));
 const urls=['fixture-complete','fixture-slow','fixture-remaining'].map(slug=>`${newsroomUrl}/${slug}`);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),[urls[0]]:anthropicArticle(urls[0]),[urls[1]]:async(init)=>{
  collection.abort(new Error('Fixture sixty-second collection deadline'));
  init?.signal?.throwIfAborted();
  throw new Error('Expected collection request cancellation');
 }});
 const id=await f.enable('Anthropic');
 let writeOwned=false,writeAborted:boolean|undefined;
 f.hooks.beforeRest=async(url,init)=>{
  if(!url.pathname.endsWith('/brief_sources')||init?.method!=='POST')return;
  writeOwned=!!(await f.db.query<{token:string|null}>('select token from brief_discovery_lock')).rows[0].token;
  writeAborted=init.signal?.aborted;
 };
 const result=await discoverStories(id);
 assert.equal(result.discovered,1,'a collection timeout must not discard completed article metadata');
 assert.equal(result.timedOut,false);assert.deepEqual(result.autoDraftIds,[]);
 assert.equal(writeOwned,true);assert.equal(writeAborted,false);
 const {outcome,scanned,inserted,attempted,remaining,duplicates,invalid}=result.results[0];
 assert.deepEqual({outcome,scanned,inserted,attempted,remaining,duplicates,invalid},
  {outcome:'partial',scanned:3,inserted:1,attempted:2,remaining:1,duplicates:0,invalid:0});
 assert.deepEqual((await f.db.query('select url from brief_sources')).rows,[{url:urls[0]}]);
 const health=(await f.db.query<{last_result:{inserted:number};discovery_cursor:string}>('select last_result,discovery_cursor from brief_publishers where id=$1',[id])).rows[0];
 assert.equal(health.last_result.inserted,1);assert.equal(health.discovery_cursor,urls[2]);
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
});

test('storage failure resumes at the first unpersisted Anthropic candidate',async(t)=>{
 const urls=['fixture-stored','fixture-write-failed','fixture-pending'].map(slug=>`${newsroomUrl}/${slug}`);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),...Object.fromEntries(urls.map(url=>[url,anthropicArticle(url)]))});
 const id=await f.enable('Anthropic');
 f.hooks.beforeRest=async(url,init)=>{
  if(url.pathname.endsWith('/brief_sources')&&init?.method==='POST'&&JSON.parse(String(init.body)).url===urls[1])
   return new Response(JSON.stringify({message:'fixture write failed'}),{status:400,headers:{'content-type':'application/json'}});
 };
 const result=await discoverStories(id);
 assert.equal(result.discovered,1);
 const health=(await f.db.query<{last_result:{remaining:number;inserted:number;attempted:number};discovery_cursor:string}>('select last_result,discovery_cursor from brief_publishers where id=$1',[id])).rows[0];
 assert.equal(health.discovery_cursor,urls[1],'the collected cursor cannot skip metadata that failed to persist');
 assert.equal(health.last_result.remaining,2);assert.equal(health.last_result.inserted,1);assert.equal(health.last_result.attempted,3);
 await f.db.query("update brief_sources set triage='selected' where url=$1",[urls[0]]);
 f.hooks.beforeRest=undefined;
 const before=f.requests.length;
 const retried=await discoverStories(id);
 assert.equal(retried.discovered,2);
 assert.deepEqual(f.requests.slice(before).filter(u=>urls.includes(u)),urls.slice(1));
 assert.equal(retried.results[0].duplicates,1);assert.equal(retried.results[0].remaining,0);
 assert.equal((await f.db.query<{triage:string}>('select triage from brief_sources where url=$1',[urls[0]])).rows[0].triage,'selected');
 assert.equal((await f.db.query('select * from brief_jobs')).rows.length,0);
});

test('global cancellation checkpoints retry and unpersisted metadata before releasing ownership',async(t)=>{
 const expire=controlGlobalDeadline(t);
 const now=Date.parse('2026-10-12T12:00:00Z');t.mock.method(Date,'now',()=>now);
 const urls=['fixture-acknowledged','fixture-pending-write','fixture-rate-limited'].map(slug=>`${newsroomUrl}/${slug}`);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),[urls[0]]:anthropicArticle(urls[0]),[urls[1]]:anthropicArticle(urls[1]),
  [urls[2]]:new Response('fixture throttled',{status:429,headers:{'retry-after':'300'}})});
 const id=await f.enable('Anthropic');
 let entered!:()=>void,release!:()=>void;
 const writing=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
 let writeSignal:AbortSignal|undefined;
 f.hooks.beforeRest=async(url,init)=>{
  if(!url.pathname.endsWith('/brief_sources')||init?.method!=='POST'||JSON.parse(String(init.body)).url!==urls[1])return;
  writeSignal=init.signal??undefined;entered();await held;
 };
 const pending=discoverStories(id);
 try {
  await writing;expire();
  const result=await pending;
  assert.equal(result.timedOut,true);assert.equal(result.discovered,1);assert.equal(writeSignal?.aborted,true);
  const health=(await f.db.query<{retry_after:Date|null;discovery_cursor:string;last_result:{remaining:number;inserted:number;attempted:number}}>('select retry_after,discovery_cursor,last_result from brief_publishers where id=$1',[id])).rows[0];
  assert.ok(health.retry_after,'pool cancellation must preserve backoff before publisher work settles');
  assert.equal(new Date(health.retry_after).toISOString(),new Date(now+300_000).toISOString());
  assert.equal(health.discovery_cursor,urls[1]);
  assert.equal(health.last_result.remaining,1);assert.equal(health.last_result.inserted,1);assert.equal(health.last_result.attempted,3);
  assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
  const token='22222222-2222-4222-8222-222222222222';
  await f.db.query('select acquire_brief_discovery($1)',[token]);
  await f.db.query("update brief_publishers set last_error='fixture next owner' where id=$1",[id]);
  const requests=f.requests.length;
  const snapshot=JSON.stringify(result);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.requests.length,requests,'cancelled work cannot dispatch late storage requests');
  assert.equal(JSON.stringify(result),snapshot,'late completion cannot mutate returned health');
  assert.deepEqual((await f.db.query('select url from brief_sources')).rows,[{url:urls[0]}]);
  assert.equal((await f.db.query<{last_error:string}>('select last_error from brief_publishers where id=$1',[id])).rows[0].last_error,'fixture next owner');
  assert.equal((await f.db.query<{token:string}>('select token from brief_discovery_lock')).rows[0].token,token);
 } finally {release();await pending;}
});

test('late storage acknowledgement cannot mutate timed-out discovery or resume writes',async(t)=>{
 const expire=controlGlobalDeadline(t);
 const urls=['fixture-late-ack','fixture-never-written'].map(slug=>`${newsroomUrl}/${slug}`);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),...Object.fromEntries(urls.map(url=>[url,anthropicArticle(url)]))});
 const id=await f.enable('Anthropic');
 let entered!:()=>void,release!:()=>void;
 const reading=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
 f.hooks.beforeRest=async(url,init)=>{
  if(!url.pathname.endsWith('/brief_sources')||init?.method!=='POST')return;
  // The server committed while owned, but its acknowledgement body is delayed
  // beyond cancellation. The client must treat this outcome as unacknowledged.
  const value=await fixtureRest(f.db,'service_role',url.pathname.replace('/rest/v1','')+url.search,'POST',Object.fromEntries(new Headers(init.headers)),JSON.parse(String(init.body)));
  return new Response(new ReadableStream({async pull(controller){
   entered();await held;controller.enqueue(new TextEncoder().encode(JSON.stringify(value.body)));controller.close();
  }},{highWaterMark:0}),{headers:{'content-type':'application/json'}});
 };
 const pending=discoverStories(id);
 try {
  await reading;expire();
  const result=await pending;
  assert.equal(result.timedOut,true);assert.equal(result.discovered,0);
  const snapshot=JSON.stringify(result),requests=f.requests.length;
  const healthBefore=(await f.db.query('select last_result,discovery_cursor from brief_publishers where id=$1',[id])).rows;
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(result),snapshot,'late acknowledgements cannot change a settled result');
  assert.equal(f.requests.length,requests,'no more writes may start after global cancellation');
  assert.deepEqual((await f.db.query('select last_result,discovery_cursor from brief_publishers where id=$1',[id])).rows,healthBefore);
  assert.deepEqual((await f.db.query('select url from brief_sources')).rows,[{url:urls[0]}]);
  assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
 } finally {release();await pending;}
});

test('global cancellation before publisher work preserves an existing retry window',async(t)=>{
 const now=Date.parse('2026-10-12T12:00:00Z');t.mock.method(Date,'now',()=>now);
 const setTimer=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',(callback:(...args:unknown[])=>void,ms?:number,...args:unknown[])=>{
  if(ms===90_000)callback(...args);
  return setTimer(callback,ms,...args);
 });
 const f=await fixture(t,{});const id=await f.enable('Mistral');
 const retry=new Date(now+300_000).toISOString();
 await f.db.query('update brief_publishers set retry_after=$1 where id=$2',[retry,id]);
 const result=await discoverStories(id);
 assert.equal(result.timedOut,true);
 const row=(await f.db.query<{retry_after:Date|null}>('select retry_after from brief_publishers where id=$1',[id])).rows[0];
 assert.ok(row.retry_after,'cancellation must not clear operational state for an unstarted task');
 assert.equal(new Date(row.retry_after).toISOString(),retry);
 assert.deepEqual(f.requests.filter(u=>u.startsWith('https:')),[]);
});

test('global cancellation during collection cannot persist previously collected metadata after release',async(t)=>{
 const expire=controlGlobalDeadline(t);
 const urls=['fixture-collected','fixture-late-fetch'].map(slug=>`${newsroomUrl}/${slug}`);
 let entered!:()=>void,release!:()=>void;
 const fetching=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);
 const f=await fixture(t,{[newsroomUrl]:anthropicListing(urls),[urls[0]]:anthropicArticle(urls[0]),[urls[1]]:async()=>{
  entered();await held;return new Response(anthropicArticle(urls[1]));
 }});
 const id=await f.enable('Anthropic');
 await f.db.query('update brief_publishers set discovery_cursor=$1 where id=$2',[urls[0],id]);
 const pending=discoverStories(id);
 try {
  await fetching;expire();
  const result=await pending;
  assert.equal(result.timedOut,true);assert.equal(result.discovered,0);
  const healthBefore=(await f.db.query<{discovery_cursor:string}>('select discovery_cursor,last_result from brief_publishers where id=$1',[id])).rows;
  assert.equal(healthBefore[0].discovery_cursor,urls[0],'the unpersisted article stays at the front of the continuation');
  const requests=f.requests.length;
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.requests.length,requests);
  assert.deepEqual((await f.db.query('select discovery_cursor,last_result from brief_publishers where id=$1',[id])).rows,healthBefore);
  assert.deepEqual((await f.db.query('select url from brief_sources')).rows,[]);
  assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
 } finally {release();await pending;}
});

test('whole-run deadline preserves completed counts and health before releasing its lease',async(t)=>{
 const slow='https://blogs.nvidia.com/feed/',good='https://mistral.ai/news/rss';
 const f=await fixture(t,{[good]:rss([{url:'https://mistral.ai/news/fixture-deadline',title:'Fixture AI model'}]),[slow]:(init)=>new Promise((_resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Fixture safety timeout')),2000);
  init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal?.reason);},{once:true});
 })});
 await f.enable('Mistral');await f.enable('NVIDIA');
 const started=Date.now();
 const result=await discoverStories(undefined,{deadlineMs:400});
 assert.ok(Date.now()-started<1500,'the whole refresh honors its bounded deadline');
 assert.equal(result.timedOut,true);assert.equal(result.discovered,1);
 assert.equal(result.results.find(r=>r.name==='Mistral')?.inserted,1);
 const health=(await f.db.query<{last_result:{outcome:string}}>('select last_result from brief_publishers where name=$1',['NVIDIA'])).rows[0];
 assert.equal(health.last_result.outcome,'unavailable');
 assert.equal((await f.db.query<{token:null}>('select token from brief_discovery_lock')).rows[0].token,null);
});

test('all ten additions reach the real private inbox with original metadata and provenance',async(t)=>{
 const f=await fixture(t,syntheticSourceResponses);
 for(const source of addedSourceFixtures)await f.enable(source.name);
 const result=await discoverStories();
 assert.equal(result.discovered,10);assert.deepEqual(result.autoDraftIds,[]);assert.deepEqual(result.unavailable,[]);
 const rows=(await f.db.query<{url:string;source_name:string;source_published_at:Date;source_kind:string;triage:string}>(`select s.url,s.source_name,s.source_published_at,s.triage,p.source_kind from brief_sources s join brief_publishers p on p.id=s.publisher_id`)).rows;
 assert.equal(rows.length,10);
 for(const fixture of addedSourceFixtures){
  const row=rows.find(row=>row.url===fixture.url);assert.ok(row,fixture.name);
  assert.equal(row.source_name,fixture.name);assert.equal(row.source_kind,fixture.kind);assert.equal(row.triage,'inbox');assert.equal(new Date(row.source_published_at).toISOString(),stamp);
 }
 assert.equal((await discoverStories()).discovered,0);
 const counts=(await f.db.query<{publishers:number;jobs:number;revisions:number;publications:number}>(`select (select count(*)::int from brief_publishers) publishers,(select count(*)::int from brief_jobs) jobs,(select count(*)::int from brief_revisions) revisions,(select count(*)::int from brief_publications) publications`)).rows[0];
 assert.deepEqual(counts,{publishers:17,jobs:0,revisions:0,publications:0});
 assert.ok(!JSON.stringify(rows).includes('Transient'));
});

test('enabled Mistral discovery stores dated inbox entries beyond eight without changing selection or drafting',async(t)=>{
 const feed='https://mistral.ai/news/rss';
 const f=await fixture(t,{[feed]:rss(Array.from({length:12},(_,i)=>({url:`https://mistral.ai/news/fixture-model-${i}`,title:`Fixture AI model ${i}`})))});
 const id=await f.enable('Mistral');
 const result=await discoverStories(id);
 assert.equal(result.discovered,12);
 assert.deepEqual(result.autoDraftIds,[]);
 const rows=(await f.db.query<{id:string;source_name:string;source_published_at:Date;triage:string}>('select id,source_name,source_published_at,triage from brief_sources order by url')).rows;
 assert.equal(rows.length,12);
 assert.ok(rows.every(s=>s.source_name==='Mistral'&&new Date(s.source_published_at).toISOString()===stamp&&s.triage==='inbox'));
 await f.db.query("update brief_sources set triage='selected' where id=$1",[rows[0].id]);
 assert.equal((await discoverStories(id)).discovered,0);
 assert.equal((await f.db.query<{triage:string}>('select triage from brief_sources where id=$1',[rows[0].id])).rows[0].triage,'selected');
 assert.equal((await f.db.query('select * from brief_jobs')).rows.length,0);
 assert.equal((await f.db.query('select * from brief_revisions')).rows.length,0);
 assert.equal((await f.db.query('select * from brief_publications')).rows.length,0);
 assert.ok(!f.requests.some(url=>url.includes('openrouter')));
});
