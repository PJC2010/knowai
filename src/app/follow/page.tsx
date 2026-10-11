import Link from "next/link";
import { ArrowUpRight, Rss } from "@/components/icons";
import { FeedAddress } from "@/components/feed-address";
import { siteUrl } from "@/lib/site-url";

import { pageMetadata } from "@/lib/page-metadata";
export const metadata = pageMetadata(
  "Follow The Brief — AI news in plain English",
  "Follow knowai in Feedly, Inoreader, or your own feed reader. Get new, editor-reviewed AI stories without a knowai account.",
  "/follow",
);

export default function FollowPage() {
  const feedUrl = new URL("/feed.xml", siteUrl()).href;
  return (
    <div className="page-container follow-page">
      <section className="page-heading">
        <span className="eyebrow">AI knowledge everyone can understand</span>
        <h1>Get The Brief. Keep making sense of AI.</h1>
        <p>Follow new AI stories, explained in plain English and checked by a human editor. Read as little or as much as you need.</p>
      </section>
      <section className="follow-options" aria-labelledby="follow-options-title">
        <div className="subscribe-card-heading">
          <Rss size={24} aria-hidden="true" />
          <h2 id="follow-options-title">Choose where you read</h2>
        </div>
        <p>A feed reader is an app that collects new stories from sites you follow. Choose one below, sign in or create an account there, then confirm that you want to follow knowai.</p>
        <div className="follow-reader-grid">
          <a className="follow-reader" href={`https://feedly.com/i/subscription/feed%2F${encodeURIComponent(feedUrl)}`} target="_blank" rel="noreferrer">
            <strong>Follow in Feedly <ArrowUpRight size={20} aria-hidden="true" /></strong>
            <span>Opens Feedly in a new tab.</span>
          </a>
          <a className="follow-reader" href={`https://www.inoreader.com/?add_feed=${encodeURIComponent(feedUrl)}`} target="_blank" rel="noreferrer">
            <strong>Follow in Inoreader <ArrowUpRight size={20} aria-hidden="true" /></strong>
            <span>Opens Inoreader in a new tab.</span>
          </a>
        </div>
        <p>No knowai account is needed. Reader apps have their own accounts, plans, and privacy policies. New stories appear after editorial review, not on a fixed delivery schedule.</p>
      </section>
      <section className="follow-options" aria-labelledby="own-reader-title">
        <h2 id="own-reader-title">Already use a different reader?</h2>
        <p>Add knowai using its RSS feed address. RSS is the format that reader apps use to collect new stories.</p>
        <FeedAddress feedUrl={feedUrl} />
        <p className="follow-raw"><a href="/feed.xml" type="application/rss+xml">View raw RSS feed</a> <span>— for reader apps, not a reading page.</span></p>
      </section>
      <aside className="follow-note" aria-label="Other ways to read">
        <h2>Prefer to read here?</h2>
        <p>Email delivery is not available yet. You can bookmark The Brief and return whenever you like.</p>
        <Link className="button lime" href="/">Read the latest Brief <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </aside>
    </div>
  );
}
