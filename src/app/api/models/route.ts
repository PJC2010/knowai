import { getModels } from "@/lib/models";
export async function GET() {
  return Response.json(await getModels());
}
