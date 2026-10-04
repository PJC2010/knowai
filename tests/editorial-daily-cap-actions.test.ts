import './editorial-server-hook';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { registerHooks } from 'node:module';
import type { DeskMutation } from '../src/lib/editorial/desk-types';
const globals = globalThis as typeof globalThis & { dailyCapTestCookies:{name:string;value:string}[] };
globals.dailyCapTestCookies=[];
registerHooks({ resolve(specifier,context,next) {
  if(specifier==='next/headers') return {url:'data:text/javascript,export async function cookies(){return {getAll:()=>globalThis.dailyCapTestCookies,set:()=>{}}}',shortCircuit:true};
  return next(specifier,context);
} });
const { executeDeskMutation, loadDesk } = await import('../src/lib/editorial/desk');
const id = '11111111-1111-4111-8111-111111111111';
const session = { db: createClient('http://127.0.0.1:59999','fixture-session',{auth:{persistSession:false}}), user:{id} };
const json = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
type Call = { name:string; body:Record<string,unknown>; key:string|null };
function fixture(t:TestContext) {
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:59999';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public';
  process.env.SUPABASE_SECRET_KEY='fixture-service';
  delete process.env.EDITORIAL_OPENROUTER_API_KEY;
  const f = { calls:[] as Call[], snapshot:{attemptsToday:10,dailyAttemptLimit:25} as unknown, respond:undefined as ((call:Call)=>Response|undefined)|undefined };
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    assert.equal(url.origin,'http://127.0.0.1:59999','No provider or other external requests');
    const call={name:url.pathname.split('/').pop()!,body:init?.body?JSON.parse(String(init.body)):{},key:new Headers(init?.headers).get('apikey')};
    f.calls.push(call);
    const custom=f.respond?.(call); if(custom) return custom;
    if(call.name==='set_brief_daily_attempt_limit') return json(null);
    if(call.name==='load_brief_desk') return json(f.snapshot);
    assert.fail(`Unexpected request ${call.name}`);
  });
  return f;
}

test('daily cap rejects invalid integers and non-boolean consent before any RPC',async t=>{
  const f=fixture(t);
  for(const limit of [null,undefined,0,-1,1001,1.5,NaN,Infinity,'25']) {
    const result=await executeDeskMutation({intent:'daily-cap',limit,confirmCharge:true} as DeskMutation,session);
    assert.equal(result.ok,false);
    assert.match(result.message,/integer between 1 and 1000/);
  }
  for(const confirmCharge of [null,undefined,'true',1]) {
    const result=await executeDeskMutation({intent:'daily-cap',limit:25,confirmCharge} as unknown as DeskMutation,session);
    assert.equal(result.ok,false);
  }
  assert.deepEqual(f.calls,[]);
});

test('daily cap mutation uses only the authenticated editor RPC and returns authoritative cap and usage without a model key',async t=>{
  const f=fixture(t);
  const result=await executeDeskMutation({intent:'daily-cap',limit:25,confirmCharge:true},session);
  assert.equal(result.ok,true,result.message);
  assert.equal(result.dailyAttemptLimit,25);
  assert.equal(result.attemptsToday,10);
  assert.deepEqual(f.calls,[
    {name:'set_brief_daily_attempt_limit',body:{p_limit:25,p_confirm_charge:true},key:'fixture-session'},
    {name:'load_brief_desk',body:{p_query:{view:'sources'}},key:'fixture-session'},
  ]);
});

test('paid action results carry the authoritative cap alongside usage on success and failure, never a guessed cap',async t=>{
  const f=fixture(t);
  process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-only';
  f.respond=c=>['enqueue_brief_selection','authorize_brief_selected_queue'].includes(c.name)?json([]):undefined;
  const inputs:DeskMutation[]=[
    {intent:'generate',ids:[id],confirmCharge:true},
    {intent:'regenerate',id,confirmCharge:true},
    {intent:'run-queued',confirmCharge:true},
    {intent:'suggest',id,version:1,field:'oneLiner',instruction:'simplify',confirmCharge:false},
  ];
  for(const input of inputs) {
    const result=await executeDeskMutation(input,session);
    assert.equal(result.ok,input.intent!=='suggest');
    assert.equal(result.attemptsToday,10);
    assert.equal(result.dailyAttemptLimit,25);
  }
  for(const dailyAttemptLimit of [undefined,null,0,1001,'25']) {
    f.snapshot={attemptsToday:11,dailyAttemptLimit};
    const result=await executeDeskMutation(inputs[0],session);
    assert.equal(result.attemptsToday,11,'Legacy response counts remain usable, not a made-up limit');
    assert.equal(result.dailyAttemptLimit,undefined);
  }
  f.respond=c=>c.name==='load_brief_desk'?json({code:'XX000',message:'unavailable'},500):json([]);
  const result=await executeDeskMutation(inputs[0],session);
  assert.equal(result.attemptsToday,undefined); assert.equal(result.dailyAttemptLimit,undefined);
});

test('worker batches retain the three-attempt ceiling and exact IDs without reporting a fixed ten cap',async t=>{
  const f=fixture(t);
  process.env.EDITORIAL_OPENROUTER_API_KEY='fixture-only';
  let claims=0;
  f.respond=c=>{
    if(c.name==='enqueue_brief_selection') return json([id]);
    if(c.name==='acquire_brief_worker') return json(true);
    if(c.name==='claim_brief_selected_job') { claims++; assert.deepEqual(c.body.p_job_ids,[id]); return json([{id,story_id:id}]); }
    // Deliberately fail source loading: each reserved failure counts but no model call is made.
    if(c.name==='brief_sources') return json({message:'fixture unavailable'},400);
    if(c.name==='brief_jobs'||c.name==='release_brief_worker') return json(null);
  };
  const result=await executeDeskMutation({intent:'generate',ids:[id],confirmCharge:true},session);
  assert.equal(result.ok,true,result.message);
  assert.equal(claims,3);
  assert.equal(result.dailyAttemptLimit,25);
  assert.match(result.message,/configured daily limit/i);
  assert.doesNotMatch(result.message,/\bten\b|10 attempts/i);
  assert.equal(f.calls.filter(c=>c.name==='release_brief_worker').length,1);
});

test('decrease and unchanged consent are decided by stored SQL state, and denied or missing RPCs never use a service fallback',async t=>{
  const f=fixture(t);
  const result=await executeDeskMutation({intent:'daily-cap',limit:30,confirmCharge:false},session);
  assert.equal(result.ok,true);
  assert.equal(result.dailyAttemptLimit,25,'A concurrent change is read back, never the requested value');
  assert.deepEqual(f.calls[0],{name:'set_brief_daily_attempt_limit',body:{p_limit:30,p_confirm_charge:false},key:'fixture-session'});
  for(const [code,message,expected] of [
    ['P0001','Confirm increasing the daily attempt limit may incur additional charges','Confirm'],
    ['P0001','Editor access required','Editor access'],
    ['PGRST202','missing schema function','migration'],
    ['42501','permission denied','migration'],
  ]) {
    f.calls.length=0;
    f.respond=c=>c.name==='set_brief_daily_attempt_limit'?json({code,message},400):undefined;
    const failed=await executeDeskMutation({intent:'daily-cap',limit:25,confirmCharge:false},session);
    assert.equal(failed.ok,false);
    assert.match(failed.message,new RegExp(expected));
    assert.equal(failed.dailyAttemptLimit,undefined);
    assert.deepEqual(f.calls.map(c=>c.name),['set_brief_daily_attempt_limit']);
    assert.equal(f.calls[0].key,'fixture-session');
  }
});

test('public daily-cap action requires an authorized editor before dispatching any setting RPC',async t=>{
  const f=fixture(t);
  globals.dailyCapTestCookies=[];
  const {mutateDesk}=await import('../src/app/editor/desk-actions');
  const result=await mutateDesk({intent:'daily-cap',limit:25,confirmCharge:true});
  assert.equal(result.ok,false); assert.match(result.message,/authorized editor/);
  assert.equal(f.calls.some(c=>c.name==='set_brief_daily_attempt_limit'),false);
});

test('cap reads and saved cap receipts fail closed for missing, invalid or unavailable configuration',async t=>{
  const f=fixture(t);
  const user={id,aud:'authenticated',role:'authenticated',email:'editor@example.test',email_confirmed_at:'2026-10-04T00:00:00Z'};
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,aud:'authenticated',role:'authenticated',exp:4102444800})}.test-signature`;
  globals.dailyCapTestCookies=[{name:'sb-127-auth-token',value:`base64-${encode({access_token:token,refresh_token:'fixture-refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user})}`}];
  t.after(()=>{globals.dailyCapTestCookies=[];});
  f.respond=c=>c.name==='user'?json(user):c.name==='is_brief_editor'?json(true):undefined;
  for(const dailyAttemptLimit of [undefined,null,0,-1,1001,1.5,'25']) {
    f.snapshot={attemptsToday:10,dailyAttemptLimit};
    await assert.rejects(loadDesk({view:'sources'}),/daily attempt limit.*unavailable/i);
    const result=await executeDeskMutation({intent:'daily-cap',limit:25,confirmCharge:true},session);
    assert.equal(result.ok,false);
    assert.equal(result.dailyAttemptLimit,undefined,'Never echo a requested but unverified limit');
    assert.match(result.message,/unavailable/i);
  }
  f.snapshot={attemptsToday:10,dailyAttemptLimit:25};
  assert.equal((await loadDesk({view:'sources'})).dailyAttemptLimit,25);
  f.snapshot={attemptsToday:null,dailyAttemptLimit:25};
  assert.equal((await executeDeskMutation({intent:'daily-cap',limit:25,confirmCharge:true},session)).ok,false);
  f.respond=c=>c.name==='load_brief_desk'?json({code:'XX000',message:'unavailable'},500):undefined;
  const failed=await executeDeskMutation({intent:'daily-cap',limit:25,confirmCharge:true},session);
  assert.equal(failed.ok,false); assert.equal(failed.dailyAttemptLimit,undefined);
});
