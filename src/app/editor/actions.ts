"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  sessionDatabase,
  requireEditor,
  serviceDatabase,
} from "@/lib/editorial/supabase";
import { runEditorialBatch } from "@/lib/editorial/pipeline";
import { importStarterDrafts } from "@/lib/editorial/starters";
import { siteUrl } from "@/lib/site-url";
import { validateTiers, type Tiers } from "@/lib/brief";

export type EditorActionState = {
  ok: boolean;
  message: string;
  revisionId?: string;
};
export async function loginEditor(
  _: EditorActionState,
  form: FormData,
): Promise<EditorActionState> {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const allowed = (process.env.EDITOR_EMAIL_ALLOWLIST || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!email || email.length > 254)
    return { ok: false, message: "Enter your editor email address." };
  if (allowed.includes(email)) {
    try {
      const db = await sessionDatabase();
      const { error } = await db.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${siteUrl()}/editor/callback`,
        },
      });
      if (error)
        return {
          ok: false,
          message:
            "Could not send the sign-in link. Check your configuration or try again later.",
        };
    } catch {
      return { ok: false, message: "Editor sign-in is not configured yet." };
    }
  }
  return {
    ok: true,
    message:
      "If this address is authorized, a sign-in link is on its way. Open it in this browser.",
  };
}
export async function logoutEditor() {
  const db = await sessionDatabase();
  await db.auth.signOut();
  revalidatePath("/editor");
}
export async function editorialAction(
  _: EditorActionState,
  form: FormData,
): Promise<EditorActionState> {
  try {
    const { db } = await requireEditor();
    const intent = String(form.get("intent"));
    if (intent === "import") {
      const message = await importStarterDrafts();
      revalidatePath("/editor");
      return { ok: true, message };
    }
    if (intent === "refresh") {
      const result = await runEditorialBatch();
      revalidatePath("/editor");
      return { ok: true, message: result.message };
    }
    const id = String(form.get("id") || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Select a valid draft.");
    if (intent === "regenerate") {
      if (form.get("confirmCharge") !== "yes")
        throw new Error("Confirm that regeneration can incur a new charge.");
      const exists = await db
        .from("brief_sources")
        .select("id")
        .eq("id", id)
        .single();
      if (exists.error) throw new Error("Story not found.");
      const inserted = await serviceDatabase()
        .from("brief_jobs")
        .insert({ story_id: id, dedupe_key: `${id}:manual:${randomUUID()}` });
      if (inserted.error) throw new Error("Could not queue regeneration.");
      const result = await runEditorialBatch(false);
      revalidatePath("/editor");
      return { ok: true, message: `Regeneration queued. ${result.message}` };
    }
    if (intent === "fork") {
      const { data, error } = await db.rpc("fork_brief_revision", { p_id: id });
      if (error) throw new Error("Could not create a new revision.");
      revalidatePath("/editor");
      return {
        ok: true,
        message:
          "New draft revision created. The published story is unchanged.",
        revisionId: data,
      };
    }
    const version = Number(form.get("version"));
    if (!Number.isSafeInteger(version) || version < 1)
      throw new Error("Reload this draft before continuing.");
    if (intent === "save") {
      const evidence = JSON.parse(String(form.get("evidence") || "[]"));
      const content: Tiers = {
        oneLiner: String(form.get("oneLiner") || "").trim(),
        shortVersion: String(form.get("shortVersion") || "").trim(),
        wholePicture: String(form.get("wholePicture") || "")
          .trim()
          .split(/\n\s*\n/)
          .filter(Boolean),
        whyItMatters: String(form.get("whyItMatters") || "").trim(),
        evidence,
      };
      if (
        !Array.isArray(evidence) ||
        evidence.length > 8 ||
        evidence.some(
          (e) =>
            !e || typeof e.claim !== "string" || typeof e.quote !== "string",
        ) ||
        JSON.stringify(content).length > 60000
      )
        throw new Error("The draft is too large or evidence is invalid.");
      const { error } = await db.rpc("save_brief_revision", {
        p_id: id,
        p_version: version,
        p_content: content,
      });
      if (error)
        throw new Error(
          "Could not save. The draft may have changed; reload before trying again.",
        );
    } else if (intent === "publish" || intent === "reject") {
      if (intent === "publish") {
        if (
          form.get("sourceChecked") !== "yes" ||
          form.get("tiersChecked") !== "yes"
        )
          throw new Error(
            "Confirm the source and all three versions were reviewed.",
          );
        const { data, error } = await db
          .from("brief_revisions")
          .select("content,source_text")
          .eq("id", id)
          .single();
        if (error) throw new Error("Draft not found.");
        const errors = validateTiers(data.content, data.source_text);
        if (errors.length) throw new Error(errors.join(" "));
      }
      const { data: slug, error } = await db.rpc("review_brief_revision", {
        p_id: id,
        p_version: version,
        p_publish: intent === "publish",
      });
      if (error)
        throw new Error(
          "Could not review. The draft may have changed or failed validation; reload first.",
        );
      if (intent === "publish") {
        revalidateTag("brief", { expire: 0 });
        revalidatePath("/");
        revalidatePath(`/brief/${slug}`);
        revalidatePath("/sitemap.xml");
      }
    } else throw new Error("Unknown editorial action.");
    revalidatePath("/editor");
    return {
      ok: true,
      message:
        intent === "publish"
          ? "Story published. All three versions are live at its permanent URL."
          : intent === "reject"
            ? "Draft rejected. Existing published versions are unchanged."
            : "Draft saved. It is still unpublished.",
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The editorial action failed. Try again.",
    };
  }
}
