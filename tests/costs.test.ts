import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, parseCompletion, apiError } from "../src/lib/openrouter";
import { safeUrl } from "../src/lib/format";
import type { Model } from "../src/lib/types";
const model: Model = {
  id: "test/model",
  name: "Test",
  provider: "test",
  description: "",
  contextLength: 8192,
  inputPrice: 1,
  outputPrice: 3,
  modalities: ["text"],
  maxOutput: 1024,
  created: 0,
};
test("cost converts per-million prices to dollars", () => {
  assert.equal(estimateCost(model, "a".repeat(2000), 200), 0.0011);
});
test("provider-reported charge takes precedence over calculated base pricing", () => {
  const r = parseCompletion(
    {
      choices: [{ message: { content: "Response" } }],
      usage: { prompt_tokens: 500, completion_tokens: 200, cost: 0.002 },
    },
    model,
    1,
  );
  assert.equal(r.cost, 0.002);
  assert.equal(r.costType, "reported");
});
test("zero reported cost stays a real free result", () => {
  const r = parseCompletion(
    { choices: [{ message: { content: "Response" } }], usage: { cost: 0 } },
    model,
    1,
  );
  assert.equal(r.cost, 0);
  assert.equal(r.costType, "reported");
});
test("missing cost uses tokens as an explicitly labeled estimate", () => {
  const r = parseCompletion(
    {
      choices: [{ message: { content: "Response" } }],
      usage: { prompt_tokens: 500, completion_tokens: 200 },
    },
    model,
    1,
  );
  assert.equal(r.cost, 0.0011);
  assert.equal(r.costType, "estimated");
});
test("missing all usage is unavailable, never silently free", () => {
  const r = parseCompletion(
    { choices: [{ message: { content: "Response" } }] },
    model,
    1,
  );
  assert.equal(r.cost, undefined);
  assert.equal(r.costType, undefined);
});
test("embedded errors cannot appear as successful free output", () => {
  assert.throws(
    () => parseCompletion({ error: { code: 402 } }, model, 1),
    /credits/,
  );
});
test("reasoning-only results retain their actual charge", () => {
  const r = parseCompletion(
    {
      choices: [{ message: { content: null, reasoning: "thinking" } }],
      usage: { cost: 0.02, prompt_tokens: 30, completion_tokens: 1000 },
    },
    model,
    1,
  );
  assert.equal(r.status, "error");
  assert.match(r.error || "", /no visible text/);
  assert.equal(r.cost, 0.02);
});
test("output limit completion is flagged as truncated", () => {
  const r = parseCompletion(
    { choices: [{ message: { content: "Partial" }, finish_reason: "length" }] },
    model,
    1,
  );
  assert.equal(r.truncated, true);
});
test("feed links reject unsafe schemes", () => {
  assert.equal(safeUrl("javascript:alert(1)"), undefined);
  assert.equal(safeUrl("data:text/html,test"), undefined);
  assert.equal(safeUrl("https://openai.com/news"), "https://openai.com/news");
});
test("billing and rate limit errors are understandable", () => {
  assert.match(apiError(402), /credits/);
  assert.match(apiError(429), /rate-limited/);
});
