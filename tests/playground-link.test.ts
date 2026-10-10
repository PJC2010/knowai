import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_LIMIT, playgroundHref, promptFromParams, storyPrompt } from "../src/lib/playground-link";

test("promptFromParams cleans and caps Unicode characters", () => {
  const p = (value: string) => promptFromParams(new URLSearchParams({ prompt: value }));
  assert.equal(p("  hi\r\nthere\u0000\u0007\t! "), "hi\nthere\t!");
  assert.equal(p("\u001b\rA\rB\u007f"), "AB");
  assert.equal(Array.from(p("😀".repeat(5000))).length, 4000);
  assert.equal(PROMPT_LIMIT, 4000);
  assert.equal(promptFromParams(new URLSearchParams()), "");
});

test("storyPrompt follows the template exactly", () => {
  const prompt = storyPrompt({ source_name: "OpenAI", one_liner: "A.", short_version: "B." });
  assert.equal(prompt, 'I just read this AI news summary from knowai (source: OpenAI):\n\n"A. B."\n\nIn plain English:\n1. What does this change for an ordinary person or small business?\n2. What questions should I ask before believing or acting on it?\n3. What, if anything, here might be overstated or uncertain?\nKeep it under 200 words.');
});

test("storyPrompt round-trips through a playground link", () => {
  const prompt = storyPrompt({ source_name: "Hugging Face", one_liner: "It’s “new” & #1?", short_version: "50% off; a/b=c." });
  const url = new URL(playgroundHref({ prompt }), "http://x");
  assert.equal(promptFromParams(url.searchParams), prompt);
});

test("playgroundHref omits empty parts and encodes values", () => {
  assert.equal(playgroundHref({}), "/playground");
  assert.equal(playgroundHref({ models: [], prompt: "" }), "/playground");
  const url = new URL(playgroundHref({ models: ["openai/gpt-4o-mini", "x/y"], prompt: "a & b #1" }), "http://x");
  assert.equal(url.searchParams.get("models"), "openai/gpt-4o-mini,x/y");
  assert.equal(url.searchParams.get("prompt"), "a & b #1");
});
