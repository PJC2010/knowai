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

**No environment variables, database, shared API key, or paid news service are required.** End users connect their own OpenRouter accounts. The site is ready for Vercel; this workspace does not contain a Vercel account binding or production deployment.

Social preview URLs use Vercel’s deployment hostname automatically. For a custom domain, optionally set `NEXT_PUBLIC_SITE_URL` to its full HTTPS URL before building.

## Interface

The charcoal interface follows the [Redesign Existing Projects skill](https://github.com/elayadesign/redesign-skill/blob/main/skills/redesign-existing-projects/SKILL.md): Manrope typography, flat neutral surfaces, one green accent, Phosphor icons, and floating navigation. The mobile menu supports keyboard focus and Escape. Loading skeletons, reduced-motion support, Privacy, and Terms are included. The visual refresh preserves source dates, model prices, and comparison accounting.

## What works

- **The Brief:** RSS news from OpenAI, Google AI, Hugging Face, and TechCrunch; category filtering, source links, source publication dates, and incremental loading. Promotional TechCrunch event offers are filtered. Some known articles have source-checked editorial summaries. Publisher and community attribution is retained.
- **Model Library:** live OpenRouter text-model catalog, provider/search/free-model filters, price sorting, full model details, and selection of up to three models to compare. Batch models and automatic routers are excluded from direct model comparison.
- **Playground:** select one to three models, send an identical prompt concurrently, compare responses, copy an answer, and inspect tokens, elapsed time, and each request's cost. Supports partial failures, cancellation, timeouts, missing-cost estimates, output-limit warnings, and billed responses with no visible text.
- **AI 101:** six plain-language guides covering LLMs, prompts, tokens, context windows, model selection, and API keys.
- **OpenRouter setup:** account connection through OAuth with S256 PKCE/state verification, or an existing key validated with OpenRouter. Direct links to buy usage credits and create keys. Creating a key is free; credits fund usage.

## Credentials and billing

The key lives only in React memory. Refreshing the page, closing it, or disconnecting removes the key from knowai. Client-side navigation retains the connection. knowai does not store a user's key, prompts, responses, or comparison history in a database or browser storage.

Model requests and key validation travel directly from the browser to `https://openrouter.ai`. Prompts go to OpenRouter and the selected providers. Temporary OAuth verifier/state information is stored in session storage for the redirect and removed during the callback; API keys are never stored there. Callback parameters are removed from the address bar.

The playground does not sell keys, process payments, mark up usage, or use a shared server key. Purchases occur on OpenRouter. A connected key can have its own spending cap; this is not the user's account balance, so knowai does not display it as a balance.

Before running, estimated charges use an approximate input token count plus the chosen output limit. After running, `usage.cost` from OpenRouter is shown as the reported charge, including an explicit zero. If it is missing, available token counts and base prices produce a labeled estimate; missing usage is unavailable, never assumed free. Reasoning, caching, provider routing, context-tier pricing, and credit-purchase fees can cause estimates to differ from final charges. Stopping a request does not guarantee the provider stops processing or billing it.

## Freshness and fallback data

News fetches are cached for 15 minutes; the model catalog for 30 minutes. Next.js revalidates them when visitors request pages after the cache interval. This is request-triggered revalidation, not a scheduled background news scraper or push feed. Refresh an open tab to get the latest rendered briefing.

If a source fails, available feeds still render. If all feeds or the model API fail, the app uses a checked-in snapshot and labels the saved data and its date. Source dates are retained rather than presenting older stories as new. Model prices are USD per one million tokens.

Sources and editorial summaries live in `src/lib/news.ts` and `src/data/news-snapshot.json`. Model data is normalized in `src/lib/models.ts`. Local snapshots were retrieved on October 3, 2026. The original green-glass editorial image is generated artwork and labeled as an illustration.

## Validation

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start the production build on port 3100. Set `TEST_BASE_URL` to test an already-running server. The tests cover news filters, model selection/details, mobile layout and keyboard navigation, reduced-motion readability, legal links, mocked key validation, identical prompts to multiple models, partial failures, cost display, truncation warnings, OAuth state rejection and successful callback, and key removal on refresh.

No genuine API key is included. Automated comparison and OAuth tests use network mocks; completing a real paid model request and a real account authorization requires a user's OpenRouter connection.

## Main files

- `src/app` — routes, page metadata, shared styles, and read-only news/model endpoints.
- `src/components` — newsroom, model library, playground, account connection, and navigation.
- `src/lib` — feed handling, model normalization, OpenRouter requests, and cost calculations.
- `src/data` — dated fallback snapshots.
- `tests` — cost-accounting and browser-flow checks.

Official integration references: [OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth), [usage accounting](https://openrouter.ai/docs/guides/guides/usage-accounting), [model catalog](https://openrouter.ai/api/v1/models), [pricing](https://openrouter.ai/pricing).
