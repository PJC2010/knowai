import type { MetadataRoute } from "next";
import { getPublishedStories } from "@/lib/editorial/published";
import { siteUrl } from "@/lib/site-url";
export const revalidate = 300;
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await getPublishedStories();
  return [
    ...["", "/models", "/playground", "/learn", "/follow", "/privacy", "/terms"].map(
      (path) => ({
        url: `${siteUrl()}${path}`,
        changeFrequency: "weekly" as const,
      }),
    ),
    ...stories.map((s) => ({
      url: `${siteUrl()}/brief/${s.slug}`,
      lastModified: s.updated_at,
      changeFrequency: "weekly" as const,
    })),
  ];
}
