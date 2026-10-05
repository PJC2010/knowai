import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { serviceDatabase } from "./supabase";
import { boundedFetch, retrieveSourceArticle, extractFeedImage } from "./source";
import { generationRequest, parseGeneratedTiers } from "./generation";
import { normalizeSourceUrl } from "../brief";
import { categorize, plainText } from "../news";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const check = (error: { message: string } | null) => {
  if (error)
    throw new Error(
      "Editorial storage operation failed. Check the database migration and service configuration.",
    );
};

export async function discoverStories() {
  const db = serviceDatabase();
  let discovered = 0;
  const unavailable: string[] = [];
  const discoveredIds: string[] = [];
  const publishers = await db.from("brief_publishers").select("id,name,feed_url").eq("enabled", true);
  check(publishers.error);
  for (const publisher of publishers.data || []) {
    const { id: publisherId, name, feed_url: url } = publisher;
    check((await db.from("brief_publishers").update({last_attempt_at: new Date().toISOString()}).eq("id",publisherId)).error);
    try {
      const raw = await boundedFetch(
        url,
        { signal: AbortSignal.timeout(15000) },
        1_500_000,
        3,
      );
      const xml = new XMLParser({ processEntities: false, ignoreAttributes: false }).parse(raw);
      const entries = xml.rss?.channel?.item;
      if (!xml.rss?.channel) throw new Error("Invalid feed");
      const items = Array.isArray(entries) ? entries : entries ? [entries] : [];
      for (const item of items.slice(0, 8)) {
        let canonical: string;
        try {
          canonical = normalizeSourceUrl(String(item.link));
        } catch {
          continue;
        }
        const title = plainText(item.title).slice(0, 500);
        const date = new Date(item.pubDate);
        if (
          !title ||
          !Number.isFinite(date.getTime()) ||
          date.getTime() > Date.now() + 300000 ||
          (name === "TechCrunch" &&
            /expo.*pass|disrupt.*ticket|last.*chance|save.*\$|deal.*disrupt/i.test(
              title,
            ))
        )
          continue;
        const slug = `${title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 110)}-${hash(canonical).slice(0, 8)}`;
        const sourceName =
          name === "Hugging Face" && item["dc:creator"]
            ? `${plainText(item["dc:creator"])} · Hugging Face`
            : name;
        const inserted = await db
          .from("brief_sources")
          .upsert(
            {
              url: canonical,
              title,
              slug,
              source_name: sourceName,
              source_published_at: date.toISOString(),
              category: categorize(title),
              publisher_id: publisherId,
              source_image_url: extractFeedImage(item, canonical),
            },
            { onConflict: "url", ignoreDuplicates: true },
          )
          .select("id");
        check(inserted.error);
        if (inserted.data?.length) {
          discovered++;
          discoveredIds.push(inserted.data[0].id);
        }
      }
      check((await db.from("brief_publishers").update({last_success_at:new Date().toISOString(),last_error:null}).eq("id",publisherId)).error);
    } catch {
      unavailable.push(name);
      check((await db.from("brief_publishers").update({last_error:"Feed retrieval or validation failed. Try refreshing again."}).eq("id",publisherId)).error);
    }
  }
  return { discovered, discoveredIds, unavailable, message: `${discovered} new stories discovered. No drafts generated.${unavailable.length ? ` Unavailable feeds: ${unavailable.join(", ")}.` : ""}` };
}

export async function runScheduledEditorial() {
  const discovery = await discoverStories();
  const db = serviceDatabase();
  const setting = await db.from("brief_settings").select("auto_draft").eq("id",true).single();
  check(setting.error);
  if (!setting.data?.auto_draft) return discovery;
  check((await db.rpc("enqueue_brief_auto",{p_ids:discovery.discoveredIds})).error);
  const batch = await runEditorialBatch(null);
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
