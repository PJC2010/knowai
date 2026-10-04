import test from 'node:test';
import assert from 'node:assert/strict';
import * as source from '../src/lib/editorial/source';

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
