import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "../src/lib/types";
import { DAYS_PER_MONTH, cheapestPaid, clampPerDay, formatEstimate, freeCapableCount, monthlyCost, perUseCost, taskPresets } from "../src/lib/task-costs";

const m = (id: string, inputPrice: number, outputPrice: number, contextLength = 128000, maxOutput: number | null = null) =>
  ({ id, name: id, inputPrice, outputPrice, contextLength, maxOutput }) as Model;
const preset = { id: "t", label: "t", inputTokens: 500, outputTokens: 200, samplePrompt: "p" };

test("costs match the AI 101 worked example and a zero-priced model", () => {
  assert.equal(perUseCost(m("a", 1, 3), preset).toFixed(4), "0.0011");
  assert.equal(monthlyCost(m("a", 1, 3), preset, 10).toFixed(2), "0.33");
  assert.equal(DAYS_PER_MONTH, 30);
  assert.equal(perUseCost(m("free", 0, 0), preset), 0);
  assert.equal(monthlyCost(m("free", 0, 0), preset, 10), 0);
});

test("cheapestPaid excludes free and too-small models, sorts by cost then name, limits to 3", () => {
  const models = [m("free", 0, 0), m("tiny", 0.01, 0.01, 600), m("b", 1, 1), m("a", 1, 1), m("c", 2, 2), m("d", 3, 3)];
  assert.deepEqual(cheapestPaid(models, preset).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(cheapestPaid(models, preset, 2).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(models.map((x) => x.id), ["free", "tiny", "b", "a", "c", "d"]);
  assert.equal(freeCapableCount([...models, m("free-small", 0, 0, 100)], preset), 1);
});

test("ranking excludes invalid prices and insufficient output capacity but accepts exact boundaries and partially free prices", () => {
  const models = [
    m("negative-input", -1, 1), m("negative-output", 1, -1),
    m("nan", NaN, 0), m("infinite", 0, Infinity),
    m("bad-free", 0, 0, 700, 199), m("too-little-output", 0.01, 0.01, 700, 199),
    m("too-little-context", 0, 0, 699, 200),
    m("partial", 0, 1, 700, 200), m("boundary", 1, 1, 700, 200),
    m("free", 0, 0, 700, 200), m("uncapped-free", 0, 0, 700),
  ];
  assert.deepEqual(cheapestPaid(models, preset).map((x) => x.id), ["partial", "boundary"]);
  assert.equal(freeCapableCount(models, preset), 2);
});

test("clampPerDay rounds, bounds, and rejects empty or nonfinite input", () => {
  assert.deepEqual(["", "abc", 0, -5, 2.7, 20000, "12", "1.5", Infinity, NaN, "12abc"].map(clampPerDay),
    [1, 1, 1, 1, 3, 10000, 12, 2, 1, 1, 1]);
});

test("formatEstimate preserves small positive costs and uses currency grouping", () => {
  assert.equal(formatEstimate(0, 0.01), "Free");
  assert.equal(formatEstimate(0.004, 0.01), "<$0.01");
  assert.equal(formatEstimate(1234.5, 0.01), "$1,234.50");
  assert.equal(formatEstimate(0.00004, 0.0001), "<$0.0001");
  assert.equal(formatEstimate(0.0011, 0.0001), "$0.0011");
  assert.equal(formatEstimate(0.01, 0.01), "$0.01");
});

test("presets match the approved task labels and sample prompts", () => {
  assert.deepEqual(taskPresets, [
    { id: "email", label: "Summarize an email", inputTokens: 600, outputTokens: 120, samplePrompt: "Summarize this email in three bullet points and list any action items for me:\n\n[Paste an email here]" },
    { id: "support", label: "Answer a customer question", inputTokens: 1200, outputTokens: 250, samplePrompt: "You are a friendly support assistant for a small bakery. A customer asks: “Do you have gluten-free options, and can I order a cake for Saturday?” Write a helpful, honest reply." },
    { id: "article", label: "Draft a 1,000-word article", inputTokens: 300, outputTokens: 1400, samplePrompt: "Write a 1,000-word beginner’s article on starting a vegetable garden on a balcony. Use short sections with headings." },
    { id: "document", label: "Ask about a 20-page document", inputTokens: 12000, outputTokens: 400, samplePrompt: "Summarize this document’s main argument and list three questions it leaves unanswered:\n\n[Paste a document here]" },
    { id: "code", label: "Explain or fix some code", inputTokens: 1500, outputTokens: 600, samplePrompt: "Explain what this code does, line by line, and point out any bugs:\n\n[Paste code here]" },
  ]);
});
