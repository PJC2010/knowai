import { Suspense } from "react";
import { getModels } from "@/lib/models";
import { Playground } from "@/components/playground";
export const metadata = { title: "Model Playground" };
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
