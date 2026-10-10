"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  READER_MEMORY_KEY,
  beginVisit,
  browserStorage,
  emptyMemory,
  loadMemory,
  saveMemory,
  type ReaderMemory,
} from "@/lib/reader-memory";

export function useReaderMemory(enabled: boolean): {
  memory: ReaderMemory | null;
  update: (change: (memory: ReaderMemory) => ReaderMemory) => void;
} {
  const [memory, setMemory] = useState<ReaderMemory | null>(null);
  const current = useRef<ReaderMemory | null>(null);
  const active = useRef(false);
  const lastWrite = useRef<ReaderMemory | null>(null);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) {
      current.current = null;
      lastWrite.current = null;
      setMemory(null);
      return;
    }

    const storage = browserStorage();
    const loaded = loadMemory(storage);
    const visit = beginVisit(loaded, new Date());
    current.current = visit;
    lastWrite.current = loaded;
    saveMemory(storage, visit);
    setMemory(visit);

    function onStorage(event: StorageEvent) {
      if ((event.key === null || event.key === READER_MEMORY_KEY) && event.newValue === null && event.storageArea === storage) {
        const cleared = emptyMemory();
        current.current = cleared;
        lastWrite.current = null;
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
    const stored = loadMemory(storage, fallback);
    // A denied write leaves the old stored snapshot behind; don't discard subsequent in-session changes.
    const previous = lastWrite.current;
    const base = previous && JSON.stringify(stored) === JSON.stringify(previous)
      ? fallback : stored;
    const next = change(base);
    current.current = next;
    lastWrite.current = stored;
    saveMemory(storage, next);
    setMemory(next);
  }, []);

  return { memory: enabled ? memory : null, update };
}
