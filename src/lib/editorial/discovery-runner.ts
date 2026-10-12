export type DiscoveryTask<T> = { id: string; host: string; run: (signal: AbortSignal) => Promise<T> };
export type DiscoveryTaskResult<T> = { id: string; status: 'fulfilled'; value: T } | { id: string; status: 'rejected'; reason: unknown };

/** Bounded orchestration only. Tasks must honor cancellation before storage writes. */
export async function runDiscoveryPool<T>(
  tasks: readonly DiscoveryTask<T>[],
  options: { deadlineMs?: number; signal?: AbortSignal } = {},
) {
  const deadlineMs = options.deadlineMs ?? 90_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 90_000)
    throw new Error('Discovery deadline must be between 1 and 90000ms.');
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new Error('Discovery deadline reached.')), deadlineMs);
  const results: DiscoveryTaskResult<T>[] = new Array(tasks.length);
  const remaining = tasks.map((task,index)=>({task,index}));
  const hosts = new Set<string>();
  let active=0;
  try {
    await new Promise<void>(resolve=>{
      const pump=()=>{
        if(signal.aborted) {
          for(const {task,index} of remaining.splice(0))
            results[index]={id:task.id,status:'rejected',reason:signal.reason};
        }
        while(!signal.aborted && active<3) {
          const next=remaining.findIndex(({task})=>!hosts.has(task.host));
          if(next<0) break;
          const {task,index}=remaining.splice(next,1)[0];
          active++;hosts.add(task.host);
          let onAbort:()=>void;
          const aborted=new Promise<never>((_,reject)=>{
            onAbort=()=>reject(signal.reason);
            signal.addEventListener('abort',onAbort,{once:true});
          });
          const work=Promise.resolve().then(()=>{signal.throwIfAborted();return task.run(signal);});
          Promise.race([work,aborted]).then(
            value=>{results[index]={id:task.id,status:'fulfilled',value};},
            reason=>{results[index]={id:task.id,status:'rejected',reason};},
          ).finally(()=>{
            signal.removeEventListener('abort',onAbort);
            active--;hosts.delete(task.host);pump();
          });
        }
        if(!active&&!remaining.length) resolve();
      };
      pump();
    });
    return {results,timedOut:deadline.signal.aborted};
  } finally { clearTimeout(timer); }
}
