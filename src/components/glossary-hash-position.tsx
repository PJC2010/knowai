"use client";

import { useEffect } from "react";

export function GlossaryHashPosition() {
  useEffect(() => {
    if (!window.location.hash.startsWith("#term-") || window.scrollY !== 0) return;
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(id);
    if (!target?.matches(".learn-glossary dt")) return;
    const rect = target.getBoundingClientRect();
    // On a streamed first load the browser may try the hash before this section exists.
    if (rect.top >= window.innerHeight || rect.bottom <= 0) {
      target.scrollIntoView();
    }
  }, []);
  return null;
}
