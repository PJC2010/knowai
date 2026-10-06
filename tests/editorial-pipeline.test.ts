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
  if(url.includes('/brief_jobs')) return json([]);
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

test('discovery considers approved primary-feed entries beyond the first eight',async(t)=>{
 const saved:string[]=[];
 const feed=Array.from({length:12},(_,i)=>`<item><title>Research update ${i+1}</title><link>https://openai.com/news/research-${i+1}</link><pubDate>2026-10-01T00:00:00Z</pubDate></item>`).join('');
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('brief_publishers') && (!init?.method || init.method==='GET')) return json([publisher]);
  if(url===publisher.feed_url) return new Response(`<rss><channel>${feed}</channel></rss>`);
  if(url.includes('brief_sources')) {
   saved.push(JSON.parse(String(init?.body)).url);
   return json([{id:`22222222-2222-4222-8222-${String(saved.length).padStart(12,'0')}`}]);
  }
  if(url.includes('openrouter') || url.includes('brief_jobs')) throw new Error('Discovery must not generate');
  return json(null);
 });
 const result=await pipeline.discoverStories();
 assert.equal(result.discovered,12);
 assert.equal(saved.length,12);
 assert.ok(saved.includes('https://openai.com/news/research-12'));
});

test('discovery imports Atom alternate links and published dates as source metadata',async(t)=>{
 const saved:Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('brief_publishers') && (!init?.method || init.method==='GET')) return json([publisher]);
  if(url===publisher.feed_url) return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>New model in Atom</title><link rel="self" href="https://openai.com/news/feed-entry"/><link rel="alternate" href="https://openai.com/news/atom-model"/><published>2026-10-01T14:05:00Z</published><updated>2026-10-02T14:05:00Z</updated></entry></feed>`);
  if(url.includes('brief_sources')) { saved.push(JSON.parse(String(init?.body))); return json([{id:'22222222-2222-4222-8222-222222222222'}]); }
  return json(null);
 });
 const result=await pipeline.discoverStories();
 assert.equal(result.discovered,1);
 assert.deepEqual(result.unavailable,[]);
 assert.equal(saved[0].url,'https://openai.com/news/atom-model');
 assert.equal(saved[0].source_published_at,'2026-10-01T14:05:00.000Z');
});

test('discovery reports a feed that exceeds its bounded scan window',async(t)=>{
 const updates:Record<string,unknown>[]=[];
 let saved=0;
 const entries=Array.from({length:51},(_,i)=>`<item><title>Paper ${i+1}</title><link>https://openai.com/news/paper-${i+1}</link><pubDate>2026-10-01T00:00:00Z</pubDate></item>`).join('');
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('brief_publishers') && (!init?.method || init.method==='GET')) return json([publisher]);
  if(url===publisher.feed_url) return new Response(`<rss><channel>${entries}</channel></rss>`);
  if(url.includes('brief_publishers') && init?.method==='PATCH') updates.push(JSON.parse(String(init.body)));
  if(url.includes('brief_sources')) { saved++; return json([{id:`22222222-2222-4222-8222-${String(saved).padStart(12,'0')}`}]); }
  return json(null);
 });
 const result=await pipeline.discoverStories();
 assert.equal(result.discovered,50);
 assert.match(result.message,/OpenAI.*50.*(limit|window|scanned)/i);
 assert.ok(updates.some(update=>String(update.last_error).includes('50')),'The publisher settings must show the warning after refresh');
 assert.ok(updates.some(update=>update.last_success_at),'The feed itself was healthy');
});

test('wider discovery does not widen the pre-existing automatic drafting window',async(t)=>{
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 const entries=Array.from({length:12},(_,i)=>`<item><title>Update ${i+1}</title><link>https://openai.com/news/auto-${i+1}</link><pubDate>2026-10-01T00:00:00Z</pubDate></item>`).join('');
 let nextId=0;
 let eligible:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('brief_publishers') && (!init?.method || init.method==='GET')) return json([publisher]);
  if(url===publisher.feed_url) return new Response(`<rss><channel>${entries}</channel></rss>`);
  if(url.includes('brief_sources')) return json([{id:`22222222-2222-4222-8222-${String(++nextId).padStart(12,'0')}`}]);
  if(url.includes('brief_settings')) return json({auto_draft:true});
  if(url.includes('/rpc/enqueue_brief_auto')) { eligible=JSON.parse(String(init?.body)).p_ids; return json(null); }
  if(url.includes('/rpc/acquire_brief_worker')) return json(false);
  if(url.includes('openrouter.ai')) throw new Error('No model call is expected');
  return json(null);
 });
 const result=await pipeline.runScheduledEditorial();
 assert.equal(result.discovered,12);
 assert.equal(eligible.length,8);
 assert.deepEqual(eligible,Array.from({length:8},(_,i)=>`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}`));
});

test('scheduled drafting claims existing and newly queued eligible auto jobs, never manual or new-feed auto jobs',async(t)=>{
 process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-model';
 const oldAuto={id:'22222222-2222-4222-8222-000000000001',story_id:'33333333-3333-4333-8333-000000000001',dedupe_key:'33333333-3333-4333-8333-000000000001:auto'};
 const newAuto={id:'22222222-2222-4222-8222-000000000002',story_id:'33333333-3333-4333-8333-000000000002',dedupe_key:'33333333-3333-4333-8333-000000000002:auto'};
 const manual={id:'22222222-2222-4222-8222-000000000003',story_id:'33333333-3333-4333-8333-000000000003',dedupe_key:'33333333-3333-4333-8333-000000000003:desk:editor-confirmed'};
 const newFeedAuto={id:'22222222-2222-4222-8222-000000000004',story_id:'33333333-3333-4333-8333-000000000004',dedupe_key:'33333333-3333-4333-8333-000000000004:auto'};
 const calls:string[][]=[], enqueued:string[][]=[];
 let queuedReads=0, discovered=false;
 let queue=[oldAuto,newAuto,manual,newFeedAuto];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),body=init?.body?JSON.parse(String(init.body)):{};
  if(url.includes('/brief_publishers') && (!init?.method || init.method==='GET')) return json([publisher]);
  if(url===publisher.feed_url) return new Response('<rss><channel><item><title>New model</title><link>https://openai.com/news/new-model</link><pubDate>2026-10-01T00:00:00Z</pubDate></item></channel></rss>');
  if(url.includes('/brief_sources') && (!init?.method || init.method==='GET')) return json([
   {id:oldAuto.story_id,publisher_id:publisher.id},
   {id:newAuto.story_id,publisher_id:publisher.id},
   {id:newFeedAuto.story_id,publisher_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  ]);
  if(url.includes('/brief_sources')) { const wasDiscovered=discovered; discovered=true; return json(wasDiscovered?[]:[{id:newAuto.story_id}]); }
  if(url.includes('/brief_settings')) return json({auto_draft:true});
  if(url.includes('/rpc/enqueue_brief_auto')) {enqueued.push(body.p_ids);return json([]);}
  if(url.includes('/brief_jobs') && (!init?.method || init.method==='GET')) { queuedReads++; return json(queue); }
  if(url.includes('/rpc/acquire_brief_worker')) return json(true);
  if(url.includes('/rpc/claim_brief_selected_job')) {calls.push(body.p_job_ids);return json([]);}
  if(url.includes('/rpc/release_brief_worker')) return json(null);
  if(url.includes('openrouter.ai')) throw new Error('An unclaimed job cannot incur a model charge');
  return json(null);
 });
 const result=await pipeline.runScheduledEditorial();
 assert.ok('generated' in result);
 assert.equal(result.generated,0);
 assert.ok(queuedReads>0,'The scheduled path must include the pre-existing automatic queue');
 assert.deepEqual(calls,[[oldAuto.id,newAuto.id]],'Neither a manual job nor a new-feed auto job may be in the scheduled claim scope');
 queue=[manual];
 await pipeline.runScheduledEditorial();
 assert.deepEqual(enqueued,[[newAuto.story_id],[]],'The second run has no newly discovered auto work');
 assert.deepEqual(calls,[[oldAuto.id,newAuto.id],[]],'An empty auto queue cannot turn into an unscoped claim');
});

test('new primary feeds only discover AI-relevant metadata and cannot join automatic drafting',async(t)=>{
 const publishers=[
  {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Google DeepMind',feed_url:'https://deepmind.google/blog/rss.xml'},
  {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Google Research',feed_url:'https://research.google/blog/rss/'},
  {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Meta Engineering',feed_url:'https://engineering.fb.com/feed/'},
 ];
 const feeds:Record<string,string>={
  [publishers[0].feed_url]:`<rss><channel><item><title>Gemini model release</title><link>https://deepmind.google/blog/gemini-model/</link><pubDate>2026-10-01T12:00:00Z</pubDate></item></channel></rss>`,
  [publishers[1].feed_url]:`<rss><channel><item><title>Agentic privacy research</title><link>https://research.google/blog/agentic-privacy/</link><pubDate>2026-10-01T12:00:00Z</pubDate><category>Natural Language Processing</category></item><item><title>Logistics routing</title><link>https://research.google/blog/logistics-routing/</link><pubDate>2026-10-01T12:00:00Z</pubDate><category>Algorithms &amp; Theory</category></item></channel></rss>`,
  [publishers[2].feed_url]:`<rss><channel><item><title>Private Processing for Meta AI Glasses</title><link>https://engineering.fb.com/2026/10/01/security/meta-ai-glasses/</link><pubDate>2026-10-01T12:00:00Z</pubDate><category>Security &amp; Privacy</category></item><item><title>Subsea cable expansion</title><link>https://engineering.fb.com/2026/10/01/connectivity/cable/</link><pubDate>2026-10-01T12:00:00Z</pubDate><category>Connectivity</category></item></channel></rss>`,
 };
 const saved:Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('brief_publishers') && (!init?.method || init.method==='GET')) return json(publishers);
  if(url in feeds) return new Response(feeds[url]);
  if(url.includes('brief_sources')) {saved.push(JSON.parse(String(init?.body)));return json([{id:`22222222-2222-4222-8222-${String(saved.length).padStart(12,'0')}`}]);}
  if(url.includes('openrouter') || url.includes('brief_jobs')) throw new Error('Discovery cannot generate');
  return json(null);
 });
 const result=await pipeline.discoverStories();
 assert.deepEqual(result.unavailable,[]);
 assert.equal(result.discovered,3);
 assert.equal(saved.length,3);
 assert.deepEqual(saved.map(s=>s.source_name),publishers.map(p=>p.name));
 assert.deepEqual(saved.map(s=>s.url),['https://deepmind.google/blog/gemini-model/','https://research.google/blog/agentic-privacy/','https://engineering.fb.com/2026/10/01/security/meta-ai-glasses/']);
 assert.deepEqual(result.autoDraftIds,[]);
});

test('AI topic filter reads attributed RSS category text and Atom term or label, excluding unrelated entries',async(t)=>{
 const research={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Google Research',feed_url:'https://research.google/blog/rss/'};
 const engineering={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Meta Engineering',feed_url:'https://engineering.fb.com/feed/'};
 const rss=`<rss><channel>
  <item><title>Quarterly update</title><link>https://research.google/blog/quarterly-update/</link><pubDate>2026-10-01T12:00:00Z</pubDate><category domain="research">Natural Language Processing</category></item>
  <item><title>Transit update</title><link>https://research.google/blog/transit-update/</link><pubDate>2026-10-01T12:00:00Z</pubDate><category domain="AI">Infrastructure</category></item>
 </channel></rss>`;
 const atom=`<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Quarterly report</title><link rel="alternate" href="https://engineering.fb.com/quarterly-report/"/><published>2026-10-01T12:00:00Z</published><category term="Language Models"/></entry>
  <entry><title>Systems update</title><link rel="alternate" href="https://engineering.fb.com/systems-update/"/><published>2026-10-01T12:00:00Z</published><category term="Research" label="Machine Learning"/></entry>
  <entry><title>Transit notes</title><link rel="alternate" href="https://engineering.fb.com/transit-notes/"/><published>2026-10-01T12:00:00Z</published><category term="Networking" label="Infrastructure"/></entry>
 </feed>`;
 const saved:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('/brief_publishers') && (!init?.method || init.method==='GET')) return json([research,engineering]);
  if(url===research.feed_url) return new Response(rss);
  if(url===engineering.feed_url) return new Response(atom);
  if(url.includes('/brief_sources')) {saved.push(JSON.parse(String(init?.body)).url);return json([{id:`22222222-2222-4222-8222-${String(saved.length).padStart(12,'0')}`}]);}
  return json(null);
 });
 const result=await pipeline.discoverStories();
 assert.deepEqual(result.unavailable,[]);
 assert.equal(result.discovered,3);
 assert.deepEqual(saved,[
  'https://research.google/blog/quarterly-update/',
  'https://engineering.fb.com/quarterly-report/',
  'https://engineering.fb.com/systems-update/',
 ]);
});
