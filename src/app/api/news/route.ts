import { getNews } from "@/lib/news";
export async function GET() {
  return Response.json(await getNews());
}
