import { getNews } from "@/lib/news";
import { getPublishedStories } from "@/lib/editorial/published";
export async function GET() {
  if (process.env.BRIEF_V2_ENABLED === "true") {
    try {
      const stories = await getPublishedStories();
      if (stories.length)
        return Response.json({ format: "three-depth", stories });
    } catch {
      return Response.json(
        { error: "The published briefing is temporarily unavailable." },
        { status: 503 },
      );
    }
  }
  return Response.json(await getNews());
}
