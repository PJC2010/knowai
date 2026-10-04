"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  SlidersHorizontal,
  Sparkles,
  FlaskConical,
  BookOpen,
  Plus,
  Radio,
  Newspaper,
  ChevronDown,
} from "@/components/icons";
import type { NewsData, Model, Article } from "@/lib/types";
import { dateLabel, formatPrice, formatContext } from "@/lib/format";
import { ModelMark, providerName } from "./model-mark";

function ArticleMeta({ article }: { article: Article }) {
  return (
    <div className="article-meta">
      <span
        className={`source-dot source-${article.source.toLowerCase().replace(/\W/g, "")}`}
      />
      <span>{article.source}</span>
      <span className="meta-dot">·</span>
      <time dateTime={article.publishedAt}>
        {dateLabel(article.publishedAt)}
      </time>
    </div>
  );
}
export function Newsroom({
  data,
  models,
  catalogInfo,
}: {
  data: NewsData;
  models: Model[];
  catalogInfo: { fallback: boolean; fetchedAt: string };
}) {
  const [filter, setFilter] = useState("All updates");
  const [limit, setLimit] = useState(6);
  const lead =
    data.articles.find((a) => a.source === "OpenAI") || data.articles[0];
  const secondary = [
    ...new Map(
      data.articles
        .filter((a) => a.id !== lead?.id && a.source !== lead?.source)
        .map((a) => [
          a.source,
          data.articles.find((first) => first.source === a.source)!,
        ]),
    ).values(),
  ].slice(0, 2);
  const filtered = data.articles.filter(
    (a) => filter === "All updates" || a.category === filter,
  );
  return (
    <div className="page-container newsroom">
      <div className="edition-line">
        <span>
          <span className="edition-dot" /> Your daily AI briefing
        </span>
        <time>
          {new Date(data.fetchedAt).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}
        </time>
      </div>
      <section className="page-heading home-heading">
        <h1>
          A clearer view
          <br />
          of AI<span className="heading-period">.</span>
        </h1>
        <div className="home-context">
          <p>
            The news that matters. The models worth knowing. All in plain
            English.
          </p>
          <Link className="quiet-link" href="/learn">
            <BookOpen size={16} /> New to AI? Start here
          </Link>
        </div>
      </section>
      {(data.fallback || data.sources.some((s) => !s.ok)) && (
        <div className="notice">
          {data.fallback
            ? `Showing our saved briefing from ${dateLabel(data.fetchedAt)}. Live feeds are temporarily unavailable.`
            : `Some sources are temporarily unavailable: ${data.sources
                .filter((s) => !s.ok)
                .map((s) => s.name)
                .join(", ")}.`}
        </div>
      )}
      {lead && (
        <section className="featured-grid" aria-label="Featured stories">
          <a
            className="lead-story"
            href={lead.url}
            target="_blank"
            rel="noreferrer"
          >
            <Image
              src="/images/editorial.png"
              alt="Abstract green glass ribbons, an editorial illustration"
              fill
              priority
              sizes="(max-width: 760px) 100vw, 60vw"
            />
            <div className="lead-shade" />
            <div className="lead-top">
              <span className="feature-badge">
                <Sparkles size={13} /> In focus
              </span>
              <span className="image-note">Editorial illustration</span>
            </div>
            <div className="lead-content">
              <span className="eyebrow">The big picture</span>
              <h2>{lead.title}</h2>
              <p>{lead.description}</p>
              <div className="lead-bottom">
                <ArticleMeta article={lead} />
                <span className="round-link">
                  <ArrowUpRight size={20} />
                </span>
              </div>
            </div>
          </a>
          <div className="secondary-stories">
            {secondary.map((article, i) => (
              <a
                className={`secondary-story secondary-${i}`}
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noreferrer"
              >
                <div className="story-top">
                  <span
                    className={`category-tag tag-${article.category.toLowerCase()}`}
                  >
                    {article.category}
                  </span>
                  <ArrowUpRight size={18} />
                </div>
                <h2>{article.title}</h2>
                <p>
                  {article.description ||
                    "Explore the original announcement, with the details straight from the source."}
                </p>
                <ArticleMeta article={article} />
              </a>
            ))}
          </div>
        </section>
      )}
      <div className="brief-footnote">
        <Radio size={13} />
        <span>Source linked. Feeds refresh on visits every 15 minutes.</span>
        <span className="footnote-right">
          OpenAI <span>·</span> Google <span>·</span> Hugging Face{" "}
          <span>·</span> TechCrunch
        </span>
      </div>
      <section className="latest-section" id="latest" data-reveal>
        <div className="section-heading">
          <div className="section-title">
            <Newspaper size={21} />
            <h2>The latest, made simple.</h2>
          </div>
          <span className="section-caption">
            The newest stories, with original sources.
          </span>
        </div>
        <div className="filter-row">
          <div className="filter-tabs" aria-label="Filter news">
            {["All updates", "Models", "Research", "Industry", "Tools"].map(
              (item) => (
                <button
                  aria-pressed={filter === item}
                  className={filter === item ? "active" : ""}
                  key={item}
                  onClick={() => {
                    setFilter(item);
                    setLimit(6);
                  }}
                >
                  {item}
                </button>
              ),
            )}
          </div>
          <span className="sort-label">
            <SlidersHorizontal size={14} /> Latest first
          </span>
        </div>
        <div className="news-grid">
          {filtered.slice(0, limit).map((article) => (
            <a
              className="news-card"
              href={article.url}
              key={article.id}
              target="_blank"
              rel="noreferrer"
            >
              <div className="story-top">
                <span
                  className={`category-tag tag-${article.category.toLowerCase()}`}
                >
                  {article.category}
                </span>
                <ArrowUpRight size={16} />
              </div>
              <h3>{article.title}</h3>
              <p>
                {article.description ||
                  "Get the full story and technical details in the original announcement."}
              </p>
              <ArticleMeta article={article} />
            </a>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            No updates in this category right now. Check another category.
          </div>
        )}
        {limit < filtered.length && (
          <button
            className="button secondary load-more"
            onClick={() => setLimit(limit + 6)}
          >
            More to know <ChevronDown size={16} />
          </button>
        )}
      </section>
      <section className="playground-banner" data-reveal>
        <div className="banner-icon">
          <FlaskConical size={30} />
        </div>
        <div>
          <span className="eyebrow">An experiment worth trying</span>
          <h2>Same prompt. Different perspectives.</h2>
          <p>Try models side by side. Find your favorite. See what it costs.</p>
        </div>
        <Link href="/playground" className="button lime">
          Open the playground <Plus size={17} />
        </Link>
      </section>
      <section className="spotlight-section" data-reveal>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Meet the models</span>
            <h2>A few names to know.</h2>
          </div>
          <Link className="quiet-link" href="/models">
            Explore the model library <Plus size={16} />
          </Link>
        </div>
        {catalogInfo.fallback && (
          <p className="notice">
            Saved model prices from {dateLabel(catalogInfo.fetchedAt)}. Live
            pricing is temporarily unavailable.
          </p>
        )}
        <div className="spotlight-grid">
          {models.map((model) => (
            <Link
              className="spotlight-card"
              key={model.id}
              href={`/models?search=${encodeURIComponent(model.id)}`}
            >
              <div className="model-title-row">
                <ModelMark provider={model.provider} />
                <div>
                  <span className="provider-name">
                    {providerName(model.provider)}
                  </span>
                  <h3>{model.name}</h3>
                </div>
              </div>
              <div className="spotlight-stat">
                <span>Input / 1M tokens</span>
                <strong>{formatPrice(model.inputPrice)}</strong>
              </div>
              <div className="spotlight-stat">
                <span>Context window</span>
                <strong>{formatContext(model.contextLength)} tokens</strong>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <div className="source-note">
        News summaries come from publisher feeds and source-checked editorial
        notes; categories are automatically assigned. Linked articles reflect
        their publishers’ views. Prices are in USD.
      </div>
    </div>
  );
}
