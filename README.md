# knowai

A Vercel-ready Next.js website for understanding AI: source-linked news, an approachable model library, short learning guides, and a side-by-side OpenRouter playground.

## Run locally

Requires Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. If a managed browser environment blocks development WebSockets, use the production preview below; development hydration can wait on that connection. For a production preview:

```bash
npm run build
npm start
```

## Deploy to Vercel

1. Push this directory to a Git repository and import it in Vercel.
2. Choose the **Next.js** framework preset. If this directory sits inside a larger repository, set the project root to `knowai`.
3. Keep the default build command (`npm run build`) and output configuration. Deploy.

Alternatively, from this directory run `npx vercel`, then `npx vercel --prod` when ready to publish.

The existing RSS homepage and playground run without a database or shared API key. **The new three-depth Brief and private editorial desk require Supabase and a dedicated editorial OpenRouter key.** Follow [editorial setup](docs/editorial.md) before enabling `BRIEF_V2_ENABLED`. Readers still connect their own OpenRouter accounts only for playground usage. This workspace does not contain a Vercel account binding or production deployment.

Social preview URLs use Vercel’s deployment hostname automatically. For a custom domain, optionally set `NEXT_PUBLIC_SITE_URL` to its full HTTPS URL before building.

## Interface

The charcoal interface follows the [Redesign Existing Projects skill](https://github.com/elayadesign/redesign-skill/blob/main/skills/redesign-existing-projects/SKILL.md): Manrope typography, flat neutral surfaces, one green accent, Phosphor icons, and floating navigation. The mobile menu supports keyboard focus and Escape. Loading skeletons, reduced-motion support, Privacy, and Terms are included. The visual refresh preserves source dates, model prices, and comparison accounting.

## What works

- **Three-depth Brief:** Quick scan, Normal, and Deep reading modes; inline story expansion; keyboard navigation; dated, copyable editions; and permanent story pages with all three tiers in server-rendered HTML. Activation waits for backend configuration and a first approved story.
- **Private editorial desk:** `/editor` uses Supabase email sign-in and an editor allowlist. Private discovery now includes seven configurable feeds: OpenAI, Google AI, Hugging Face, TechCrunch, Google DeepMind, Google Research, and Meta Engineering. The last three add metadata to the inbox but do not enter scheduled automatic drafting. Editors can review possible same-event coverage and explicitly group, split, and choose a private lead from source previews. Source-grounded OpenRouter drafts, four importable starter drafts, evidence checks, revision history, and explicit human approval remain unchanged. Daily cron and manual refresh share deduplication, a worker lease, and a configurable daily attempt cap. See [setup, workflow, and validation](docs/editorial.md).
- **Story images and weekly features:** editors preview the article's main image, choose no image, or upload a JPEG/PNG/WebP replacement before review and publication. A published article can lead The Brief for a selected Monday–Sunday UTC week, with one featured article per week.

- **Legacy Brief (before activation):** RSS news from OpenAI, Google AI, Hugging Face, and TechCrunch; category filtering, source links, source publication dates, and incremental loading. Promotional TechCrunch event offers are filtered. Some known articles have source-checked editorial summaries. Publisher and community attribution is retained.
- **Model Library:** live OpenRouter text-model catalog, provider/search/free-model filters, price sorting, full model details, and selection of up to three models to compare. Batch models and automatic routers are excluded from direct model comparison.
- **Playground:** select one to three models, send an identical prompt concurrently, compare responses, copy an answer, and inspect tokens, elapsed time, and each request's cost. Supports partial failures, cancellation, timeouts, missing-cost estimates, output-limit warnings, and billed responses with no visible text.
- **AI 101:** six plain-language guides covering LLMs, prompts, tokens, context windows, model selection, and API keys.
- **OpenRouter setup:** account connection through OAuth with S256 PKCE/state verification, or an existing key validated with OpenRouter. Direct links to buy usage credits and create keys. Creating a key is free; credits fund usage.

## Expanded editorial discovery and private event groups

The editorial code adds **two private capabilities**, not a new public aggregator or an automated publication system:

1. **Wider private source discovery.** Three official publisher feeds—Google DeepMind, Google Research, and Meta Engineering—are registered by `20261005224600_primary_source_feeds.sql` without resetting an existing editor's source switches. RSS and Atom entries with original publication dates are normalized and URL-deduplicated. The six primary/research feeds scan at most 50 entries per refresh; TechCrunch remains at eight. A visible health warning records when a feed exceeds its scan limit. Google Research and Meta Engineering use a conservative AI-topic check on headline and structured feed categories, so some relevant stories may be missed. Exact HTTPS source-host and redirect validation is extended for the new publishers. All discoveries enter only the private inbox. The three new feeds **do not auto-enqueue paid drafts**. Even for the four original eligible publishers, scheduled drafting considers only the first eight entries and claims only auto-origin jobs, never manual queued work. A human may explicitly select a new story and confirm a paid draft using the existing workflow.
2. **Private, human-reviewed event grouping.** `202610060001_editorial_events.sql` creates a separate event identity and membership for each existing source, then adds a singleton group for each newly discovered/imported source. It also hardens the inherited editor-authorization helper against temporary-table shadowing; event tables use editor-only row policies and mutations use editor-checked RPCs. Opening **Inbox → Source preview → Related coverage** shows that private group, up to six conservative metadata-only suggestions from a bounded nearby-date search, and a search of stored article titles/publishers for missed matches. Suggestions use overlapping named entity, event action, distinctive title terms, model version and a 72-hour window; they are **not verification or automatic merges**. Compare the original articles and explicitly merge groups, choose a private lead, or remove a source. Merges carry all members of the other group and are capped at 20 sources. `202610060002_editorial_event_confirmation.sql` adds group versions and removes the unsafe two-argument merge RPC. **Review merge** displays both full groups, their original-article links, the resulting count, and the proposed lead before explicit confirmation. Confirmation submits exactly those group IDs and versions; membership or lead changes invalidate it. A rejected stale merge moves nothing and requires **Reload groups** plus fresh review, never an automatic retry. An editor-only audit records merge, lead, and split decisions. Grouping neither rewrites source records nor changes a draft, the public Brief, publication approval, model-attempt count, or the homepage's separate four-feed RSS path. Public stories are still single-source; no public event page or cross-source article is generated.

**Rollout:** apply all seven SQL migrations in order on a backed-up staging database, including the discovery, event-grouping, and event-confirmation migrations above, then deploy the matching app. Keep automatic drafting off and review feed/publisher terms and republication rights before broadening content use (especially TechCrunch). Manual URL import still requires a recognizable original publication date; availability of a feed does not guarantee that every article page is importable. Validate Supabase permissions, event operations with two editors, discovery cadence, production cron isolation and the no-charge private workflow in staging before any production migration. A branch push does **not** apply migrations, enable feeds in an existing database, authorize a paid model call, or publish an article. It may trigger a **preview deployment** if your Vercel/Git integration is configured; it is not a production rollout. See [editorial setup and rollback notes](docs/editorial.md).

**Implementation and tests:** `src/lib/editorial/pipeline.ts` handles feed parsing, bounded scanning and scheduled-job eligibility; `src/lib/brief.ts` and `src/lib/editorial/source.ts` validate and attribute the new hosts. `src/lib/editorial/event-candidates.ts` provides testable, free suggestions; `src/lib/editorial/desk.ts`, `src/components/editor/event-coverage.tsx`, and the sixth and seventh migrations handle editor-only grouping and version-bound confirmation. `tests/editorial-pipeline.test.ts`, `tests/editorial-source-import.test.ts`, `tests/editorial-primary-feeds-db.test.ts`, `tests/editorial-event-candidates.test.ts`, `tests/editorial-event-groups-db.test.ts`, `tests/editorial-event-confirmation-db.test.ts`, `tests/editorial-event-actions.test.ts`, and the editor-flow/event-confirmation browser tests cover the feed and event boundaries, database access, human controls and public/paid isolation. `node tests/run-editorial-cap-postgres.mjs --suite events` exercises real PostgreSQL snapshots and separate-connection lock contention with disposable local containers. Run the commands in [Validation](#validation); the local browser suite builds with fake localhost Supabase configuration, so run a normal build afterward.

## Credentials and billing

The key lives only in React memory. Refreshing the page, closing it, or disconnecting removes the key from knowai. Client-side navigation retains the connection. knowai does not store a user's key, prompts, responses, or comparison history in a database or browser storage.

Model requests and key validation travel directly from the browser to `https://openrouter.ai`. Prompts go to OpenRouter and the selected providers. Temporary OAuth verifier/state information is stored in session storage for the redirect and removed during the callback; API keys are never stored there. Callback parameters are removed from the address bar.

The playground does not sell keys, process payments, mark up usage, or use a shared server key. Purchases occur on OpenRouter. A connected key can have its own spending cap; this is not the user's account balance, so knowai does not display it as a balance.

Before running, estimated charges use an approximate input token count plus the chosen output limit. After running, `usage.cost` from OpenRouter is shown as the reported charge, including an explicit zero. If it is missing, available token counts and base prices produce a labeled estimate; missing usage is unavailable, never assumed free. Reasoning, caching, provider routing, context-tier pricing, and credit-purchase fees can cause estimates to differ from final charges. Stopping a request does not guarantee the provider stops processing or billing it.

## Freshness and fallback data

The three-depth Brief reads approved database publications. Source discovery runs daily or from the editor; publishing updates the relevant caches. Original source dates and knowai publication dates are distinct. If the activated editorial database fails, the app shows an error rather than substituting unreviewed stories. The following RSS fallback behavior applies to the legacy homepage.

News fetches are cached for 15 minutes; the model catalog for 30 minutes. Next.js revalidates them when visitors request pages after the cache interval. This is request-triggered revalidation, not a scheduled background news scraper or push feed. Refresh an open tab to get the latest rendered briefing.

If a source fails, available feeds still render. If all feeds or the model API fail, the app uses a checked-in snapshot and labels the saved data and its date. Source dates are retained rather than presenting older stories as new. Model prices are USD per one million tokens.

Sources and editorial summaries live in `src/lib/news.ts` and `src/data/news-snapshot.json`. Model data is normalized in `src/lib/models.ts`. Local snapshots were retrieved on October 3, 2026. The original green-glass editorial image is generated artwork and labeled as an illustration.

## Product roadmap

See [the prioritized todo roadmap](docs/roadmap.md) for the website-analysis recommendations, what is already built versus live, acceptance criteria, and remaining release gates.

## Follow The Brief via RSS

Add `/feed.xml` on your deployment to an RSS reader, or use **Subscribe via RSS** in the public footer. Pages also advertise the feed for reader autodiscovery. The feed contains up to 50 of the latest **editor-approved publications**, one item per story, with a short version, why it matters, attribution, and a permanent knowai link. It updates as stories are published, not on a guaranteed daily send schedule. This is not an email signup.

An empty editorial database produces a valid empty feed; it does not substitute raw headlines or starter drafts. The public publication reader supplies the existing five-minute, tag-invalidated cache. Like the existing public reader, its time-based refresh can serve previously approved cached content while revalidation runs or fails; this is not a guarantee of a fresh database read on every request. HTTP clients must revalidate; uncached retrieval failures return a non-cacheable 503 with a five-minute retry hint. RSS works independently of the reader-homepage rollout flag, just like permanent article pages. Feed readers may retain copies of published content; withdrawal cannot remove copies already downloaded.

No database migration, mailing-list service, additional credentials, or model calls are required. Configure `NEXT_PUBLIC_SITE_URL` to the canonical production origin before rollout so feed item URLs and GUIDs remain stable. Changing domains can appear as new entries to subscribers.

## Validation

```bash
npm run typecheck
npm test
npm run test:brief
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start the production build on port 3100. Set `TEST_BASE_URL` to test an already-running server. The tests cover news filters, model selection/details, mobile layout and keyboard navigation, reduced-motion readability, legal links, mocked key validation, identical prompts to multiple models, partial failures, cost display, truncation warnings, OAuth state rejection and successful callback, and key removal on refresh.

The dedicated Brief browser suite uses a local Supabase HTTP fixture; database tests execute the actual migration and access policies in isolated PGlite. Run a normal build after `test:brief` because it uses fixture configuration.

No genuine API key is included. Automated comparison and OAuth tests use network mocks; completing a real paid model request and a real account authorization requires a user's OpenRouter connection.

## Main files

- `src/app` — routes, page metadata, shared styles, and read-only news/model endpoints.
- `src/components` — newsroom, model library, playground, account connection, and navigation.
- `src/lib` — feed handling, model normalization, OpenRouter requests, and cost calculations.
- `src/data` — dated fallback snapshots.
- `tests` — cost-accounting and browser-flow checks.

Official integration references: [OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth), [usage accounting](https://openrouter.ai/docs/guides/guides/usage-accounting), [model catalog](https://openrouter.ai/api/v1/models), [pricing](https://openrouter.ai/pricing).
