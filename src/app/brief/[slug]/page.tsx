import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedStory } from "@/lib/editorial/published";
import { dateLabel } from "@/lib/format";
import { siteUrl } from "@/lib/site-url";
import { StoryImage } from "@/components/story-image";

export const revalidate = 300;
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const story = await getPublishedStory(slug);
  if (!story) notFound();
  return {
    title: story.one_liner,
    description: story.short_version,
    alternates: { canonical: `/brief/${story.slug}` },
    openGraph: {
      type: "article",
      title: story.one_liner,
      description: story.short_version,
      url: `/brief/${story.slug}`,
      publishedTime: story.published_at,
      modifiedTime: story.updated_at,
      images: story.image_url
        ? [{ url: story.image_url, alt: story.image_alt || "" }]
        : [],
    },
    twitter: {
      card: story.image_url ? "summary_large_image" : "summary",
      title: story.one_liner,
      description: story.short_version,
      images: story.image_url ? [story.image_url] : [],
    },
  };
}
export default async function StoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const story = await getPublishedStory((await params).slug);
  if (!story) notFound();
  const structured = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: story.one_liner,
    description: story.short_version,
    articleBody: story.whole_picture.join("\n\n"),
    datePublished: story.published_at,
    dateModified: story.updated_at,
    author: { "@type": "Organization", name: "knowai", url: siteUrl() },
    publisher: { "@type": "Organization", name: "knowai" },
    mainEntityOfPage: `${siteUrl()}/brief/${story.slug}`,
    citation: story.source_url,
    ...(story.image_url ? { image: story.image_url } : {}),
  };
  return (
    <article className="page-container story-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structured).replace(/</g, "\\u003c"),
        }}
      />
      <header className="page-heading">
        <Link href={`/?date=${story.edition_date}`} className="small-link">
          ← Back to The Brief
        </Link>
        <div className="story-kicker">
          <span className="category-tag">{story.category}</span>
          <span>AI assisted · Editor reviewed</span>
        </div>
        <span className="eyebrow" id="one-liner">
          The one-liner
        </span>
        <h1>{story.one_liner}</h1>
        <p className="story-dates">
          Source: {story.source_name} · {dateLabel(story.source_published_at)}
          <br />
          Published by knowai: {dateLabel(story.published_at)}
          {story.updated_at !== story.published_at && (
            <> · Updated: {dateLabel(story.updated_at)}</>
          )}
        </p>
      </header>
      <StoryImage
        src={story.image_url}
        alt={story.image_alt}
        className="story-page-image"
        priority
      />
      <nav className="story-depth-links" aria-label="Jump to reading depth">
        <a href="#one-liner">The one-liner</a>
        <a href="#short">The short version</a>
        <a href="#full">The whole picture</a>
      </nav>
      <section id="short" className="story-section">
        <h2>The short version</h2>
        <p>{story.short_version}</p>
      </section>
      <section id="full" className="story-section">
        <h2>The whole picture</h2>
        {story.whole_picture.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
        <aside className="brief-matters">
          <strong>Why it matters</strong>
          <p>{story.why_it_matters}</p>
        </aside>
        <a
          className="button secondary"
          href={story.source_url}
          target="_blank"
          rel="noreferrer"
        >
          Read the {story.source_name} original ↗
        </a>
      </section>
    </article>
  );
}
