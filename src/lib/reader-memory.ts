import { depths, type BriefStory, type Depth } from "./brief";

export const READER_MEMORY_KEY = "knowai-reader";
export const VISIT_GAP_MS = 1_800_000;
export const READ_LIMIT = 200;

export type ReaderMemory = {
  v: 1;
  depth: Depth | null;
  lastVisit: string | null;
  previousVisit: string | null;
  read: string[];
  welcomeDismissed: boolean;
};

export function emptyMemory(): ReaderMemory {
  return {
    v: 1,
    depth: null,
    lastVisit: null,
    previousVisit: null,
    read: [],
    welcomeDismissed: false,
  };
}

function validVisit(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function parseMemory(raw: string | null): ReaderMemory {
  if (raw === null) return emptyMemory();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptyMemory();
    const record = value as Record<string, unknown>;
    if (record.v !== 1) return emptyMemory();

    const seen = new Set<string>();
    const read = Array.isArray(record.read)
      ? record.read.filter((id): id is string => typeof id === "string" && id.length > 0)
          .reverse().filter((id) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          }).slice(0, READ_LIMIT).reverse()
      : [];
    return {
      v: 1,
      depth: typeof record.depth === "string" && depths.some((depth) => depth === record.depth)
        ? record.depth as Depth : null,
      lastVisit: validVisit(record.lastVisit),
      previousVisit: validVisit(record.previousVisit),
      read,
      welcomeDismissed: record.welcomeDismissed === true,
    };
  } catch {
    return emptyMemory();
  }
}

export function beginVisit(memory: ReaderMemory, now: Date): ReaderMemory {
  const last = memory.lastVisit === null ? NaN : Date.parse(memory.lastVisit);
  const newVisit = !Number.isFinite(last) || now.getTime() - last >= VISIT_GAP_MS;
  return {
    ...memory,
    previousVisit: newVisit ? (Number.isFinite(last) ? memory.lastVisit : null) : memory.previousVisit,
    lastVisit: now.toISOString(),
  };
}

export function markRead(memory: ReaderMemory, id: string): ReaderMemory {
  return { ...memory, read: [...memory.read.filter((entry) => entry !== id), id].slice(-READ_LIMIT) };
}

export function newStoryIds(
  stories: Pick<BriefStory, "id" | "published_at">[],
  previousVisit: string | null,
): Set<string> {
  const since = previousVisit === null ? NaN : Date.parse(previousVisit);
  if (!Number.isFinite(since)) return new Set();
  return new Set(stories.filter((story) => Date.parse(story.published_at) > since).map((story) => story.id));
}

export function catchUpStories<T extends Pick<BriefStory, "id" | "published_at">>(
  stories: T[], previousVisit: string | null,
): T[] {
  const since = previousVisit === null ? NaN : Date.parse(previousVisit);
  if (!Number.isFinite(since)) return [];
  const seen = new Set<string>();
  return stories.filter((story) => {
    if (!(Date.parse(story.published_at) > since) || seen.has(story.id)) return false;
    seen.add(story.id);
    return true;
  }).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadMemory(storage: Storage | null, fallback: ReaderMemory = emptyMemory()): ReaderMemory {
  try {
    if (storage === null) return fallback;
    const raw = storage.getItem(READER_MEMORY_KEY);
    return raw === null ? fallback : parseMemory(raw);
  } catch {
    return fallback;
  }
}

export function saveMemory(storage: Storage | null, memory: ReaderMemory): void {
  try {
    storage?.setItem(READER_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage may be unavailable or over quota; keep in-session state in the caller.
  }
}

export function clearMemory(storage: Storage | null): void {
  try {
    storage?.removeItem(READER_MEMORY_KEY);
  } catch {
    // Storage access can be denied; the UI must verify removal before claiming success.
  }
}
