import "./editorial-server-hook";
import test from "node:test";
import assert from "node:assert/strict";
import starters from "../src/data/editorial-starters.json";
const pipeline = await import("../src/lib/editorial/pipeline");
process.env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:59999";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="fixture-public";
process.env.SUPABASE_SECRET_KEY="fixture-service";
const publisher={id:"11111111-1111-4111-8111-111111111111",name:"OpenAI",feed_url:"https://openai.com/news/rss.xml",enabled:true};
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});

test('cron is discovery-only by default and runs selected work only in consented automatic mode',async(t)=>{
 const {GET}=await import('../src/app/api/cron/editorial/route');
 process.env.CRON_SECRET='fixture-cron';delete process.env.EDITORIAL_OPENROUTER_API_KEY;
 let auto=false;const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const url=String(input);calls.push(url);
  if(url.includes('brief_publishers')) return json([]);
  if(url.includes('brief_settings')) return json({auto_draft:auto});
  if(url.includes('acquire_brief_worker')) return json(false);
  if(url.includes('enqueue_brief_auto')) return json([]);
  throw new Error('Unexpected network call '+url);
 });
 assert.equal((await GET(new Request('http://local/api/cron/editorial'))).status,401);
 const request=()=>new Request('http://local/api/cron/editorial',{headers:{authorization:'Bearer fixture-cron'}});
 assert.equal((await GET(request())).status,200);
 assert.equal(calls.some(c=>c.includes('/rpc/')),false);
 auto=true;process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 assert.equal((await GET(request())).status,200);
 assert.equal(calls.some(c=>c.includes('acquire_brief_worker')),true);
});

test("worker targets exact requested jobs, attempts at most three and retains failed output charges",async(t)=>{
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-not-a-real-key';
 const ids=['22222222-2222-4222-8222-222222222222'];
 let claims=0,paid=0,released=false;
 const updates:Record<string,unknown>[]=[];
 const content=starters[0].content;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input), body=init?.body?JSON.parse(String(init.body)):{};
  if(url.includes('/rpc/acquire_brief_worker')) return json(true);
  if(url.includes('/rpc/release_brief_worker')) {released=true;return json(null);}
  if(url.includes('/rpc/claim_brief')) {assert.ok(url.endsWith('/claim_brief_selected_job'));assert.deepEqual(body.p_job_ids,ids);claims++; return json([{id:ids[0],story_id:publisher.id}]);}
  if(url.includes('/brief_sources')) return json({id:publisher.id,url:'https://openai.com/news/source',title:'Source'});
  if(url==='https://openai.com/news/source') return new Response(`<html><body><article><h1>Source</h1><p>${content.wholePicture.join(' ')}</p><p>${content.evidence.map(e=>e.quote).join(' ')}</p></article></body></html>`);
  if(url.includes('openrouter.ai')) {paid++;return json({usage:{cost:0.01},choices:[{finish_reason:'stop',message:{content:JSON.stringify(paid===2?{}:content)}}]});}
  if(url.includes('brief_jobs')) updates.push(body);
  return json(null);
 });
 const result=await pipeline.runEditorialBatch(ids);
 assert.equal(claims,3);assert.equal(paid,3);assert.equal(result.generated,2);assert.equal(result.failed,1);assert.equal(released,true);
 assert.equal(updates.filter(u=>u.cost===0.01).length,3);
 assert.equal(updates.filter(u=>u.state==='failed').length,1);
});

test("discovery reads enabled publishers and persists health without queueing or a model key",async(t)=>{
 const calls:{url:string;method:string;body:unknown}[]=[];
 delete process.env.EDITORIAL_OPENROUTER_API_KEY;
 t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input); calls.push({url,method:init?.method||"GET",body:init?.body?JSON.parse(String(init.body)):null});
  if(url.includes("brief_publishers") && (!init?.method||init.method==='GET')) return json([publisher]);
  if(url.includes("rss.xml")) return new Response('<rss><channel><item><title>New model</title><link>https://openai.com/news/new-model</link><pubDate>2026-10-01T00:00:00Z</pubDate></item></channel></rss>');
  if(url.includes("brief_sources")) return json([{id:"22222222-2222-4222-8222-222222222222"}]);
  return json(null);
 });
 const result=await pipeline.discoverStories();
 assert.equal(result.discovered,1);
 assert.equal(calls.some(c=>c.url.includes("brief_jobs")||c.url.includes("openrouter")),false);
 assert.ok(calls.some(c=>c.url.includes("brief_publishers")&&c.method==='PATCH'&&JSON.stringify(c.body).includes("last_success_at")));
 assert.equal(calls.filter(c=>c.url.startsWith('https://')).length,1);
});
