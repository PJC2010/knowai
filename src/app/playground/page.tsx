import { Suspense } from "react";
import { getModels } from "@/lib/models";
import { Playground } from "@/components/playground";
import { pageMetadata } from "@/lib/page-metadata";
export const metadata = pageMetadata(
  "Model Playground — Compare AI answers",
  "Ask AI models the same question and compare their answers side by side. Connect your own OpenRouter account to run models and see usage costs.",
  "/playground",
);
export const revalidate = 1800;
export default async function PlaygroundPage() {
  const data = await getModels();
  return (
    <Suspense
      fallback={
        <div className="page-container loading-page">
          Getting the playground ready…
        </div>
      }
    >
      <Playground data={data} />
    </Suspense>
  );
}
