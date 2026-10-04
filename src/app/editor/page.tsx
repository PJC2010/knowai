import Link from "next/link";
import { databaseConfigured, editorSession } from "@/lib/editorial/supabase";
import {
  EditorJobAction,
  EditorLogin,
  RevisionEditor,
} from "@/components/editor";
import { logoutEditor } from "./actions";
import type { Revision } from "@/lib/brief";
import type { NewsCategory } from "@/lib/types";
export const metadata = {
  title: "Editorial desk",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Source = {
  id: string;
  slug: string;
  url: string;
  title: string;
  source_name: string;
  source_published_at: string;
  category: NewsCategory;
};
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  if (!databaseConfigured())
    return (
      <div className="page-container editor-page">
        <header className="page-heading">
          <span className="eyebrow">The editorial desk</span>
          <h1>A human in the loop.</h1>
          <p>
            Editor setup is not complete. Configure Supabase and an authorized
            editor account to prepare and review stories.
          </p>
        </header>
        <p className="notice">
          The current public feed remains available. No draft generation or
          publication runs without configuration.
        </p>
        <Link className="button secondary" href="/">
          Back to The Brief
        </Link>
      </div>
    );
  const session = await editorSession();
  if (!session)
    return (
      <div className="page-container editor-page">
        <header className="page-heading">
          <span className="eyebrow">Private editorial desk</span>
          <h1>Welcome back, editor.</h1>
          <p>
            Sign in to check sources, shape the voice, and approve the next
            briefing.
          </p>
        </header>
        {query.signin === "failed" && (
          <p className="notice">
            The sign-in link expired or this account does not have editor
            access.
          </p>
        )}
        <EditorLogin />
      </div>
    );
  const { db } = session;
  const selected = [
    "needs_review",
    "published",
    "rejected",
    "failed",
    "queued",
  ].includes(query.view || "")
    ? query.view!
    : "needs_review";
  const [revisions, jobs, active] = await Promise.all([
    db
      .from("brief_revisions")
      .select("*,brief_sources(*)")
      .eq(
        "state",
        ["failed", "queued"].includes(selected) ? "needs_review" : selected,
      )
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("brief_jobs")
      .select("*,brief_sources(*)")
      .order("created_at", { ascending: false })
      .limit(100),
    query.id && /^[0-9a-f-]{36}$/i.test(query.id)
      ? db
          .from("brief_revisions")
          .select("*,brief_sources(*)")
          .eq("id", query.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (revisions.error || jobs.error || active.error)
    throw new Error(
      "Could not load the editorial desk. Check the database migration and editor permissions.",
    );
  const revision = active.data as (Revision & { brief_sources: Source }) | null;
  const history = revision
    ? await db
        .from("brief_revision_history")
        .select("id,action,version,created_at,content")
        .eq("revision_id", revision.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : null;
  return (
    <div className="page-container editor-page">
      <header className="page-heading">
        <span className="eyebrow">Private editorial desk</span>
        <h1>
          Sharp outside.
          <br />
          Rigorous inside.
        </h1>
        <p>
          Every story earns its place through a source check and an editorial
          decision.
        </p>
      </header>
      <div className="editor-top">
        <div className="editor-import-actions">
          <EditorJobAction />
          <EditorJobAction importStarters />
        </div>
        <form action={logoutEditor}>
          <button className="text-button">Sign out</button>
        </form>
      </div>
      <p className="source-note">
        Each batch prepares up to three drafts; ten attempts per UTC day
        maximum. Failed or interrupted requests may still cost money.
        Publication always requires your approval.
      </p>
      <nav className="editor-tabs" aria-label="Editorial queues">
        {["needs_review", "failed", "queued", "published", "rejected"].map(
          (view) => (
            <Link
              key={view}
              href={`/editor?view=${view}`}
              aria-current={view === selected ? "page" : undefined}
            >
              {view.replaceAll("_", " ")}
            </Link>
          ),
        )}
      </nav>
      <div className="editor-queue">
        {["failed", "queued"].includes(selected)
          ? jobs.data
              ?.filter((j) =>
                selected === "queued"
                  ? ["queued", "generating"].includes(j.state)
                  : j.state === "failed",
              )
              .map((job) => (
                <article key={job.id}>
                  <h3>{job.brief_sources.title}</h3>
                  <a
                    href={job.brief_sources.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the original source ↗
                  </a>
                  <p>
                    {job.state} ·{" "}
                    {job.error || "Waiting for an editorial batch."}
                  </p>
                  <p>
                    Reported cost:{" "}
                    {job.cost === null ? "unavailable" : `$${job.cost}`}
                  </p>
                  {job.state === "failed" && (
                    <EditorJobAction storyId={job.story_id} />
                  )}
                </article>
              ))
          : (revisions.data as (Revision & { brief_sources: Source })[])?.map(
              (r) => (
                <Link
                  className="editor-queue-item"
                  key={r.id}
                  href={`/editor?view=${selected}&id=${r.id}`}
                  aria-current={r.id === query.id ? "true" : undefined}
                >
                  <span>{r.brief_sources.category}</span>
                  <strong>{r.content.oneLiner || r.brief_sources.title}</strong>
                  <small>
                    {r.brief_sources.source_name} ·{" "}
                    {new Date(r.created_at).toLocaleString("en-US", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </small>
                </Link>
              ),
            )}
      </div>
      {!(selected === "failed" || selected === "queued") &&
        !revisions.data?.length && (
          <p className="notice">
            No drafts in this queue. Refresh sources to prepare the next batch.
          </p>
        )}
      {revision && (
        <>
          <RevisionEditor
            key={`${revision.id}:${revision.version}`}
            revision={revision}
            story={{
              id: revision.story_id,
              slug: revision.brief_sources.slug,
              source_url: revision.brief_sources.url,
              source_name: revision.brief_sources.source_name,
              source_published_at: revision.brief_sources.source_published_at,
              category: revision.brief_sources.category,
            }}
          />
          <EditorJobAction storyId={revision.story_id} />
          <section className="editor-history">
            <h2>Revision history</h2>
            {history?.data?.map((item) => (
              <details key={item.id}>
                <summary>
                  {item.action} · version {item.version} ·{" "}
                  {new Date(item.created_at).toLocaleString("en-US", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </summary>
                <pre>{JSON.stringify(item.content, null, 2)}</pre>
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
