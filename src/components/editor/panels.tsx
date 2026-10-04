import React from "react";
import { characterCount, wordCount, validateTiers, type Tiers } from "@/lib/brief";

export type WritingField = "oneLiner" | "shortVersion" | "wholePicture" | "whyItMatters";
export type Tier = Exclude<WritingField, "whyItMatters">;
export const fieldLabels: Record<WritingField, string> = { oneLiner: "The one-liner", shortVersion: "The short version", wholePicture: "The whole picture", whyItMatters: "Why it matters" };
export function WritePanel({ content, tier, readOnly, onTier, onEdit, onSuggest }: {
  content: Tiers; tier: Tier; readOnly: boolean; onTier: (tier: Tier) => void;
  onEdit: (content: Tiers) => void; onSuggest: (field: WritingField) => void;
}) {
  const errors = validateTiers(content);
  function field(key: WritingField) {
    const value = content[key];
    const text = Array.isArray(value) ? value.join("\n\n") : value;
    const guidance = key === "oneLiner" ? `${characterCount(text)} / 140 characters` : key === "shortVersion" ? `${wordCount(text)} words · 40–80` : key === "wholePicture" ? `${wordCount(text)} words · 150–300 · 2–3 paragraphs` : `${characterCount(text)} / 240 characters`;
    const error = errors.find(e => e.toLowerCase().startsWith(fieldLabels[key].toLowerCase()));
    return <section className="desk-writing-field" key={key}>
      <div className="desk-field-heading"><label htmlFor={`field-${key}`}>{fieldLabels[key]}</label><span id={`count-${key}`} className={error ? "desk-invalid" : ""}>{guidance}</span></div>
      <textarea id={`field-${key}`} name={key} value={text} readOnly={readOnly} rows={key === "wholePicture" ? 15 : key === "shortVersion" ? 8 : 4} aria-describedby={`count-${key}${error ? ` error-${key}` : ""}`} aria-invalid={!!error} onChange={event => onEdit({ ...content, [key]: key === "wholePicture" ? event.target.value.split(/\n\s*\n/) : event.target.value })} />
      {error && <p className="desk-invalid" id={`error-${key}`}>{error}</p>}
      {key === "wholePicture" && <p className="desk-hint">Separate paragraphs with a blank line. Each depth should stand on its own.</p>}
      {!readOnly && <button className="text-button desk-suggest" onClick={() => onSuggest(key)}>Suggest a rewrite <span>· AI, optional</span></button>}
    </section>;
  }
  return <div className="desk-write"><div className="desk-segments" role="group" aria-label="Writing tier">{(["oneLiner", "shortVersion", "wholePicture"] as const).map((key, i) => <button key={key} aria-pressed={tier === key} onClick={() => onTier(key)}>{["One-liner", "Short", "Full"][i]}</button>)}</div>{field(tier)}{field("whyItMatters")}</div>;
}
