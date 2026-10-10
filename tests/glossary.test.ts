import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateSections,
  glossary,
  termById,
  type GlossarySegment,
  type GlossaryTerm,
} from "../src/lib/glossary";

const found = (segments: GlossarySegment[]) =>
  segments.flatMap((segment) =>
    typeof segment === "string" ? [] : [[segment.termId, segment.text]],
  );
const text = (segments: GlossarySegment[]) =>
  segments.map((segment) => (typeof segment === "string" ? segment : segment.text)).join("");

test("glossary data is valid", () => {
  assert.equal(glossary.length, 19);
  assert.equal(new Set(glossary.map((term) => term.id)).size, 19);
  const aliases = glossary.flatMap((term) => term.aliases.map((alias) => alias.toLowerCase()));
  assert.equal(new Set(aliases).size, aliases.length);
  for (const term of glossary) {
    assert.ok(term.aliases.length > 0);
    assert.ok(Array.from(term.definition).length <= 200);
  }
});
test("matches whole words, plural aliases, and the longest alias first", () => {
  const [segments] = annotateSections(["New API keys and APIs for every LLM."]);
  assert.deepEqual(found(segments), [["api-key", "API keys"], ["api", "APIs"], ["llm", "LLM"]]);
});
test("does not match inside longer words or lowercase acronyms", () => {
  const [segments] = annotateSections(["A tokenizer, a ragged rag, an api call, and agentic flows."]);
  assert.deepEqual(found(segments), [["agent", "agentic"]]);
});
test("non-acronym aliases match case-insensitively and keep the original text", () => {
  assert.deepEqual(found(annotateSections(["Training Data matters."])[0]), [["training-data", "Training Data"]]);
});
test("annotates only the first occurrence per story across sections", () => {
  const [first, second] = annotateSections(["Tokens cost money.", "More tokens, more cost."]);
  assert.equal(found(first).length, 1);
  assert.equal(found(second).length, 0);
});
test("hyphens and punctuation are boundaries, and text is preserved exactly", () => {
  const input = "LLM-based tools (GPUs), data centres.";
  const [segments] = annotateSections([input]);
  assert.deepEqual(found(segments).map(([id]) => id), ["llm", "gpu", "data-center"]);
  assert.equal(text(segments), input);
});
test("no terms returns the text unchanged", () => {
  assert.deepEqual(annotateSections(["Nothing here."], []), [["Nothing here."]]);
});
test("termById looks up glossary entries and returns undefined for missing ids", () => {
  assert.equal(termById("api-key")?.term, "API key");
  assert.equal(termById("missing"), undefined);
});
test("custom aliases are escaped and Unicode letters are word characters", () => {
  const terms: GlossaryTerm[] = [{ id: "plus", term: "C++", aliases: ["C++"], definition: "A language." }];
  const input = "éC++ C++!";
  const [segments] = annotateSections([input], terms);
  assert.deepEqual(found(segments), [["plus", "C++"]]);
  assert.equal(text(segments), input);
});
