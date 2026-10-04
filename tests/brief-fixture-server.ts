// Local-only Supabase HTTP fixture. Never imported by application routes.
import { createServer } from "node:http";
import starters from "../src/data/editorial-starters.json";

const stamp = "2026-10-04T09:00:00.000Z";
const sources = starters.map((s, i) => ({
  ...s,
  content: undefined,
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
}));
const publications = starters.map((s, i) => ({
  id: sources[i].id,
  slug: s.slug,
  source_url: s.url,
  source_name: s.source_name,
  source_published_at: s.source_published_at,
  category: s.category,
  one_liner: s.content.oneLiner,
  short_version: s.content.shortVersion,
  whole_picture: s.content.wholePicture,
  why_it_matters: s.content.whyItMatters,
  published_at: stamp,
  updated_at: stamp,
  edition_date: "2026-10-04",
}));
const revision: Record<string, any> = {
  id: "10000000-0000-4000-8000-000000000001",
  story_id: sources[0].id,
  content: structuredClone(starters[0].content),
  source_text:
    "PRIVATE_CAPTURE_FOR_REVIEW " +
    starters[0].content.evidence.map((e) => e.quote).join(" "),
  source_hash: "fixture",
  state: "needs_review",
  version: 1,
  created_at: stamp,
  reviewed_at: null,
  brief_sources: sources[0],
};
const actor = "11111111-1111-4111-8111-111111111111";
const otpRequests: unknown[] = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1:4310");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "X-Supabase-Api-Version": "2024-01-01",
    });
    res.end(JSON.stringify(body));
  };
  const auth = req.headers.authorization || "";
  const editor =
    auth.startsWith("Bearer ey") && auth.includes(".editor-fixture-signature");
  if (url.pathname === "/health") return send(200, { ready: true });
  if (url.pathname === "/_fixture/otp-requests") return send(200, otpRequests);
  if (url.pathname === "/auth/v1/otp") {
    let body = "";
    for await (const chunk of req) body += chunk;
    otpRequests.push({
      ...JSON.parse(body),
      redirect_to: url.searchParams.get("redirect_to"),
    });
    if (otpRequests.length > 1)
      return send(429, {
        code: "over_email_send_rate_limit",
        msg: "email rate limit exceeded",
      });
    return send(403, {
      code: "email_address_not_authorized",
      msg: "Email address not authorized",
    });
  }
  if (url.pathname === "/auth/v1/user")
    return editor
      ? send(200, {
          id: actor,
          aud: "authenticated",
          role: "authenticated",
          email: "editor@example.test",
          email_confirmed_at: stamp,
          created_at: stamp,
          app_metadata: { provider: "email" },
          user_metadata: {},
          identities: [],
        })
      : send(401, { message: "Unauthorized" });
  if (url.pathname === "/rest/v1/rpc/is_brief_editor") return send(200, editor);
  if (url.pathname === "/rest/v1/brief_publications") {
    const rows = url.searchParams.has("slug")
      ? publications.filter(
          (p) => p.slug === url.searchParams.get("slug")?.replace(/^eq\./, ""),
        )
      : publications;
    return send(
      200,
      req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] : rows,
    );
  }
  if (!editor) return send(403, { message: "Editor access required" });
  if (url.pathname === "/rest/v1/brief_revisions") {
    const state = url.searchParams.get("state")?.replace(/^eq\./, "");
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    const rows =
      (!state || revision.state === state) && (!id || revision.id === id)
        ? [revision]
        : [];
    return send(
      200,
      req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] : rows,
    );
  }
  if (
    url.pathname === "/rest/v1/brief_jobs" ||
    url.pathname === "/rest/v1/brief_revision_history"
  )
    return send(200, []);
  let body = "";
  for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  if (url.pathname === "/rest/v1/rpc/save_brief_revision") {
    if (args.p_version !== revision.version)
      return send(409, { message: "stale version" });
    revision.content = args.p_content;
    revision.version++;
    return send(200, null);
  }
  if (url.pathname === "/rest/v1/rpc/review_brief_revision") {
    if (args.p_version !== revision.version)
      return send(409, { message: "stale version" });
    revision.state = args.p_publish ? "published" : "rejected";
    revision.version++;
    if (args.p_publish) {
      publications[0].one_liner = revision.content.oneLiner;
      publications[0].short_version = revision.content.shortVersion;
      publications[0].whole_picture = revision.content.wholePicture;
      publications[0].why_it_matters = revision.content.whyItMatters;
      publications[0].updated_at = "2026-10-04T10:00:00.000Z";
    }
    return send(200, sources[0].slug);
  }
  return send(404, { message: "Fixture route not implemented" });
});
server.listen(4310, "127.0.0.1", () =>
  console.log("Local editorial fixture ready"),
);
process.on("SIGTERM", () => server.close());
