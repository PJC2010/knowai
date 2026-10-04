import './editorial-server-hook';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import starters from '../src/data/editorial-starters.json';
const desk = await import('../src/lib/editorial/desk').catch(()=>({})) as typeof import('../src/lib/editorial/desk');
const id='11111111-1111-4111-8111-111111111111';
const session={db:createClient('http://127.0.0.1:59999','fixture-session',{auth:{persistSession:false}}),user:{id}};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('desk discovery and approved URL import make no model calls or generation jobs',async(t)=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:59999';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public';process.env.SUPABASE_SECRET_KEY='fixture-service';
 delete process.env.EDITORIAL_OPENROUTER_API_KEY;
 const calls:string[]=[];let saved:Record<string,unknown>|undefined;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);calls.push(url);
  if(url.startsWith('https://openai.com')) return new Response('<html><head><title>Model release</title><meta property="article:published_time" content="2026-10-01"></head></html>');
  if(url.includes('brief_publishers')) return json(url.includes('name=')?{id}:[]);
  if(url.includes('brief_sources')) {saved=JSON.parse(String(init?.body));return json([{id}]);}
  throw new Error('Unexpected network '+url);
 });
 assert.equal((await desk.executeDeskMutation({intent:'discover'},session)).ok,true);
 assert.equal((await desk.executeDeskMutation({intent:'import-url',url:'https://openai.com/news/model'},session)).ok,true);
 assert.equal(saved?.publisher_id,id);assert.equal(saved?.source_published_at,'2026-10-01T00:00:00.000Z');
 assert.equal(calls.some(c=>c.includes('openrouter')||c.includes('brief_jobs')),false);
});

test('paid generation requires confirmation and scopes the worker to exactly enqueued IDs',async(t)=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:59999';
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public';
 process.env.SUPABASE_SECRET_KEY='fixture-service';
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 const calls:{name:string;body:Record<string,unknown>}[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const name=String(input).split('/').pop()!,body=JSON.parse(String(init?.body));calls.push({name,body});
  if(name==='enqueue_brief_selection') return json([id]);
  if(name==='acquire_brief_worker') return json(true);
  if(name==='claim_brief_selected_job') {assert.deepEqual(body.p_job_ids,[id]);return json([]);}
  if(name==='load_brief_desk') return json({attemptsToday:4});
  return json(null);
 });
 assert.equal((await desk.executeDeskMutation({intent:'generate',ids:[id],confirmCharge:false},session)).ok,false);
 assert.equal(calls.some(c=>c.name==='enqueue_brief_selection'),false);
 const result=await desk.executeDeskMutation({intent:'generate',ids:[id],confirmCharge:true},session);
 assert.equal(result.ok,true); assert.equal(result.attemptsToday,4);
 assert.deepEqual(calls.find(c=>c.name==='enqueue_brief_selection')?.body,{p_ids:[id],p_regenerate:false});
 const regen=await desk.executeDeskMutation({intent:'regenerate',id,confirmCharge:true},session);
 assert.equal(regen.ok,true);
 assert.deepEqual(calls.filter(c=>c.name==='enqueue_brief_selection').at(-1)?.body,{p_ids:[id],p_regenerate:true});
});

test('run queued confirms charges before authorizing only the existing selected queue',async(t)=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:59999';
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public';
 process.env.SUPABASE_SECRET_KEY='fixture-service';
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 const calls:{name:string;body:Record<string,unknown>;key:string|null}[]=[];
 let authorized:string[]=[id];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const name=String(input).split('/').pop()!,body=JSON.parse(String(init?.body));
  calls.push({name,body,key:new Headers(init?.headers).get('apikey')});
  if(name==='authorize_brief_selected_queue') return json(authorized);
  if(name==='acquire_brief_worker') return json(true);
  if(name==='claim_brief_selected_job') return json([]);
  if(name==='load_brief_desk') return json({attemptsToday:0});
  if(name==='release_brief_worker') return json(null);
  throw new Error('Unexpected network '+String(input));
 });
 assert.equal((await desk.executeDeskMutation({intent:'run-queued',confirmCharge:false},session)).ok,false);
 assert.deepEqual(calls.map(c=>c.name),['load_brief_desk']);
 calls.length=0;
 delete process.env.EDITORIAL_OPENROUTER_API_KEY;
 assert.equal((await desk.executeDeskMutation({intent:'run-queued',confirmCharge:true},session)).ok,false);
 assert.deepEqual(calls.map(c=>c.name),['load_brief_desk']);
 calls.length=0;
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 assert.equal((await desk.executeDeskMutation({intent:'run-queued',confirmCharge:true},session)).ok,true);
 assert.deepEqual(calls.map(c=>c.name),['authorize_brief_selected_queue','acquire_brief_worker','claim_brief_selected_job','release_brief_worker','load_brief_desk']);
 assert.equal(calls[0].key,'fixture-session','Authorization must use the authenticated editor, not service role');
 assert.deepEqual(calls[0].body,{});
 assert.deepEqual(calls.find(c=>c.name==='claim_brief_selected_job')?.body.p_job_ids,[id]);
 calls.length=0;
 authorized=[];
 assert.equal((await desk.executeDeskMutation({intent:'run-queued',confirmCharge:true},session)).ok,true);
 assert.deepEqual(calls.map(c=>c.name),['authorize_brief_selected_queue','load_brief_desk'],'An empty queue must not start an unscoped worker');
});

test('selection actions retain the 200-ID request limit and surface the persisted cap error',async(t)=>{
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const name=String(input).split('/').pop()!;calls.push(name);
  if(name==='load_brief_desk') return json({attemptsToday:0});
  if(name==='triage_brief_sources') return json({code:'P0001',message:'Select at most 200 stories. Deselect a story before adding another.'},400);
  throw new Error('Unexpected network '+String(input));
 });
 const ids=Array.from({length:201},()=>id);
 assert.equal((await desk.executeDeskMutation({intent:'triage',ids,state:'selected'},session)).ok,false);
 assert.equal((await desk.executeDeskMutation({intent:'generate',ids,confirmCharge:true},session)).ok,false);
 assert.deepEqual(calls,['load_brief_desk']);
 const capped=await desk.executeDeskMutation({intent:'triage',ids:[id],state:'selected'},session);
 assert.equal(capped.ok,false);
 assert.match(capped.message,/at most 200/);
 assert.deepEqual(calls,['load_brief_desk','triage_brief_sources']);
});

test('desk load and public action reject without an editor session',async()=>{
 assert.equal(typeof desk.loadDesk,'function');
 await assert.rejects(desk.loadDesk({view:'inbox'}));
 const actions=await import('../src/app/editor/desk-actions');
 assert.equal((await actions.mutateDesk({intent:'triage',ids:[id],state:'selected'})).ok,false);
});

test('review requires saved-version attestations; controls dispatch only fixed authorized RPCs',async(t)=>{
 const calls:{name:string;body:Record<string,unknown>}[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const name=String(input).split('/').pop()!;
  calls.push({name,body:JSON.parse(String(init?.body))});
  return json(name==='review_brief_desk'?'story-slug':name==='fork_brief_revision'||name==='restore_brief_revision'?id:null);
 });
 assert.equal((await desk.executeDeskMutation({intent:'publish',id,version:1,sourceChecked:false,tiersChecked:true},session)).ok,false);
 assert.equal(calls.length,0);
 assert.equal((await desk.executeDeskMutation({intent:'publish',id,version:1,sourceChecked:true,tiersChecked:true},session)).slug,'story-slug');
 assert.deepEqual(calls[0],{name:'review_brief_desk',body:{p_id:id,p_version:1,p_publish:true,p_source_checked:true,p_tiers_checked:true}});
 assert.equal((await desk.executeDeskMutation({intent:'reject',id,version:1},session)).ok,true);
 assert.equal((await desk.executeDeskMutation({intent:'fork',id},session)).revisionId,id);
 assert.equal((await desk.executeDeskMutation({intent:'restore',id,historyId:id},session)).revisionId,id);
 assert.equal((await desk.executeDeskMutation({intent:'triage',ids:[id],state:'selected'},session)).ok,true);
 assert.equal((await desk.executeDeskMutation({intent:'publisher',id,enabled:false},session)).ok,true);
 assert.equal((await desk.executeDeskMutation({intent:'auto-draft',enabled:true,confirmCharge:false},session)).ok,false);
 assert.equal((await desk.executeDeskMutation({intent:'auto-draft',enabled:true,confirmCharge:true},session)).ok,true);
 assert.deepEqual(calls.map(c=>c.name),['review_brief_desk','review_brief_desk','fork_brief_revision','restore_brief_revision','triage_brief_sources','set_brief_publisher','set_brief_auto_draft']);
});

test('save returns exact atomic version and conflict preserves client text without refreshing',async(t)=>{
 assert.equal(typeof desk.executeDeskMutation,'function');
 let count=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  assert.equal(String(input),'http://127.0.0.1:59999/rest/v1/rpc/save_brief_desk');
  assert.equal(JSON.parse(String(init?.body)).p_version,1);
  return ++count===1?json(2):json({code:'P0001',message:'Draft changed or is no longer editable. Reload before saving.'},400);
 });
 const input={intent:'save' as const,id,version:1,content:starters[0].content};
 assert.deepEqual(await desk.executeDeskMutation(input,session),{ok:true,message:'Draft saved. It is still unpublished.',version:2});
 const conflict=await desk.executeDeskMutation(input,session);
 assert.equal(conflict.ok,false);assert.equal(conflict.code,'conflict');assert.equal(conflict.version,undefined);
 assert.equal(input.content.oneLiner,starters[0].content.oneLiner);
});
