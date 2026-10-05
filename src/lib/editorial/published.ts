import "server-only";
import { unstable_cache } from "next/cache";
import { databaseConfigured, publicDatabase } from "./supabase";
import type { BriefStory } from "../brief";

const cachedPublishedStories = unstable_cache(
  async (): Promise<BriefStory[]> => {
    const db = publicDatabase();
    const [recent, featured] = await Promise.all([
      db.from("brief_publications").select("*").order("published_at", { ascending: false }).limit(500),
      // An editor can select an older article for a recent week. It must remain
      // available even when it falls outside the recent-publication window.
      db.from("brief_publications").select("*").not("featured_week", "is", null).order("featured_week", { ascending: false }).limit(500),
    ]);
    if (recent.error || featured.error)
      throw new Error("The published briefing is temporarily unavailable.");
    const stories = new Map<string,BriefStory>();
    for (const story of [...(recent.data || []), ...(featured.data || [])] as BriefStory[]) stories.set(story.id,story);
    return [...stories.values()].sort((a,b) => b.published_at.localeCompare(a.published_at));
  },
  [
    "published-brief-v2",
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
