"use client";
import { useEffect, useState } from "react";
import type { DeskResult } from "@/lib/editorial/desk-types";

function monday(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}
export function WeeklyFeature({ initialWeek, disabled, onFeature }: { initialWeek: string | null; disabled: boolean; onFeature: (week: string | null) => Promise<DeskResult> }) {
  const [featured, setFeatured] = useState(initialWeek);
  const [week, setWeek] = useState(initialWeek || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFeatured(initialWeek);
    if (!initialWeek) setWeek(previous => previous || monday(new Date().toISOString().slice(0, 10)));
  }, [initialWeek]);
  async function update(value: string | null) {
    setPending(true); setMessage(""); setFailed(false);
    try {
      const result = await onFeature(value);
      setMessage(result.message); setFailed(!result.ok);
      if (result.ok) setFeatured(result.featuredWeek ?? value);
    } catch { setMessage("The featured article could not be updated. Please try again."); setFailed(true); }
    finally { setPending(false); }
  }
  return <section className="desk-weekly-feature" aria-labelledby="weekly-feature-heading">
    <h2 id="weekly-feature-heading">Featured article of the week</h2>
    <p className="desk-hint">Give this published article the lead position on The Brief for the selected week. Choosing it replaces that week’s previous featured article.</p>
    {featured && <p className="desk-feature-current">Featured for the week of <time dateTime={featured}>{featured}</time>.</p>}
    <label>Week of<input type="date" value={week} disabled={disabled || pending} onChange={event => setWeek(event.target.value)} onBlur={() => { if (week) setWeek(monday(week)); }} aria-describedby="feature-week-help" /></label>
    <p id="feature-week-help" className="desk-hint">Monday through Sunday, UTC. Any date you choose selects its full week.</p>
    <div className="desk-card-actions"><button className="button secondary" disabled={disabled || pending || !monday(week) || featured === monday(week)} onClick={() => void update(monday(week))}>{pending ? "Updating feature…" : "Feature this article"}</button>{featured && <button className="text-button" disabled={disabled || pending} onClick={() => void update(null)}>Remove featured article</button>}</div>
    <p className={failed ? "desk-invalid" : "desk-hint"} role={failed ? "alert" : "status"}>{message}</p>
  </section>;
}
