"use client";

import { useId, useState } from "react";
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
      <p>New stories arrive in your feed reader after editorial review. No account or email needed.</p>
      <div className="subscribe-card-actions">
        <a className="button lime" href="/feed.xml" type="application/rss+xml">Open the RSS feed</a>
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
        <p>A feed reader collects new posts from sites you follow. Paste the feed address into any reader app.</p>
      </details>
    </section>
  );
}
