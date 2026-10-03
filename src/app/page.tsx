import { getNews } from "@/lib/news";
import { getModels, featuredModels } from "@/lib/models";
import { Newsroom } from "@/components/newsroom";
export const revalidate = 900;
export default async function Home() {
  const [news, catalog] = await Promise.all([getNews(), getModels()]);
  return (
    <Newsroom
      data={news}
      models={featuredModels(catalog.models)}
      catalogInfo={{ fallback: catalog.fallback, fetchedAt: catalog.fetchedAt }}
    />
  );
}
