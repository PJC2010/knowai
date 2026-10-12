import test from 'node:test';
import assert from 'node:assert/strict';
import * as source from '../src/lib/editorial/source';
import { normalizeSourceUrl } from '../src/lib/brief';
import { discoverAnthropic } from '../src/lib/editorial/connectors/anthropic';

import { normalizePublisherUrl, publisherByKey } from '../src/lib/editorial/publisher-catalog';

test('bounded fetch validates its initial URL and every hop through the supplied policy', async(t) => {
 const publisher=publisherByKey('mistral')!;
 const validateUrl=(url:string)=>normalizePublisherUrl(url,publisher,'article');
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
  requests.push(String(input));
  return new Response(null,{status:302,headers:{location:'https://openai.com/news/other'}});
 });
 await assert.rejects(source.boundedFetch('https://evil.example/story',{},1000,3,{validateUrl}),/configured publishers/);
 assert.deepEqual(requests,[]);
 await assert.rejects(source.boundedFetch('https://mistral.ai/news/story?utm_source=feed',{},1000,3,{validateUrl}),/configured publishers/);
 assert.deepEqual(requests,['https://mistral.ai/news/story']);
});

test('all ten additions resolve explicit import attribution from the catalog', async(t) => {
 t.mock.method(globalThis,'fetch',async()=>new Response('<html><head><meta property="og:title" content="A source announcement"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head></html>'));
 const urls:Record<string,string>={
  'microsoft-research':'https://www.microsoft.com/en-us/research/blog/model/',nvidia:'https://blogs.nvidia.com/blog/model/',
  'aws-ml':'https://aws.amazon.com/blogs/machine-learning/model/',mistral:'https://mistral.ai/news/model',
  bair:'http://bair.berkeley.edu/blog/2026/10/01/research/','ars-technica':'https://arstechnica.com/ai/2026/10/model/',
  'the-verge':'https://www.theverge.com/ai-artificial-intelligence/123/model','mit-tech-review':'https://www.technologyreview.com/2026/10/01/123/model/',
  'the-decoder':'https://the-decoder.com/model/',anthropic:'https://www.anthropic.com/news/model',
 };
 for (const [key,url] of Object.entries(urls)) {
  const result=await source.retrieveImportMetadata(url);
  assert.equal(result.source_name,publisherByKey(key)!.name,key);
  assert.equal(result.source_published_at,'2026-10-01T12:30:00.000Z');
  assert.equal(result.url,url.replace(/^http:/,'https:'));
 }
});

test('source retrieval never follows cross-publisher or cross-purpose redirects', async(t) => {
 const html='<html><head><meta property="og:title" content="Title"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head><article><p>'+ 'Substantial original text about the model and research. '.repeat(60)+'</p></article></html>';
 for (const retrieve of [source.retrieveImportMetadata,source.retrieveSourceArticle,source.retrieveSourceImage]) {
  for (const destination of ['https://openai.com/news/other','https://mistral.ai/news/rss']) {
   const requests:string[]=[];
   t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
    const url=String(input);requests.push(url);
    return url==='https://mistral.ai/news/story' ? new Response(null,{status:302,headers:{location:destination}}) : new Response(html);
   });
   await assert.rejects(retrieve('https://mistral.ai/news/story'),/configured publishers/);
   assert.deepEqual(requests,['https://mistral.ai/news/story']);
  }
  let fetched=0;
  t.mock.method(globalThis,'fetch',async()=>{fetched++;return new Response(html);});
  await assert.rejects(retrieve('https://www.anthropic.com/news'),/configured publishers/);
  assert.equal(fetched,0);
 }
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{requests.push(String(input));return new Response(null,{status:302,headers:{location:'https://openai.com/news/rss.xml'}});});
 await assert.rejects(source.boundedFetch('https://evil.example/feed',{},1000,3),/configured publishers/);
 assert.deepEqual(requests,[]);
 await assert.rejects(source.boundedFetch('https://mistral.ai/news/rss',{},1000,3),/configured publishers/);
 assert.deepEqual(requests,['https://mistral.ai/news/rss']);
});

test('redirects share one deadline while provider POST calls retain their unrestricted API', async(t) => {
 let deadlines=0;
 const controller=new AbortController();
 t.mock.method(AbortSignal,'timeout',()=>{deadlines++;return controller.signal;});
 const signals:(AbortSignal|null|undefined)[]=[];
 t.mock.method(globalThis,'fetch',async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  signals.push(init?.signal);
  return signals.length===1 ? new Response(null,{status:302,headers:{location:'/news/canonical'}}) : new Response('ok');
 });
 assert.equal(await source.boundedFetch('https://mistral.ai/news/original',{},1000,3),'ok');
 assert.equal(deadlines,1);
 assert.deepEqual(signals,[controller.signal,controller.signal]);
 const providerSignal=new AbortController().signal;
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  assert.equal(String(input),'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init?.method,'POST');assert.equal(init?.body,'{"fixture":true}');
  assert.equal(init?.signal,providerSignal);assert.equal(init?.redirect,'manual');
  return new Response('{"ok":true}');
 });
 assert.equal(await source.boundedFetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:'{"fixture":true}',signal:providerSignal},1000),'{"ok":true}');
 assert.equal(deadlines,1);
});

test('source calls compose caller cancellation with one bounded deadline through body reads', async(t) => {
 const caller=new AbortController();const deadline=new AbortController();let deadlines=0;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,15000);deadlines++;return deadline.signal;});
 const signals:(AbortSignal|null|undefined)[]=[];
 t.mock.method(globalThis,'fetch',async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  signals.push(init?.signal);
  if(signals.length===1)return new Response(null,{status:302,headers:{location:'/news/canonical'}});
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('partial'));deadline.abort(new Error('source deadline'));controller.close();}}));
 });
 const validateUrl=(url:string)=>normalizePublisherUrl(url,publisherByKey('mistral')!,'article');
 await assert.rejects(source.boundedFetch('https://mistral.ai/news/original',{signal:caller.signal},1000,3,{validateUrl}),/source deadline/);
 assert.equal(deadlines,1);
 assert.equal(signals.length,2);
 assert.equal(signals[0],signals[1]);
 assert.notEqual(signals[0],caller.signal);
 assert.equal(caller.signal.aborted,false);
 caller.abort(new Error('caller cancelled'));
 await assert.rejects(source.boundedFetch('https://mistral.ai/news/original',{signal:caller.signal},1000,3,{validateUrl}),/caller cancelled/);
 assert.equal(signals.length,2);
});

test('body deadlines cancel a stalled stream without waiting on cleanup', async(t) => {
 const deadline=new AbortController();let cancelled=0;let streamController:ReadableStreamDefaultController<Uint8Array>;
 t.mock.method(AbortSignal,'timeout',()=>deadline.signal);
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream<Uint8Array>({start(controller){streamController=controller;},cancel(){cancelled++;return new Promise<void>(()=>{});}})));
 const result=source.boundedFetch('https://mistral.ai/news/story',{},1000,3).then(()=> 'unexpected success',error=>error.message);
 await new Promise<void>(resolve=>setImmediate(resolve));
 deadline.abort(new Error('body deadline'));
 const observed=await Promise.race([result,new Promise<string>(resolve=>setImmediate(()=>resolve('not cancelled')))]);
 if(!cancelled)streamController!.close();
 assert.equal(observed,'body deadline');assert.equal(cancelled,1);
});

test('HTTP failures expose status and Retry-After without bodies or automatic retries', async(t) => {
 for (const [status,retryAfter] of [[429,'120'],[429,'Mon, 12 Oct 2026 12:30:00 GMT'],[403,null],[503,null]] as const) {
  let requests=0,cancelled=0;
  t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('private response detail'));},cancel(){cancelled++;}}),{status,headers:retryAfter ? {'Retry-After':retryAfter}: {}});});
  await assert.rejects(source.boundedFetch('https://mistral.ai/news/story',{},1000,3),(error:unknown)=>{
   assert.ok(error instanceof Error);
   const failure=error as Error & {status:number;retryAfter:string|null};
   assert.equal(failure.status,status);assert.equal(failure.retryAfter,retryAfter);
   assert.equal(String(error).includes('private response detail'),false);
   assert.equal('body' in error,false);return true;
  });
  assert.equal(requests,1);assert.equal(cancelled,1);
 }
});

test('imports reject impossible, guessed, timezone-free and future original publication dates', async(t) => {
 t.mock.method(Date,'now',()=>Date.parse('2026-10-12T12:00:00Z'));
 for (const date of ['2026-02-30T12:30:00Z','1','2026-10-01T12:30:00','2026-10-12T12:00:00.001Z']) {
  t.mock.method(globalThis,'fetch',async()=>new Response(`<html><head><title>Model</title><meta property="article:published_time" content="${date}"></head></html>`));
  await assert.rejects(source.retrieveImportMetadata('https://mistral.ai/news/story'),/publication date/i,date);
 }
});

test('imports use the validated final canonical identity and reject off-publisher canonicals', async(t) => {
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
  const url=String(input);requests.push(url);
  return url==='https://mistral.ai/news/alias' ? new Response(null,{status:302,headers:{location:'/news/redirected'}}) : new Response('<html><head><title>Model</title><link rel="canonical" href="/news/canonical?utm_source=page"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head></html>');
 });
 const result=await source.retrieveImportMetadata('https://mistral.ai/news/alias');
 assert.equal(result.url,'https://mistral.ai/news/canonical');
 assert.deepEqual(requests,['https://mistral.ai/news/alias','https://mistral.ai/news/redirected']);
 for (const canonical of ['https://openai.com/news/other','https://mistral.ai/news/rss','https://mistral.ai.evil.test/news/story']) {
  t.mock.method(globalThis,'fetch',async()=>new Response(`<html><head><title>Model</title><link rel="canonical" href="${canonical}"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head></html>`));
  await assert.rejects(source.retrieveImportMetadata('https://mistral.ai/news/story'),/configured publishers/);
 }
});

const identityUrl = 'https://www.anthropic.com/news/first';
const identityPage = (metadata: string) => `<html><head><meta property="og:title" content="Model"><meta property="article:published_time" content="2026-10-01T12:30:00Z">${metadata}</head></html>`;
const identityListing = '<main><h1>Newsroom</h1><div class="PublicationList-module-scss-module__fixture__root"><ul class="PublicationList-module-scss-module__fixture__list"><li><a class="PublicationList-module-scss-module__fixture__listItem" href="/news/first">Model</a></li></ul></div></main>';

for (const [name, metadata] of [
 ['conflicting canonicals', '<link rel="canonical" href="/news/first"><link rel="canonical" href="/news/second">'],
 ['reversed conflicting canonicals', '<link rel="canonical" href="/news/second"><link rel="canonical" href="/news/first">'],
 ['tokenized conflicting canonical', '<link rel="canonical" href="/news/first"><link rel="alternate canonical" href="/news/second">'],
 ['canonical versus og:url', '<link rel="canonical" href="/news/first"><meta property="og:url" content="/news/second">'],
 ['conflicting repeated og:url', '<meta property="og:url" content="/news/first"><meta property="og:url" content="/news/second">'],
 ['og:url versus requested URL', '<meta property="og:url" content="/news/second">'],
 ['missing canonical href', '<link rel="canonical">'],
 ['empty canonical href', '<link rel="canonical" href="">'],
 ['blank canonical href', '<link rel="canonical" href="   ">'],
 ['missing og:url content', '<meta property="og:url">'],
 ['empty og:url content', '<meta property="og:url" content="">'],
 ['blank og:url content', '<meta property="og:url" content="   ">'],
] as const) {
 test(`page identity parity rejects ${name}`, async t => {
  const now = () => Date.parse('2026-10-12T12:00:00Z');
  t.mock.method(Date, 'now', now);
  const page = identityPage(metadata);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
   requests.push(String(input));
   assert.equal(String(input), identityUrl);
   return new Response(page);
  });
  const discovered = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
   fetchText: async url => {
    assert.ok(url === 'https://www.anthropic.com/news' || url === identityUrl);
    return url === identityUrl ? page : identityListing;
   },
  });
  assert.deepEqual(discovered.candidates, [], 'Discovery must reject this exact shared page');
  assert.equal(discovered.invalid, 1);
  await assert.rejects(source.retrieveImportMetadata(identityUrl), /canonical|metadata|identit|URL/i,
   'Direct import must reject the same page identity as discovery');
  assert.deepEqual(requests, [identityUrl]);
 });
}

test('page identity parity accepts normalized equivalent declarations', async t => {
 const now = () => Date.parse('2026-10-12T12:00:00Z');
 t.mock.method(Date, 'now', now);
 const page = identityPage('<link rel="canonical" href="/news/canonical?utm_source=fixture#top">'
  + '<link rel="alternate canonical" href="https://www.anthropic.com/news/canonical/">'
  + '<meta property="og:url" content="/news/canonical/?utm_medium=fixture#article">'
  + '<meta property="og:url" content="https://www.anthropic.com/news/canonical">');
 t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
  assert.equal(String(input), identityUrl);
  return new Response(page);
 });
 const discovered = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
  fetchText: async url => {
   assert.ok(url === 'https://www.anthropic.com/news' || url === identityUrl);
   return url === identityUrl ? page : identityListing;
  },
 });
 const imported = await source.retrieveImportMetadata(identityUrl);
 assert.equal(discovered.invalid, 0);
 assert.equal(discovered.outcome, 'ok');
 assert.deepEqual(discovered.candidates, [imported]);
 assert.equal(imported.url, 'https://www.anthropic.com/news/canonical');
 assert.equal(imported.source_published_at, '2026-10-01T12:30:00.000Z');
});

test('page identity parity retains JSON-LD protections after canonical selection', async t => {
 const now = () => Date.parse('2026-10-12T12:00:00Z');
 t.mock.method(Date, 'now', now);
 const canonical = 'https://www.anthropic.com/news/canonical';
 for (const [name, extra, valid] of [
  ['equivalent binding and date', {mainEntityOfPage: {'@id': `${canonical}/?utm_source=fixture#article`}, datePublished: '2026-10-01T08:30:00-04:00'}, true],
  ['conflicting binding', {mainEntityOfPage: identityUrl, datePublished: '2026-10-01T12:30:00Z'}, false],
  ['conflicting date', {mainEntityOfPage: canonical, datePublished: '2026-10-02T12:30:00Z'}, false],
 ] as const) {
  const node = {'@type': 'NewsArticle', url: canonical, ...extra};
  const page = identityPage(`<link rel="canonical" href="${canonical}"><link rel="canonical" href="/news/canonical/?utm_source=fixture">`
   + `<meta property="og:url" content="${canonical}#article"><script type="application/ld+json">${JSON.stringify(node)}</script>`);
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
   assert.equal(String(input), identityUrl);
   return new Response(page);
  });
  const discovered = await discoverAnthropic({knownUrls: new Set(), signal: new AbortController().signal, now,
   fetchText: async url => {
    assert.ok(url === 'https://www.anthropic.com/news' || url === identityUrl);
    return url === identityUrl ? page : identityListing;
   },
  });
  if (valid) {
   const imported = await source.retrieveImportMetadata(identityUrl);
   assert.deepEqual(discovered.candidates, [imported], name);
   assert.equal(imported.url, canonical);
   assert.equal(imported.source_published_at, '2026-10-01T12:30:00.000Z');
  } else {
   assert.deepEqual(discovered.candidates, [], name);
   assert.equal(discovered.invalid, 1);
   await assert.rejects(source.retrieveImportMetadata(identityUrl), /publication/i, name);
  }
 }
});

test('import dates are article-bound and conflicting publication instants are rejected', async(t) => {
 for (const url of ['https://mistral.ai/news/story','https://www.anthropic.com/news/story']) {
  const page=(node:unknown,meta='')=>`<html><head><title>Model</title>${meta}<script type="application/ld+json">${JSON.stringify(node)}</script></head></html>`;
  const meta='<meta property="article:published_time" content="2026-10-01T12:30:00Z">';
  for (const [node,extra] of [
   [{'@type':'NewsArticle',url:'https://unrelated.example/story',datePublished:'2026-10-01T12:30:00Z'},''],
   [{'@type':'NewsArticle',datePublished:'2026-10-01T12:30:00Z'},''],
   [{'@type':'NewsArticle',url,datePublished:'2026-10-02T12:30:00Z'},meta],
   [{'@type':'NewsArticle',url,datePublished:'not a date'},meta],
   [{'@type':'NewsArticle',url,dateModified:'2026-10-01T12:30:00Z'},''],
  ] as const) {
   t.mock.method(globalThis,'fetch',async()=>new Response(page(node,extra)));
   await assert.rejects(source.retrieveImportMetadata(url),/publication date/i);
  }
  const graph={'@graph':[{'@type':'Article',url:'https://unrelated.example/story',datePublished:'2026-10-02T00:00:00Z'},{'@type':['Thing','NewsArticle'],mainEntityOfPage:{'@id':url},datePublished:'2026-10-01T14:30:00+02:00'}]};
  t.mock.method(globalThis,'fetch',async()=>new Response(page(graph,meta)));
  assert.equal((await source.retrieveImportMetadata(url)).source_published_at,'2026-10-01T12:30:00.000Z');
 }
});

for (const url of ['https://mistral.ai/news/story', 'https://www.anthropic.com/news/story']) {
 for (const matchingField of ['url', 'mainEntityOfPage'] as const) {
  for (const fields of [['url', 'mainEntityOfPage'], ['mainEntityOfPage', 'url']]) {
   test(`import JSON-LD identities reject conflicts for ${url} matching ${matchingField}, ${fields[0]} first`, async t => {
    t.mock.method(Date, 'now', () => Date.parse('2026-10-12T12:00:00Z'));
    const values: Record<string, string> = {url: `${url}-other`, mainEntityOfPage: `${url}-other`, [matchingField]: url};
    const node = {'@type': 'NewsArticle', ...Object.fromEntries(fields.map(key => [key, values[key]])), datePublished: '2026-10-01T12:30:00Z'};
    for (const meta of ['', '<meta property="article:published_time" content="2026-10-01T12:30:00Z">']) {
     t.mock.method(globalThis, 'fetch', async () => new Response(`<html><head><title>Model</title>${meta}<script type="application/ld+json">${JSON.stringify(node)}</script></head></html>`));
     await assert.rejects(source.retrieveImportMetadata(url), /publication|metadata|identit/i, 'A matching identity must not excuse another conflicting provided identity');
    }
   });
  }
 }
}

test('import JSON-LD identities reject provided invalid bindings despite a valid page date', async t => {
 t.mock.method(Date, 'now', () => Date.parse('2026-10-12T12:00:00Z'));
 for (const url of ['https://mistral.ai/news/story', 'https://www.anthropic.com/news/story']) {
  for (const conflict of [null, '', '   ', {}, {'@id': `${url}-other`}, 'https://unrelated.example/story']) {
   for (const identities of [{url, mainEntityOfPage: conflict}, {url: conflict, mainEntityOfPage: {'@id': url}}]) {
    // Even a dateless conflicting node must not be ignored in favor of convenient page metadata.
    for (const date of [{}, {datePublished: '2026-10-01T12:30:00Z'}]) {
     const node = {'@type': 'NewsArticle', ...identities, ...date};
     const page = `<html><head><title>Model</title><meta property="article:published_time" content="2026-10-01T12:30:00Z"><script type="application/ld+json">${JSON.stringify({'@graph': [node]})}</script></head></html>`;
     t.mock.method(globalThis, 'fetch', async () => new Response(page));
     await assert.rejects(source.retrieveImportMetadata(url), /publication|metadata|identit/i, JSON.stringify({url, identities, date}));
    }
   }
  }
 }
});

test('import JSON-LD identities accept valid and equivalent article bindings', async t => {
 t.mock.method(Date, 'now', () => Date.parse('2026-10-12T12:00:00Z'));
 for (const url of ['https://mistral.ai/news/story', 'https://www.anthropic.com/news/story']) {
  for (const identities of [
   {url}, {mainEntityOfPage: url}, {mainEntityOfPage: {'@id': url}}, {url, mainEntityOfPage: url},
   {url: `${url}?utm_source=fixture#top`, mainEntityOfPage: {'@id': `${new URL(url).pathname}?utm_medium=fixture#article`}},
  ]) {
   const node = {'@type': 'NewsArticle', ...identities, datePublished: '2026-10-01T12:30:00Z'};
   t.mock.method(globalThis, 'fetch', async () => new Response(`<html><head><title>Model</title><script type="application/ld+json">${JSON.stringify(node)}</script></head></html>`));
   const result = await source.retrieveImportMetadata(url);
   assert.equal(result.url, url);
   assert.equal(result.source_published_at, '2026-10-01T12:30:00.000Z');
  }
 }
});

test('invalid fetch budgets fail before network and oversized bodies are cancelled', async(t) => {
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('ok');});
 for (const [maxBytes,redirects] of [[NaN,3],[Infinity,3],[0,3],[1000,-1],[1000,1.5],[1000,Infinity],[1000,4]]) {
  await assert.rejects(source.boundedFetch('https://mistral.ai/news/story',{},maxBytes,redirects),/limit|budget/i);
 }
 assert.equal(requests,0);
 for (const headers of [{'content-length':'1001'},{'content-length':'1','content-encoding':'gzip'}] as HeadersInit[]) {
  let cancelled=0;
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('🌱'.repeat(251)));},cancel(){cancelled++;}}),{headers}));
  await assert.rejects(source.boundedFetch('https://mistral.ai/news/story',{},1000,3),/size limit/);
  assert.equal(cancelled,1);
 }
});

test('redirect cleanup cannot pin the deadline and redirect count stays capped', async(t) => {
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{
  requests++;
  return new Response(new ReadableStream({cancel(){return new Promise<void>(()=>{});}}),{status:302,headers:{location:'/news/redirect'}});
 });
 const request=source.boundedFetch('https://mistral.ai/news/story',{},1000,3).then(()=> 'unexpected success',error=>error.message);
 const result=await Promise.race([request,new Promise<string>(resolve=>setImmediate(()=>resolve('cleanup stalled')))]);
 assert.match(result,/Redirect requires source verification/);
 assert.equal(requests,4);
});

test('Anthropic imports cannot use unbound page microdata as an original date', async(t) => {
 t.mock.method(globalThis,'fetch',async()=>new Response('<html><head><title>Article</title><meta itemprop="datePublished" content="2026-10-01T12:30:00Z"></head></html>'));
 await assert.rejects(source.retrieveImportMetadata('https://www.anthropic.com/news/story'),/publication date/i);
});

test('manual import preserves original publication metadata and refuses unknown dates or unapproved hosts',async(t)=>{
 assert.equal(typeof source.retrieveImportMetadata,'function');
 let fetched=0;
 t.mock.method(globalThis,'fetch',async()=>{fetched++;return new Response('<html><head><meta property="og:title" content="New model &amp; tools"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head></html>');});
 const result=await source.retrieveImportMetadata('https://openai.com/news/model?utm_source=test');
 assert.equal(result.url,'https://openai.com/news/model');
 assert.equal(result.title,'New model & tools');
 assert.equal(result.source_published_at,'2026-10-01T12:30:00.000Z');
 assert.equal(result.source_name,'OpenAI');
 await assert.rejects(source.retrieveImportMetadata('https://127.0.0.1/private'),/configured publishers/);
 assert.equal(fetched,1);
 t.mock.method(globalThis,'fetch',async()=>new Response('<html><head><title>Title</title><meta property="article:modified_time" content="2026-10-01"></head></html>'));
 await assert.rejects(source.retrieveImportMetadata('https://openai.com/news/undated'),/publication date/i);
});

test('new primary hosts allow original URLs but reject impostors and unknown redirects',async(t)=>{
 for (const url of ['https://deepmind.google/blog/gemini-model/','https://research.google/blog/agentic-privacy/','https://engineering.fb.com/2026/10/01/ai/post/']) assert.equal(normalizeSourceUrl(url),url);
 for (const url of ['https://deepmind.google.evil.example/blog/','https://research.google@evil.example/blog/','http://engineering.fb.com/feed/','https://arxiv.org/abs/1234.5678']) assert.throws(()=>normalizeSourceUrl(url),/configured publishers/);
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://evil.example/private'}});});
 await assert.rejects(source.boundedFetch('https://deepmind.google/blog/rss.xml',{},10000,3),/configured publishers/);
 assert.equal(requests,1);
});

test('manual import preserves publisher, original date, title, and normalized URL for all seven hosts',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('<html><head><meta property="og:title" content="AI research"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head></html>'));
 for (const [host,name] of [['openai.com','OpenAI'],['blog.google','Google'],['huggingface.co','Hugging Face'],['techcrunch.com','TechCrunch'],['deepmind.google','Google DeepMind'],['research.google','Google Research'],['engineering.fb.com','Meta Engineering']]) {
  const result=await source.retrieveImportMetadata(`https://${host}/blog/ai-story/?article=42&utm_source=feed#section`);
  assert.equal(result.source_name,name);
  assert.equal(result.url,`https://${host}/blog/ai-story/?article=42`);
  assert.equal(result.title,'AI research');
  assert.equal(result.source_published_at,'2026-10-01T12:30:00.000Z');
 }
});

test('new publisher imports validate every redirect hop before fetching it',async(t)=>{
 for (const host of ['deepmind.google','research.google','engineering.fb.com']) {
  const first=`https://${host}/story`;
  const next=`https://${host}/canonical?article=42`;
  const requests:string[]=[];
  t.mock.method(globalThis,'fetch',async(input: Parameters<typeof globalThis.fetch>[0])=>{
   const url=String(input);requests.push(url);
   if(url===first)return new Response(null,{status:302,headers:{location:'/canonical?article=42&utm_source=redirect#section'}});
   if(url===next)return new Response(null,{status:302,headers:{location:`https://${host}.evil.example/private`}});
   throw new Error('An unapproved URL reached fetch');
  });
  await assert.rejects(source.retrieveImportMetadata(first),/configured publishers/);
  assert.deepEqual(requests,[first,next]);
  t.mock.restoreAll();
 }
});
