import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_LIMIT, playgroundHref, promptFromParams } from "../src/lib/playground-link";

test("promptFromParams cleans and caps Unicode characters", () => {
  const p = (value: string) => promptFromParams(new URLSearchParams({ prompt: value }));
  assert.equal(p("  hi\r\nthere\u0000\u0007\t! "), "hi\nthere\t!");
  assert.equal(p("\u001b\rA\rB\u007f"), "AB");
  assert.equal(Array.from(p("😀".repeat(5000))).length, 4000);
  assert.equal(PROMPT_LIMIT, 4000);
  assert.equal(promptFromParams(new URLSearchParams()), "");
});

test("playgroundHref omits empty parts and encodes values", () => {
  assert.equal(playgroundHref({}), "/playground");
  assert.equal(playgroundHref({ models: [], prompt: "" }), "/playground");
  const url = new URL(playgroundHref({ models: ["openai/gpt-4o-mini", "x/y"], prompt: "a & b #1" }), "http://x");
  assert.equal(url.searchParams.get("models"), "openai/gpt-4o-mini,x/y");
  assert.equal(url.searchParams.get("prompt"), "a & b #1");
});
