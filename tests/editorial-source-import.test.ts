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
  t.mock.method(globalThis,'fetch',async(input)=>{
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
