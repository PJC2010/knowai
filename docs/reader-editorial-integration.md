# Reader/editorial integration review — 2026-10-11

This is a local integration candidate, not a production release. PR #9 remains open against `feat/story-images-weekly-feature`; no remote branch, PR base, production deployment, database, publisher setting, or paid drafting workflow was changed.

## Pinned source state

| Reference | Commit |
| --- | --- |
| `main` | `8705468acfb6c25de61272daa46478c166878a5a` |
| `feat/reader-conversion` (PR #9 head) | `24f5aefd6f9b32bdd91550085245725651f795c7` |
| `feat/story-images-weekly-feature` (PR #9 base) | `53c1467578a91bfb521b8bbe2f9dbf838d836abb` |
| Common ancestor of main and reader | `6be70315ab54439210bbe6b761e2f389ca24c66c` |
| Local merge candidate, before regression hardening | `05c243921971b6bbb4cd9cf61f45843fb46782a5` |

Sources: [PR #9](https://github.com/PJC2010/knowai/pull/9), [main at inspection](https://github.com/PJC2010/knowai/commit/8705468acfb6c25de61272daa46478c166878a5a), and the fetched Git histories. The open-PR search returned only #9. Personal-context retrieval was unavailable; the current PR description, discussion, repository handoff notes, and histories supplied the working context.

The reader branch is still **25 commits ahead and 4 behind main**. Those counts include merge commits. Main's substantive additions are private publisher discovery/event grouping and the stale-confirmation fix; the reader lineage includes the earlier hands-on/retention features as well as #9's one conversion commit. Applying only #9 to main would omit its reader prerequisites.

## Integration result and overlapping files

A real three-way merge from main into an isolated review history reports only `README.md` as conflicted. In particular, Git preserves the seven-domain allowlist automatically: the reader's `relatedStories`/`safeRelatedStories` additions and main's allowlist edit are separate hunks. The regression risk is real if someone replaces a whole file/tree with the reader version; it is not an unavoidable textual conflict in this merge.

The complete intersection of paths changed since the common ancestor is:

| Path | Result and required resolution |
| --- | --- |
| `src/lib/brief.ts` | Keep reader helpers and all seven exact HTTPS publisher hosts. The hardening commit expands the existing array onto separate lines for review; it adds no new publisher beyond main. Credentials, non-443 ports, schemes, and tracking removal retain existing behavior. |
| `src/app/brief.css` | Clean additive merge. Main adds the private `.desk-event-*` rules beside source-dialog styles; reader changes add homepage, follow, glossary, related-story and responsive reader styles. Both blocks remain; no shared selector collision was found in these additions. Browser verification remains required. |
| `tests/brief-e2e/editor-flow.spec.ts` | Keep main's private merge/lead/split and publisher-control assertions, plus the reader's two assertions that editor previews neither write `knowai-reader` nor display New/Read markers. No test is replaced or removed. |
| `README.md` | Two conflict regions. Retain the four reader feature bullets and main's expanded seven-publisher/editor description. Retain the reader privacy/no-automatic-call paragraph and main's entire discovery/event-grouping implementation and rollout section. |

## Exact code and regression changes

1. `src/lib/brief.ts` accepts `openai.com`, `blog.google`, `huggingface.co`, `techcrunch.com`, `deepmind.google`, `research.google`, and `engineering.fb.com`, alongside the unchanged reader related-story helpers.
2. `tests/brief.test.ts` adds one table-driven regression for all seven hosts. It verifies HTTPS host case/default-port normalization; removal of `utm_source`, `fbclid`, `gclid` and fragments; retention of a semantic `article=42` query; and rejection of HTTP, credentials, nonstandard ports, unapproved subdomains, lookalike suffix hosts and userinfo host confusion. Existing related-story and source-security tests remain.
3. `tests/editorial-source-import.test.ts` strengthens the publisher-attribution test to cover all seven publishers, normalized URLs, titles and original dates. A new redirect-chain test for each added publisher permits a normalized same-host relative redirect, then rejects an impostor host before issuing that network request. All responses are mocked; no publisher is contacted.
4. `README.md` contains the union described above. This document records the review boundary and validation requirements.

The newly added seven-host regression was also run against the exact old reader-branch `brief.ts` in a disposable probe: it failed with the configured-publisher rejection, as intended. It passes against the integrated implementation.

## Main-only changes that must travel together

These were inspected and retained, rather than cherry-picking just the allowlist:

- `src/lib/editorial/source.ts`: all seven host-to-publisher names and redirect validation remain. Public related-story helpers do not replace this import path.
- `src/lib/editorial/pipeline.ts`: wider private discovery, bounded scanning and the original-four-only automatic drafting restriction remain. Reader changes do not alter paid job eligibility.
- Editorial desk UI/types/actions, `event-candidates.ts`, and all three newer migrations remain exactly as on main. The version-bound event-confirmation RPC and stale-review rejection are preserved.
- `tests/brief-e2e/event-confirmation.spec.ts` remains byte-for-byte main's version, covering full-group review on a phone, explicit consent, stale confirmation across sessions, reload/review, unchanged public Brief/RSS, and zero attempts.
- Main's editor hydration wait in `tests/brief-e2e/brief.spec.ts` and cache cleanup in `tests/run-brief-e2e.mjs` remain. The reader fixture's cross-edition support and cache-refresh helper remain; the fixture dynamically loads every migration, so the combined run includes the event schema.
- Source/feed, event-action, event-candidate, PGlite access-policy and event-confirmation regressions, plus the real-PostgreSQL contention runner, remain in the combined tree. No schema change is newly authored by this patch.

## Validation in this environment

- **223 unit/regression tests passed**, none failed, skipped or cancelled, with the existing suite run serially using the installed Node executable's absolute path:

  ```bash
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
    --import tsx --test --test-concurrency=1 tests/*.test.ts
  ```

  This uses the repository's pinned `tsx` loader and unchanged test files. The initial parallel run had 220 passes and three process-launch errors because this sandbox reports `process.execPath` as `node`; all three passed using the absolute executable path. A subsequent parallel run hit a native `corrupted size vs. prev_size` crash in a PGlite test process. Serial execution completed cleanly. These environment issues are recorded rather than treating either earlier run as a pass.
- **16 focused reader/source tests passed** before the full run, including existing related-story selection, the new URL matrix, metadata attribution and redirect checks.
- The old-reader mutation probe failed as expected; whitespace checks passed and no merge conflict markers remain.
- Remote main, reader, and PR-base heads were rechecked after implementation and still match the table above.

This is not a release-ready validation claim. The pinned TypeScript 7 compiler panics because this sandbox lacks `/proc/self/exe`. Next.js production build fails in `uv_resident_set_memory` before compilation. The pinned Chromium download also failed (invalid/truncated archive and download-lock error), and Docker is unavailable. Consequently neither browser suite, a production build, the fresh typecheck, nor the real PostgreSQL contention suite passed here. No dependencies were downgraded and no checks were disabled to manufacture a pass.

Playwright discovery does load the combined suites successfully: **52 Brief/editor tests in 9 files** and **33 fallback tests in 6 files**. Discovery is not execution. The earlier PR's 49/33 browser results and preview-ready status apply to its earlier tree, not this integration candidate.

## Safe integration sequence

1. **Keep the histories separate for review.** Fetch current remote refs in a clean checkout. Confirm the three head SHAs above; if any changed, stop applying the snapshot blindly and reconcile the newer commits on another review branch. Leave #9's intentional base unchanged.
2. **Import the candidate into a new local branch.** The accompanying `knowai-integration.bundle` preserves both parent histories and the focused follow-up commit. It requires the pinned main and reader commits already present locally. From the repository, substitute the actual path to the extracted bundle:

   ```bash
   git fetch origin main feat/reader-conversion feat/story-images-weekly-feature
   git rev-parse origin/main origin/feat/reader-conversion origin/feat/story-images-weekly-feature
   git bundle verify /path/to/knowai-integration.bundle
   git fetch /path/to/knowai-integration.bundle \
     refs/heads/integration/reader-editorial-2026-10-11:refs/heads/review/reader-editorial
   git switch review/reader-editorial
   git merge-base --is-ancestor 8705468acfb6c25de61272daa46478c166878a5a HEAD
   git merge-base --is-ancestor 24f5aefd6f9b32bdd91550085245725651f795c7 HEAD
   git diff origin/main...HEAD
   ```

   Use a fresh review-branch name if that name already exists; do not force-update it. `integration-vs-main.patch` is an alternative exact-tree patch against the pinned main. Use `git apply --check` on a fresh branch at that commit before applying it. The bundle is preferred because it records ancestry; the patch alone does not. Do not apply both. `regression-hardening.patch` is only the focused follow-up after the resolved merge; it is not a replacement for integrating main's editorial dependencies.

3. **Run gates on the combined tree in an ordinary Node 22+ environment.** Use a clean checkout without production `.env` files or database/model secrets. Install pinned dependencies and Chromium, then run:

   ```bash
   npm ci
   npx playwright install chromium
   npm test
   npm run typecheck -- --incremental false
   npm run test:brief
   ```

   `test:brief` builds with synthetic localhost Supabase credentials and an empty paid drafting key; it owns ports 4310/4311. Require the conversion/retention/hands-on, source publisher controls, editor preview isolation, event merge/lead/split, and stale-confirmation tests all to pass together. Also run `node tests/run-editorial-cap-postgres.mjs --suite events` with the documented disposable local PostgreSQL 18/Docker prerequisites. It must not use a production DSN.

4. **Rebuild for fallback verification.** The fixture build embeds fixture configuration. In that same clean checkout, explicitly unset database/drafting credentials and `TEST_BASE_URL`, set `BRIEF_V2_ENABLED=false`, then run `npm run build` followed by `npm run test:e2e`. Never reuse the fixture build as a release artifact. Recheck the phone homepage headline/filters, follow/copy/manual-copy flow, story reading/related links, and private coverage dialog on the same integrated commit. Preserve the existing non-blocking #9 follow-ups unless an actual integration failure requires a fix.

5. **Stage the complete application/schema pair if reviewing a hosted preview.** Check applied migration history; apply only missing migrations in order on a backed-up staging database through `202610060002_editorial_event_confirmation.sql`. Keep automatic drafting off and use a staging-only setup. Verify editor permissions and two-session stale confirmation. This task applies no migration. A later branch push may trigger a Vercel preview; that is distinct from production approval.

6. **Final merge and release are separate decisions.** After #9's review and the combined gates are complete, re-fetch and inspect any changed feature/main heads before deciding the final integration merge. Do not retarget #9, force-push either lineage, enable auto-merge, or replace main's tree with a reader snapshot. Production deployment, migrations, domain changes, paid drafts and publishing require their own release step. This work performs none of them.

The archive includes both patches, the Git bundle, source/head metadata, and validation logs. `MANIFEST.json` records the final local candidate commit and artifact checksums.
