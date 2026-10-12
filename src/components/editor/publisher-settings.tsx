import React, { useEffect, useState } from "react";
import type { DeskMutation, DeskPublisher, DeskResult } from "@/lib/editorial/desk-types";
import { SourceKindBadge } from "./inbox";

function Timestamp({ value, fallback }: { value: string | null | undefined; fallback: string }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <>{fallback}</>;
  return <time dateTime={value}>{new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC</time>;
}

function healthLabel(publisher: DeskPublisher) {
  const result = publisher.last_result;
  if (!result) return publisher.last_error ? "Unavailable" : publisher.last_attempt_at || publisher.last_success_at ? "No result recorded" : "Not checked";
  switch (result.outcome) {
    case "ok": return result.inserted === 0 ? "Healthy — no new stories" : "Healthy";
    case "empty": return "Healthy — no new stories";
    case "partial": return "Partial refresh";
    case "unavailable": return "Unavailable";
    case "skipped": return "Refresh skipped";
  }
}

export function PublisherSettings({ publishers, busy, run }: {
  publishers: DeskPublisher[];
  busy: boolean;
  run: (input: DeskMutation) => Promise<DeskResult>;
}) {
  const [clock, updateClock] = useState(0);
  const now = Date.now();
  const nextRetryAt = Math.min(...publishers.map(publisher => Date.parse(publisher.retry_after || "")).filter(time => time > now));
  useEffect(() => {
    // Keep the render's deadline: if it expired before this effect, catch up once.
    if (!Number.isFinite(nextRetryAt)) return;
    const timer = window.setTimeout(() => updateClock(value => value + 1), Math.max(0, Math.min(nextRetryAt - Date.now(), 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [nextRetryAt, clock]);
  return <div className="desk-publishers">{publishers.map(publisher => {
    const catalog = publisher.catalog;
    const discovery = catalog?.discovery;
    const discoveryUrl = discovery?.method === "newsroom" ? discovery.listingUrl : discovery?.feedUrl;
    const configured = Boolean(catalog && publisher.catalog_key === catalog.key && publisher.name === catalog.name &&
      publisher.source_kind === catalog.kind && publisher.discovery_method === discovery?.method && publisher.discovery_url === discoveryUrl &&
      (discovery?.method === "newsroom" ? publisher.feed_url === null : publisher.feed_url === discoveryUrl));
    const approved = publisher.access_status === "approved";
    const retryActive = Boolean(publisher.retry_after && Date.parse(publisher.retry_after) > now);
    const canToggle = !busy && (publisher.enabled || (approved && configured));
    const canRefresh = !busy && approved && configured && publisher.enabled && !retryActive;
    const reasonId = `publisher-${publisher.id}-availability`;
    const reason = !approved ? publisher.access_status === "blocked" ? "Access blocked" : "Access review required"
      : !configured ? "Discovery configuration unavailable"
      : busy ? "Request in progress. Please wait."
      : !publisher.enabled ? "Discovery paused. Enable this source to refresh it."
      : retryActive ? "Retry window is active. Wait until the time below before refreshing."
      : "Ready to refresh. No model calls.";
    const result = publisher.last_result;
    return <article className="desk-publisher" key={publisher.id} aria-label={publisher.name}>
      <div className="desk-publisher-heading"><h2>{publisher.name}</h2><label className="desk-toggle">
        <input type="checkbox" role="switch" aria-label={`${publisher.name} discovery`} aria-describedby={reasonId} checked={publisher.enabled} disabled={!canToggle} onChange={event => { if (canToggle && (!event.target.checked || (approved && configured))) void run({ intent: "publisher", id: publisher.id, enabled: event.target.checked }); }} />
        <span>{publisher.enabled ? "Enabled" : "Disabled"}</span>
      </label></div>
      <SourceKindBadge kind={publisher.source_kind || catalog?.kind} />
      <p className="desk-hint">{catalog?.description || "Publisher details are unavailable."}</p>
      <div className="desk-publisher-links">
        {catalog?.homepageUrl && <a href={catalog.homepageUrl} target="_blank" rel="noreferrer">Homepage <span>{catalog.homepageUrl} ↗</span></a>}
        {discoveryUrl && <a href={discoveryUrl} target="_blank" rel="noreferrer">{discovery?.method === "newsroom" ? "Newsroom" : "Feed"} <span>{discoveryUrl} ↗</span></a>}
      </div>
      <div id={reasonId} className="desk-publisher-availability">
        <p>{reason}</p>
        {publisher.access_note && <p>{publisher.access_note}</p>}
        {!approved && <p>Access restrictions need an operational review and cannot be overridden by a toggle or an article import.</p>}
      </div>
      <p className="desk-publisher-health">{healthLabel(publisher)}</p>
      <dl className="desk-publisher-times">
        <div><dt>Last attempt</dt><dd><Timestamp value={publisher.last_attempt_at} fallback={publisher.last_result || publisher.last_success_at || publisher.last_error ? "Not recorded" : "Not checked"} /></dd></div>
        <div><dt>Last successful refresh</dt><dd><Timestamp value={publisher.last_success_at} fallback="No successful refresh yet" /></dd></div>
      </dl>
      {result && <dl className="desk-publisher-counts" aria-label="Last refresh counts">
        {([["Scanned", result.scanned], ["New", result.inserted], ["Duplicates", result.duplicates], ["Filtered", result.filtered], ["Invalid", result.invalid], ["Article requests", result.attempted], ["Remaining", result.remaining]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
      </dl>}
      {publisher.last_error && <p className="desk-invalid"><strong>Last error: </strong>{publisher.last_error}</p>}
      {publisher.last_warning && <p className="desk-publisher-warning"><strong>Warning: </strong>{publisher.last_warning}</p>}
      {publisher.retry_after && <p className="desk-hint">Retry after <Timestamp value={publisher.retry_after} fallback="time unavailable" />.</p>}
      <button type="button" className="button secondary" disabled={!canRefresh} aria-describedby={reasonId} onClick={() => { if (canRefresh) void run({ intent: "discover", publisherId: publisher.id }); }}>Refresh {publisher.name}</button>
    </article>;
  })}</div>;
}
