import { NextResponse } from "next/server";
import { editorSession, sessionDatabase } from "@/lib/editorial/supabase";
import { siteUrl } from "@/lib/site-url";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  try {
    const db = await sessionDatabase();
    if (code) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error && (await editorSession()))
        return NextResponse.redirect(new URL("/editor", siteUrl()));
    }
    await db.auth.signOut();
  } catch {
    /* Fail closed; do not expose auth provider messages or callback codes. */
  }
  return NextResponse.redirect(new URL("/editor?signin=failed", siteUrl()));
}
