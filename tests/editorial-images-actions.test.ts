import './editorial-server-hook';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const { executeDeskMutation, executeDeskImageUpload } = await import('../src/lib/editorial/desk');
const { uploadDeskImage } = await import('../src/app/editor/desk-actions');
const id='11111111-1111-4111-8111-111111111111';
const session={db:createClient('http://127.0.0.1:59999','fixture-session',{auth:{persistSession:false}}),user:{id}};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const active={id,story_id:id,state:'needs_review',version:2,image_source:'source',image_url:null,image_alt:null,brief_sources:{url:'https://openai.com/news/article'}};
const form=()=>{const f=new FormData();f.set('id',id);f.set('version','2');f.set('imageAlt','Article image');f.set('image',new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])],'image.png',{type:'image/png'}));return f;};
function config(){process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:59999';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public';process.env.SUPABASE_SECRET_KEY='fixture-service';}

test('image and feature actions validate input and use session RPCs without model calls',async(t)=>{
 const calls:{name:string;body:Record<string,unknown>;key:string|null}[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const name=String(input).split('/').pop()!;calls.push({name,body:JSON.parse(String(init?.body)),key:new Headers(init?.headers).get('apikey')});
  return json(name==='set_brief_feature'?{slug:'story',featuredWeek:'2026-10-05'}:{version:3,imageUrl:null,imageAlt:null,imageSource:'none'});
 });
 assert.equal((await executeDeskMutation({intent:'feature',id,week:'2026-10-04'},session)).ok,false);
 assert.equal((await executeDeskMutation({intent:'image',id,version:2,imageSource:'none',imageAlt:'x'.repeat(501)},session)).ok,false);
 assert.equal(calls.length,0);
 assert.equal((await executeDeskMutation({intent:'image',id,version:2,imageSource:'none',imageAlt:''},session)).version,3);
 assert.equal((await executeDeskMutation({intent:'feature',id,week:'2026-10-05'},session)).featuredWeek,'2026-10-05');
 assert.deepEqual(calls.map(c=>[c.name,c.key]),[['set_brief_revision_image','fixture-session'],['set_brief_feature','fixture-session']]);
 await executeDeskMutation({intent:'image',id,version:2,imageSource:'source',imageUrl:'https://cdn.example.com/selected.jpg',imageAlt:'Preview'},session);
 assert.equal(calls.at(-1)?.body.p_url,'https://cdn.example.com/selected.jpg');
});

test('refresh captures source image for an existing draft and preserves uploaded override',async(t)=>{
 config();let state={...active};const calls:{url:string;body:Record<string,unknown>}[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),body=init?.body?JSON.parse(String(init.body)):{};calls.push({url,body});
  if(url.endsWith('load_brief_desk')) return json({active:state});
  if(url==='https://openai.com/news/article')return new Response('<meta property="og:image" content="https://cdn.example.com/hero.png">');
  if(url.includes('/brief_sources'))return json(null);
  if(url.endsWith('set_brief_revision_image'))return json({version:3,imageUrl:state.image_source==='upload'?'https://project.supabase.co/upload.png':'https://cdn.example.com/hero.png',imageSource:state.image_source,sourceImageUrl:'https://cdn.example.com/hero.png'});
  throw new Error(url);
 });
 assert.equal((await executeDeskMutation({intent:'refresh-image',id,version:2},session)).imageUrl,'https://cdn.example.com/hero.png');
 assert.equal(calls.find(c=>c.url.endsWith('set_brief_revision_image'))?.body.p_url,'https://cdn.example.com/hero.png');
 state={...active,image_source:'upload'};calls.length=0;
 assert.equal((await executeDeskMutation({intent:'refresh-image',id,version:2},session)).imageSource,'upload');
 assert.equal(calls.find(c=>c.url.endsWith('set_brief_revision_image'))?.body.p_url,null);
 assert.equal(calls.some(c=>c.url.includes('openrouter')),false);
});

test('upload authorizes revision before storage, registers server URL, and cleans up stale attachments',async(t)=>{
 config();const calls:{url:string;method:string;body:unknown;key:string|null}[]=[];let conflict=false,uncertain=false;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method||'GET',raw=init?.body;let body:unknown=raw;
  if(typeof raw==='string')try{body=JSON.parse(raw);}catch{/* binary response not JSON */}
  calls.push({url,method,body,key:new Headers(init?.headers).get('apikey')});
  if(url.endsWith('load_brief_desk'))return json({active});
  if(url.includes('/storage/v1/object/brief-images')&&method==='POST')return json({Key:'brief-images/image.png'});
  if(url.includes('/brief_image_uploads'))return json(null);
  if(url.includes('/storage/v1/object/brief-images')&&method==='DELETE')return json([]);
  if(url.endsWith('set_brief_revision_image'))return uncertain?json({message:'The response could not be read'},400):conflict?json({code:'P0001',message:'Draft changed or is no longer editable'},400):json({version:3,imageSource:'upload',imageUrl:(body as {p_url:string}).p_url,imageAlt:'Article image'});
  throw new Error(url);
 });
 const result=await executeDeskImageUpload(form(),session);
 assert.equal(result.ok,true);assert.equal(result.version,3);assert.equal(result.imageSource,'upload');
 assert.match(result.imageUrl!,new RegExp(`/storage/v1/object/public/brief-images/${id}/${id}/[\\w-]+\\.png$`));
 assert.equal(calls[0].url.endsWith('load_brief_desk'),true);
 assert.ok(calls.filter(c=>c.url.includes('/storage/')||c.url.includes('/brief_image_uploads')).every(c=>c.key==='fixture-service'));
 assert.equal(calls.find(c=>c.url.endsWith('set_brief_revision_image'))?.key,'fixture-session');
 calls.length=0;conflict=true;
 const stale=await executeDeskImageUpload(form(),session);assert.equal(stale.code,'conflict');
 assert.ok(calls.some(c=>c.url.includes('/brief_image_uploads')&&c.method==='DELETE'));
 assert.ok(calls.some(c=>c.url.includes('/storage/v1/object/brief-images')&&c.method==='DELETE'));
 calls.length=0;uncertain=true;
 assert.equal((await executeDeskImageUpload(form(),session)).ok,false);
 assert.equal(calls.some(c=>c.method==='DELETE'),false,'An ambiguous attachment response must not delete an image that could have committed');
});

test('upload rejects unauthenticated action and invalid bytes before uploading',async(t)=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('No network expected');});
 assert.equal((await uploadDeskImage(form())).ok,false);
 const invalid=form();invalid.set('image',new File(['<svg/>'],'fake.png',{type:'image/png'}));
 assert.equal((await executeDeskImageUpload(invalid,session)).ok,false);assert.equal(requests,0);
});
