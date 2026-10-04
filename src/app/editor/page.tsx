import Link from "next/link";
import { databaseConfigured, editorSession } from "@/lib/editorial/supabase";
import { loadDesk } from "@/lib/editorial/desk";
import type { DeskQuery } from "@/lib/editorial/desk-types";
import { EditorDesk, EditorLogin } from "@/components/editor";
import { logoutEditor } from "./actions";
import { mutateDesk } from "./desk-actions";

export const metadata = { title: "Editorial desk", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export default async function EditorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query: DeskQuery = {};
  for (const key of ["view", "id", "q", "publisher", "category", "status", "since", "page"] as const) {
    const value = raw[key];
    if (typeof value === "string") query[key] = value;
  }
  if (!databaseConfigured()) return <div className="page-container editor-page"><header className="desk-heading"><div><span className="eyebrow">Private editorial desk</span><h1>A human in the loop.</h1><p>Editor setup is not complete. Configure Supabase and an authorized editor account to prepare and review stories.</p></div></header><p className="notice">The public feed remains available. No draft generation or publication runs without configuration.</p><Link className="button secondary" href="/">Back to The Brief</Link></div>;
  if (!await editorSession()) return <div className="page-container editor-page"><header className="desk-heading"><div><span className="eyebrow">Private editorial desk</span><h1>Welcome back, editor.</h1><p>Sign in to check sources, shape the voice, and approve the next briefing.</p></div></header>{raw.signin === "failed" && <p className="notice">The sign-in link expired or this account does not have editor access.</p>}<EditorLogin /></div>;
  const data = await loadDesk(query);
  return <EditorDesk data={data} query={query} mutate={mutateDesk} signOut={<form action={logoutEditor}><button className="text-button">Sign out</button></form>} />;
}
