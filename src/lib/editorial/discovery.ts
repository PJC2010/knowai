import 'server-only';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { categorize } from '../news';
import { serviceDatabase } from './supabase';
import { boundedFetch } from './source';
import { normalizePublisherUrl, publisherByKey, type PublisherDefinition } from './publisher-catalog';
import { parsePublisherFeed, type FeedCandidate } from './feed-parser';
import { discoverAnthropic, parseAnthropicListing } from './connectors/anthropic';
import { runDiscoveryPool } from './discovery-runner';

const autoDraftKeys = new Set(['openai','google','hugging-face','techcrunch']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Database = ReturnType<typeof serviceDatabase>;
type PublisherRow = { id:string; name:string; catalog_key:string|null; source_kind:string; discovery_method:string; discovery_url:string; feed_url:string|null; access_status:string; retry_after:string|null; discovery_cursor:string|null };
export type DiscoveryHealth = {
  outcome:'ok'|'empty'|'partial'|'unavailable'|'skipped'; scanned:number; inserted:number;
  duplicates:number; filtered:number; invalid:number; attempted:number; remaining:number; elapsed_ms:number;
};
export type PublisherDiscoveryResult = DiscoveryHealth & { publisherId:string; name:string; warning:string|null; error:string|null; discoveredIds:string[]; autoDraftIds:string[] };
const checked = (error:{message:string}|null) => { if(error) throw new Error('Editorial storage operation failed. Check the database migration and service configuration.'); };
const emptyHealth = ():DiscoveryHealth => ({outcome:'empty',scanned:0,inserted:0,duplicates:0,filtered:0,invalid:0,attempted:0,remaining:0,elapsed_ms:0});
const errorMessage = (error:unknown) => error instanceof Error && /^(Editorial storage|Configured source|Source access review|Invalid feed|Malformed feed|Anthropic|Only the configured)/.test(error.message)
  ? error.message.slice(0,240) : 'Source retrieval or validation failed. Check access and try again later.';
function backoff(error:unknown):string|null {
  const value = error && typeof error === 'object' ? error as {status?:number;retryAfter?:string|null} : {};
  if(![403,429,503].includes(value.status ?? 0)) return null;
  const raw=value.retryAfter;
  const duration=raw && /^\d+$/.test(raw) ? Number(raw)*1000 : raw ? Date.parse(raw)-Date.now() : NaN;
  const ms=Number.isFinite(duration)&&duration>0 ? Math.min(duration,86_400_000) : value.status===403 ? 3_600_000 : 900_000;
  return new Date(Date.now()+ms).toISOString();
}
function configuration(row:PublisherRow):PublisherDefinition {
  const definition=publisherByKey(row.catalog_key ?? '');
  if(!definition || row.name!==definition.name || row.source_kind!==definition.kind || row.discovery_method!==definition.discovery.method)
    throw new Error('Configured source does not match the reviewed publisher catalog.');
  const expected=definition.discovery.method==='feed'?definition.discovery.feedUrl:definition.discovery.listingUrl;
  if(row.discovery_url!==expected || (definition.discovery.method==='feed' ? row.feed_url!==expected : row.feed_url!==null))
    throw new Error('Configured source endpoint does not match the reviewed publisher catalog.');
  if(row.access_status!=='approved') throw new Error('Source access review is required before fetching this publisher.');
  return definition;
}
async function knownUrls(db:Database,urls:string[],signal:AbortSignal):Promise<Set<string>> {
  if(!urls.length)return new Set();
  const rows=await db.from('brief_sources').select('url').in('url',[...new Set(urls)]).abortSignal(signal);
  checked(rows.error);return new Set((rows.data ?? []).map(row=>row.url));
}
type PublisherWork = {result:PublisherDiscoveryResult; started:number; continuation:string|null; retryAfter:string|null; skipped:boolean};
async function discoverPublisher(db:Database,row:PublisherRow,signal:AbortSignal,work:PublisherWork):Promise<PublisherDiscoveryResult> {
  const start=work.started=Date.now();
  const result=work.result;
  if(row.retry_after && Date.parse(row.retry_after)>start) {
    work.skipped=true;result.outcome='skipped';result.warning='Retry window is active. This source was not requested.';return result;
  }
  let continuation=row.discovery_cursor, retryAfter:string|null=null;
  let collectionSignal=signal;
  try {
    const definition=configuration(row);
    // Collection may expire first; completed metadata still has the owned global
    // budget for persistence. Never replace the signal that gates storage writes.
    if(definition.discovery.method==='newsroom')collectionSignal=AbortSignal.any([signal,AbortSignal.timeout(60_000)]);
    signal.throwIfAborted();
    checked((await db.from('brief_publishers').update({last_attempt_at:new Date(start).toISOString()}).eq('id',row.id).abortSignal(signal)).error);
    let candidates:FeedCandidate[];
    let existing:Set<string>;
    if(definition.discovery.method==='feed') {
      const url=definition.discovery.feedUrl;
      const raw=await boundedFetch(url,{signal},1_500_000,3,{validateUrl:value=>normalizePublisherUrl(value,definition,'feed')});
      const feed=parsePublisherFeed(raw,definition);
      Object.assign(result,{scanned:feed.scanned,filtered:feed.filtered,invalid:feed.invalid,warning:feed.warning});
      candidates=feed.candidates;
      existing=await knownUrls(db,candidates.map(candidate=>candidate.url),signal);
      result.outcome=feed.invalid ? (candidates.length?'partial':'unavailable') : candidates.length?'ok':'empty';
      if(result.outcome==='unavailable')result.error='No trustworthy dated article metadata was available in this feed.';
      continuation=null;
    } else {
      const url=definition.discovery.listingUrl;
      const raw=await boundedFetch(url,{signal:collectionSignal},1_500_000,3,{validateUrl:value=>normalizePublisherUrl(value,definition,'listing')});
      const listing=parseAnthropicListing(raw);
      existing=await knownUrls(db,listing.urls,collectionSignal);
      const newsroom=await discoverAnthropic({
        fetchText:(target,requestSignal)=>target===url ? Promise.resolve(raw) : boundedFetch(target,{signal:requestSignal},2_000_000,3,{validateUrl:value=>normalizePublisherUrl(value,definition,'article')}),
        knownUrls:existing,signal:collectionSignal,continuation,
      });
      Object.assign(result,{outcome:newsroom.outcome,scanned:newsroom.scanned,filtered:newsroom.filtered,invalid:newsroom.invalid,duplicates:newsroom.duplicates,attempted:newsroom.attempted,remaining:newsroom.remaining,warning:newsroom.warning});
      candidates=newsroom.candidates.map(candidate=>({...candidate,index:-1}));
      continuation=newsroom.continuation;retryAfter=backoff({status:Number(newsroom.errorCode?.match(/^http-(\d{3})$/)?.[1]),retryAfter:newsroom.retryAfter});
      // The pool may settle before a pending storage request: publish known
      // backoff now, not only when this publisher task eventually returns.
      work.retryAfter=retryAfter;
      if(newsroom.errorCode)result.error=`Anthropic metadata discovery: ${newsroom.errorCode}.`;
    }
    const collectedContinuation=continuation;
    // Collected metadata remains pending until storage acknowledges it. On any
    // failed write, resume at that candidate rather than the connector's cursor.
    result.remaining+=candidates.length;
    for(const candidate of candidates) {
      if(definition.discovery.method==='newsroom')continuation=candidate.url;
      work.continuation=continuation;
      signal.throwIfAborted();
      if(existing.has(candidate.url)){result.duplicates++;result.remaining--;continue;}
      const slug=`${candidate.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,110)}-${createHash('sha256').update(candidate.url).digest('hex').slice(0,8)}`;
      // Never persist feed content, raw article HTML, or a synthesized timestamp.
      const inserted=await db.from('brief_sources').upsert({url:candidate.url,title:candidate.title,slug,source_name:candidate.source_name,
        source_published_at:candidate.source_published_at,category:categorize(candidate.title),publisher_id:row.id,source_image_url:candidate.source_image_url},
        {onConflict:'url',ignoreDuplicates:true}).select('id').abortSignal(signal);
      // A response can arrive after the pool has cancelled and released its
      // lease. Do not acknowledge it, advance the cursor or mutate settled IDs.
      signal.throwIfAborted();
      checked(inserted.error);
      existing.add(candidate.url);
      if(inserted.data?.length){
        result.inserted++;result.discoveredIds.push(inserted.data[0].id);
        if(definition.discovery.method==='feed'&&autoDraftKeys.has(definition.key)&&candidate.index<8)result.autoDraftIds.push(inserted.data[0].id);
      } else result.duplicates++;
      result.remaining--;
    }
    continuation=collectedContinuation;
  } catch(error) {
    result.outcome=result.inserted?'partial':'unavailable';
    result.error=signal.aborted||collectionSignal.aborted?'Discovery time limit reached. Unprocessed entries remain available for a later refresh.':errorMessage(error);
    // A storage error has no authority to clear a known upstream retry window.
    retryAfter=backoff(error) ?? retryAfter;
  }
  result.elapsed_ms=Math.max(0,Date.now()-start);
  work.continuation=continuation;work.retryAfter=retryAfter;
  return result;
}

export async function discoverStories(publisherId?:string,options:{deadlineMs?:number}={}) {
  if(publisherId!==undefined && !uuid.test(publisherId))throw new Error('Select a valid publisher.');
  const db=serviceDatabase();
  const token=randomUUID();
  // One short preflight budget leaves room for the bounded pool and cleanup
  // inside the database's 120-second lease, even when acquisition is delayed.
  const preflight=AbortSignal.timeout(5000);
  let releaseLease=true;
  try {
    const lease=await db.rpc('acquire_brief_discovery',{p_token:token}).abortSignal(preflight);checked(lease.error);
    preflight.throwIfAborted();
    if(lease.data!==true) {
      releaseLease=false;
      return {discovered:0,discoveredIds:[],autoDraftIds:[],unavailable:[],results:[],busy:true,timedOut:false,message:'A source refresh is already running. Try again after it finishes.'};
    }
    // Retry, access and continuation must reflect the last lease owner's writes.
    let query=db.from('brief_publishers').select('*').eq('enabled',true);
    if(publisherId)query=query.eq('id',publisherId);
    const publishers=await query.abortSignal(preflight);checked(publishers.error);
    preflight.throwIfAborted();
    if(publisherId && !publishers.data?.length)throw new Error('This publisher is disabled or not configured.');
    const rows=(publishers.data ?? []) as PublisherRow[];
    const work:PublisherWork[]=rows.map(row=>({started:Date.now(),continuation:row.discovery_cursor,retryAfter:row.retry_after,skipped:false,
      result:{...emptyHealth(),publisherId:row.id,name:row.name,warning:null,error:null,discoveredIds:[],autoDraftIds:[]}}));
    const pool=await runDiscoveryPool(rows.map((row,index)=>({id:row.id,host:(()=>{try{return new URL(row.discovery_url).hostname;}catch{return `invalid-${row.id}`;}})(),
      run:(signal:AbortSignal)=>discoverPublisher(db,row,signal,work[index])})),options);
    const results=pool.results.map((item,index):PublisherDiscoveryResult=>item.status==='fulfilled'?item.value:{...work[index].result,
      outcome:work[index].result.inserted?'partial':'unavailable',elapsed_ms:Math.max(0,Date.now()-work[index].started),
      error:pool.timedOut?'Discovery time limit reached. Unprocessed entries remain available for a later refresh.':errorMessage(item.reason)});
    // Settle health while still owning the lease. Aborted tasks cannot write
    // late health over a newer refresh; only this coordinator persists it.
    const cleanup=AbortSignal.timeout(5000);
    for(const [index,result] of results.entries()) {
      if(work[index].skipped)continue;
      const {publisherId,name:_name,warning,error,discoveredIds:_ids,autoDraftIds:_auto,...stored}=result;
      checked((await db.from('brief_publishers').update({last_attempt_at:new Date(work[index].started).toISOString(),
        last_result:stored,last_warning:warning,last_error:error,retry_after:work[index].retryAfter,discovery_cursor:work[index].continuation,
        ...(['ok','empty','partial'].includes(result.outcome)?{last_success_at:new Date().toISOString()}:{}),
      }).eq('id',publisherId).abortSignal(cleanup)).error);
    }
    const discoveredIds=results.flatMap(result=>result.discoveredIds),autoDraftIds=results.flatMap(result=>result.autoDraftIds);
    const unavailable=results.filter(result=>result.error).map(result=>result.name);
    const warnings=results.filter(result=>result.warning).map(result=>`${result.name}: ${result.warning}`);
    return {discovered:discoveredIds.length,discoveredIds,autoDraftIds,unavailable,results,busy:false,timedOut:pool.timedOut,
      message:`${discoveredIds.length} new stories discovered. No drafts generated.${unavailable.length?` Unavailable sources: ${unavailable.join(', ')}.`:''}${warnings.length?` ${warnings.join(' ')}`:''}`};
  } finally {
    // Also attempt token-scoped release on an uncertain acquisition response.
    if(releaseLease)checked((await db.rpc('release_brief_discovery',{p_token:token}).abortSignal(AbortSignal.timeout(5000))).error);
  }
}
