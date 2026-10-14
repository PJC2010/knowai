import { test } from "node:test";
import assert from "node:assert/strict";
import snapshot from "../src/data/models-snapshot.json" with { type: "json" };
import type { Model, ModelsData } from "../src/lib/types";
import {
  defaultModelIds,
  freeAlternative,
  freeChatModels,
  isFree,
} from "../src/lib/free-models";
import { apiError, OpenRouterError, parseCompletion } from "../src/lib/openrouter";

const models = (snapshot as ModelsData).models;
const m = (id: string, price = 0, contextLength = 32000): Model => ({
  id,
  name: id,
  provider: id.split("/")[0],
  description: "",
  contextLength,
  inputPrice: price,
  outputPrice: price,
  modalities: ["text"],
  maxOutput: null,
  created: 0,
});

test("free chat models exclude non-chat $0 entries", () => {
  const ids = freeChatModels(models).map((x) => x.id);
  assert.ok(ids.length >= 2);
  assert.ok(ids.every((id) => !/lyria|omni|safety/.test(id)));
  assert.ok(freeChatModels(models).every(isFree));
});

test("default models are two free models from different providers, non-Google first", () => {
  const ids = defaultModelIds(models);
  assert.equal(ids.length, 2);
  const [a, b] = ids.map((id) => models.find((x) => x.id === id)!);
  assert.ok(isFree(a) && isFree(b));
  assert.notEqual(a.provider, b.provider);
  assert.notEqual(a.provider, "google");
});

test("defaults fall back to the paid pair when the catalog has no free models", () => {
  const catalog = [m("openai/gpt-4o-mini", 1), m("google/gemini-2.5-flash", 1)];
  assert.deepEqual(defaultModelIds(catalog), [
    "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",
  ]);
});

test("a free alternative is never one already selected", () => {
  const catalog = [m("qwen/a:free"), m("google/gemma:free"), m("openai/x", 2)];
  assert.equal(
    freeAlternative(catalog, ["qwen/a:free", "openai/x"])?.id,
    "google/gemma:free",
  );
  assert.equal(freeAlternative(catalog, ["qwen/a:free", "google/gemma:free"]), undefined);
});

test("402 errors carry their status and point to a free model", () => {
  const err = new OpenRouterError(402);
  assert.equal(err.status, 402);
  assert.match(err.message, /credits/);
  assert.match(apiError(402), /free model/);
  assert.throws(
    () => parseCompletion({ error: { code: 402 } }, m("openai/x", 1), 1),
    (e: unknown) => e instanceof OpenRouterError && e.status === 402,
  );
});
