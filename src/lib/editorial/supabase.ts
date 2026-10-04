import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { siteUrl } from "../site-url";

export const databaseConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
export function publicDatabase() {
  if (!databaseConfigured())
    throw new Error("Editorial database is not configured.");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export function serviceDatabase() {
  if (!process.env.SUPABASE_SECRET_KEY || !databaseConfigured())
    throw new Error("Editorial service credentials are not configured.");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function sessionDatabase() {
  if (!databaseConfigured())
    throw new Error("Editorial database is not configured.");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: siteUrl().startsWith("https://"),
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Read-only Server Component; actions and callback persist refreshes. */
          }
        },
      },
    },
  );
}
export async function editorSession() {
  const db = await sessionDatabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || !user.email_confirmed_at) return null;
  const { data, error } = await db.rpc("is_brief_editor");
  return !error && data === true ? { db, user } : null;
}
export async function requireEditor() {
  const session = await editorSession();
  if (!session) throw new Error("Sign in with an authorized editor account.");
  return session;
}
