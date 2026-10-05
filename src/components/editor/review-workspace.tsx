"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { uploadDeskImage } from "@/app/editor/desk-actions";
import { BriefFeed } from "@/components/brief-feed";
import { validateTiers, type BriefStory, type Tiers } from "@/lib/brief";
import type { DeskData, DeskHistory, DeskMutation, DeskResult, DeskRevision } from "@/lib/editorial/desk-types";
import { createDraftSession, canPublish, quoteMatches, acceptSuggestion, contentDiff } from "./workspace-state";
import { WritePanel, type Tier, type WritingField, fieldLabels } from "./panels";
import { DeskDialog, ChargeNotice, LimitReachedNotice } from "./dialog";
import { useNavigationGuard } from "./navigation-guard";
import { StoryImageSelector, type ImageRequest, type StoryImageSelection } from "./story-image-selector";
import { WeeklyFeature } from "./weekly-feature";

export type DeskAction = (input: DeskMutation) => Promise<DeskResult>;
export function ReviewWorkspace({ revision, history, revisions, attempts, limit, mutate, onBack, onOpen, refreshHistory, historyLoading }: {
  revision: DeskRevision; history: DeskHistory[]; revisions: DeskData["revisions"]; attempts: number; limit: number;
  mutate: DeskAction; onBack: () => void; onOpen: (id: string) => void;
  refreshHistory: () => void; historyLoading: boolean;
}) {
  // Server HTML is visible before React attaches controlled-input handlers.
  // Keep edits read-only until hydration so early typing cannot be overwritten.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [session] = useState(() => createDraftSession(revision.content, revision.version,
    (content, version) => mutate({ intent: "save", id: revision.id, version, content })));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [tab, setTab] = useState<"write" | "evidence" | "preview">("write");
  const [tier, setTier] = useState<Tier>("oneLiner");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [quote, setQuote] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<"publish" | "reject" | "regenerate" | null>(null);
  const [charge, setCharge] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState(revision.state);
  const [slug, setSlug] = useState<string | null>(null);
  const [suggestField, setSuggestField] = useState<WritingField | null>(null);
  const [instruction, setInstruction] = useState<"simplify" | "shorten" | "alternative">("simplify");
  const [suggestion, setSuggestion] = useState<{ field: WritingField; before: string | string[]; value: string | string[]; cost: number | null } | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(attempts);
  const [dailyLimit, setDailyLimit] = useState(limit);
  useEffect(() => { setAttemptsUsed(attempts); setDailyLimit(limit); }, [attempts, limit]);
  const source = revision.brief_sources;
  const [initialImage] = useState<StoryImageSelection>(() => ({ url: revision.image_url || null, alt: revision.image_alt || "", source: revision.image_source || (revision.image_url ? "source" : "none") }));
  const [image, setImage] = useState(initialImage);
  const [imageDirty, setImageDirty] = useState(false);
  const imageChanged = useCallback((selection: StoryImageSelection, dirty: boolean) => {
    setImage(selection); setImageDirty(dirty);
    if (dirty) session.invalidateReview();
  }, [session]);
  const editable = hydrated && decision === "needs_review";
  const errors = validateTiers(state.content, revision.source_text);
  const guard = useNavigationGuard(state.dirty || imageDirty || state.saving || busy, state.saving || busy, () => session.pauseAutosave());
  const matches = quoteMatches(revision.source_text, quote);
  const sourceText = useRef<HTMLDivElement>(null);
  const ready = editable && !busy && !imageDirty && !suggestion && canPublish(state, errors);
  const next = revisions.find(r => r.id !== revision.id && r.state === "needs_review");

  useEffect(() => {
    if (!editable || !state.dirty || state.saving || state.paused || state.error || busy) return;
    const timer = window.setTimeout(() => { void session.save(); }, 900);
    return () => window.clearTimeout(timer);
  }, [session, editable, state.dirty, state.content, state.saving, state.paused, state.error, busy]);
  useEffect(() => {
    if (!sourceOpen || !quote) return;
    const timer = window.setTimeout(() => {
      const mark = sourceText.current?.querySelectorAll<HTMLElement>("mark")[matchIndex];
      if (mark && sourceText.current) sourceText.current.scrollTop = Math.max(0, mark.offsetTop - sourceText.current.offsetTop - 60);
      mark?.focus({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [sourceOpen, quote, matchIndex]);

  async function run(input: DeskMutation): Promise<DeskResult> {
    if (busyRef.current) return { ok: false, message: "Wait for the current request." };
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      const result = await mutate(input);
      setMessage(result.message);
      if (typeof result.attemptsToday === "number") setAttemptsUsed(result.attemptsToday);
      if (Number.isSafeInteger(result.dailyAttemptLimit) && result.dailyAttemptLimit! >= 1 && result.dailyAttemptLimit! <= 1000) setDailyLimit(result.dailyAttemptLimit!);
      if (result.code === "conflict") session.serverConflict(result);
      return result;
    } catch {
      const result = { ok: false, message: "The request could not finish. Your text is still here. Please retry.", code: "failed" as const };
      setMessage(result.message); return result;
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function changeImage(request: ImageRequest | "refresh"): Promise<DeskResult> {
    if (busyRef.current || !editable) return { ok: false, message: "Wait for the current request." };
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      if (!await session.save()) return { ok: false, message: "Save your text changes before changing the image." };
      const version = session.getSnapshot().version;
      let result: DeskResult;
      if (request === "refresh") result = await mutate({ intent: "refresh-image", id: revision.id, version });
      else if (request.file) {
        const form = new FormData();
        form.set("id", revision.id); form.set("version", String(version));
        form.set("imageAlt", request.alt); form.set("image", request.file);
        result = await uploadDeskImage(form);
      } else result = await mutate({ intent: "image", id: revision.id, version, imageSource: request.source, imageUrl: request.url, imageAlt: request.alt });
      if (result.code === "conflict") session.serverConflict(result);
      if (result.ok && (!result.version || !session.acceptSavedVersion(result.version))) {
        const error: DeskResult = { ok: false, code: "conflict", message: "The saved image version could not be confirmed. Reload the latest draft before publishing." };
        session.serverConflict(error); return error;
      }
      setMessage(result.message);
      return result;
    } catch { return { ok: false, code: "failed", message: "The image could not be saved. Your selection is still here; try again." }; }
    finally { busyRef.current = false; setBusy(false); }
  }
  function showSource(value = "") { setQuote(value); setMatchIndex(0); setSourceOpen(true); }
  function edit(content: Tiers) { session.edit(content); setMessage(""); }
  function openRevision(id: string) { if (guard.canLeave()) { guard.allow(); onOpen(id); } }
  async function decide() {
    if (!confirmation) return;
    if (confirmation === "publish") {
      if (!ready) return;
      const result = await run({ intent: "publish", id: revision.id, version: state.version, sourceChecked: state.sourceChecked, tiersChecked: state.tiersChecked });
      if (result.ok) { setDecision("published"); setSlug(result.slug || source.slug); setConfirmation(null); }
    } else if (confirmation === "reject") {
      if (!await session.save()) return;
      const result = await run({ intent: "reject", id: revision.id, version: session.getSnapshot().version });
      if (result.ok) { setDecision("rejected"); setConfirmation(null); }
    } else {
      if (!charge || !await session.save()) return;
      const result = await run({ intent: "regenerate", id: revision.story_id, confirmCharge: true });
      // Usage is reported by the server; a failed request may not reserve an attempt.
      if (result.ok) { setConfirmation(null); if (result.revisionId) { guard.allow(); onOpen(result.revisionId); } }
    }
  }
  async function requestSuggestion() {
    if (!suggestField || !charge || !await session.save()) return;
    const current = session.getSnapshot();
    const field = suggestField;
    const result = await run({ intent: "suggest", id: revision.id, version: current.version, field, instruction, confirmCharge: true });
    // Usage is reported by the server; a failed request may not reserve an attempt.
    if (result.ok && result.suggestion && result.suggestion.field === field) {
      setSuggestion({ ...result.suggestion, before: current.content[field] }); setSuggestField(null);
    }
  }
  function issue(error: string) {
    if (error.includes("one-liner")) { setTab("write"); setTier("oneLiner"); }
    else if (error.includes("short version")) { setTab("write"); setTier("shortVersion"); }
    else if (error.includes("whole picture")) { setTab("write"); setTier("wholePicture"); }
    else if (error.includes("Why it matters")) setTab("write");
    else setTab("evidence");
    window.setTimeout(() => document.querySelector<HTMLElement>(error.includes("Why it matters") ? "#field-whyItMatters" : ".desk-work-panel textarea")?.focus(), 0);
  }
  const preview: BriefStory = { id: revision.story_id, slug: source.slug, source_url: source.url, source_name: source.source_name, source_published_at: source.source_published_at, category: source.category, one_liner: state.content.oneLiner, short_version: state.content.shortVersion, whole_picture: state.content.wholePicture, why_it_matters: state.content.whyItMatters, published_at: revision.created_at, updated_at: revision.created_at, edition_date: revision.created_at.slice(0, 10), image_url: image.url, image_alt: image.alt };
  const text = (value: string | string[]) => Array.isArray(value) ? value.join("\n\n") : value;

  return <section className="desk-workspace" aria-label="Story workspace">
    <LimitReachedNotice attempts={attemptsUsed} limit={dailyLimit} /><div className="desk-work-top"><button className="text-button" onClick={() => { if (guard.canLeave()) { guard.allow(); onBack(); } }}>← Back to queue</button><span className="desk-state">{decision.replaceAll("_", " ")} · v{state.version}</span></div>
    <header className="desk-work-heading"><div className="desk-meta"><span>{source.source_name}</span><time dateTime={source.source_published_at}>{source.source_published_at.slice(0, 10)}</time><span>{source.category}</span></div><h1>{source.title}</h1><div className="desk-card-actions"><button className="button secondary" onClick={() => showSource()}>Original source ↗</button><button className="text-button" disabled={busy || state.saving} onClick={async () => { if (await session.save()) { setHistoryOpen(true); refreshHistory(); } }}>Revision history</button></div></header>
    {decision !== "needs_review" && <div className="desk-outcome" role="status"><h2>{decision === "published" ? "This story is published." : "This draft was rejected."}</h2><p>{decision === "published" ? "The public story stays unchanged until another revision is explicitly approved." : "Existing public content has not changed."}</p><div className="desk-card-actions">{slug && <a className="button secondary" href={`/brief/${slug}`} target="_blank" rel="noreferrer">View published story ↗</a>}<button className="button secondary" disabled={busy} onClick={async () => { const result = await run({ intent: "fork", id: revision.id }); if (result.ok && result.revisionId) { guard.allow(); onOpen(result.revisionId); } }}>Create an editable revision</button>{next ? <button className="button primary" onClick={() => openRevision(next.id)}>Next draft →</button> : <button className="button primary" onClick={onBack}>Back to queue →</button>}</div></div>}
    {decision === "published" && <WeeklyFeature initialWeek={source.featured_week || null} disabled={!hydrated || busy} onFeature={week => run({ intent: "feature", id: revision.id, week })} />}
    <div className="desk-work-layout"><div className="desk-work-main">
      <div className="desk-work-tabs" role="tablist" aria-label="Workspace view">{(["write", "evidence", "preview"] as const).map((value, i) => <button id={`tab-${value}`} key={value} role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) { event.preventDefault(); const tabs = ["write", "evidence", "preview"] as const; const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (i + (event.key === "ArrowRight" ? 1 : 2)) % 3; setTab(tabs[index]); document.getElementById(`tab-${tabs[index]}`)?.focus(); } }}>{["Write", "Evidence", "Preview"][i]}{value === "evidence" && <span>{state.content.evidence.length}</span>}</button>)}</div>
      <div className="desk-work-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <div hidden={tab !== "write"}><WritePanel content={state.content} tier={tier} readOnly={!editable || busy} onTier={setTier} onEdit={edit} onSuggest={field => { setCharge(false); setSuggestField(field); }} /><StoryImageSelector initial={initialImage} sourceUrl={source.source_image_url || null} disabled={!editable || busy || !!state.error} onChange={imageChanged} onSave={changeImage} onRefresh={() => changeImage("refresh")} /></div>
        {tab === "evidence" && <div className="desk-evidence"><h2>Trace every claim.</h2><p className="desk-hint">An exact excerpt match is not a fact check. Read the original and verify each claim in context.</p>{state.content.evidence.map((item, index) => {
          const found = quoteMatches(revision.source_text, item.quote);
          return <article className="desk-evidence-card" key={index}><span className="eyebrow">Claim {index + 1}</span><label>Claim<textarea value={item.claim} readOnly={!editable || busy} onChange={e => edit({ ...state.content, evidence: state.content.evidence.map((v, i) => i === index ? { ...v, claim: e.target.value } : v) })} /></label><label>Exact source excerpt<textarea rows={4} value={item.quote} readOnly={!editable || busy} onChange={e => edit({ ...state.content, evidence: state.content.evidence.map((v, i) => i === index ? { ...v, quote: e.target.value } : v) })} /></label><div className="desk-card-actions"><button className="button secondary" onClick={() => showSource(item.quote)}>{found.length ? `Show excerpt · ${found.length} exact ${found.length === 1 ? "match" : "matches"}` : "Excerpt not found · inspect source"}</button>{editable && <button className="text-button" disabled={busy} onClick={() => edit({ ...state.content, evidence: state.content.evidence.filter((_, i) => i !== index) })}>Remove claim {index + 1}</button>}</div></article>;
        })}{editable && state.content.evidence.length < 8 && <button className="button secondary" disabled={busy} onClick={() => edit({ ...state.content, evidence: [...state.content.evidence, { claim: "", quote: "" }] })}>Add supporting evidence</button>}</div>}
        {tab === "preview" && <div className="editor-preview desk-reader-preview"><p className="desk-hint">Unpublished reader preview · displayed edition date is the draft creation date, not a publication date.</p><BriefFeed key={revision.id} stories={[preview]} preview /></div>}
      </div>
      {suggestion && <section className="desk-suggestion" aria-label="AI suggestion"><h2>Suggested {fieldLabels[suggestion.field].toLowerCase()}</h2><p className="desk-hint">Your original is unchanged until you accept. Review the source again after accepting.{suggestion.cost !== null ? ` Reported cost: $${suggestion.cost.toFixed(6)}.` : " Cost not reported yet."}</p><div className="desk-diff"><div><h3>Current</h3><del>{text(suggestion.before)}</del></div><div><h3>Suggested</h3><ins>{text(suggestion.value)}</ins></div></div><div className="desk-card-actions"><button className="button primary" disabled={!editable || busy || text(state.content[suggestion.field]) !== text(suggestion.before)} onClick={() => { const accepted = acceptSuggestion(session.getSnapshot().content, suggestion); if (accepted) { edit(accepted); setSuggestion(null); } }}>Accept suggestion</button><button className="button secondary" onClick={() => setSuggestion(null)}>Discard suggestion</button></div>{text(state.content[suggestion.field]) !== text(suggestion.before) && <p className="desk-invalid">This field changed since the suggestion. Discard it and request another; your newer text is safe.</p>}</section>}
    </div><aside className="desk-review" aria-label="Publication checklist"><h2>Before it goes live</h2><p className="desk-hint">Save, pause, then check the version you will publish.</p>
      {editable && <button className="button secondary" disabled={busy || state.saving || imageDirty || !!suggestion} onClick={async () => { if (await session.beginReview()) setMessage("Final review started. Autosave is paused; any edit resets your checks."); }}>Start final review</button>}
      {imageDirty && <p className="desk-hint">Save your image selection in Write before starting final review.</p>}
      <ul className="desk-checklist"><li><button className="text-button" onClick={() => showSource()}>1. Check the original source ↗</button></li><li><button className="text-button" onClick={() => setTab("preview")}>2. Read all three versions →</button></li><li>{errors.length ? `${errors.length} content ${errors.length === 1 ? "issue" : "issues"} to resolve` : "✓ Length and excerpt rules satisfied"}</li><li>{state.dirty || state.saving ? "Save changes before review" : `✓ Saved version ${state.version}`}</li></ul>
      {errors.length > 0 && <ul className="desk-issues">{errors.map(error => <li key={error}><button onClick={() => issue(error)}>{error} →</button></li>)}</ul>}
      {editable && <><label className="editor-check"><input type="checkbox" checked={state.sourceChecked} disabled={!state.paused || state.dirty || state.saving || busy || !!state.error} onChange={e => session.check("source", e.target.checked)} />I checked the original source and the factual claims.</label><label className="editor-check"><input type="checkbox" checked={state.tiersChecked} disabled={!state.paused || state.dirty || state.saving || busy || !!state.error} onChange={e => session.check("tiers", e.target.checked)} />I reviewed all three standalone versions, including the one-liner’s tone.</label><p className="desk-hint">{state.paused ? `Reviewing saved version ${state.version}. Editing resets both checks.` : "Start final review to enable the checks. Autosave is active while writing."}</p><button className="text-button" disabled={busy || state.saving || imageDirty} onClick={() => setConfirmation("reject")}>Reject draft</button><button className="text-button" disabled={busy || state.saving || imageDirty} onClick={() => { setCharge(false); setConfirmation("regenerate"); }}>Generate a new draft</button></>}
    </aside></div>
    {state.error && <div className="desk-save-error" role="alert"><strong>{state.error.code === "conflict" ? "A newer version was saved elsewhere." : "Draft not saved."}</strong><p>{state.error.message}</p><p>Your local text is preserved here. Copy any changes you want to keep before reloading.</p><div className="desk-card-actions"><button className="button secondary" disabled={state.saving} onClick={() => void session.save()}>Retry save</button><button className="text-button" onClick={() => { if (window.confirm("Reload the latest saved draft? This discards your local unsaved text.")) { guard.allow(); window.location.reload(); } }}>Reload latest</button></div></div>}
    <p className="desk-feedback" role="status">{busy ? "Working… please keep this page open." : message}</p>
    {editable && <div className="desk-work-actions"><div role="status" aria-live="polite"><strong>{state.saving ? "Saving…" : state.error ? "Not saved" : imageDirty ? "Unsaved image selection" : state.dirty ? "Unsaved changes" : state.paused ? "Saved · review paused autosave" : "All changes saved"}</strong><small>Version {state.version} · private draft</small></div><button className="button secondary" disabled={busy || state.saving || !state.dirty} onClick={() => void session.save()}>Save draft</button><button className="button primary" disabled={!ready} onClick={() => setConfirmation("publish")}>Approve and publish</button></div>}
    <DeskDialog open={sourceOpen} onClose={() => setSourceOpen(false)} title="Original source" description={`${source.source_name} · Published ${source.source_published_at.slice(0, 10)}. This capture belongs to this revision; check the original for updates.`} reader>
      <a className="button secondary" href={source.url} target="_blank" rel="noreferrer">Open {source.source_name} original ↗</a>
      {quote && <div className="desk-source-match"><p>{matches.length ? `${matches.length} exact ${matches.length === 1 ? "match" : "matches"}. Text matching does not verify factual accuracy.` : "No exact match in this capture. Check punctuation and context; do not treat this as verified evidence."}</p>{matches.length > 1 && <div className="desk-card-actions"><button className="button secondary" onClick={() => setMatchIndex((matchIndex + matches.length - 1) % matches.length)}>Previous match</button><span>{matchIndex + 1} / {matches.length}</span><button className="button secondary" onClick={() => setMatchIndex((matchIndex + 1) % matches.length)}>Next match</button></div>}</div>}
      <div className="desk-source-text" ref={sourceText}>{matches.length ? <>{matches.map((match, i) => <span key={match.start}>{revision.source_text.slice(i ? matches[i - 1].end : 0, match.start)}<mark tabIndex={-1} data-current={i === matchIndex}>{revision.source_text.slice(match.start, match.end)}</mark></span>)}{revision.source_text.slice(matches[matches.length - 1].end)}</> : revision.source_text || "No captured source text is available."}</div>
    </DeskDialog>
    <DeskDialog open={!!confirmation} onClose={() => setConfirmation(null)} busy={busy || state.saving} title={confirmation === "publish" ? "Publish this saved version?" : confirmation === "reject" ? "Reject this draft?" : "Generate another draft?"} description={confirmation === "publish" ? `Version ${state.version} will become public. This is a human approval, not another save.` : confirmation === "reject" ? "Your changes will be saved first. Any existing public story stays unchanged." : "This is a new paid model attempt using this story’s source. It does not publish or replace your current draft."}>
      {confirmation === "regenerate" && <><ChargeNotice attempts={attemptsUsed} limit={dailyLimit} /><label className="editor-check"><input type="checkbox" checked={charge} onChange={e => setCharge(e.target.checked)} />I understand this may incur a model charge.</label></>}
      <div className="desk-card-actions"><button className="button secondary" disabled={busy || state.saving} onClick={() => setConfirmation(null)}>Cancel</button><button className="button primary" disabled={busy || state.saving || (confirmation === "publish" && !ready) || (confirmation === "regenerate" && (!charge || attemptsUsed >= dailyLimit))} onClick={() => void decide()}>{busy || state.saving ? "Working…" : confirmation === "publish" ? "Confirm publication" : confirmation === "reject" ? "Confirm rejection" : "Confirm generation"}</button></div><p role="status">{message}</p>
    </DeskDialog>
    <DeskDialog open={!!suggestField} onClose={() => setSuggestField(null)} busy={busy || state.saving} title="Suggest a field rewrite" description="Source-grounded AI assistance for one field only. Your draft is saved first; the result is a suggestion, never an automatic replacement.">
      <label>Instruction<select value={instruction} onChange={e => setInstruction(e.target.value as typeof instruction)}><option value="simplify">Simplify</option><option value="shorten">Shorten</option><option value="alternative">Suggest an alternative</option></select></label><ChargeNotice attempts={attemptsUsed} limit={dailyLimit} /><label className="editor-check"><input type="checkbox" checked={charge} onChange={e => setCharge(e.target.checked)} />I understand this suggestion may incur a model charge.</label><button className="button primary" disabled={!charge || busy || state.saving || attemptsUsed >= dailyLimit} onClick={() => void requestSuggestion()}>{busy ? "Preparing suggestion…" : "Generate suggestion"}</button><p role="status">{message}</p>
    </DeskDialog>
    <DeskDialog open={historyOpen} onClose={() => setHistoryOpen(false)} busy={busy} title="Revision history" description="Compare historic content with your current text. Restore creates a new editable draft and never rolls back a publication.">
      {historyLoading && <p role="status">Loading saved history…</p>}{!historyLoading && !history.length && <p>No saved history for this revision yet.</p>}{!historyLoading && history.map(item => <details className="desk-history-entry" key={item.id}><summary>Version {item.version} · {item.action.replaceAll("_", " ")} · {item.created_at.slice(0, 16).replace("T", " ")} UTC</summary><HistoryDiff before={item.content} after={state.content} /><button className="button secondary" disabled={busy || state.saving} onClick={async () => { if (!guard.canLeave()) return; const result = await run({ intent: "restore", id: revision.id, historyId: item.id }); if (result.ok && result.revisionId) { guard.allow(); onOpen(result.revisionId); } }}>Restore as new draft</button></details>)}
    </DeskDialog>
  </section>;
}

function HistoryDiff({ before, after }: { before: Tiers; after: Tiers }) {
  const fields = contentDiff(before, after);
  return <div className="desk-history-diff">{!fields.length ? <p>No content differences.</p> : fields.map(item => <section key={item.field}><h3>{item.field === "evidence" ? "Supporting evidence" : fieldLabels[item.field]}</h3><div className="desk-diff"><div><h4>Historic version</h4><del>{item.before}</del></div><div><h4>Current version</h4><ins>{item.after}</ins></div></div></section>)}</div>;
}
