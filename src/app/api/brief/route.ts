import { getPublishedStories } from "@/lib/editorial/published";
export async function GET() {
  try {
    return Response.json({ stories: await getPublishedStories() });
  } catch {
    return Response.json(
      { error: "The published briefing is temporarily unavailable." },
      { status: 503 },
    );
  }
}
