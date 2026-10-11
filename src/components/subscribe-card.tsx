"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Rss, Copy, Check } from "./icons";

export function SubscribeCard({ feedUrl }: { feedUrl: string }) {
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  const [showAddress, setShowAddress] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setShowAddress(false);
    } catch {
      setCopied(false);
      setShowAddress(true);
    }
  }

  return (
    <section className="subscribe-card" aria-labelledby={headingId}>
      <div className="subscribe-card-heading">
        <Rss size={24} aria-hidden="true" />
        <h2 id={headingId}>Follow The Brief</h2>
      </div>
      <p>Keep making sense of AI. Follow new, editor-reviewed stories in a reader app. No knowai account needed.</p>
      <div className="subscribe-card-actions">
        <Link className="button lime" href="/follow">Choose how to follow</Link>
        <button className="button secondary" type="button" onClick={copyAddress}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {copied ? "Copied" : "Copy feed address"}
        </button>
      </div>
      <span className="sr-only" role="status">{copied ? "Feed address copied." : ""}</span>
      {showAddress && (
        <label className="subscribe-card-address">
          Feed address
          <input readOnly value={feedUrl} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      <details>
        <summary>New to RSS?</summary>
        <p>A feed reader, such as Feedly or Inoreader, collects new posts from sites you follow. <Link href="/follow">See how to get started.</Link></p>
      </details>
    </section>
  );
}
