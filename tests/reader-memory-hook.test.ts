import test from "node:test";
import assert from "node:assert/strict";
import { StrictMode, createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { parseHTML } from "linkedom";
import { useReaderMemory } from "../src/components/use-reader-memory";
import { READER_MEMORY_KEY, emptyMemory, type ReaderMemory } from "../src/lib/reader-memory";

type HookResult = ReturnType<typeof useReaderMemory>;

async function withHook(
  enabled: boolean,
  storage: Storage,
  check: (hook: () => HookResult, render: (enabled: boolean) => Promise<void>, window: Window) => Promise<void>,
) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  let latest: HookResult | undefined;
  function Probe({ active }: { active: boolean }) {
    latest = useReaderMemory(active);
    return null;
  }
  let root: Root | undefined;
  try {
    root = createRoot(window.document.getElementById("root")!);
    async function render(active: boolean) {
      await act(async () => { root!.render(createElement(StrictMode, null, createElement(Probe, { active }))); });
    }
    await render(enabled);
    await check(() => latest!, render, window as unknown as Window);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    for (const [name, descriptor] of [["window", previousWindow], ["document", previousDocument], ["IS_REACT_ACT_ENVIRONMENT", previousAct]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

function memoryStorage(initial?: ReaderMemory) {
  const values = new Map<string, string>();
  if (initial) values.set(READER_MEMORY_KEY, JSON.stringify(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  return { storage, values };
}

test("disabled and server rendering never touch storage, and disabled update is inert", async () => {
  let accesses = 0;
  const storage = {
    getItem() { accesses++; throw Error("read while disabled"); },
    setItem() { accesses++; throw Error("write while disabled"); },
  } as unknown as Storage;
  assert.doesNotThrow(() => renderToString(createElement(() => {
    const result = useReaderMemory(true);
    assert.equal(result.memory, null);
    return null;
  })));
  await withHook(false, storage, async (hook) => {
    assert.equal(hook().memory, null);
    let called = false;
    await act(async () => hook().update((memory) => { called = true; return memory; }));
    assert.equal(called, false);
    assert.equal(hook().memory, null);
    assert.equal(accesses, 0);
  });
});

test("disabling after mount clears memory without replacing the update function", async () => {
  const { storage, values } = memoryStorage();
  await withHook(true, storage, async (hook, render) => {
    const update = hook().update;
    const saved = values.get(READER_MEMORY_KEY);
    await render(false);
    assert.equal(hook().memory, null);
    assert.equal(hook().update, update);
    let called = false;
    await act(async () => update((memory) => { called = true; return memory; }));
    assert.equal(called, false);
    assert.equal(values.get(READER_MEMORY_KEY), saved);
  });
});

test("enabled mount begins a visit, saves it, and updates with a stable function using the latest stored value", async () => {
  const old = { ...emptyMemory(), depth: "quick" as const, lastVisit: "2026-01-01T00:00:00Z" };
  const { storage, values } = memoryStorage(old);
  await withHook(true, storage, async (hook, render) => {
    const visit = hook().memory!;
    assert.equal(visit.previousVisit, old.lastVisit);
    assert.ok(Date.parse(visit.lastVisit!) > Date.parse(old.lastVisit!));
    assert.deepEqual(JSON.parse(values.get(READER_MEMORY_KEY)!), visit);
    const update = hook().update;
    await render(true);
    assert.equal(hook().update, update);
    values.set(READER_MEMORY_KEY, JSON.stringify({ ...visit, read: ["other-tab"] }));
    await act(async () => update((memory) => ({ ...memory, depth: "deep" })));
    assert.deepEqual(hook().memory?.read, ["other-tab"]);
    assert.equal(hook().memory?.depth, "deep");
    assert.deepEqual(JSON.parse(values.get(READER_MEMORY_KEY)!), hook().memory);
  });
});

test("updates preserve in-session changes when storage writes fail", async () => {
  const old = { ...emptyMemory(), depth: "quick" as const };
  const { storage, values } = memoryStorage(old);
  storage.setItem = () => { throw Error("quota exceeded"); };
  await withHook(true, storage, async (hook) => {
    await act(async () => hook().update((memory) => ({ ...memory, read: [...memory.read, "a"] })));
    await act(async () => hook().update((memory) => ({ ...memory, welcomeDismissed: true })));
    assert.deepEqual(hook().memory?.read, ["a"]);
    assert.equal(hook().memory?.welcomeDismissed, true);
    assert.equal(JSON.parse(values.get(READER_MEMORY_KEY)!).welcomeDismissed, false);
  });
});

test("a clear in another tab discards old history rather than resurrecting it on update", async () => {
  const { storage, values } = memoryStorage({ ...emptyMemory(), read: ["past"], depth: "deep" });
  await withHook(true, storage, async (hook, _render, window) => {
    values.delete(READER_MEMORY_KEY);
    const event = new (window as unknown as { Event: typeof Event }).Event("storage");
    Object.defineProperty(event, "key", { value: READER_MEMORY_KEY });
    Object.defineProperty(event, "newValue", { value: null });
    Object.defineProperty(event, "storageArea", { value: storage });
    await act(async () => { window.dispatchEvent(event); });
    assert.deepEqual(hook().memory?.read, []);
    await act(async () => hook().update((memory) => ({ ...memory, depth: "normal" })));
    assert.deepEqual(hook().memory?.read, []);
    assert.deepEqual(JSON.parse(values.get(READER_MEMORY_KEY)!).read, []);
  });
});

test("change callbacks run outside React state updater functions", async () => {
  const { storage } = memoryStorage();
  await withHook(true, storage, async (hook) => {
    let calls = 0;
    await act(async () => hook().update((memory) => { calls++; return { ...memory, depth: "quick" }; }));
    assert.equal(calls, 1);
    assert.equal(hook().memory?.depth, "quick");
  });
});
