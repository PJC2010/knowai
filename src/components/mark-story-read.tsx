"use client";

import { useEffect, useRef } from "react";
import { markRead } from "@/lib/reader-memory";
import { useReaderMemory } from "./use-reader-memory";

export function MarkStoryRead({ id }: { id: string }): null {
  const { memory, update } = useReaderMemory(true);
  const lastMarked = useRef<string | null>(null);

  useEffect(() => {
    if (memory && lastMarked.current !== id) {
      lastMarked.current = id;
      update((current) => markRead(current, id));
    }
  }, [id, memory, update]);

  return null;
}
