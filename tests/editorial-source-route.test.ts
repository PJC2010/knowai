import "./editorial-server-hook";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as jsxRuntime from "react/jsx-runtime";
import Link from "next/link";
import type { DeskData, DeskQuery } from "../src/lib/editorial/desk-types";

// Load components after the existing server-only test hook has been registered.
const { EditorDesk, EditorLogin } = await import("../src/components/editor");

type EditorPage = typeof import("../src/app/editor/page").default;
type RawQuery = Record<string, string | string[] | undefined>;
const file = new URL("../src/app/editor/page.tsx", import.meta.url);
const compiled = transformSync(readFileSync(file, "utf8"), {
  loader: "tsx", format: "cjs", jsx: "automatic", sourcefile: file.pathname,
});

function routeHarness() {
  const loaded: DeskQuery[] = [];
  const data: DeskData = {
    sources: [], revisions: [], jobs: [], publishers: [], active: null, history: [],
    counts: { inbox: 0, selected: 0, saved: 0, dismissed: 0, drafts: 0, published: 0, failed: 0, queued: 0, rejected: 0 },
    total: 0, page: 1, pageSize: 20, selectedIds: [], attemptsToday: 0, dailyAttemptLimit: 10, autoDraft: false,
  };
  const unusedAction = () => assert.fail("Route rendering must not invoke a server action");
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: Link },
    "@/components/editor": { EditorDesk, EditorLogin },
    "@/lib/editorial/supabase": { databaseConfigured: () => true, editorSession: async () => ({ user: { id: "editor-fixture" } }) },
    "@/lib/editorial/desk": { loadDesk: async (query: DeskQuery) => { loaded.push(query); return data; } },
    "./actions": { logoutEditor: unusedAction },
    "./desk-actions": { mutateDesk: unusedAction },
  };
  const module = { exports: {} as { default: EditorPage } };
  // Invoke the actual page with only auth, data loading and server actions stubbed.
  // Real JSX and component references expose its output without a Next request or DB.
  runInNewContext(compiled.code, {
    module, exports: module.exports,
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file.pathname });
  return { EditorPage: module.exports.default, loaded, data };
}

test("editor route awaits searchParams and forwards sourceKind to loadDesk and EditorDesk", async () => {
  const { EditorPage, loaded, data } = routeHarness();
  let resolve!: (query: RawQuery) => void;
  const searchParams = new Promise<RawQuery>(done => { resolve = done; });
  const pending = EditorPage({ searchParams });
  assert.equal(loaded.length, 0, "Data must not load before searchParams resolves");
  const query = { sourceKind: "research", publisher: "microsoft-research", page: "2" };
  resolve(query);
  const element = await pending;
  assert.equal(loaded.length, 1);
  assert.equal(element.type, EditorDesk);
  assert.deepEqual({ loadDesk: loaded[0].sourceKind, EditorDesk: element.props.query.sourceKind }, {
    loadDesk: "research", EditorDesk: "research",
  }, "The route must pass the source type to both the data loader and the desk");
  assert.deepEqual({ ...loaded[0] }, query);
  assert.deepEqual({ ...element.props.query }, query);
  assert.equal(element.props.data, data);
});

test("editor route preserves supported string parameters without forwarding unknown URL keys", async () => {
  const { EditorPage, loaded } = routeHarness();
  const query = {
    view: "inbox", id: "revision-fixture", q: "small & useful", publisher: "microsoft-research",
    sourceKind: "research", category: "Research", status: "selected", since: "2026-10-01", page: "3",
  };
  const element = await EditorPage({ searchParams: Promise.resolve({ ...query, unrecognized: "not-a-desk-filter", signin: "failed" }) });
  assert.equal(loaded.length, 1);
  assert.equal(element.type, EditorDesk);
  assert.deepEqual({ ...loaded[0] }, query);
  assert.deepEqual({ ...element.props.query }, query);
});

test("editor route omits non-string sourceKind and existing query values instead of coercing them", async () => {
  for (const sourceKind of [undefined, [], ["research"], ["research", "company"]]) {
    const { EditorPage, loaded } = routeHarness();
    const element = await EditorPage({ searchParams: Promise.resolve({
      view: "inbox", sourceKind, publisher: ["microsoft-research"], page: ["2"], q: undefined, status: "selected",
    }) });
    const expected = { view: "inbox", status: "selected" };
    assert.equal(loaded.length, 1);
    assert.equal(element.type, EditorDesk);
    assert.deepEqual({ ...loaded[0] }, expected);
    assert.deepEqual({ ...element.props.query }, expected);
  }
});
