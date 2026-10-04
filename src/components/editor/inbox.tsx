import React from "react";
import type { DeskPublisher, DeskQuery, DeskSource } from "@/lib/editorial/desk-types";
import { deskHref } from "./workspace-state";

export function QueueControls({ query, publishers, total, page, pageSize, onFilter }: {
  query: DeskQuery; publishers: DeskPublisher[]; total: number; page: number; pageSize: number;
  onFilter: (query: DeskQuery) => void;
}) {
  const inbox = !query.view || query.view === "inbox";
  const statuses = inbox ? [["inbox", "Inbox"], ["selected", "Selected"], ["saved", "Saved for later"], ["dismissed", "Dismissed"], ["all", "All stories"]] : [["needs_review", "Needs review"], ["failed", "Failed"], ["queued", "Queued / held"], ["rejected", "Rejected"]];
  return <>
    <form className="desk-filters" key={deskHref(query)} onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      onFilter({ ...query, id: undefined, page: undefined, q: String(values.get("q") || ""), publisher: String(values.get("publisher") || ""), category: String(values.get("category") || ""), since: String(values.get("since") || ""), status: String(values.get("status") || "") });
    }}>
      <label className="desk-search">Search stories<input name="q" type="search" placeholder="Headline or publisher…" defaultValue={query.q} /></label>
      <details className="desk-filter-details" open={Boolean(query.publisher || query.category || query.since || query.status)}><summary>Filters</summary><div className="desk-filter-fields">
        <label>Publisher<select name="publisher" defaultValue={query.publisher || ""}><option value="">All publishers</option>{publishers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Category<select name="category" defaultValue={query.category || ""}><option value="">All categories</option>{["Models", "Research", "Industry", "Tools"].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Published since<input type="date" name="since" defaultValue={query.since} /></label>
        {query.view !== "published" && <label>Status<select name="status" defaultValue={query.status || (inbox ? "inbox" : "needs_review")}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      </div></details>
      <button className="button secondary">Apply filters</button><a className="text-button" href={deskHref({ view: query.view })}>Clear</a>
    </form>
    <nav className="desk-pager" aria-label="Story pages"><span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 stories"}</span><div>
      {page > 1 ? <a href={deskHref(query, { page: String(page - 1), id: undefined })}>← Previous</a> : <span aria-disabled="true">← Previous</span>}
      <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
      {page * pageSize < total ? <a href={deskHref(query, { page: String(page + 1), id: undefined })}>Next →</a> : <span aria-disabled="true">Next →</span>}
    </div></nav>
  </>;
}

export function SourceCard({ source, selected, pending, onTriage, onPreview }: {
  source: DeskSource; selected: boolean; pending: boolean;
  onTriage: (source: DeskSource, state: DeskSource["triage"]) => void;
  onPreview: (source: DeskSource) => void;
}) {
  return <article className="desk-story" data-selected={selected || undefined}>
    <div className="desk-meta"><span>{source.source_name}</span><time dateTime={source.source_published_at}>{source.source_published_at.slice(0, 10)}</time><span className="category-tag">{source.category}</span></div>
    <h2><button className="desk-headline" onClick={() => onPreview(source)}>{source.title}</button></h2>
    <div className="desk-meta"><span>{source.triage === "selected" ? "Selected for drafting" : source.triage === "saved" ? "Saved for later" : source.triage === "dismissed" ? "Dismissed" : "Ready to consider"}</span>{source.job_state && <span>Draft: {source.job_state.replaceAll("_", " ")}</span>}</div>
    <div className="desk-card-actions">
      <button className={`button ${selected ? "primary" : "secondary"}`} disabled={pending} aria-pressed={selected} onClick={() => onTriage(source, selected ? "inbox" : "selected")}>{selected ? "Deselect" : "Select story"}</button>
      <button className="text-button" disabled={pending} onClick={() => onTriage(source, source.triage === "saved" ? "inbox" : "saved")}>{source.triage === "saved" ? "Return to inbox" : "Save for later"}</button>
      <button className="text-button" disabled={pending} onClick={() => onTriage(source, source.triage === "dismissed" ? "inbox" : "dismissed")}>{source.triage === "dismissed" ? "Restore to inbox" : "Dismiss"}</button>
      <button className="text-button desk-preview-link" onClick={() => onPreview(source)}>Source preview ↗</button>
    </div>
  </article>;
}
