import "server-only";
import { unstable_cache } from "next/cache";
import { databaseConfigured, publicDatabase } from "./supabase";
import type { BriefStory } from "../brief";

export const getPublishedStories = unstable_cache(
  async (): Promise<BriefStory[]> => {
    if (!databaseConfigured()) return [];
    const { data, error } = await publicDatabase()
      .from("brief_publications")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(500);
    if (error)
      throw new Error("The published briefing is temporarily unavailable.");
    return (data || []) as BriefStory[];
  },
  ["published-brief-v1"],
  { revalidate: 300, tags: ["brief"] },
);
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
