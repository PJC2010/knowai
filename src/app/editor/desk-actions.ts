"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireEditor } from "@/lib/editorial/supabase";
import { executeDeskMutation, executeDeskImageUpload } from "@/lib/editorial/desk";
import type { DeskMutation, DeskResult } from "@/lib/editorial/desk-types";

export async function mutateDesk(input: DeskMutation): Promise<DeskResult> {
  let session;
  try { session = await requireEditor(); }
  catch { return {ok:false,code:'failed',message:'Sign in with an authorized editor account.'}; }
  const result = await executeDeskMutation(input,session);
  if (result.ok && (input.intent === 'publish' || input.intent === 'feature') && result.slug) {
    revalidateTag('brief',{expire:0});
    revalidatePath('/');
    revalidatePath(`/brief/${result.slug}`);
    revalidatePath('/sitemap.xml');
  }
  // Never refresh the editor here: autosave must not replace local in-flight text.
  return result;
}

export async function uploadDeskImage(form: FormData): Promise<DeskResult> {
  let session;
  try { session = await requireEditor(); }
  catch { return {ok:false,code:'failed',message:'Sign in with an authorized editor account.'}; }
  return executeDeskImageUpload(form,session);
}
