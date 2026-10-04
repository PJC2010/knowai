import type { DeskQuery, DeskResult } from "@/lib/editorial/desk-types";
import type { Tiers } from "@/lib/brief";

export type DraftSnapshot = {
  content: Tiers; saved: Tiers; version: number; dirty: boolean; saving: boolean;
  error: DeskResult | null; paused: boolean; sourceChecked: boolean; tiersChecked: boolean;
};
const same = (a: Tiers, b: Tiers) => JSON.stringify(a) === JSON.stringify(b);
export function createDraftSession(initial: Tiers, version: number,
  persist: (content: Tiers, version: number) => Promise<DeskResult>) {
  let state: DraftSnapshot = { content: initial, saved: initial, version, dirty: false, saving: false, error: null, paused: false, sourceChecked: false, tiersChecked: false };
  const listeners = new Set<() => void>();
  let active: Promise<boolean> | null = null;
  function update(patch: Partial<DraftSnapshot>) {
    state = { ...state, ...patch };
    state.dirty = !same(state.content, state.saved);
    listeners.forEach(listener => listener());
  }
  async function drain() {
    if (!state.dirty && state.error) return false;
    update({ saving: true, error: null });
    while (state.dirty) {
      const snapshot = structuredClone(state.content);
      let result: DeskResult;
      try { result = await persist(snapshot, state.version); }
      catch { result = { ok: false, code: "failed", message: "Could not save. Your changes are still here. Check your connection and retry." }; }
      if (!result.ok || typeof result.version !== "number" || !Number.isInteger(result.version) || result.version <= state.version) {
        update({ saving: false, error: result.ok ? { ok: false, code: "failed", message: "The server did not confirm a new saved version. Your text is preserved; reload only after keeping a copy." } : result });
        return false;
      }
      update({ saved: snapshot, version: result.version });
    }
    update({ saving: false });
    return true;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    pauseAutosave() { update({ paused: true }); },
    serverConflict(error: DeskResult) { update({ error, sourceChecked: false, tiersChecked: false, paused: false }); },
    edit(content: Tiers) { update({ content, paused: false, sourceChecked: false, tiersChecked: false }); },
    async beginReview() {
      update({ paused: true, sourceChecked: false, tiersChecked: false });
      const ok = await this.save();
      return ok && state.paused;
    },
    check(kind: "source" | "tiers", checked: boolean) {
      if (!state.paused || state.dirty || state.saving || state.error) return;
      update(kind === "source" ? { sourceChecked: checked } : { tiersChecked: checked });
    },
    save() {
      if (active) return active;
      active = drain().finally(() => { active = null; });
      return active;
    },
  };
}

export function canPublish(state: DraftSnapshot, errors: string[]): boolean {
  return state.paused && !state.dirty && !state.saving && !state.error && state.sourceChecked && state.tiersChecked && !errors.length;
}

export function contentDiff(before: Tiers, after: Tiers) {
  const render = (value: Tiers[keyof Tiers]) => Array.isArray(value) ? value.map(item => typeof item === "string" ? item : `${item.claim}\n“${item.quote}”`).join("\n\n") : value;
  return (["oneLiner", "shortVersion", "wholePicture", "whyItMatters", "evidence"] as const)
    .map(field => ({ field, before: render(before[field]), after: render(after[field]) }))
    .filter(item => item.before !== item.after);
}

export function acceptSuggestion(content: Tiers, suggestion: { field: Exclude<keyof Tiers, "evidence">; before: string | string[]; value: string | string[] }): Tiers | null {
  if (JSON.stringify(content[suggestion.field]) !== JSON.stringify(suggestion.before)) return null;
  if (suggestion.field === "wholePicture" ? !Array.isArray(suggestion.value) : typeof suggestion.value !== "string") return null;
  return { ...content, [suggestion.field]: suggestion.value };
}

export function quoteMatches(source: string, quote: string): { start: number; end: number }[] {
  if (!quote.trim()) return [];
  const matches = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(quote, cursor);
    if (start < 0) break;
    matches.push({ start, end: start + quote.length });
    cursor = start + quote.length;
  }
  return matches;
}

// Keep queue context in the URL; never persist private draft content.
export function deskHref(query: DeskQuery, patch: Partial<DeskQuery> = {}): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  for (const key of ["view", "id", "q", "publisher", "category", "status", "since", "page"] as const) {
    if (next[key]) params.set(key, next[key]!);
  }
  return `/editor${params.size ? `?${params}` : ""}`;
}
