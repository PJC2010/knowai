import test from "node:test";
import assert from "node:assert/strict";
import * as desk from "../src/components/editor/workspace-state";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as inbox from "../src/components/editor/inbox";
import * as panels from "../src/components/editor/panels";
import type { DeskData, DeskSource } from "../src/lib/editorial/desk-types";

test("opening and leaving a draft preserves queue filters and page without trusting arbitrary URL keys", () => {
  const query = { view: "drafts", q: "small & useful", publisher: "p1", category: "Tools", page: "3", status: "needs_review", injected: "javascript:alert(1)" };
  const opened = desk.deskHref(query, { id: "revision-1" });
  const url = new URL(opened, "https://example.com");
  assert.equal(url.pathname, "/editor");
  assert.equal(url.searchParams.get("q"), "small & useful");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("id"), "revision-1");
  assert.equal(url.searchParams.has("injected"), false);
  assert.equal(new URL(desk.deskHref({ ...query, id: "revision-1" }, { id: undefined }), url).searchParams.has("id"), false);
});

const source: DeskSource = { id: "s1", slug: "story", title: "A useful original headline", url: "https://openai.com/story", source_name: "OpenAI", source_published_at: "2026-10-01T09:00:00Z", category: "Tools", publisher_id: "p1", triage: "selected", job_state: null, revision_id: null };
test("inbox cards expose original metadata and persisted selection with reversible triage actions", () => {
  assert.equal(typeof inbox.SourceCard, "function");
  const html = renderToStaticMarkup(createElement(inbox.SourceCard, { source, selected: true, pending: false, onTriage: () => {}, onPreview: () => {} }));
  for (const text of [source.title, "OpenAI", "2026-10-01", "Tools", "Save for later", "Dismiss", "Source preview", "Deselect"])
    assert.ok(html.includes(text), text);
  assert.match(html, /aria-pressed="true"/);
});

test("queue controls retain server filters and paginate the exact total beyond the current page", () => {
  assert.equal(typeof inbox.QueueControls, "function");
  const html = renderToStaticMarkup(createElement(inbox.QueueControls, { query: { view: "inbox", q: "research", category: "Tools", page: "3" }, publishers: [], total: 143, page: 3, pageSize: 20, onFilter: () => {} }));
  for (const text of ["Search stories", "Publisher", "Category", "Published since", "Status", "research", "41–60 of 143", "Previous", "Next"])
    assert.ok(html.includes(text), text);
  assert.match(html, /page=4/);
  assert.match(html, /category=Tools/);
});

const content = { oneLiner: "Original", shortVersion: "Short", wholePicture: ["First", "Second"], whyItMatters: "Matters", evidence: [] };
test("autosave serializes snapshots and advances only the version returned for each save", async () => {
  assert.equal(typeof desk.createDraftSession, "function");
  const calls: { version: number; oneLiner: string }[] = [];
  let finish: (result: { ok: boolean; message: string; version: number }) => void = () => {};
  const session = desk.createDraftSession(content, 4, async (snapshot, version) => {
    calls.push({ version, oneLiner: snapshot.oneLiner });
    if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
    return { ok: true, message: "Saved", version: 6 };
  });
  session.edit({ ...content, oneLiner: "First edit" });
  const saving = session.save();
  session.edit({ ...content, oneLiner: "Typed during request" });
  const duplicate = session.save();
  assert.equal(calls.length, 1);
  assert.equal(session.getSnapshot().saving, true);
  finish({ ok: true, message: "Saved", version: 5 });
  await Promise.all([saving, duplicate]);
  assert.deepEqual(calls, [{ version: 4, oneLiner: "First edit" }, { version: 5, oneLiner: "Typed during request" }]);
  assert.equal(session.getSnapshot().content.oneLiner, "Typed during request");
  assert.equal(session.getSnapshot().version, 6);
  assert.equal(session.getSnapshot().dirty, false);
});

test("network failure retains unsaved text and a retry uses the original version", async () => {
  let calls = 0;
  const session = desk.createDraftSession(content, 4, async (_, version) => {
    assert.equal(version, 4);
    if (!calls++) throw new Error("Offline");
    return { ok: true, message: "Saved", version: 5 };
  });
  session.edit({ ...content, oneLiner: "Keep this text" });
  assert.equal(await session.save(), false);
  assert.equal(session.getSnapshot().content.oneLiner, "Keep this text");
  assert.equal(session.getSnapshot().dirty, true);
  assert.equal(session.getSnapshot().saving, false);
  assert.equal(session.getSnapshot().error?.code, "failed");
  assert.equal(await session.save(), true);
  assert.equal(session.getSnapshot().dirty, false);
});

test("final review flushes saves and binds attestations to the saved version; every edit invalidates them", async () => {
  const session = desk.createDraftSession(content, 1, async () => ({ ok: true, message: "Saved", version: 2 }));
  assert.equal(typeof session.beginReview, "function");
  session.edit({ ...content, oneLiner: "Ready" });
  assert.equal(await session.beginReview(), true);
  assert.equal(session.getSnapshot().paused, true);
  session.check("source", true);
  session.check("tiers", true);
  assert.equal(desk.canPublish(session.getSnapshot(), []), true);
  assert.equal(desk.canPublish(session.getSnapshot(), ["Bad quote"]), false);
  session.edit({ ...content, oneLiner: "Accepted suggestion" });
  assert.equal(session.getSnapshot().sourceChecked, false);
  assert.equal(session.getSnapshot().tiersChecked, false);
  assert.equal(session.getSnapshot().paused, false);
  assert.equal(desk.canPublish(session.getSnapshot(), []), false);
});

test("writing focuses one reading tier and keeps supporting context and inline limits accessible", () => {
  assert.equal(typeof panels.WritePanel, "function");
  const html = renderToStaticMarkup(createElement(panels.WritePanel, { content, tier: "oneLiner", readOnly: false, onTier: () => {}, onEdit: () => {}, onSuggest: () => {} }));
  for (const text of ["One-liner", "Short", "Full", "Why it matters", "140 characters", "240 characters", "Suggest a rewrite"])
    assert.ok(html.includes(text), text);
  assert.match(html, /name="oneLiner"/);
  assert.doesNotMatch(html, /name="wholePicture"/);
});

test("evidence matching highlights every exact occurrence and never treats a near-match as found", () => {
  assert.equal(typeof desk.quoteMatches, "function");
  assert.deepEqual(desk.quoteMatches("A quoted fact. Another quoted fact.", "quoted fact."), [{ start: 2, end: 14 }, { start: 23, end: 35 }]);
  assert.deepEqual(desk.quoteMatches("A Quoted fact.", "quoted fact."), []);
  assert.deepEqual(desk.quoteMatches("anything", ""), []);
});

test("a save response without a newer integral version never marks local text as saved", async () => {
  for (const returned of [4, 3, NaN, 5.5]) {
    const session = desk.createDraftSession(content, 4, async () => ({ ok: true, message: "Saved", version: returned }));
    session.edit({ ...content, oneLiner: "Keep local" });
    assert.equal(await session.save(), false);
    assert.equal(session.getSnapshot().dirty, true);
    assert.equal(session.getSnapshot().version, 4);
    assert.equal(session.getSnapshot().error?.ok, false);
  }
});

test("a publication conflict invalidates review without replacing the editor content or adopting a remote version", async () => {
  const session = desk.createDraftSession(content, 4, async () => ({ ok: true, message: "Saved", version: 5 }));
  await session.beginReview(); session.check("source", true); session.check("tiers", true);
  assert.equal(typeof session.serverConflict, "function");
  session.serverConflict({ ok: false, code: "conflict", message: "Another editor saved.", version: 99 });
  assert.equal(session.getSnapshot().content.oneLiner, "Original");
  assert.equal(session.getSnapshot().version, 4);
  assert.equal(await session.beginReview(), false);
  assert.equal(session.getSnapshot().error?.code, "conflict");
  assert.equal(session.getSnapshot().sourceChecked, false);
  assert.equal(desk.canPublish(session.getSnapshot(), []), false);
});

test("accepting a field suggestion changes only that field and refuses to overwrite newer typing", () => {
  assert.equal(typeof desk.acceptSuggestion, "function");
  const suggestion = { field: "oneLiner" as const, before: content.oneLiner, value: "A cleaner line" };
  const accepted = desk.acceptSuggestion(content, suggestion);
  assert.deepEqual(accepted, { ...content, oneLiner: "A cleaner line" });
  assert.equal(content.oneLiner, "Original");
  assert.equal(desk.acceptSuggestion({ ...content, oneLiner: "Newer typing" }, suggestion), null);
  assert.equal(desk.acceptSuggestion(content, { ...suggestion, value: ["Wrong type"] }), null);
});

test("history diff exposes only changed fields and formats evidence as readable claims and quotations", () => {
  assert.equal(typeof desk.contentDiff, "function");
  const after = { ...content, oneLiner: "Revised", evidence: [{ claim: "A claim", quote: "An exact excerpt from the source." }] };
  const diff = desk.contentDiff(content, after);
  assert.deepEqual(diff.map(item => item.field), ["oneLiner", "evidence"]);
  assert.equal(diff[0].before, "Original");
  assert.equal(diff[0].after, "Revised");
  assert.equal(diff[1].after, "A claim\n“An exact excerpt from the source.”");
  assert.deepEqual(desk.contentDiff(after, after), []);
});
