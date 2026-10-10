"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  READER_MEMORY_KEY,
  beginVisit,
  browserStorage,
  emptyMemory,
  loadMemory,
  parseMemory,
  saveMemory,
  type ReaderMemory,
} from "@/lib/reader-memory";

function saveAndConfirm(storage: Storage | null, memory: ReaderMemory): boolean {
  saveMemory(storage, memory);
  try {
    return storage?.getItem(READER_MEMORY_KEY) === JSON.stringify(memory);
  } catch {
    return false;
  }
}

export function useReaderMemory(enabled: boolean): {
  memory: ReaderMemory | null;
  update: (change: (memory: ReaderMemory) => ReaderMemory) => void;
} {
  const [memory, setMemory] = useState<ReaderMemory | null>(null);
  const current = useRef<ReaderMemory | null>(null);
  const active = useRef(false);
  const lastWrite = useRef<ReaderMemory | null>(null);
  const persisted = useRef(false);
  const pendingClear = useRef(false);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) {
      current.current = null;
      lastWrite.current = null;
      persisted.current = false;
      pendingClear.current = false;
      setMemory(null);
      return;
    }

    const storage = browserStorage();
    const loaded = loadMemory(storage);
    let hadStoredValue = false;
    try {
      hadStoredValue = storage !== null && storage.getItem(READER_MEMORY_KEY) !== null;
    } catch {
      // A denied read cannot confirm either a stored value or a clear.
    }
    const visit = beginVisit(loaded, new Date());
    current.current = visit;
    lastWrite.current = loaded;
    persisted.current = saveAndConfirm(storage, visit) || hadStoredValue;
    pendingClear.current = false;
    setMemory(visit);

    function onStorage(event: StorageEvent) {
      if ((event.key === null || event.key === READER_MEMORY_KEY) && event.newValue === null && event.storageArea === storage) {
        // A clear event can arrive after this tab has saved a new value.
        try {
          if (storage && storage.getItem(READER_MEMORY_KEY) !== null) return;
        } catch {
          // Trust the clear event if storage cannot be inspected.
        }
        if (pendingClear.current) {
          pendingClear.current = false;
          return;
        }
        const cleared = emptyMemory();
        current.current = cleared;
        lastWrite.current = null;
        persisted.current = false;
        setMemory(cleared);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => {
      active.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled]);

  const update = useCallback((change: (memory: ReaderMemory) => ReaderMemory) => {
    if (!active.current || typeof window === "undefined") return;
    const storage = browserStorage();
    const fallback = current.current ?? emptyMemory();
    let raw: string | null | undefined;
    try {
      raw = storage?.getItem(READER_MEMORY_KEY);
    } catch {
      // An unavailable read is not evidence of deletion.
    }
    const cleared = raw === null && persisted.current;
    const stored = raw === undefined ? fallback : raw === null
      ? (cleared ? emptyMemory() : fallback) : parseMemory(raw);
    // A denied write leaves the old stored snapshot behind; don't discard subsequent in-session changes.
    const previous = lastWrite.current;
    const base = !cleared && previous && JSON.stringify(stored) === JSON.stringify(previous)
      ? fallback : stored;
    const next = change(base);
    current.current = next;
    lastWrite.current = stored;
    if (cleared) persisted.current = false;
    persisted.current = saveAndConfirm(storage, next) || persisted.current;
    pendingClear.current = !persisted.current && (cleared || pendingClear.current);
    setMemory(next);
  }, []);

  return { memory: enabled ? memory : null, update };
}
