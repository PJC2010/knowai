"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Copy,
  Check,
  ArrowUpRight,
  BookOpen,
  Plus,
  ChevronDown,
  Link2,
} from "./icons";
import { depths, digestText, type BriefStory, type Depth } from "@/lib/brief";
import { dateLabel } from "@/lib/format";
import { StoryImage } from "./story-image";
import { GlossaryText } from "./glossary-text";
import { annotateSections, glossary } from "@/lib/glossary";

export function BriefFeed({
  stories,
  initialDepth = "normal",
  initialDate,
  initialCategory = "All updates",
  preview = false,
}: {
  stories: BriefStory[];
  initialDepth?: Depth;
  initialDate?: string;
  initialCategory?: string;
  preview?: boolean;
}) {
  const dates = [...new Set(stories.map((s) => s.edition_date))]
    .sort()
    .reverse();
  const [date, setDate] = useState(initialDate || dates[0] || "");
  const [depth, setDepth] = useState<Depth>(initialDepth);
  const [filter, setFilter] = useState(initialCategory);
  const [overrides, setOverrides] = useState<Record<string, Depth>>({});
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const [today, setToday] = useState("");
  const feed = useRef<HTMLElement>(null);
  const edition = stories.filter((s) => s.edition_date === date);
  const selectedWeek = editionWeek(date);
  const featured = stories.find(
    (story) =>
      selectedWeek !== null &&
      story.featured_week === selectedWeek &&
      story.edition_date <= date &&
      (filter === "All updates" || story.category === filter),
  );
  const filtered = edition.filter(
    (story) =>
      story.id !== featured?.id &&
      (filter === "All updates" || story.category === filter),
  );
  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        !["j", "k"].includes(event.key)
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,button,a,[contenteditable="true"]',
        )
      )
        return;
      const cards = [
        ...(feed.current?.querySelectorAll<HTMLElement>(".brief-card") || []),
      ];
      if (!cards.length) return;
      const index = cards.findIndex((c) => c.contains(document.activeElement));
      const next =
        index < 0
          ? event.key === "j"
            ? 0
            : cards.length - 1
          : Math.max(
              0,
              Math.min(cards.length - 1, index + (event.key === "j" ? 1 : -1)),
            );
      event.preventDefault();
      cards[next].focus();
    };
    document.addEventListener("keydown", navigate);
    return () => document.removeEventListener("keydown", navigate);
  }, []);
  function updateUrl(next: {
    depth?: Depth;
    date?: string;
    category?: string;
  }) {
    if (preview) return;
    const url = new URL(window.location.href);
    Object.entries(next).forEach(([key, value]) =>
      value ? url.searchParams.set(key, value) : url.searchParams.delete(key),
    );
    window.history.replaceState(null, "", url);
  }
  function advance(id: string) {
    const current = overrides[id] || depth;
    setOverrides((previous) => ({
      ...previous,
      [id]: depths[(depths.indexOf(current) + 1) % 3],
    }));
  }
  async function copyDigest() {
    const text = digestText(edition, date, window.location.origin);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyFallback("");
    } catch {
      setCopyFallback(text);
    }
  }
  return (
    <div className="page-container brief-page" data-depth={depth}>
      <div className="edition-line">
        <span>
          <span className="edition-dot" /> The Brief ·{" "}
          {preview ? "Unpublished preview" : "AI, in plain English"}
        </span>
        <span>
          {date
            ? `${dateLabel(date + "T12:00:00Z")} · UTC`
            : "Your next briefing"}
        </span>
      </div>
      <section className="page-heading brief-hero">
        <div>
          <span className="eyebrow">One story. Your depth.</span>
          <h1>A clearer view of AI.</h1>
        </div>
        <p>
          Get the point. Understand the stakes. See the whole picture.
          <br />
          You choose how much to take in.
        </p>
      </section>
      {preview && (
        <p className="notice">
          Layout preview only. These sample stories are not published news.
        </p>
      )}
      <section
        className="brief-reading"
        aria-labelledby="brief-title"
        ref={feed}
      >
        <div className="brief-toolbar">
          <div>
            <h2 id="brief-title">
              {today && date === today ? "Today’s briefing" : "The briefing"}
            </h2>
            <p>
              {edition.length} {edition.length === 1 ? "story" : "stories"}.
              Three ways in.
            </p>
          </div>
          <div className="depth-toggle" role="group" aria-label="Reading depth">
            {depths.map((value, i) => (
              <button
                key={value}
                aria-pressed={depth === value}
                onClick={() => {
                  setDepth(value);
                  setOverrides({});
                  updateUrl({ depth: value });
                }}
              >
                {["Quick scan", "Normal", "Deep"][i]}
              </button>
            ))}
          </div>
        </div>
        <div className="brief-controls">
          <div className="filter-tabs" aria-label="Filter news">
            {["All updates", "Models", "Research", "Industry", "Tools"].map(
              (category) => (
                <button
                  key={category}
                  aria-pressed={filter === category}
                  className={filter === category ? "active" : ""}
                  onClick={() => {
                    setFilter(category);
                    updateUrl({ category });
                  }}
                >
                  {category}
                </button>
              ),
            )}
          </div>
          <label className="edition-picker">
            Edition
            <select
              aria-label="Briefing edition"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setCopied(false);
                setCopyFallback("");
                setOverrides({});
                updateUrl({ date: e.target.value });
              }}
            >
              {initialDate && !dates.includes(initialDate) && (
                <option value={initialDate}>{initialDate}</option>
              )}
              {dates.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {featured && (
          <section
            className="brief-featured-section"
            aria-labelledby="featured-title"
          >
            <div className="brief-featured-heading">
              <h2 id="featured-title">Featured article of the week</h2>
              <span>Week of {dateLabel(`${selectedWeek}T12:00:00Z`)}</span>
            </div>
            <BriefCard
              story={featured}
              current={overrides[featured.id] || depth}
              onAdvance={() => advance(featured.id)}
              preview={preview}
              featured
            />
          </section>
        )}
        <div className="brief-list">
          {filtered.map((story, index) => (
            <BriefCard
              key={story.id}
              story={story}
              current={overrides[story.id] || depth}
              onAdvance={() => advance(story.id)}
              preview={preview}
              index={index}
            />
          ))}
        </div>
        {!filtered.length && !featured && (
          <div className="empty-state">
            <h3>
              {edition.length
                ? "No stories in this category."
                : "No published stories for this edition."}
            </h3>
            <p>
              {edition.length
                ? "Try another category to keep reading."
                : "Choose another date, or check back after the next editorial review."}
            </p>
          </div>
        )}
        <div className="brief-digest-bar">
          <span className="keyboard-hint">
            <kbd>j</kbd> / <kbd>k</kbd> move <span>·</span> <kbd>space</kbd> go
            deeper
          </span>
          <button
            className="button secondary"
            disabled={!edition.length || preview}
            onClick={copyDigest}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied
              ? "Copied"
              : date === today
                ? "Copy today’s one-liners"
                : "Copy this edition’s one-liners"}
          </button>
          <span className="sr-only" role="status">
            {copied
              ? "The entire edition’s one-liners and link were copied."
              : ""}
          </span>
        </div>
        {copyFallback && (
          <label className="copy-fallback">
            Clipboard unavailable. Select and copy the briefing below.
            <textarea
              readOnly
              value={copyFallback}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        <p className="source-note">
          {preview
            ? "Unpublished layout preview. Source checking and approval are required before publication."
            : "AI assisted. Editor reviewed. Source dates stay visible; each version stands on its own. The digest includes every story in the selected edition."}
        </p>
      </section>
      <section className="brief-next">
        <Link href="/learn">
          <BookOpen size={24} />
          <span>
            New to the terminology?<strong>Start with AI 101.</strong>
          </span>
          <ArrowUpRight size={20} />
        </Link>
        <Link href="/playground">
          <Plus size={24} />
          <span>
            Put the models to the test.
            <strong>One prompt. Different perspectives.</strong>
          </span>
          <ArrowUpRight size={20} />
        </Link>
      </section>
    </div>
  );
}

function editionWeek(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function BriefCard({
  story,
  current,
  onAdvance,
  preview,
  featured = false,
  index = 0,
}: {
  story: BriefStory;
  current: Depth;
  onAdvance: () => void;
  preview: boolean;
  featured?: boolean;
  index?: number;
}) {
  const [short, ...remaining] = annotateSections(
    [story.short_version, ...story.whole_picture, story.why_it_matters],
    preview ? [] : glossary,
  );
  return (
    <article
      className={`brief-card${featured ? " brief-featured" : ""}`}
      data-depth={current}
      tabIndex={0}
      aria-labelledby={`${story.slug}-title`}
      onKeyDown={(event) => {
        if (event.key === " " && event.target === event.currentTarget) {
          event.preventDefault();
          onAdvance();
        }
      }}
    >
      <div className="brief-card-meta">
        {!featured && (
          <span className="brief-number">
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        <span className="category-tag">{story.category}</span>
        <span className="brief-source">
          {story.source_name} ·{" "}
          <time dateTime={story.source_published_at}>
            {dateLabel(story.source_published_at)}
          </time>
        </span>
        {current === "quick" && !preview && (
          <Link
            className="brief-version-link"
            href={`/brief/${story.slug}#one-liner`}
            aria-label={`Link to the one-liner: ${story.one_liner}`}
          >
            <Link2 size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="brief-card-layout">
        <StoryImage
          src={story.image_url}
          alt={story.image_alt}
          className="brief-card-image"
          priority={featured}
        />
        <div className="brief-card-copy">
          <h3 id={`${story.slug}-title`}>
            <button
              className="brief-headline"
              aria-expanded={current !== "quick"}
              aria-controls={`${story.slug}-body`}
              onClick={onAdvance}
            >
              {story.one_liner}
              <Plus size={20} aria-hidden="true" />
            </button>
          </h3>
          <div id={`${story.slug}-body`} hidden={current === "quick"}>
            <section id={`${story.slug}-short`} className="brief-short">
              <span className="eyebrow">The short version</span>
              <p>
                <GlossaryText segments={short} scope={story.slug} />
              </p>
            </section>
            <section
              id={`${story.slug}-full`}
              className="brief-full"
              hidden={current !== "deep"}
            >
              <span className="eyebrow">The whole picture</span>
              {story.whole_picture.map((_, i) => (
                <p key={i}>
                  <GlossaryText segments={remaining[i]} scope={story.slug} />
                </p>
              ))}
              <aside className="brief-matters">
                <strong>Why it matters</strong>
                <p>
                  <GlossaryText
                    segments={remaining[story.whole_picture.length]}
                    scope={story.slug}
                  />
                </p>
              </aside>
              <a
                className="small-link"
                href={story.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Read the {story.source_name} original{" "}
                <ArrowUpRight size={16} />
              </a>
            </section>
            <div className="brief-card-actions">
              <button className="small-link" onClick={onAdvance}>
                {current === "normal"
                  ? "The whole picture"
                  : "Back to the one-liner"}
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {!preview && (
                <Link
                  className="small-link"
                  href={`/brief/${story.slug}#${current === "deep" ? "full" : "short"}`}
                >
                  Link to this version <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
