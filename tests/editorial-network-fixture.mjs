// Test-process preload, never imported by application code. All source traffic
// is redirected to the local synthetic fixture. Real model calls are forbidden.
import { PUBLISHERS } from '../src/lib/editorial/publisher-catalog.ts';
if(process.env.EDITORIAL_FIXTURE_NETWORK!=='1' || process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:4310') {
  throw new Error('Editorial network fixture requires its explicit local-only environment.');
}
const sourceHosts=new Set(PUBLISHERS.flatMap(p=>[...p.articleHosts,new URL(p.discovery.method==='feed'?p.discovery.feedUrl:p.discovery.listingUrl).hostname]));
const originalFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,init)=>{
 const raw=input instanceof Request?input.url:String(input);
 const url=new URL(raw);
 if(url.hostname==='openrouter.ai')throw new Error('No real model traffic is allowed in browser fixtures.');
 if(url.protocol==='https:' && sourceHosts.has(url.hostname)) {
  return originalFetch(`http://127.0.0.1:4310/_fixture/source?url=${encodeURIComponent(url.href)}`,{
   signal:init?.signal ?? (input instanceof Request?input.signal:undefined),cache:'no-store',
  });
 }
 return originalFetch(input,init);
};
