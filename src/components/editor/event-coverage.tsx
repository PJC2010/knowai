"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { DeskMutation, DeskResult, DeskSource, EventContext } from "@/lib/editorial/desk-types";
import type { EventSource } from "@/lib/editorial/event-candidates";

type Action = (input: DeskMutation) => Promise<DeskResult>;

export function EventCoverage({source,mutate}:{source:DeskSource;mutate:Action}) {
  const [event,setEvent]=useState<EventContext|null>(null);
  const [candidates,setCandidates]=useState<EventSource[]>([]);
  const [matches,setMatches]=useState<EventSource[]>([]);
  const [term,setTerm]=useState('');
  const [searched,setSearched]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  useEffect(()=>{
    let active=true;
    setBusy(true);setMessage('');setEvent(null);setCandidates([]);setMatches([]);setSearched(false);
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
  async function change(input:DeskMutation) {
    if (busy) return;
    if (input.intent==='event-merge' && !window.confirm('Merge both private coverage groups? Compare the original articles first. This does not change drafts or public stories.')) return;
    setBusy(true);setError(false);setMessage('');
    try {
      const result=await mutate(input);
      setMessage(result.message);setError(!result.ok);
      if (result.ok) await refresh();
    } catch {setError(true);setMessage('Could not save this private group. Try again.');}
    finally {setBusy(false);}
  }
  async function search(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(busy)return;
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
    <div className="desk-card-actions"><a className="text-button" href={item.url} target="_blank" rel="noreferrer">Read original ↗</a><button type="button" className="button secondary" disabled={busy} onClick={()=>void change({intent:'event-merge',id:source.id,otherId:item.id})}>Merge private groups</button></div>
  </li>)}</ul>;
  return <section className="desk-event-coverage" aria-label="Related coverage">
    <h3>Related coverage</h3>
    <p className="desk-hint">Private editor organization only. Grouping is not independent confirmation, does not change a draft or public story, and never runs a model.</p>
    {event ? <>
      <p><strong>{event.members.length} {event.members.length===1?'source':'sources'} in this private group</strong></p>
      <ul className="desk-event-list">{event.members.map(member=><li key={member.id} className="desk-event-member">
        <strong>{member.title}</strong><span className="desk-meta">{member.source_name} · {member.source_published_at.slice(0,10)}{event.leadSourceId===member.id?' · Lead (private)':''}</span>
        <div className="desk-card-actions"><a className="text-button" href={member.url} target="_blank" rel="noreferrer">Read original ↗</a>
          {event.leadSourceId!==member.id&&<button type="button" className="text-button" disabled={busy} onClick={()=>void change({intent:'event-lead',id:member.id})}>Choose as lead</button>}
          {event.members.length>1&&<button type="button" className="text-button" disabled={busy} onClick={()=>void change({intent:'event-split',id:member.id})}>Remove from group</button>}
        </div>
      </li>)}</ul>
      <h4>Possible related coverage (not verified)</h4>
      {candidates.length?list(candidates,'suggestion'):<p className="desk-hint">No strong metadata matches. Search your stored articles instead.</p>}
      <form className="desk-event-search" onSubmit={e=>void search(e)}>
        <label>Find another stored article<input type="search" minLength={3} maxLength={80} required value={term} onChange={e=>setTerm(e.target.value)} /></label>
        <button type="submit" className="button secondary" disabled={busy||term.trim().length<3}>Search coverage</button>
      </form>
      {searched&&(matches.length?list(matches,'search'):<p className="desk-hint">No other stored articles match that search.</p>)}
    </>:<p className="desk-hint">Loading private group…</p>}
    {message&&<p role={error?'alert':'status'} className={error?'desk-invalid':'desk-hint'}>{message}</p>}
  </section>;
}
