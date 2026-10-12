import test from 'node:test';
import assert from 'node:assert/strict';

async function runner() {
  try { return (await import('../src/lib/editorial/discovery-runner')).runDiscoveryPool; }
  catch (error) { if ((error as {code?:string}).code === 'ERR_MODULE_NOT_FOUND') return undefined; throw error; }
}

test('one unavailable publisher does not discard healthy discovery results',async()=>{
  const run=await runner();
  assert.equal(typeof run,'function','bounded discovery pool is implemented');
  const result=await run!([
    {id:'bad',host:'a.test',run:async()=>{throw new Error('unavailable');}},
    {id:'good',host:'b.test',run:async()=>42},
  ]);
  assert.equal(result.results[0].status,'rejected');
  assert.deepEqual(result.results[1],{id:'good',status:'fulfilled',value:42});
  assert.equal(result.timedOut,false);
});

test('runs three independent hosts but serializes work for the same host',async()=>{
  const run=await runner();
  const starts:string[]=[];
  let active=0,maxActive=0;
  const releases=new Map<string,()=>void>();
  const task=(id:string,host:string)=>({id,host,run:async()=>{
    starts.push(id);active++;maxActive=Math.max(maxActive,active);
    await new Promise<void>(resolve=>releases.set(id,resolve));active--;return id;
  }});
  const pending=run!([task('one','a.test'),task('two','a.test'),task('three','b.test'),task('four','c.test')]);
  await new Promise(resolve=>setImmediate(resolve));
  // Always release pending work, even when this assertion is red.
  try { assert.deepEqual(starts,['one','three','four']); assert.equal(maxActive,3); }
  finally {
    for(let i=0;i<5;i++) {for(const release of releases.values()) release();await new Promise(resolve=>setImmediate(resolve));}
  }
  const result=await pending;
  assert.deepEqual(result.results.map(r=>r.id),['one','two','three','four']);
  assert.equal(maxActive,3);
});

test('the shared deadline aborts active work and never starts queued work',async()=>{
  const run=await runner();
  const seen:string[]=[];
  let received:AbortSignal|undefined;
  let release!:()=>void;
  const slow=new Promise<void>(resolve=>release=resolve);
  // An uncooperative double still cannot hold the runner past its deadline.
  const tasks=[
    {id:'slow',host:'a.test',run:async(signal:AbortSignal)=>{seen.push('slow');received=signal;await slow;return 1;}},
    {id:'queued',host:'a.test',run:async()=>{seen.push('queued');return 2;}},
  ];
  const pending=run!(tasks,{deadlineMs:20});
  const outcome=await Promise.race([pending,new Promise<null>(resolve=>setTimeout(()=>resolve(null),150))]);
  release();
  assert.notEqual(outcome,null,'pool must settle at its deadline');
  assert.equal(outcome!.timedOut,true);
  assert.equal(received?.aborted,true);
  assert.deepEqual(seen,['slow']);
  assert.deepEqual(outcome!.results.map(r=>r.status),['rejected','rejected']);
});
