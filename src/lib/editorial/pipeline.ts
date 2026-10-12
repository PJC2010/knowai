import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { serviceDatabase } from "./supabase";
import { boundedFetch, retrieveSourceArticle } from "./source";
import { generationRequest, parseGeneratedTiers } from "./generation";
import { discoverStories } from "./discovery";
import { requireSourceAccess } from "./source-access";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const autoDraftFeedNames = new Set(["OpenAI", "Google", "Hugging Face", "TechCrunch"]);
const check = (error: { message: string } | null) => {
  if (error)
    throw new Error(
      "Editorial storage operation failed. Check the database migration and service configuration.",
    );
};

export { discoverStories } from "./discovery";

export async function runScheduledEditorial() {
  const discovery = await discoverStories();
  const db = serviceDatabase();
  const setting = await db.from("brief_settings").select("auto_draft").eq("id",true).single();
  check(setting.error);
  if (!setting.data?.auto_draft) return discovery;
  check((await db.rpc("enqueue_brief_auto",{p_ids:discovery.autoDraftIds})).error);
  // Include auto jobs left from earlier runs, but never hand a manual job or a
  // new-feed job left by a partial rollout to the scheduled paid worker.
  const eligiblePublishers = await db.from("brief_publishers").select("id,name")
    .in("name", [...autoDraftFeedNames]);
  check(eligiblePublishers.error);
  const eligiblePublisherIds = new Set((eligiblePublishers.data || [])
    .filter(publisher => autoDraftFeedNames.has(publisher.name)).map(publisher => publisher.id));
  const autoJobIds: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const queued = await db.from("brief_jobs").select("id,story_id,dedupe_key")
      .eq("state", "queued").eq("selected", true).like("dedupe_key", "%:auto")
      .order("id").range(offset, offset + 999);
    check(queued.error);
    const jobs = queued.data || [];
    const candidateStoryIds = [...new Set(jobs
      .filter(job => job.dedupe_key === `${job.story_id}:auto`).map(job => job.story_id))];
    const eligibleSourceIds = new Set<string>();
    for (let i = 0; eligiblePublisherIds.size && i < candidateStoryIds.length; i += 100) {
      const sources = await db.from("brief_sources").select("id,publisher_id")
        .in("id", candidateStoryIds.slice(i, i + 100));
      check(sources.error);
      for (const source of sources.data || []) {
        if (eligiblePublisherIds.has(source.publisher_id)) eligibleSourceIds.add(source.id);
      }
    }
    autoJobIds.push(...jobs.filter(job => job.dedupe_key === `${job.story_id}:auto`
      && eligibleSourceIds.has(job.story_id)).map(job => job.id));
    if (jobs.length < 1000) break;
  }
  const batch = await runEditorialBatch(autoJobIds);
  return {...discovery,...batch};
}

export async function runEditorialBatch(jobIds: string[] | null = []) {
  if (!process.env.EDITORIAL_OPENROUTER_API_KEY)
    throw new Error(
      "Set the dedicated editorial OpenRouter key before generating drafts.",
    );
  const db = serviceDatabase();
  const token = randomUUID();
  const lease = await db.rpc("acquire_brief_worker", { p_token: token });
  check(lease.error);
  if (!lease.data)
    return {
      message: "Another editorial batch is already running.",
      generated: 0,
      failed: 0,
    };
  let generated = 0,
    failed = 0;
  try {
    const start = Date.now();
    // At most three calls per run; SQL enforces the configured shared UTC-day cap.
    for (let i = 0; i < 3 && Date.now() - start < 150000; i++) {
      const claimed = await db.rpc("claim_brief_selected_job", { p_token: token, p_job_ids: jobIds });
      check(claimed.error);
      const job = claimed.data?.[0];
      if (!job) break;
      const model = process.env.EDITORIAL_MODEL || "openai/gpt-4.1-mini";
      try {
        const sourceResult = await db
          .from("brief_sources")
          .select("*")
          .eq("id", job.story_id)
          .single();
        check(sourceResult.error);
        const source = sourceResult.data!;
        await requireSourceAccess(db,source.url);
        const article = await retrieveSourceArticle(source.url);
        const text = article.text;
        const imageUrl = article.imageUrl || source.source_image_url || null;
        if (article.imageUrl) check((await db.from("brief_sources").update({source_image_url:article.imageUrl}).eq("id",source.id)).error);
        check(
          (await db.from("brief_jobs").update({ model }).eq("id", job.id))
            .error,
        );
        const responseText = await boundedFetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.EDITORIAL_OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "X-Title": "knowai editorial",
            },
            body: JSON.stringify(generationRequest(model, source.title, text)),
            signal: AbortSignal.timeout(45000),
          },
          100000,
        );
        const response = JSON.parse(responseText);
        const usage = response.usage;
        // Retain known charges even when output validation fails. Missing cost stays null.
        check(
          (
            await db
              .from("brief_jobs")
              .update({
                cost:
                  typeof usage?.cost === "number" && usage.cost >= 0
                    ? usage.cost
                    : null,
                input_tokens:
                  Number.isInteger(usage?.prompt_tokens) &&
                  usage.prompt_tokens >= 0
                    ? usage.prompt_tokens
                    : null,
                output_tokens:
                  Number.isInteger(usage?.completion_tokens) &&
                  usage.completion_tokens >= 0
                    ? usage.completion_tokens
                    : null,
              })
              .eq("id", job.id)
          ).error,
        );
        const content = parseGeneratedTiers(response, text);
        check(
          (
            await db
              .from("brief_revisions")
              .insert({
                story_id: source.id,
                job_id: job.id,
                content,
                source_text: text,
                source_hash: hash(text),
                image_url: imageUrl,
                image_source: "source",
              })
          ).error,
        );
        check(
          (
            await db
              .from("brief_jobs")
              .update({
                state: "needs_review",
                finished_at: new Date().toISOString(),
              })
              .eq("id", job.id)
          ).error,
        );
        generated++;
      } catch (error) {
        const message =
          error instanceof Error && !/fetch|JSON|token/i.test(error.message)
            ? error.message
            : "Source retrieval or generation failed. A request may still have incurred a charge.";
        check(
          (
            await db
              .from("brief_jobs")
              .update({
                state: "failed",
                error: message.slice(0, 1200),
                finished_at: new Date().toISOString(),
              })
              .eq("id", job.id)
          ).error,
        );
        failed++;
      }
    }
    return {
      generated,
      failed,
      message: `${generated} drafts ready for review; ${failed} need attention. Remaining selected jobs stay queued; the configured daily limit applies to drafts and suggestions together.`,
    };
  } finally {
    await db.rpc("release_brief_worker", { p_token: token });
  }
}
