import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeskData, DeskQuery, DeskMutation, DeskResult, EventContext, EventMergePreview, EventSnapshot } from "./desk-types";
import { suggestRelatedCoverage, type EventSource } from "./event-candidates";
import { requireEditor, serviceDatabase } from "./supabase";
import { discoverStories, runEditorialBatch } from "./pipeline";
import { boundedFetch, retrieveImportMetadata, retrieveSourceImage } from "./source";
import { createHash, randomUUID } from "node:crypto";
import { categorize } from "../news";
import { parseSuggestion, suggestionRequest } from "./suggestions";
import { IMAGE_BUCKET, validFeaturedWeek, validateImageUpload } from "./images";

export async function loadDesk(query: DeskQuery): Promise<DeskData> {
  const {db} = await requireEditor();
  const safe: DeskQuery = {};
  for (const key of ['view','id','q','publisher','category','status','since','page'] as const) {
    if (typeof query[key] === 'string') safe[key] = query[key].slice(0,200);
  }
  const data = await rpc<DeskData>(db,'load_brief_desk',{p_query:safe});
  requireDailyLimit(data?.dailyAttemptLimit);
  return data;
}

type Session = { db: SupabaseClient; user: { id: string } };
class DeskError extends Error {
  constructor(message: string, readonly code: "conflict" | "invalid" | "failed" = "invalid") { super(message); }
}
const validDailyLimit = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1000;
function requireDailyLimit(value: unknown) {
  if (!validDailyLimit(value)) throw new DeskError('Daily attempt limit configuration is unavailable. Check the editorial daily cap migration and reload.', 'failed');
}
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function requireId(id: unknown) { if (!validId(id)) throw new DeskError('Select a valid story or revision.'); }
function validEventSnapshot(value: unknown): value is EventSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot=value as EventSnapshot;
  return validId(snapshot.eventId) && Number.isInteger(snapshot.version) && snapshot.version >= 1 && snapshot.version <= 2147483647;
}
async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const {data,error} = await db.rpc(name,args);
  if (error) {
    if (error.code === 'P0001' && /^Event groups changed/i.test(error.message)) throw new DeskError('These groups changed while you were reviewing them. Nothing was merged. Reload both groups and confirm again.', 'conflict');
    if (/Draft changed|no longer editable|already reviewed|newer publication/i.test(error.message)) throw new DeskError('The draft changed or is no longer editable. Your local text is retained; reload the current version before retrying.', 'conflict');
    if (error.code === 'P0001') throw new DeskError(error.message);
    throw new DeskError('Editorial storage failed. Check the migration and try again; your local text is retained.', 'failed');
  }
  return data as T;
}

// Not a server action. Only called with a session already authorized by requireEditor.
export async function executeDeskMutation(input: DeskMutation, session: Session): Promise<DeskResult> {
  const result = await performDeskMutation(input,session);
  if (input && ['suggest','generate','regenerate','run-queued'].includes(input.intent)) {
    try {
      const data = await rpc<DeskData>(session.db,'load_brief_desk',{p_query:{view:'sources'}});
      if (Number.isSafeInteger(data.attemptsToday) && data.attemptsToday >= 0) result.attemptsToday = data.attemptsToday;
      if (validDailyLimit(data.dailyAttemptLimit)) result.dailyAttemptLimit = data.dailyAttemptLimit;
    } catch { /* Do not invent a count or cap if the authoritative snapshot is unavailable. */ }
  }
  return result;
}
async function performDeskMutation(input: DeskMutation, {db,user}: Session): Promise<DeskResult> {
  try {
    if (!input || typeof input !== 'object') throw new DeskError('Invalid editorial action.');
    if ('id' in input) requireId(input.id);
    if ('version' in input && (!Number.isSafeInteger(input.version) || input.version < 1)) throw new DeskError('Reload this draft before continuing.');
    if (input.intent === 'discover') {
      const result = await discoverStories();
      return {ok:true,message:result.message};
    }
    if (input.intent === 'import-url') {
      if (typeof input.url !== 'string' || input.url.length > 2048) throw new DeskError('Enter a valid approved publisher article URL.');
      let metadata;
      try { metadata = await retrieveImportMetadata(input.url); }
      catch (error) { throw new DeskError(error instanceof Error ? error.message : 'Source metadata could not be read.'); }
      const service = serviceDatabase();
      const publisher = await service.from('brief_publishers').select('id').eq('name',metadata.source_name).single();
      if (publisher.error || !publisher.data) throw new DeskError('The approved publisher is not configured.','failed');
      const slug = `${metadata.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,110)}-${createHash('sha256').update(metadata.url).digest('hex').slice(0,8)}`;
      const inserted = await service.from('brief_sources').upsert({...metadata,slug,category:categorize(metadata.title),publisher_id:publisher.data.id},{onConflict:'url',ignoreDuplicates:true}).select('id');
      if (inserted.error) throw new DeskError('The article could not be imported. Try again.','failed');
      return {ok:true,message:inserted.data?.length?'Article imported to the inbox. No drafts generated.':'This article is already in your desk; its existing selection is unchanged.'};
    }
    if (input.intent === 'event-detail') {
      const event = await rpc<EventContext>(db,'load_brief_event',{p_source_id:input.id});
      if (!event || !Array.isArray(event.members)) throw new DeskError('Event group is unavailable. Reload the editorial desk.','failed');
      const anchor = event.members.find(member => member.id===input.id);
      if (!anchor || !Number.isFinite(Date.parse(anchor.source_published_at))) throw new DeskError('The original source date is unavailable for matching.','failed');
      const time=Date.parse(anchor.source_published_at), windowMs=72*60*60*1000;
      const nearby = await db.from('brief_sources').select('id,title,source_name,source_published_at,url')
        .gte('source_published_at',new Date(time-windowMs).toISOString())
        .lte('source_published_at',new Date(time+windowMs).toISOString())
        .order('source_published_at',{ascending:false}).limit(300);
      if (nearby.error) throw new DeskError('Nearby source metadata could not be loaded. Try again.','failed');
      const members=new Set(event.members.map(member=>member.id));
      const candidates=suggestRelatedCoverage(anchor,(nearby.data || []) as EventSource[],members);
      return {ok:true,message:'Private event metadata loaded. No stories were grouped automatically.',event,candidates};
    }
    if (input.intent === 'event-search') {
      if (typeof input.term!=='string' || input.term.trim().length<3 || input.term.trim().length>80) throw new DeskError('Search with 3 to 80 characters.');
      const matches=await rpc<EventSource[]>(db,'search_brief_event_sources',{p_source_id:input.id,p_term:input.term.trim()});
      return {ok:true,message:'Stored article search complete. Compare original reporting before grouping.',matches};
    }
    if (input.intent === 'event-merge-preview') {
      requireId(input.otherId);
      if (input.id===input.otherId) throw new DeskError('Choose two different sources.');
      const mergePreview=await rpc<EventMergePreview>(db,'load_brief_event_merge_preview',{p_lead_source:input.id,p_other_source:input.otherId});
      return {ok:true,message:'Review every source in both private groups before confirming.',mergePreview};
    }
    if (input.intent === 'event-merge') {
      requireId(input.otherId);
      if (input.id===input.otherId) throw new DeskError('Choose two different sources.');
      if (!validEventSnapshot(input.expectedTarget) || !validEventSnapshot(input.expectedOther) || input.expectedTarget.eventId===input.expectedOther.eventId)
        throw new DeskError('Reload both groups and review them before confirming the merge.');
      await rpc<string>(db,'merge_brief_events',{
        p_lead_source:input.id,p_other_source:input.otherId,
        p_target_event:input.expectedTarget.eventId,p_target_version:input.expectedTarget.version,
        p_other_event:input.expectedOther.eventId,p_other_version:input.expectedOther.version,
      });
      return {ok:true,message:'Private event groups merged. Drafts and public stories are unchanged.'};
    }
    if (input.intent === 'event-split' || input.intent === 'event-lead') {
      await rpc<string>(db,input.intent==='event-split'?'split_brief_event_source':'set_brief_event_lead',{p_source_id:input.id});
      return {ok:true,message:input.intent==='event-split'?'Source removed from the private group. Public stories are unchanged.':'Private lead source updated. Public stories are unchanged.'};
    }
    if (input.intent === 'generate' || input.intent === 'regenerate' || input.intent === 'run-queued') {
      if (input.confirmCharge !== true) throw new DeskError('Confirm generation may incur charges.');
      if (!process.env.EDITORIAL_OPENROUTER_API_KEY) throw new DeskError('Set the dedicated editorial OpenRouter key before generating drafts.');
      let jobs: string[];
      if (input.intent === 'run-queued') {
        jobs = await rpc<string[]>(db,'authorize_brief_selected_queue',{});
        if (!jobs.length) return {ok:true,message:'No selected queued jobs to run.'};
      } else {
        const ids = input.intent === 'generate' ? input.ids : [input.id];
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || ids.some(id=>!validId(id))) throw new DeskError('Select between 1 and 200 valid sources.');
        jobs = await rpc<string[]>(db,'enqueue_brief_selection',{p_ids:[...new Set(ids)],p_regenerate:input.intent === 'regenerate'});
        if (!jobs.length) return {ok:true,message:'No new jobs queued. Existing drafts or failed jobs require explicit regeneration.'};
      }
      const result = await runEditorialBatch(jobs);
      return {ok:true,message:result.message};
    }
    if (input.intent === 'suggest') {
      requireId(input.id);
      if (!Number.isSafeInteger(input.version) || input.version < 1) throw new DeskError('Reload this draft before continuing.');
      if (input.confirmCharge !== true) throw new DeskError('Confirm a suggestion may incur charges.');
      if (!process.env.EDITORIAL_OPENROUTER_API_KEY) throw new DeskError('Set the dedicated editorial OpenRouter key before requesting suggestions.');
      if (!['oneLiner','shortVersion','wholePicture','whyItMatters'].includes(input.field) || !['simplify','shorten','alternative'].includes(input.instruction)) throw new DeskError('Choose a supported field and editing task.');
      // Read once before reservation: never mix a newer draft with an older version,
      // and use its immutable source capture rather than refetching the article.
      const {active: draft} = await rpc<DeskData>(db,'load_brief_desk',{p_query:{id:input.id}});
      if (!draft || draft.id !== input.id || draft.version !== input.version || draft.state !== 'needs_review') throw new DeskError('The draft changed or is no longer editable. Your local text is retained; reload the current version before retrying.','conflict');
      if (typeof draft.source_text !== 'string' || !draft.source_text.trim() || draft.source_text.length > 60000) throw new DeskError('This draft has no usable source capture. Review the source and explicitly regenerate the draft before requesting suggestions.');
      const service = serviceDatabase();
      const token = randomUUID();
      const acquired = await rpc<boolean>(service,'acquire_brief_worker',{p_token:token});
      if (acquired !== true) throw new DeskError('Another editorial worker is already running. Retry after it finishes.');
      try {
        const reservation = await rpc<string>(service,'reserve_brief_suggestion',{p_token:token,p_id:input.id,p_version:input.version,p_field:input.field,p_instruction:input.instruction,p_actor:user.id});
        if (!validId(reservation)) throw new DeskError('The suggestion attempt could not be reserved. No model request was made.','failed');
        const model = process.env.EDITORIAL_MODEL || 'openai/gpt-4.1-mini';
        const audit = async (values: Record<string,unknown>) => {
          const {error} = await service.from('brief_suggestions').update(values).eq('id',reservation);
          if (error) throw new DeskError('Suggestion audit could not be saved. A request may still have incurred a charge.','failed');
        };
        let reportedUsage: {cost:number|null;input_tokens:number|null;output_tokens:number|null} = {cost:null,input_tokens:null,output_tokens:null};
        try {
          await audit({model});
          const response = JSON.parse(await boundedFetch('https://openrouter.ai/api/v1/chat/completions',{
            method:'POST',
            headers:{Authorization:`Bearer ${process.env.EDITORIAL_OPENROUTER_API_KEY}`,'Content-Type':'application/json','X-Title':'knowai editorial'},
            body:JSON.stringify(suggestionRequest(model,draft.brief_sources.title,draft.source_text,draft.content,input.field,input.instruction)),
            signal:AbortSignal.timeout(45000),
          },100000));
          const usage = response?.usage;
          const cost = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
          const tokens = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647 ? value : null;
          // Persist usage before validating: invalid/truncated completions may be billed.
          reportedUsage = {cost,input_tokens:tokens(usage?.prompt_tokens),output_tokens:tokens(usage?.completion_tokens)};
          await audit(reportedUsage);
          const value = parseSuggestion(response,draft.content,draft.source_text,input.field);
          await audit({state:'complete',finished_at:new Date().toISOString()});
          return {ok:true,message:'Suggestion ready for review. Nothing has been applied or saved.',suggestion:{field:input.field,value,cost}};
        } catch (error) {
          const message = error instanceof DeskError ? error.message : 'Suggestion generation or validation failed. Nothing was changed. A request may still have incurred a charge.';
          await audit({...reportedUsage,state:'failed',error:message,finished_at:new Date().toISOString()});
          throw new DeskError(message,'failed');
        }
      } finally {
        await rpc(service,'release_brief_worker',{p_token:token});
      }
    }
    if (input.intent === 'publish' || input.intent === 'reject') {
      const publish = input.intent === 'publish';
      if (publish && (input.sourceChecked !== true || input.tiersChecked !== true)) throw new DeskError('Confirm the source and all tiers were reviewed against this saved version.');
      const slug = await rpc<string>(db,'review_brief_desk',{p_id:input.id,p_version:input.version,p_publish:publish,p_source_checked:publish && input.sourceChecked,p_tiers_checked:publish && input.tiersChecked});
      return {ok:true,message:publish?'Story published. All three versions are live.':'Draft rejected. Existing publications are unchanged.',slug};
    }
    if (input.intent === 'fork' || input.intent === 'restore') {
      if (input.intent === 'restore') requireId(input.historyId);
      const revisionId = await rpc<string>(db,input.intent === 'fork'?'fork_brief_revision':'restore_brief_revision',input.intent === 'fork'?{p_id:input.id}:{p_id:input.id,p_history_id:input.historyId});
      return {ok:true,message:'New editable revision created. The published story is unchanged.',revisionId};
    }
    if (input.intent === 'triage') {
      if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 200 || input.ids.some(id=>!validId(id)) || !['inbox','selected','saved','dismissed'].includes(input.state)) throw new DeskError('Select between 1 and 200 valid sources.');
      await rpc(db,'triage_brief_sources',{p_ids:[...new Set(input.ids)],p_state:input.state});
      return {ok:true,message:'Selection updated.'};
    }
    if (input.intent === 'publisher') {
      if (typeof input.enabled !== 'boolean') throw new DeskError('Invalid publisher setting.');
      await rpc(db,'set_brief_publisher',{p_id:input.id,p_enabled:input.enabled});
      return {ok:true,message:input.enabled?'Publisher enabled.':'Publisher disabled for discovery.'};
    }
    if (input.intent === 'daily-cap') {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new DeskError('Daily attempt limit must be an integer between 1 and 1000.');
      if (typeof input.confirmCharge !== 'boolean') throw new DeskError('Invalid charge confirmation.');
      // The session RPC compares with the stored value under the reservation lock.
      // A stale client cannot waive consent for an actual increase.
      await rpc(db,'set_brief_daily_attempt_limit',{p_limit:input.limit,p_confirm_charge:input.confirmCharge});
      const data = await rpc<DeskData>(db,'load_brief_desk',{p_query:{view:'sources'}});
      requireDailyLimit(data?.dailyAttemptLimit);
      if (!Number.isSafeInteger(data.attemptsToday) || data.attemptsToday < 0) throw new DeskError('Daily usage is unavailable. Reload to verify the saved limit.', 'failed');
      return {ok:true,message:'Daily attempt limit saved. Usage and queued work are unchanged.',attemptsToday:data.attemptsToday,dailyAttemptLimit:data.dailyAttemptLimit};
    }
    if (input.intent === 'auto-draft') {
      if (typeof input.enabled !== 'boolean' || (input.enabled && input.confirmCharge !== true)) throw new DeskError('Confirm automatic drafting may incur charges.');
      await rpc(db,'set_brief_auto_draft',{p_enabled:input.enabled,p_confirm_charge:input.confirmCharge === true});
      return {ok:true,message:input.enabled?'Automatic drafting enabled. Publication still requires review.':'Automatic drafting disabled. Discovery remains free.'};
    }
    if (input.intent === 'save') {
      if (JSON.stringify(input.content).length > 60000) throw new DeskError('The draft is too large.');
      const version = await rpc<number>(db,'save_brief_desk',{p_id:input.id,p_version:input.version,p_content:input.content});
      return {ok:true,message:'Draft saved. It is still unpublished.',version};
    }
    if (input.intent === 'image') {
      if (!['source','upload','none'].includes(input.imageSource) || typeof input.imageAlt !== 'string' || input.imageAlt.length > 500) throw new DeskError('Choose a supported image and description of up to 500 characters.');
      if (input.imageUrl !== undefined && input.imageUrl !== null && (typeof input.imageUrl !== 'string' || input.imageUrl.length > 2048)) throw new DeskError('Choose a valid story image.');
      const image = await rpc<DeskResult>(db,'set_brief_revision_image',{p_id:input.id,p_version:input.version,p_source:input.imageSource,p_url:input.imageSource === 'source' && input.imageUrl !== undefined ? input.imageUrl || '' : null,p_alt:input.imageAlt.trim()});
      return {...image,ok:true,message:'Story image saved. Publish this revision to make it live.'};
    }
    if (input.intent === 'refresh-image') {
      const {active} = await rpc<DeskData>(db,'load_brief_desk',{p_query:{id:input.id}});
      if (!active || active.version !== input.version || active.state !== 'needs_review') throw new DeskError('Draft changed or is no longer editable. Reload before trying again.','conflict');
      let imageUrl;
      try { imageUrl = await retrieveSourceImage(active.brief_sources.url); }
      catch { throw new DeskError('The article image could not be retrieved. Try again or upload an image.'); }
      const service = serviceDatabase();
      const {error} = await service.from('brief_sources').update({source_image_url:imageUrl}).eq('id',active.story_id);
      if (error) throw new DeskError('The source image could not be saved.','failed');
      const image = await rpc<DeskResult>(db,'set_brief_revision_image',{p_id:input.id,p_version:input.version,p_source:active.image_source || 'source',p_url:active.image_source === 'upload' ? null : imageUrl || '',p_alt:active.image_alt || ''});
      return {...image,ok:true,message:imageUrl?'Article image refreshed. Publish this revision to make it live.':'No article image was found. You can upload an image.'};
    }
    if (input.intent === 'feature') {
      if (!validFeaturedWeek(input.week)) throw new DeskError('Choose the Monday that starts the featured week.');
      const result = await rpc<DeskResult>(db,'set_brief_feature',{p_id:input.id,p_week:input.week});
      return {...result,ok:true,message:input.week?'Featured article of the week updated.':'Weekly feature removed.'};
    }
    throw new DeskError('Unknown editorial action.');
  } catch (error) {
    return {ok:false,code:error instanceof DeskError ? error.code : 'failed',message:error instanceof DeskError ? error.message : 'The editorial action failed. Your local text is retained; try again.'};
  }
}

// File data is accepted only by the authenticated server action. The upload is
// registered server-side before an editor RPC can attach it to this revision.
export async function executeDeskImageUpload(form: FormData, {db,user}: Session): Promise<DeskResult> {
  let uploaded: {path:string;url:string} | null = null;
  let service: SupabaseClient | undefined;
  let attachmentAttempted = false;
  try {
    const id = form.get('id'), version = Number(form.get('version')), alt = form.get('imageAlt'), file = form.get('image');
    requireId(id);
    if (!Number.isSafeInteger(version) || version < 1) throw new DeskError('Reload this draft before uploading an image.');
    if (typeof alt !== 'string' || alt.length > 500 || !(file instanceof File)) throw new DeskError('Choose an image and description of up to 500 characters.');
    let validated;
    try { validated = await validateImageUpload(file); } catch (error) { throw new DeskError((error as Error).message); }
    const {active} = await rpc<DeskData>(db,'load_brief_desk',{p_query:{id}});
    if (!active || active.id !== id || active.version !== version || active.state !== 'needs_review') throw new DeskError('Draft changed or is no longer editable. Reload before uploading.','conflict');
    service = serviceDatabase();
    const path = `${user.id}/${id}/${randomUUID()}.${validated.extension}`;
    const bucket = service.storage.from(IMAGE_BUCKET);
    const upload = await bucket.upload(path,validated.bytes,{contentType:validated.contentType,upsert:false,cacheControl:'31536000'});
    if (upload.error) throw new DeskError('The image upload failed. Check that the story images migration is installed and try again.','failed');
    const url = bucket.getPublicUrl(path).data.publicUrl;
    uploaded = {path,url};
    const record = await service.from('brief_image_uploads').insert({revision_id:id,actor:user.id,path,url});
    if (record.error) throw new DeskError('The image upload could not be registered. Try again.','failed');
    attachmentAttempted = true;
    const image = await rpc<DeskResult>(db,'set_brief_revision_image',{p_id:id,p_version:version,p_source:'upload',p_url:url,p_alt:alt.trim()});
    return {...image,ok:true,message:'Image uploaded and saved. Publish this revision to make it live.'};
  } catch (error) {
    if (uploaded && service && (!attachmentAttempted || (error instanceof DeskError && error.code !== 'failed'))) {
      // Clean up rejected attachments. A transport failure after submission may
      // have committed, so retain those bytes for the saved revision to resolve.
      await service.from('brief_image_uploads').delete().eq('url',uploaded.url);
      await service.storage.from(IMAGE_BUCKET).remove([uploaded.path]);
    }
    return {ok:false,code:error instanceof DeskError ? error.code : 'failed',message:error instanceof DeskError ? error.message : 'The image upload failed. Try again.'};
  }
}
