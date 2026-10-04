"use client";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeskData, DeskMutation, DeskQuery, DeskResult, DeskSource } from "@/lib/editorial/desk-types";
import { SourceCard, QueueControls } from "./inbox";
import { DeskDialog, ChargeNotice, LimitReachedNotice } from "./dialog";
import { ReviewWorkspace, type DeskAction } from "./review-workspace";
import { deskHref } from "./workspace-state";
import { DailyLimitSettings } from "./daily-limit-settings";

// Queue scroll only, in memory. Never store private draft content in browser storage.
const queueScroll = new Map<string, number>();
export function EditorDesk({ data, query, mutate, signOut }: { data: DeskData; query: DeskQuery; mutate: DeskAction; signOut: ReactNode }) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<DeskSource | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; state: DeskSource["triage"] } | null>(null);
  const [paid, setPaid] = useState<DeskMutation | null>(null);
  const [charge, setCharge] = useState(false);
  const [selectedIds, setSelectedIds] = useState(data.selectedIds);
  const [usage, setUsage] = useState({ attempts: data.attemptsToday, limit: data.dailyAttemptLimit });
  useEffect(() => { setUsage({ attempts: data.attemptsToday, limit: data.dailyAttemptLimit }); }, [data.attemptsToday, data.dailyAttemptLimit]);
  const view = ["drafts", "published", "sources"].includes(query.view || "") ? query.view! : "inbox";
  const queueUrl = deskHref(query, { id: undefined });
  const active = data.active;
  useEffect(() => { setSelectedIds(data.selectedIds); }, [data.selectedIds]);
  useEffect(() => {
    if (!active) {
      const y = queueScroll.get(queueUrl);
      if (y !== undefined) requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
    }
  }, [active, queueUrl]);
  useEffect(() => {
    if (active || pending || (!data.counts.queued && !data.jobs.some(job => ["running", "fetching", "generating"].includes(job.state)))) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && polls++ < 24) startNavigation(() => router.refresh());
      if (polls >= 24) window.clearInterval(timer);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [active, pending, data.counts.queued, data.jobs, router]);
  async function perform(input: DeskMutation): Promise<DeskResult> {
    if (pendingRef.current) return { ok: false, message: "A request is already running." };
    pendingRef.current = true; setPending(true); setMessage(""); setFailed(false);
    try {
      const result = await mutate(input);
      setMessage(result.message); setFailed(!result.ok);
      setUsage(previous => ({ attempts: Number.isSafeInteger(result.attemptsToday) ? result.attemptsToday! : previous.attempts, limit: Number.isSafeInteger(result.dailyAttemptLimit) && result.dailyAttemptLimit! >= 1 && result.dailyAttemptLimit! <= 1000 ? result.dailyAttemptLimit! : previous.limit }));
      if (result.ok) startNavigation(() => router.refresh());
      return result;
    } catch {
      const result = { ok: false, message: "Could not complete the request. Check your connection and try again.", code: "failed" as const };
      setMessage(result.message); setFailed(true); return result;
    } finally { pendingRef.current = false; setPending(false); }
  }
  function open(id: string) {
    if (!active) queueScroll.set(queueUrl, window.scrollY);
    startNavigation(() => router.push(deskHref(query, { id }), { scroll: true }));
  }
  function askCharge(input: DeskMutation) { setCharge(false); setPaid(input); }
  async function triage(source: DeskSource, state: DeskSource["triage"]) {
    const previous = selectedIds.includes(source.id) ? "selected" : source.triage;
    const result = await perform({ intent: "triage", ids: [source.id], state });
    if (result.ok) {
      setSelectedIds(ids => state === "selected" ? [...new Set([...ids, source.id])] : ids.filter(id => id !== source.id));
      setUndo({ ids: [source.id], state: previous });
    }
  }
  const working = pending || navigating;
  if (active) return <div className="editor-desk desk-focused"><ReviewWorkspace key={active.id} revision={active} history={data.history} revisions={data.revisions} attempts={usage.attempts} limit={usage.limit} mutate={mutate} historyLoading={navigating} refreshHistory={() => startNavigation(() => router.refresh())} onBack={() => startNavigation(() => router.push(queueUrl, { scroll: false }))} onOpen={open} /></div>;
  return <div className="editor-desk" aria-busy={working}>
    <header className="desk-heading"><div><span className="eyebrow">Private editorial desk</span><h1>{view === "sources" ? "Publisher settings" : view === "published" ? "Out in the world." : view === "drafts" ? "Make it worth reading." : "Find the next good story."}</h1><p>{view === "inbox" ? "Discover. Select. Then draft — on your terms." : view === "drafts" ? "Check the source. Find the voice. Publish with confidence." : view === "published" ? "Published stories stay stable while you work on the next revision." : "Approved publishers, discovery health, and drafting preferences."}</p></div><div className="desk-heading-actions">{view !== "published" && <button className="button secondary" disabled={working} onClick={() => void perform({ intent: "discover" })}>{pending ? "Discovering…" : "Refresh sources"}</button>}{signOut}</div></header>
    <nav className="desk-navigation" aria-label="Editorial navigation">{([['inbox', 'Inbox', data.counts.inbox], ['drafts', 'Drafts', data.counts.drafts], ['published', 'Published', data.counts.published], ['sources', 'Sources', null]] as const).map(([key, label, count]) => <Link key={key} href={deskHref({ view: key })} aria-current={view === key ? "page" : undefined}>{label}{count !== null && <span>{count}</span>}</Link>)}</nav>
    <div className="desk-status-line"><span>Refresh discovers stories only. No model charges.</span><span>{usage.attempts} / {usage.limit} attempts today · {Math.max(0, usage.limit - usage.attempts)} remaining</span></div>
    <LimitReachedNotice attempts={usage.attempts} limit={usage.limit} />
    {(message || pending) && <div className={`desk-feedback ${failed ? "desk-save-error" : ""}`} role={failed ? "alert" : "status"}><span>{pending ? "Working… please keep this page open." : message}</span>{undo && !pending && <button className="text-button" onClick={async () => { const result = await perform({ intent: "triage", ...undo }); if (result.ok) setUndo(null); }}>Undo last triage</button>}</div>}
    {view === "sources" ? <section className="desk-settings" aria-label="Publisher settings">
      <DailyLimitSettings limit={usage.limit} busy={working} save={(limit, confirmCharge) => perform({ intent: "daily-cap", limit, confirmCharge })} />
      <div className="desk-settings-intro"><h2>Discovery is free of model calls.</h2><p>Enable the approved feeds you want to consider. Turning off a feed pauses future discovery; it does not delete stories or publish anything.</p></div>
      <div className="desk-publishers">{data.publishers.map(publisher => <article className="desk-publisher" key={publisher.id}><div className="desk-publisher-heading"><h2>{publisher.name}</h2><label className="desk-toggle"><input type="checkbox" role="switch" checked={publisher.enabled} disabled={working} onChange={e => void perform({ intent: "publisher", id: publisher.id, enabled: e.target.checked })} /><span>{publisher.enabled ? "Enabled" : "Disabled"}<span className="sr-only">: {publisher.name}</span></span></label></div><a href={publisher.feed_url} target="_blank" rel="noreferrer">{publisher.feed_url} ↗</a><dl><div><dt>Last attempt</dt><dd>{publisher.last_attempt_at ? `${publisher.last_attempt_at.slice(0, 16).replace("T", " ")} UTC` : "Not yet checked"}</dd></div><div><dt>Last successful refresh</dt><dd>{publisher.last_success_at ? `${publisher.last_success_at.slice(0, 16).replace("T", " ")} UTC` : "No successful refresh yet"}</dd></div></dl>{publisher.last_error && <p className="desk-invalid">{publisher.last_error}</p>}</article>)}</div>
      <section className="desk-setting-section"><h2>Import an article</h2><p className="desk-hint">Approved HTTPS publishers only: OpenAI, Google, Hugging Face, and TechCrunch. Import fetches metadata without a model call. An original publication date is required.</p><form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; const url = String(new FormData(form).get("url") || ""); const result = await perform({ intent: "import-url", url }); if (result.ok) form.reset(); }}><label>Article URL<input name="url" type="url" required placeholder="https://openai.com/…" /></label><button className="button secondary" disabled={working}>Import to inbox</button></form></section>
      <section className="desk-setting-section"><h2>Drafting preference</h2><label className="desk-toggle"><input type="checkbox" role="switch" checked={data.autoDraft} disabled={working} onChange={e => e.target.checked ? askCharge({ intent: "auto-draft", enabled: true, confirmCharge: false }) : void perform({ intent: "auto-draft", enabled: false, confirmCharge: false })} /><span>Automatic drafting</span></label><p className="desk-hint">Recommended: leave off and choose stories yourself. Enabling automatic drafting authorizes model charges during scheduled runs, within the daily cap. Publishing always requires your review.</p></section>
    </section> : <>
      <QueueControls query={{ ...query, view }} publishers={data.publishers} total={data.total} page={data.page} pageSize={data.pageSize} onFilter={next => startNavigation(() => router.push(deskHref(next)))} />
      {view === "drafts" && <div className="desk-attention"><Link href={deskHref(query, { status: "needs_review", page: undefined })}>Needs review <span>{data.counts.drafts}</span></Link><Link href={deskHref(query, { status: "failed", page: undefined })}>Failed <span>{data.counts.failed}</span></Link><Link href={deskHref(query, { status: "queued", page: undefined })}>Queued / held <span>{data.counts.queued}</span></Link><Link href={deskHref(query, { status: "rejected", page: undefined })}>Rejected <span>{data.counts.rejected}</span></Link></div>}
      <div className="desk-story-list">{view === "inbox" ? data.sources.map(source => <SourceCard key={source.id} source={source} selected={selectedIds.includes(source.id)} pending={working} onTriage={(s, state) => void triage(s, state)} onPreview={setPreview} />) : ["failed", "queued"].includes(query.status || "") ? data.jobs.map(job => <article className="desk-story" key={job.id}><div className="desk-meta"><span>{job.source_name}</span><time dateTime={job.created_at}>Attempt {job.created_at.slice(0, 10)}</time><span>{job.state.replaceAll("_", " ")}{!job.selected && " · held, not selected"}</span></div><h2>{job.title}</h2>{job.error && <p className="desk-invalid">{job.error}</p>}{job.cost !== null && <p className="desk-hint">Reported cost: ${job.cost.toFixed(6)}</p>}<div className="desk-card-actions"><a className="text-button" href={job.source_url} target="_blank" rel="noreferrer">Original source ↗</a><button className="button secondary" disabled={working} onClick={() => void perform({ intent: "triage", ids: [job.story_id], state: "selected" })}>{job.selected ? "Keep selected" : "Select this story"}</button><button className="button primary" disabled={working || usage.attempts >= usage.limit} onClick={() => askCharge({ intent: "regenerate", id: job.story_id, confirmCharge: false })}>Retry this story</button></div>{!job.selected && <p className="desk-hint">Legacy work is held. It will not run unless you explicitly select or retry this story.</p>}</article>) : data.revisions.map(revision => <article className="desk-story" key={revision.id}><div className="desk-meta"><span>{revision.brief_sources.source_name}</span><time dateTime={revision.brief_sources.source_published_at}>{revision.brief_sources.source_published_at.slice(0, 10)}</time><span>{revision.brief_sources.category}</span></div><h2><Link className="desk-headline" href={deskHref(query, { id: revision.id })} onClick={event => { if (!event.ctrlKey && !event.metaKey) { event.preventDefault(); open(revision.id); } }}>{revision.content.oneLiner || revision.brief_sources.title}</Link></h2><p className="desk-hint">{revision.state.replaceAll("_", " ")} · version {revision.version}</p><button className="button secondary" onClick={() => open(revision.id)}>{revision.state === "needs_review" ? "Review draft →" : "Open revision →"}</button></article>)}</div>
      {data.total === 0 && <div className="desk-empty"><h2>{view === "inbox" ? "Nothing in this view yet." : "A clear desk."}</h2><p>{query.q || query.publisher || query.category || query.since ? "Try clearing a filter to see more stories." : view === "inbox" ? "Refresh your sources to discover stories, or bring an approved article into Sources." : "Select stories in the inbox, then generate the drafts you want to work on."}</p><Link className="button secondary" href={deskHref({ view: "inbox" })}>Go to inbox</Link></div>}
      {view === "drafts" && query.status === "queued" && <div className="desk-setting-section"><p>Only explicitly selected queued work will run. Older, unselected jobs remain held.</p><button className="button primary" disabled={working || usage.attempts >= usage.limit} onClick={() => askCharge({ intent: "run-queued", confirmCharge: false })}>Run selected queued jobs</button></div>}
      {view === "inbox" && selectedIds.length > 0 && <section className="desk-selection-tray" aria-label="Selected stories"><div><strong>{selectedIds.length} {selectedIds.length === 1 ? "story" : "stories"} selected</strong><small>200-story selection limit · up to 3 drafts per batch</small></div><Link className="text-button" href={deskHref({ view: "inbox", status: "selected" })}>View selected</Link><button className="button primary" disabled={working || usage.attempts >= usage.limit} onClick={() => askCharge({ intent: "generate", ids: selectedIds, confirmCharge: false })}>Generate selected drafts</button></section>}
    </>}
    <DeskDialog open={!!preview} onClose={() => setPreview(null)} title={preview?.title || "Source preview"} description="Original publisher metadata. This is not an AI summary or a verified factual assessment." reader>{preview && <><div className="desk-meta"><span>{preview.source_name}</span><time dateTime={preview.source_published_at}>{preview.source_published_at.slice(0, 10)}</time><span>{preview.category}</span></div><p>{preview.excerpt || "No excerpt has been captured yet. Open the original article before selecting it."}</p><a className="button secondary" href={preview.url} target="_blank" rel="noreferrer">Read original source ↗</a></>}</DeskDialog>
    <DeskDialog open={!!paid} onClose={() => setPaid(null)} busy={pending} title={paid?.intent === "auto-draft" ? "Enable automatic drafting?" : "Generate with AI?"} description={paid?.intent === "auto-draft" ? "This authorizes recurring model attempts during scheduled runs. You can turn it off in Sources at any time." : "Only the stories you selected or explicitly requested will be processed. Generating does not publish."}><ChargeNotice attempts={usage.attempts} limit={usage.limit} /><label className="editor-check"><input type="checkbox" checked={charge} onChange={e => setCharge(e.target.checked)} />I understand this may incur model charges.</label><div className="desk-card-actions"><button className="button secondary" disabled={pending} onClick={() => setPaid(null)}>Cancel</button><button className="button primary" disabled={!charge || pending || usage.attempts >= usage.limit} onClick={async () => { if (!paid || !("confirmCharge" in paid)) return; const result = await perform({ ...paid, confirmCharge: true }); if (result.ok) { setPaid(null); if (result.revisionId) open(result.revisionId); } }}>{pending ? "Generating…" : paid?.intent === "auto-draft" ? "Enable automatic drafting" : "Confirm generation"}</button></div><p role="status">{message}</p></DeskDialog>
  </div>;
}
