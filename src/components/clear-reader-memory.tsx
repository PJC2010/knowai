"use client";

import { useState } from "react";
import { browserStorage, clearMemory, READER_MEMORY_KEY } from "@/lib/reader-memory";

export function ClearReaderMemory(): React.JSX.Element {
  const [status, setStatus] = useState("");

  function clearReadingHistory() {
    const storage = browserStorage();
    if (storage) clearMemory(storage);
    try {
      setStatus(storage && storage.getItem(READER_MEMORY_KEY) === null
        ? "Reading history cleared."
        : "Could not clear reading history. Clear this site’s browser data to remove it.");
    } catch {
      setStatus("Could not clear reading history. Clear this site’s browser data to remove it.");
    }
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <button
        type="button"
        className="button secondary"
        style={{ maxWidth: "100%", whiteSpace: "normal", textAlign: "center" }}
        onClick={clearReadingHistory}
      >
        Clear reading history on this device
      </button>
      <p role="status" aria-live="polite">{status}</p>
    </div>
  );
}
