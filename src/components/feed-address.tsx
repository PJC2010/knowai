"use client";

import { useState } from "react";
import { Copy, Check } from "./icons";

export function FeedAddress({ feedUrl }: { feedUrl: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setStatus("copied");
    } catch {
      setStatus("manual");
    }
  }
  return (
    <div className="feed-address">
      <button className="button secondary" onClick={copy}>
        {status === "copied" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {status === "copied" ? "Copied" : "Copy feed address"}
      </button>
      <p role="status">{status === "copied" ? "Feed address copied." : status === "manual" ? "Select and copy the feed address below." : ""}</p>
      <label className="subscribe-card-address">
        Feed address
        <input readOnly value={feedUrl} onFocus={(event) => event.currentTarget.select()} />
      </label>
    </div>
  );
}
