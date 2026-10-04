import "server-only";
import { createHash } from "node:crypto";
import starters from "@/data/editorial-starters.json";
import { serviceDatabase } from "./supabase";
import { retrieveSource } from "./source";
import { validateTiers } from "../brief";

/** These AI-assisted starter texts are never public until an editor approves them. */
export async function importStarterDrafts() {
  const db = serviceDatabase();
  let imported = 0,
    skipped = 0;
  for (const starter of starters) {
    const { content, ...source } = starter;
    const inserted = await db
      .from("brief_sources")
      .upsert(source, { onConflict: "url", ignoreDuplicates: true });
    if (inserted.error) throw new Error("Could not store the starter source.");
    const sourceRow = await db
      .from("brief_sources")
      .select("id")
      .eq("url", source.url)
      .single();
    if (sourceRow.error) throw new Error("Could not load the starter source.");
    const job = await db
      .from("brief_jobs")
      .upsert(
        {
          story_id: sourceRow.data.id,
          dedupe_key: `${sourceRow.data.id}:first`,
          state: "generating",
          attempted_at: new Date().toISOString(),
          model: "AI-assisted starter; no API call",
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (job.error) throw new Error("Could not reserve the starter import.");
    if (!job.data?.length) {
      skipped++;
      continue;
    }
    const jobId = job.data[0].id;
    try {
      const text = await retrieveSource(source.url);
      if (validateTiers(content, text).length)
        throw new Error(
          "Starter evidence no longer matches the source; regenerate and review.",
        );
      const revision = await db
        .from("brief_revisions")
        .insert({
          story_id: sourceRow.data.id,
          job_id: jobId,
          content,
          source_text: text,
          source_hash: createHash("sha256").update(text).digest("hex"),
        });
      if (revision.error) throw new Error("Could not save starter revision.");
      const completed = await db
        .from("brief_jobs")
        .update({
          state: "needs_review",
          cost: 0,
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      if (completed.error) throw new Error("Could not finish starter import.");
      imported++;
    } catch {
      await db
        .from("brief_jobs")
        .update({
          state: "failed",
          error:
            "Starter source could not be verified. Regenerate explicitly to prepare a new draft.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      skipped++;
    }
  }
  return `${imported} starter drafts imported for review; ${skipped} already imported or need source verification. Nothing was published.`;
}
