import { timingSafeEqual } from "node:crypto";
import { runEditorialBatch } from "@/lib/editorial/pipeline";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : "";
  const supplied = request.headers.get("authorization") || "";
  if (
    !expected ||
    Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runEditorialBatch());
  } catch {
    return Response.json(
      {
        error:
          "Editorial batch failed. Check the editor queue and server configuration.",
      },
      { status: 503 },
    );
  }
}
