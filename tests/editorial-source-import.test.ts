import test from 'node:test';
import assert from 'node:assert/strict';
import * as source from '../src/lib/editorial/source';
import { normalizeSourceUrl } from '../src/lib/brief';

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

test('manual import maps newly approved primary hosts to their registered publishers',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('<html><head><meta property="og:title" content="AI research"><meta property="article:published_time" content="2026-10-01T12:30:00Z"></head></html>'));
 for (const [host,name] of [['deepmind.google','Google DeepMind'],['research.google','Google Research'],['engineering.fb.com','Meta Engineering']]) {
  const result=await source.retrieveImportMetadata(`https://${host}/blog/ai-story/`);
  assert.equal(result.source_name,name);
 }
});
