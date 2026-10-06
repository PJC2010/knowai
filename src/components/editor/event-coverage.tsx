"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { DeskMutation, DeskResult, DeskSource, EventContext, EventMergePreview } from "@/lib/editorial/desk-types";
import type { EventSource } from "@/lib/editorial/event-candidates";

type Action = (input: DeskMutation) => Promise<DeskResult>;
type MergeReview = { otherId: string; groups: EventMergePreview };
type GroupChange = Extract<DeskMutation, { intent: "event-split" | "event-lead" }>;

export function EventCoverage({source,mutate}:{source:DeskSource;mutate:Action}) {
  // A different source must never inherit another source's reviewed snapshot.
  return <EventCoverageGroup key={source.id} source={source} mutate={mutate} />;
}

function EventCoverageGroup({source,mutate}:{source:DeskSource;mutate:Action}) {
  const [event,setEvent]=useState<EventContext|null>(null);
  const [candidates,setCandidates]=useState<EventSource[]>([]);
  const [matches,setMatches]=useState<EventSource[]>([]);
  const [term,setTerm]=useState('');
  const [searched,setSearched]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const [mergeReview,setMergeReview]=useState<MergeReview|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const [reloadOtherId,setReloadOtherId]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    setBusy(true);setMessage('');setError(false);setEvent(null);setCandidates([]);setMatches([]);setSearched(false);
    setMergeReview(null);setReviewed(false);setReloadOtherId(null);
    void mutate({intent:'event-detail',id:source.id}).then(result=>{
      if (!active) return;
      if (result.ok && result.event) {setEvent(result.event);setCandidates(result.candidates||[]);}
      else {setError(true);setMessage(result.message||'Private group unavailable.');}
    }).catch(()=>{if(active){setError(true);setMessage('Private group unavailable. Retry by reopening the preview.');}})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[source.id,mutate]);
  async function refresh() {
    const result=await mutate({intent:'event-detail',id:source.id});
    if (!result.ok || !result.event) {setError(true);setMessage(result.message||'Private group unavailable.');return;}
    setEvent(result.event);setCandidates(result.candidates||[]);setMatches([]);setSearched(false);
  }
  async function change(input:GroupChange) {
    if (busy || mergeReview) return;
    setBusy(true);setError(false);setMessage('');
    try {
      const result=await mutate(input);
      setMessage(result.message);setError(!result.ok);
      if (result.ok) await refresh();
    } catch {setError(true);setMessage('Could not save this private group. Try again.');}
    finally {setBusy(false);}
  }
  async function reviewMerge(otherId:string) {
    if (busy) return;
    setBusy(true);setError(false);setMessage('');setMergeReview(null);setReviewed(false);setReloadOtherId(null);
    try {
      const result=await mutate({intent:'event-merge-preview',id:source.id,otherId});
      if (result.ok && result.mergePreview) {
        setMergeReview({otherId,groups:result.mergePreview});
        setEvent(result.mergePreview.target);
      } else {setReloadOtherId(otherId);setError(true);setMessage(result.message||'Could not load both private groups.');}
    } catch {setReloadOtherId(otherId);setError(true);setMessage('Could not load both private groups. Reload them before reviewing the merge again.');}
    finally {setBusy(false);}
  }
  function cancelMerge() {
    setMergeReview(null);setReviewed(false);setReloadOtherId(null);setMessage('');setError(false);
  }
  async function confirmMerge() {
    if (busy || !mergeReview || !reviewed || mergeReview.groups.target.members.length+mergeReview.groups.other.members.length>20) return;
    const {otherId,groups}=mergeReview;
    if (!groups.target.members.some(member=>member.id===source.id)) return;
    setBusy(true);setError(false);setMessage('');
    try {
      // Submit the snapshot actually displayed. Never refresh or adopt new
      // versions on the way to confirmation, even if another editor changed it.
      const result=await mutate({
        intent:'event-merge',id:source.id,otherId,
        expectedTarget:{eventId:groups.target.eventId,version:groups.target.version},
        expectedOther:{eventId:groups.other.eventId,version:groups.other.version},
      });
      setMergeReview(null);setReviewed(false);
      setReloadOtherId(result.ok?null:otherId);
      setMessage(result.message);setError(!result.ok);
      if (result.ok) await refresh();
    } catch {
      setMergeReview(null);setReviewed(false);setReloadOtherId(otherId);setError(true);
      setMessage('Could not confirm this merge. Reload both groups and review them again before trying to merge.');
    } finally {setBusy(false);}
  }
  async function search(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(busy || mergeReview)return;
    setBusy(true);setError(false);setMessage('');
    try {
      const result=await mutate({intent:'event-search',id:source.id,term});
      if(result.ok){setMatches(result.matches||[]);setSearched(true);}
      else {setError(true);setMessage(result.message);}
    } catch {setError(true);setMessage('Could not search stored article metadata. Try again.');}
    finally {setBusy(false);}
  }
  const list=(items:EventSource[],kind:'suggestion'|'search')=> <ul className="desk-event-list">{items.map(item=><li key={item.id} className={kind==='search'?'desk-event-search-result':'desk-event-suggestion'}>
    <strong>{item.title}</strong><span className="desk-meta">{item.source_name} · {item.source_published_at.slice(0,10)}</span>
    <div className="desk-card-actions"><a className="text-button" href={item.url} target="_blank" rel="noreferrer">Read original ↗</a><button type="button" className="button secondary" disabled={busy||!!mergeReview} onClick={()=>void reviewMerge(item.id)}>Review merge</button></div>
  </li>)}</ul>;
  const reviewGroup=(group:EventContext,label:string)=> <section aria-label={label}>
    <h5>{label} · {group.members.length} {group.members.length===1?'source':'sources'}</h5>
    <ul className="desk-event-list">{group.members.map(member=><li key={member.id}>
      <strong>{member.title}</strong><span className="desk-meta">{member.source_name} · {member.source_published_at.slice(0,10)}{group.leadSourceId===member.id?' · Lead (private)':''}</span>
      <a className="text-button" href={member.url} target="_blank" rel="noreferrer">Read original ↗</a>
    </li>)}</ul>
  </section>;
  const mergedCount=mergeReview?mergeReview.groups.target.members.length+mergeReview.groups.other.members.length:0;
  const proposedLead=mergeReview?.groups.target.members.find(member=>member.id===source.id);
  return <section className="desk-event-coverage" aria-label="Related coverage">
    <h3>Related coverage</h3>
    <p className="desk-hint">Private editor organization only. Grouping is not independent confirmation, does not change a draft or public story, and never runs a model.</p>
    {event ? <>
      <p><strong>{event.members.length} {event.members.length===1?'source':'sources'} in this private group</strong></p>
      <ul className="desk-event-list">{event.members.map(member=><li key={member.id} className="desk-event-member">
        <strong>{member.title}</strong><span className="desk-meta">{member.source_name} · {member.source_published_at.slice(0,10)}{event.leadSourceId===member.id?' · Lead (private)':''}</span>
        <div className="desk-card-actions"><a className="text-button" href={member.url} target="_blank" rel="noreferrer">Read original ↗</a>
          {event.leadSourceId!==member.id&&<button type="button" className="text-button" disabled={busy||!!mergeReview} onClick={()=>void change({intent:'event-lead',id:member.id})}>Choose as lead</button>}
          {event.members.length>1&&<button type="button" className="text-button" disabled={busy||!!mergeReview} onClick={()=>void change({intent:'event-split',id:member.id})}>Remove from group</button>}
        </div>
      </li>)}</ul>
      {mergeReview&&<section className="desk-event-merge-review" aria-label="Review group merge">
        <h4>Review group merge</h4>
        <p>Compare every original article below. Confirmation applies only to these reviewed group versions.</p>
        {reviewGroup(mergeReview.groups.target,'Current group')}
        {reviewGroup(mergeReview.groups.other,'Incoming group')}
        <p><strong>{mergedCount} sources after merging</strong></p>
        <p>Proposed lead: {proposedLead?.title||'Unavailable — reload this source.'}</p>
        {mergedCount>20&&<p className="desk-invalid">Group at most 20 sources. Cancel and split a group before reviewing another merge.</p>}
        <label className="editor-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)} />I reviewed every source in both groups.</label>
        <div className="desk-card-actions">
          <button type="button" className="button primary" disabled={busy||!reviewed||!proposedLead||mergedCount>20} onClick={()=>void confirmMerge()}>Confirm merge</button>
          <button type="button" className="button secondary" disabled={busy} onClick={cancelMerge}>Cancel merge</button>
        </div>
      </section>}
      <h4>Possible related coverage (not verified)</h4>
      {candidates.length?list(candidates,'suggestion'):<p className="desk-hint">No strong metadata matches. Search your stored articles instead.</p>}
      <form className="desk-event-search" onSubmit={e=>void search(e)}>
        <label>Find another stored article<input type="search" minLength={3} maxLength={80} required disabled={busy||!!mergeReview} value={term} onChange={e=>setTerm(e.target.value)} /></label>
        <button type="submit" className="button secondary" disabled={busy||!!mergeReview||term.trim().length<3}>Search coverage</button>
      </form>
      {searched&&(matches.length?list(matches,'search'):<p className="desk-hint">No other stored articles match that search.</p>)}
    </>:<p className="desk-hint">Loading private group…</p>}
    {message&&<p role={error?'alert':'status'} className={error?'desk-invalid':'desk-hint'}>{message}</p>}
    {reloadOtherId&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void reviewMerge(reloadOtherId)}>Reload groups</button>}
  </section>;
}
