# Anthropic metadata connector fixtures and handoff

These are small **synthetic** inputs, not saved publisher pages, article bodies, or evidence of live ingestion. `listing.html` and `article.html` intentionally use synthetic headlines, dates and URLs. Additional negative cases are built from these inputs in `editorial-anthropic-discovery.test.ts`.

## Structural grounding

Read-only inspection during leaf-1.2 implementation found:

- `https://www.anthropic.com/robots.txt`: HTTP 200, `User-Agent: *`, `Allow: /`. This is not a terms/rights approval; source-policy enablement remains a separate parent-owned gate.
- `https://www.anthropic.com/news`: HTTP 200; `main`, `h1` = `Newsroom`; `PublicationList-module-scss-module__<hash>__root`, `__list` (`ul`), `__listItem` (`li > a`), `__listHeader`, and `__seeMore`. Featured entries use `FeaturedGrid-module-scss-module__<hash>__root > __featuredItem > a.__content`.
- The representative `/news/cyber-verification-program` article exposed a same-host canonical, `og:type=article`, `og:title`, `og:image`, `article:published_time`, and a `NewsArticle` JSON-LD node with `url`, `mainEntityOfPage`, and the same `datePublished` instant. No live article body was saved.

The fixtures replace the CSS-module hash, not the observed component/local names. The parser requires the actual list hierarchy; merely matching a link class elsewhere is insufficient. A `See more` marker yields truncation rather than causing pagination. Only a complete empty publication structure with an explicit semantic `role=status` no-results notice can be empty. That hypothetical negative/empty-state fixture is **not a claim that an empty live newsroom was observed**. Empty structure without an explicit notice fails closed as layout drift.

## Exported standalone contract

`src/lib/editorial/connectors/anthropic.ts` uses `linkedom` and the shared pure `safeImageUrl` policy from `../images`, never catalog/source/pipeline/database modules. Optional image metadata follows the same local/private-host restrictions as feed and article imports.

- `parseAnthropicListing(html): { urls: string[]; truncated: boolean }`
- `parseAnthropicArticle(html, url, now = Date.now()): AnthropicCandidate`
- `discoverAnthropic({ fetchText, knownUrls, signal, now?, continuation? }): Promise<AnthropicDiscoveryResult>`
- Types: `AnthropicCandidate`, `AnthropicDiscoveryOptions`, `AnthropicDiscoveryResult`.
- `AnthropicConnectorError` exposes `code`; the pure parsers throw it for rejected pages. Discovery converts listing/fetch/access failures into the standardized result.

Candidate fields: `url`, `title`, `source_name: 'Anthropic'`, `source_published_at` (ISO instant), `source_image_url: string | null`. No entry index, HTML, body, description, summary, or generated output.

Result fields: `candidates, scanned, duplicates, filtered, invalid, attempted, remaining, warning, continuation, outcome, errorCode, retryAfter`.

- `scanned`: number of unique allowed canonical links in the returned listing window, at most 40, including known entries.
- `attempted`: metadata requests actually started, at most 8. The single listing request is not included.
- `duplicates`: known listing URLs plus canonical aliases found after metadata parsing. They never overwrite stored metadata/state. This is not disjoint from `attempted` when an alias was only identifiable after fetching.
- `filtered`: 0 (dedicated source; invalid article metadata is counted separately).
- `invalid`: rejected fetched metadata, not HTTP/access failures or listing anchors excluded by URL policy.
- `remaining`: unprocessed candidates in this bounded visible window, **not** the size of the hidden archive.
- `continuation`: next unprocessed canonical URL, at most 2048 characters. Rotate the current validated window to this URL on the next refresh; reset with a warning if absent/invalid. Never fetch a cursor directly. A safe cursor survives listing failure so transient outages do not reset progress.
- `outcome`: `ok | empty | partial | unavailable`. All-invalid completed windows are unavailable. An unfinished all-invalid window remains partial with continuation, avoiding invalid-leader starvation. Valid prior candidates survive later failures.
- `errorCode`: `layout-changed`, `challenge`, `invalid-metadata`, `invalid-url`, `deadline`, `aborted`, `http-<status>` or `fetch-failed` as applicable. Ordinary recoverable per-article metadata rejection is counted as invalid; it need not set a source-wide error while useful work remains.
- `retryAfter`: bounded raw HTTP header string or null. Parent converts this into its durable retry window and suppresses premature future refreshes. No immediate retries or fallback requests occur here.

**Parent responsibilities:** supply credential-free bounded `fetchText` which validates the first URL and every redirect against the correct listing/article policy, enforces decompressed size and per-request timeouts, forwards the supplied signal, and rejects HTTP errors with `{status: number, retryAfter: string | null}`. The connector adds its own active 60-second timer and inherited cancellation; it settles even if a faulty dependency ignores abort, but it cannot forcibly stop that dependency's underlying I/O. Persist only returned metadata/health. DB/inbox integration, enable/access policy and the global 90-second runner remain parent-owned.

## Reproducing the focused tests

From the repository root with the existing dependencies installed:

```sh
node node_modules/tsx/dist/cli.mjs --test tests/editorial-anthropic-discovery.test.ts
```

These tests use synthetic local inputs and injected fetch behavior, not live publisher access.

## Original implementation RED/GREEN evidence

Every behavior slice used the inspected credential-scrubbing wrapper, from the repository root:

```sh
node .unlazy/knowai-sources/verify.mjs anthropic
```

Representative recorded outputs (the same command was rerun after each fix):

| Slice | RED (exit 1) | GREEN (exit 0) |
| --- | --- | --- |
| First metadata-only discovery | 0 pass, 1 fail: connector missing assertion | 1 pass, `VERIFIED anthropic` |
| Forty-link/eight-request budget | 7 pass, 1 fail: invalid metadata aborted discovery | 8 pass, `VERIFIED anthropic` |
| Continuation past invalid leaders | 8 pass, 1 fail: restarted at item-0 rather than item-8 | 9 pass, `VERIFIED anthropic` |
| Active in-flight expiry | 11 pass, 1 fail: signal still not aborted at 60 seconds | 12 pass, `VERIFIED anthropic` |
| Scoped listing defect | 15 pass, 1 fail: accepted links outside verified roots | 16 pass, `VERIFIED anthropic` |
| Encoded traversal defect | 16 pass, 1 fail: repaired encoded traversal accepted | 17 pass, `VERIFIED anthropic` |
| Final parse/deadline boundary | 20 pass, 1 fail: candidate admitted at deadline | 21 pass, `VERIFIED anthropic` |

Targeted strict type-check (no broad build, no emitted files):

```sh
env -i PATH="$PATH" HOME="$HOME" CI=1 TZ=UTC node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --types node --target ES2022 --moduleResolution Bundler --module ESNext --skipLibCheck --lib ES2022,DOM src/lib/editorial/connectors/anthropic.ts tests/editorial-anthropic-discovery.test.ts
```

An initial isolated type-check omitted `--types node`, so Node test APIs were not resolved with the installed TypeScript defaults. Adding the explicit installed Node types fixed the command; no dependencies or shared node_modules were changed.

Four passes completed: vertical implementation; expert structural/date review; defect hunt (scope, URL repair, JSON-LD complexity, accurate health, expiry); and comments/constants/handoff polish with repeated focused verification. Parent gate G2 remains parent-owned independent review, not a leaf self-certification.
