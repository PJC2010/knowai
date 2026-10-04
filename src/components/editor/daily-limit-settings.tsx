"use client";
import { useEffect, useState } from "react";
import { DeskDialog } from "./dialog";
import type { DeskResult } from "@/lib/editorial/desk-types";

export function DailyLimitSettings({ limit, busy, save }: {
  limit: number;
  busy: boolean;
  save: (limit: number, confirmCharge: boolean) => Promise<DeskResult>;
}) {
  const [value, setValue] = useState(String(limit));
  const [proposed, setProposed] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setValue(String(limit)); }, [limit]);
  async function submit(next: number, confirmed: boolean) {
    const result = await save(next, confirmed);
    setError(result.ok ? "" : result.message);
    if (result.ok) setProposed(null);
  }
  return <section className="desk-setting-section" id="daily-limit" aria-labelledby="daily-limit-heading">
    <h2 id="daily-limit-heading">Daily model limit</h2>
    <p className="desk-hint" id="daily-limit-help">Shared across all editors, draft generation and AI suggestions. Choose 1–1000 attempts per UTC day; the default is 10. Failed attempts count. Usage resets at 00:00 UTC. This is an attempt limit, not a dollar budget.</p>
    <form onSubmit={event => {
      event.preventDefault();
      const next = Number(value);
      if (!Number.isSafeInteger(next) || next < 1 || next > 1000) { setError("Choose a whole number between 1 and 1000."); return; }
      setError("");
      if (next > limit) { setConsent(false); setProposed(next); }
      else void submit(next, false);
    }}>
      <label htmlFor="daily-attempt-limit">Daily model attempt limit<input id="daily-attempt-limit" type="number" inputMode="numeric" min="1" max="1000" step="1" required value={value} disabled={busy} aria-describedby="daily-limit-help" onChange={event => setValue(event.target.value)} /></label>
      <button className="button secondary" disabled={busy}>Save daily limit</button>
    </form>
    <p className="desk-hint">Changing the limit does not reset usage, start generation, or change automatic drafting. Lowering it below attempts already used blocks new attempts until the next UTC day; work already in progress may finish.</p>
    {error && proposed === null && <p role="alert" className="desk-invalid">{error}</p>}
    <DeskDialog open={proposed !== null} onClose={() => setProposed(null)} busy={busy} title="Increase daily model limit?" description={`Raise the shared limit from ${limit} to ${proposed ?? limit} attempts per UTC day. This persists for future days and may allow more model charges, including scheduled work if automatic drafting is already on. No model call is started by saving this setting.`}>
      <label className="editor-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />I understand a higher limit may increase model charges.</label>
      <div className="desk-card-actions"><button className="button secondary" disabled={busy} onClick={() => setProposed(null)}>Cancel</button><button className="button primary" disabled={!consent || busy} onClick={() => { if (proposed !== null && consent) void submit(proposed, true); }}>{busy ? "Saving limit…" : "Confirm limit increase"}</button></div>
      {error && <p role="alert" className="desk-invalid">{error}</p>}
    </DeskDialog>
  </section>;
}
