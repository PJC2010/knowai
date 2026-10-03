import { Suspense } from "react";
import { getModels } from "@/lib/models";
import { ModelLibrary } from "@/components/model-library";
export const metadata = { title: "Model Library" };
export const revalidate = 1800;
export default async function ModelsPage() {
  const data = await getModels();
  return (
    <Suspense
      fallback={
        <div className="page-container loading-page">
          Opening the model library…
        </div>
      }
    >
      <ModelLibrary data={data} />
    </Suspense>
  );
}
