# knowai — todo roadmap

Reconciled with the repository and public site on **2026-10-04**. Source: the website analysis supplied in chat (The Brief, Model Library, Playground, AI 101). This roadmap prioritizes discoverability and retention before new editorial formats. Keep the charcoal/pale-green design, Manrope typography, calm voice, accessible controls, and phone-friendly reading/editing.

## Status rules

- `[x]` means implemented and verified at the stated level; **built is not the same as live**.
- `[ ]` means unfinished. **In progress** identifies the current implementation, not a production release.
- Publishing, paid experiments, external-service setup, deployment, commits, and pushes remain separate approval steps.

## What the analysis missed or what has changed

| Analysis finding | Current evidence | Status |
| --- | --- | --- |
| `robots.txt` and `sitemap.xml` return 404 | Both public endpoints now return 200; robots points to the correct sitemap and excludes editorial paths. Sitemap currently contains six static URLs. | Infrastructure live |
| No permanent story URLs | `src/app/brief/[slug]/page.tsx` renders all depths, canonical metadata, article social metadata and escaped NewsArticle JSON-LD. Sitemap includes approved publication URLs when available. | Built; live publication rollout not verified |
| Only headline aggregation | Three-depth Brief, source-grounded drafts, human approval, and `why_it_matters` already exist. | Built; live homepage still shows legacy feed |
| No digest | Edition copy/share and dated quick-scan URLs already exist. Neither `/feed.xml` nor `/rss.xml` exists publicly. | Copyable digest built; subscription missing |
| No beginner prompts | Playground already includes example-prompt buttons. | Basic examples built; themed packs remain |
| No model pages | Model details are in the library UI, not standalone `/models/...` pages. | Unfinished |

Live check: https://knowai-sepia.vercel.app/ — homepage has no Brief story links or depth controls; public sitemap has no article entries. This does **not** establish whether the homepage flag is off or no approved stories exist. Do not publish starter samples or turn on automatic drafting to fill the gap. The catalog count in the analysis is a historical snapshot, not a fixed product requirement.

## P0 — discoverability and a way to return

### R01. Crawlable foundations — implemented / live
- [x] Serve `/robots.txt` with the public sitemap URL and private-route exclusions.
- [x] Serve `/sitemap.xml` with public routes and data-driven approved story links.
- [x] Implement permanent `/brief/[slug]` pages with all reading depths in server HTML.
- [x] Add article canonical/social metadata, NewsArticle structured data, and noindex behavior for missing stories.
- [ ] **Release gate:** an authorized editor reviews and publishes a real story, then verifies its public URL, metadata, source links, and sitemap entry on the deployed site. Enable the reader homepage only through the documented rollout. No production publication/deployment is authorized by this roadmap task.

### R02. RSS subscription — implemented and verified locally; rollout pending
Choose RSS first: no mailing-list vendor, address collection, or paid calls are needed. This is a rolling feed, **one item per approved story**, not a promise of a scheduled daily email or exactly one item per date.
- [x] Serve `/feed.xml` as valid RSS 2.0, using only existing public approved publications.
- [x] Include the latest 50 stories, newest first, stable permalink GUIDs, original knowai publication dates, category, plain-English summary, “Why it matters,” and original-source attribution.
- [x] Escape XML and description HTML; never expose private captures, evidence notes, credentials, or draft content.
- [x] Valid empty feed before the first publication; safe non-cacheable 503 on uncached retrieval failure, never unreviewed fallback news. Existing approved cached content may be served during revalidation, as documented in README.
- [x] Add RSS autodiscovery and a visible, accessible footer subscription link on both legacy and activated reader pages.
- [x] Test serializer edge cases, HTTP behavior, live-in-fixture publication visibility, and mobile discoverability; verify with a production build.
- [ ] Non-blocking test follow-up: exercise time-based expiry of a warm publication cache while its upstream is failing. Explicit publication invalidation and uncached errors are covered; the expiry/failure combination is not.
- [ ] **Release gate:** deploy, inspect the real feed, and subscribe using a real feed reader. No email or push subscription is implied.

### R03. “Yesterday in AI” landing page — pending
Existing dated editions and quick scan provide the underlying UI; a dedicated landing page does not exist yet.
- [ ] Add a shareable yesterday route using an explicit UTC date and quick-scan depth.
- [ ] Honest no-edition state; never silently label an older edition “yesterday.”
- [ ] Link to dated archives, add metadata/canonical handling, test date boundaries, and avoid duplicate indexable query variations.

### R04. Optional email digest — pending decision, after RSS
RSS satisfies the analysis’s first “email **or** RSS” milestone. Email is a separate expansion.
- [ ] Choose vendor, verified sender/domain, cadence, cost ceiling, and retention policy.
- [ ] Double opt-in, accessible signup, unsubscribe/suppression, delivery deduplication, and consent records.
- [ ] Deliver only approved content; test retries and empty days. No addresses collected or mail sent before approval.

## P1 — make the editorial signature visible

### R05. Three depths and a point of view — built; reader rollout pending
- [x] One-liner → short version → whole picture, inline and on permanent pages.
- [x] Per-story “Why it matters,” attribution, source capture and human review.
- [x] Quick-scan permalinks and edition copy/share.
- [ ] Clear “Who should care” guidance in editorial practice; only add a separate field after defining audience value and factual-review rules.
- [ ] Verify the three-depth experience with real approved stories on the live site (same release gate as R01; not duplicate implementation work).

### R06. Beginner prompt packs — pending expansion
- [x] Basic example prompts and side-by-side comparisons with reported/estimated cost labels.
- [ ] Add themed packs for everyday explanation, writing, and first coding tasks; each supplies editable prompts, not automatic execution.
- [x] Deep-link to a prompt via `?prompt=`: pre-fill editable plain text without automatic comparison; public browser flow verified locally.
- [ ] Deep-link to themed packs when packs exist; explain what to compare and preserve explicit run/charge consent.

### R07. Weekly comparison posts — pending
- [ ] Define repeatable editorial methodology: same prompt/settings, exact model IDs/date, reported vs estimated cost, and explicit limitations.
- [ ] Publish human-reviewed comparison posts at permanent URLs, with original results rather than invented benchmarks.
- [ ] Connect posts to the Playground and RSS/sitemap. Curated publication only; do not persist reader keys, prompts, or results without separate product/privacy approval.
- [ ] Run the first real experiment only with an explicitly approved paid-call budget.

## P2 — models for people, not benchmarks

### R08. Standalone model pages — pending
- [ ] Stable provider/model routes with title, unique editorial description, canonical metadata, and sitemap inclusion.
- [ ] Price/context freshness labels, supported tasks/modalities, limitations, and direct Playground links.
- [ ] Safe routing for model IDs containing slashes/variants; honest retired/unavailable-model states.
- [ ] Avoid thin duplicated catalog pages; validate catalog data and render useful server HTML before indexing.

### R09. Beginner decision guides — pending
- [ ] Task-oriented guides: studying, résumés, first coding project, and currently free options.
- [ ] State selection criteria, privacy cautions, trade-offs, test date, and actual evidence. Never promise “free forever” for third-party pricing.
- [ ] Link guides to model pages and editable Playground examples; maintain a review schedule.

## P3 — sustain discovery and trust

### R10. Original coverage and distribution — pending
- [ ] Establish a human-reviewed publication cadence, original context, and transparent source selection beyond rewording the same feeds.
- [ ] Connect relevant AI 101 guides, article pages, model guides, and comparison posts through internal links.
- [ ] After production verification, submit the sitemap in the site owner's search console; crawlability does not guarantee indexing or traffic.
- [ ] Agree on privacy-respecting measures of returning readers, feed adoption, and useful Playground comparisons before adding analytics.

### R11. Returning-reader experience — implemented locally; rollout pending
- [x] Store non-identifying reading state under `knowai-reader` on this device; disclose its fields and provide a clear control in Privacy.
- [x] Remember reading depth unless a valid URL depth takes precedence; mark individual stories New/Read and offer Catch me up for new stories among available approved publications.
- [x] Explain the three depths with a first-visit welcome strip.
- [x] Add story-page Keep reading links (up to three other published stories), a visible RSS subscribe card on reader/story/legacy pages, and a link back to today's Brief.
- [x] Verify locally with reader-memory, story-page, browser and full phase gates; no production rollout claimed.
- [ ] **Release gate:** verify on the deployed site after the Brief rollout (R01 gate).

### R12. Headline to hands-on — implemented locally; rollout pending
- [x] Plain-English glossary in Brief stories and AI 101, with no editor-preview annotations.
- [x] Safe `?prompt=` Playground links that pre-fill editable text without automatic model requests.
- [x] “Ask AI models about this story” links in story pages and Deep Brief cards.
- [x] “What would it cost me?” everyday-task estimates in the Model Library, labeled as estimates.
- [x] Cross-edition Catch me up for new stories among available approved publications, using on-device visit memory.
- [x] Local documentation and phase-gate verification; no production rollout claimed.
- [ ] **Release gate:** verify the reader experience with real approved stories and catalog data after separately authorized deployment; no production publishing or paid calls authorized here.

Later ideas (not part of R12; each needs a separate decision):
- [ ] **Receipts:** decide editorial handling and quotation rights before exposing public claim-level source excerpts; evidence remains private.
- [ ] **Who should care:** decide audience value and factual-review rules before adding audience chips (see R05).
- [ ] **Model changelog / price watch:** decide snapshot storage and cron job before tracking daily catalog diffs.
- [ ] **Editor-picked Try it models:** decide migration and editor UI before launch-story recommendations.

## Current work and verification

- Local branch: `feat/headline-to-hands-on`, based on the story-images work; R12 is implemented locally, not rolled out. R01's remaining item is a production/editorial approval gate, not missing page code.
- R12 local phase gate: 181 unit/database tests, 37 Brief fixture browser tests, 23 public browser tests, TypeScript check, and production build passed. Four existing Next.js “destination stream closed early” messages appeared in the Brief fixture run without failing tests; their cause is not established here.
- The R02 verification notes below describe the earlier RSS implementation, not a new live check for R12.
- No commitment to rebuild completed features or implement the entire roadmap in this change.
- Local verification completed **2026-10-05**: 122 unit/database tests, TypeScript checking, production builds with the reader flag both enabled and disabled, 27 editorial/reader browser tests, and 12 public-site browser tests passed. Mobile RSS discovery, keyboard focus, touch-target size, and overflow checks passed.
- The history-restore blocker was traced to corruption during the first edit, before save/restore, while the editor was hydrating. Draft fields now remain read-only until their client handlers are ready. A delayed-JavaScript regression failed before the fix; it and the strengthened history test then passed 20 repeated runs. History storage/restoration and publication rules were not changed.
- The editorial run still logged the previously observed Next.js `destination stream closed early` messages without failing tests; their cause is not established by this change. The expected concurrent-editor conflict was also exercised successfully.
- Production rollout and a real feed-reader subscription check remain pending. No production database, environment, publication, or paid model calls were changed by this work. Commit/push/PR delivery was explicitly requested; merge and production deployment remain separate approval steps.
