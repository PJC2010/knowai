import { Suspense } from "react";
import { getModels } from "@/lib/models";
import { ModelLibrary } from "@/components/model-library";
import { pageMetadata } from "@/lib/page-metadata";
export const metadata = pageMetadata(
  "Model Library — Explore AI models and costs",
  "Browse AI models, compare prices, and see what each one can do. Explore text, image, and other models with clear pricing information.",
  "/models",
);
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
