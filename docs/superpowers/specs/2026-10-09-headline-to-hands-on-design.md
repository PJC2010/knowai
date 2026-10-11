# Headline to hands-on — differentiation design

Date: 2026-10-09. Builds on `2026-10-09-reader-retention-design.md` (reader memory). That plan ships first; only §5 depends on it.

## Market read

This is based on general market knowledge. It has not been checked against competitors' live sites.

| Segment | Examples | What they do | What they leave open |
| --- | --- | --- | --- |
| AI newsletters | The Rundown AI, TLDR AI, The Neuron, Superhuman, Ben's Bites | Fast daily headlines by email, one depth, sponsor-funded | No way to try what you read; jargon assumed; no cost reality |
| AI-written news feeds | Perplexity Discover, Google News summaries | Automatic summaries | No human review; no sense of what matters to a newcomer |
| Model data | Artificial Analysis, LMArena, OpenRouter rankings | Benchmarks, leaderboards, per-token prices | Built for experts; per-million-token prices mean nothing to most people |
| Tool directories | There's An AI For That, Futurepedia | Huge lists, often affiliate-funded | No editorial judgment, no comparison |

knowai already has things these segments don't combine:
- human-reviewed stories at three depths
- a bring-your-own-key side-by-side playground with exact reported costs
- a plain-English model catalog

**What's missing is the bridge from "I read about it" to "I tried it and know what it would cost me."** No competitor offers that loop for non-experts. These features make it the product's signature: *read it, understand it, try it, price it.*

## Scope

In this plan (no new dependencies, vendors, migrations, env vars or paid calls):

1. Plain-English glossary layer
2. Prompt links into the Playground
3. "Ask AI models about this story"
4. "What would it cost me?" estimator
5. Catch me up (needs reader memory)

Later; each needs a decision first, so it is not planned here:
- **Receipts:** public claim-level source excerpts. Evidence is deliberately private today; existing tests assert `/api/brief` never exposes it. Needs an editorial and quotation-rights decision.
- **Who should care:** audience chips per story. Roadmap R05 requires audience and review rules first.
- **Model changelog / price watch:** daily catalog diffs. Needs snapshot storage and a cron job.
- **Editor-picked "Try it" models on launch stories:** needs a migration and an editor UI.
- **Weekly comparison posts:** already on the roadmap as R07.

## 1. Glossary layer

- Data: `src/data/glossary.json`, the entries below, exact copy. Definitions are ≤ 200 characters.
- Matching: the first occurrence of each term per story, across short version → whole-picture paragraphs → why it matters, in that order. One-liners and headings are never annotated.
  - Whole words only: no letter or digit may sit directly before or after the match. Hyphens and punctuation count as boundaries.
  - The longest alias wins.
  - Aliases written entirely in capitals (LLM, API, RAG, GPU) match case-sensitively. All others match case-insensitively.
- Rendering: the term becomes `<button type="button" class="glossary-term" popovertarget=…>` with a dotted underline. It opens a native `<span popover="auto" class="glossary-pop">` containing the term, its definition and the link `More in the AI 101 glossary` → `/learn#term-{id}`.
  - The popover must not have `role="dialog"`, because the j/k handler pauses while a dialog exists.
  - It appears in Brief cards (Normal/Deep) and on story pages, but not in the editor preview.
- AI 101 gains a `Glossary` section (`id="glossary"`): a `<dl>` with every term, each `<dt id="term-{id}">`.

| id | term | aliases | definition |
| --- | --- | --- | --- |
| llm | LLM | LLM, LLMs, large language model, large language models | An AI system trained on huge amounts of text to predict and write language. Chat assistants are built on them. |
| token | Token | token, tokens | A small piece of text, often part of a word, that models read and write. Usage is priced per token; one English token is about four characters. |
| context-window | Context window | context window, context windows, context length | How much text a model can consider at once, counted in tokens. It includes your instructions, documents, and the reply. |
| parameters | Parameters | parameters | The internal numbers a model learns in training. More parameters often means more capability and higher running costs, not always better answers. |
| fine-tuning | Fine-tuning | fine-tuning, fine-tuned, fine-tune | Extra training on a smaller, focused set of examples so a model gets better at one style or task. |
| inference | Inference | inference | Running a trained model to get an answer. Inference is what you pay for each time a model responds. |
| open-weight | Open-weight model | open-weight, open weights, open-weights | A model whose trained parameters are published, so anyone can download and run it, subject to its license. |
| benchmark | Benchmark | benchmark, benchmarks | A standard test for comparing models. Scores help, but they rarely match the exact task you care about. |
| leaderboard | Leaderboard | leaderboard, leaderboards | A ranked list of models by test score. Check what the test measures before trusting the order. |
| hallucination | Hallucination | hallucination, hallucinations, hallucinate, hallucinates | When a model states something false with confidence. Check important claims against the original source. |
| multimodal | Multimodal | multimodal | Able to work with more than one kind of input or output, such as text, images, audio, or video. |
| agent | AI agent | AI agent, AI agents, agentic | An AI system that takes several steps on its own, such as searching or using tools, to finish a task you set. |
| reasoning-model | Reasoning model | reasoning model, reasoning models | A model that works through a problem in steps before answering. Often better at math and logic, but slower and pricier. |
| api | API | API, APIs | A way for software to talk to a service. Developers use a model’s API to send prompts from their own apps. |
| api-key | API key | API key, API keys | A secret code that lets an app use a service on your account. Treat it like a password. |
| rag | RAG | RAG, retrieval-augmented generation | A model first looks up relevant documents, then answers using them. It helps keep answers tied to specific sources. |
| training-data | Training data | training data | The material a model learned from. It shapes what the model knows and where its blind spots are. |
| data-center | Data center | data center, data centers, data centre, data centres | A building full of computers. AI data centers need large amounts of power, water, and cooling. |
| gpu | GPU | GPU, GPUs | A chip that does many calculations at once. AI models are trained and run on huge numbers of them. |

## 2. Prompt links into the Playground

- `/playground?prompt=…` pre-fills the prompt box. The existing `models=` parameter still works alongside it.
- Prompt handling:
  - `\r\n` is normalized to `\n`.
  - Control characters other than `\n` and `\t` are removed.
  - The value is trimmed and capped at **4,000** characters.
  - It renders only as the textarea value, never as HTML.
- When a prompt arrives from a link, show `Prompt loaded from a link. Read it first; nothing is sent until you start the comparison.` **Never auto-run.**

## 3. Ask AI models about this story

On story pages (after the source button) and inside Deep cards in the feed (after the source link), add the link `Ask AI models about this story` to `/playground?prompt=…`, with the helper text `Opens the Playground with this story as a prompt. You choose the models and decide whether to run it.` It never appears in the editor preview. The prompt is exactly:

```
I just read this AI news summary from knowai (source: {source_name}):

"{one_liner} {short_version}"

In plain English:
1. What does this change for an ordinary person or small business?
2. What questions should I ask before believing or acting on it?
3. What, if anything, here might be overstated or uncertain?
Keep it under 200 words.
```

## 4. What would it cost me?

A section on `/models` titled `What would it cost me?`, with the intro `Pick an everyday task to see what it would cost each month with different models. No account needed.`

- Controls: `Task` select (presets below, default the first) and `Times per day` number input (default 10). Clamp to an integer between 1 and 10,000: empty or non-numeric becomes 1, decimals round.
- Cost per use = `(inputTokens × inputPrice + outputTokens × outputPrice) / 1,000,000`, with prices in USD per million tokens. Per month = per use × times per day × **30**.
- Table `Cheapest paid models for this task`: the 3 lowest per-use costs. It excludes models priced 0/0 and models whose `contextLength < inputTokens + outputTokens`. Ties sort by name.
  - Columns: Model, Per use, Per month, and a `Try it` link to `/playground?models={id}&prompt={samplePrompt}`.
  - If the reader has selected models for comparison, a second table `Your selected models` lists them the same way.
- Free note when N > 0: `{N} free models can also handle this task. Free models can have rate limits and may change or disappear.`
- Disclaimer: `Estimates use list prices from the {live OpenRouter catalog | saved catalog from {date}} and typical token counts for each task. Real costs vary with length, reasoning, and caching.`
- Formatting:
  - Per month: `Free` for 0, `<$0.01` below one cent, otherwise USD with 2 decimals and thousands separators.
  - Per use: `Free` for 0, `<$0.0001` below that amount, otherwise USD with 4 decimals.

| id | label | input tokens | output tokens | samplePrompt |
| --- | --- | --- | --- | --- |
| email | Summarize an email | 600 | 120 | `Summarize this email in three bullet points and list any action items for me:\n\n[Paste an email here]` |
| support | Answer a customer question | 1200 | 250 | `You are a friendly support assistant for a small bakery. A customer asks: “Do you have gluten-free options, and can I order a cake for Saturday?” Write a helpful, honest reply.` |
| article | Draft a 1,000-word article | 300 | 1400 | `Write a 1,000-word beginner’s article on starting a vegetable garden on a balcony. Use short sections with headings.` |
| document | Ask about a 20-page document | 12000 | 400 | `Summarize this document’s main argument and list three questions it leaves unanswered:\n\n[Paste a document here]` |
| code | Explain or fix some code | 1500 | 600 | `Explain what this code does, line by line, and point out any bugs:\n\n[Paste code here]` |

## 5. Catch me up (requires reader memory)

- When `previousVisit` is set and at least one published story (any edition) has `published_at > previousVisit`, the Brief shows the button `Catch me up: {N} new {story|stories} since {Mon D, YYYY}`.
- Pressing it replaces the featured section and the list with `<section aria-labelledby="catch-up-title">`, headed `Since your last visit`. It holds those stories newest first, at the current depth, with the category filter and edition picker hidden.
- Focus moves to the heading. `Back to the briefing` restores the view and returns focus to the Catch me up button.
- It never appears in preview or on a first visit.

## Constraints

- Nothing in this design can send a paid request without the reader pressing the existing run button with a connected key.
- All estimates are labeled as estimates; no "free forever" claims.
- Keep the charcoal/pale-green design, Manrope font, Phosphor icons, calm voice, keyboard access, 44px touch targets and 320px fit.
