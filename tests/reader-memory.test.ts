import test from "node:test";
import assert from "node:assert/strict";
import {
  READER_MEMORY_KEY,
  catchUpStories,
  beginVisit,
  browserStorage,
  clearMemory,
  emptyMemory,
  loadMemory,
  markRead,
  newStoryIds,
  parseMemory,
  saveMemory,
} from "../src/lib/reader-memory";

test("parseMemory returns defaults for missing, corrupt, foreign and wrong-version values", () => {
  for (const raw of [null, "", "{", "[]", '"x"', '{"v":2,"depth":"deep"}'])
    assert.deepEqual(parseMemory(raw), emptyMemory());
});
test("parseMemory keeps valid fields and drops invalid ones individually", () => {
  const m = parseMemory(JSON.stringify({ v: 1, depth: "loud", lastVisit: "2026-10-01T00:00:00Z",
    previousVisit: 5, read: ["a", 3, "", "b"], welcomeDismissed: "yes" }));
  assert.deepEqual(m, { ...emptyMemory(), lastVisit: "2026-10-01T00:00:00Z", read: ["a", "b"] });
});
test("parseMemory deduplicates and caps stored ids while preserving most recent order", () => {
  const read = ["s0", ...Array.from({ length: 205 }, (_, i) => `s${i}`)];
  const m = parseMemory(JSON.stringify({ v: 1, depth: "deep", read, welcomeDismissed: true }));
  assert.equal(m.depth, "deep");
  assert.equal(m.welcomeDismissed, true);
  assert.equal(m.read.length, 200);
  assert.equal(m.read[0], "s5");
  assert.equal(m.read.at(-1), "s204");
});
test("beginVisit starts a new visit after 30 minutes and keeps it within 30 minutes", () => {
  const first = beginVisit(emptyMemory(), new Date("2026-10-09T10:00:00Z"));
  assert.equal(first.previousVisit, null);
  assert.equal(first.lastVisit, "2026-10-09T10:00:00.000Z");
  const same = beginVisit(first, new Date("2026-10-09T10:29:59Z"));
  assert.equal(same.previousVisit, null);
  assert.equal(same.lastVisit, "2026-10-09T10:29:59.000Z");
  const next = beginVisit(same, new Date("2026-10-09T11:00:00Z"));
  assert.equal(next.previousVisit, "2026-10-09T10:29:59.000Z");
});
test("beginVisit starts a new visit at the exact boundary and ignores invalid last visits", () => {
  const first = beginVisit(emptyMemory(), new Date("2026-10-09T10:00:00Z"));
  assert.equal(beginVisit(first, new Date("2026-10-09T10:30:00Z")).previousVisit, first.lastVisit);
  assert.equal(beginVisit({ ...first, lastVisit: "invalid" }, new Date("2026-10-09T10:30:00Z")).previousVisit, null);
});
test("markRead deduplicates, keeps newest last, and caps at 200", () => {
  let m = emptyMemory();
  for (let i = 0; i < 205; i++) m = markRead(m, `s${i}`);
  assert.equal(m.read.length, 200);
  assert.equal(m.read[0], "s5");
  m = markRead(m, "s5");
  assert.equal(m.read.at(-1), "s5");
  assert.equal(m.read.filter((id) => id === "s5").length, 1);
});
test("newStoryIds is empty on a first visit and strict after previousVisit", () => {
  const stories = [{ id: "old", published_at: "2026-10-01T00:00:00Z" },
                   { id: "edge", published_at: "2026-10-02T00:00:00Z" },
                   { id: "new", published_at: "2026-10-03T00:00:00Z" }];
  assert.equal(newStoryIds(stories, null).size, 0);
  assert.deepEqual([...newStoryIds(stories, "2026-10-02T00:00:00.000Z")], ["new"]);
});
test("newStoryIds compares instants across ISO formats", () => {
  const stories = [{ id: "a", published_at: "2026-10-04T09:00:00+00:00" }];
  assert.equal(newStoryIds(stories, "2026-10-04T08:59:59.999Z").size, 1);
  assert.equal(newStoryIds(stories, "2026-10-04T09:00:00.000Z").size, 0);
});
test("catchUpStories spans editions, newest first, excludes boundary and duplicates, and is empty on first visit", () => {
  const stories = [
    { id: "a", edition_date: "2026-10-01", published_at: "2026-10-01T00:00:00Z" },
    { id: "b", edition_date: "2026-10-05", published_at: "2026-10-05T00:00:00+00:00" },
    { id: "c", edition_date: "2026-10-03", published_at: "2026-10-03T00:00:00Z" },
    { id: "edge", edition_date: "2026-10-02", published_at: "2026-10-02T00:00:00Z" },
    { id: "invalid", edition_date: "2026-10-06", published_at: "not-a-date" },
    { id: "b", edition_date: "2026-10-05", published_at: "2026-10-05T00:00:00+00:00" },
  ];
  assert.deepEqual(catchUpStories(stories, "2026-10-02T00:00:00Z").map((x) => x.id), ["b", "c"]);
  assert.deepEqual(catchUpStories(stories, null), []);
});
test("storage helpers never throw and load the fallback when nothing is stored", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); },
                     removeItem() { throw new Error("denied"); } } as unknown as Storage;
  const fallback = { ...emptyMemory(), welcomeDismissed: true };
  assert.deepEqual(loadMemory(throwing, fallback), fallback);
  assert.deepEqual(loadMemory(null, fallback), fallback);
  assert.deepEqual(loadMemory({ getItem: () => null } as unknown as Storage, fallback), fallback);
  assert.deepEqual(loadMemory({ getItem: () => "{" } as unknown as Storage, fallback), emptyMemory());
  assert.doesNotThrow(() => saveMemory(throwing, fallback));
  assert.doesNotThrow(() => clearMemory(throwing));
});
test("save then load round-trips through a Storage", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v),
                    removeItem: (k: string) => void map.delete(k) } as unknown as Storage;
  const m = markRead({ ...emptyMemory(), depth: "quick" }, "x");
  saveMemory(storage, m);
  assert.deepEqual(loadMemory(storage), m);
  clearMemory(storage);
  assert.equal(map.has(READER_MEMORY_KEY), false);
});
test("browserStorage is absent on the server and handles denied localStorage access", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    assert.equal(browserStorage(), null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { get localStorage() { throw new Error("denied"); } },
    });
    assert.equal(browserStorage(), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
