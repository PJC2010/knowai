import { getNews } from "@/lib/news";
import { getModels, featuredModels } from "@/lib/models";
import { Newsroom } from "@/components/newsroom";
import { BriefFeed } from "@/components/brief-feed";
import { getPublishedStories } from "@/lib/editorial/published";
import { depths, type Depth } from "@/lib/brief";
import { siteUrl } from "@/lib/site-url";
export const revalidate = 900;
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read before the rollout branch so the first publication cannot turn a
  // previously prerendered legacy homepage into a dynamic route at runtime.
  const query = await searchParams;
  const feedUrl = new URL("/feed.xml", siteUrl()).href;
  if (process.env.BRIEF_V2_ENABLED === "true") {
    const stories = await getPublishedStories();
    if (stories.length) {
      const depth =
        typeof query.depth === "string" && depths.includes(query.depth as Depth)
          ? (query.depth as Depth)
          : "normal";
      return (
        <BriefFeed
          stories={stories}
          feedUrl={feedUrl}
          initialDepth={depth}
          depthFromUrl={typeof query.depth === "string" && depths.includes(query.depth as Depth)}
          initialDate={
            typeof query.date === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(query.date)
              ? query.date
              : undefined
          }
          initialCategory={
            typeof query.category === "string" &&
            ["All updates", "Models", "Research", "Industry", "Tools"].includes(
              query.category,
            )
              ? query.category
              : undefined
          }
        />
      );
    }
  }
  const [news, catalog] = await Promise.all([getNews(), getModels()]);
  return (
    <Newsroom
      data={news}
      feedUrl={feedUrl}
      models={featuredModels(catalog.models)}
      catalogInfo={{ fallback: catalog.fallback, fetchedAt: catalog.fetchedAt }}
    />
  );
}
