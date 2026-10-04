import "server-only";
import { unstable_cache } from "next/cache";
import { databaseConfigured, publicDatabase } from "./supabase";
import type { BriefStory } from "../brief";

const cachedPublishedStories = unstable_cache(
  async (): Promise<BriefStory[]> => {
    const { data, error } = await publicDatabase()
      .from("brief_publications")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(500);
    if (error)
      throw new Error("The published briefing is temporarily unavailable.");
    return (data || []) as BriefStory[];
  },
  [
    "published-brief-v1",
    process.env.NEXT_PUBLIC_SUPABASE_URL || "unconfigured",
  ],
  { revalidate: 300, tags: ["brief"] },
);
export async function getPublishedStories(): Promise<BriefStory[]> {
  // Configuration checks must happen before a cache hit; cache namespaces must
  // also change when switching Supabase projects or local test fixtures.
  return databaseConfigured() ? cachedPublishedStories() : [];
}
export const getPublishedStory = async (
  slug: string,
): Promise<BriefStory | null> => {
  if (!databaseConfigured() || !/^[a-z0-9-]{1,180}$/.test(slug)) return null;
  const { data, error } = await publicDatabase()
    .from("brief_publications")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error("This story is temporarily unavailable.");
  return data as BriefStory | null;
};
