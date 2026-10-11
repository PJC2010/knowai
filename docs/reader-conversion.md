# Reader conversion first pass

This implements the highest-priority reader-facing changes from the local conversion audit (`../../knowai-cro-audit/report.md`, outside this repository). It preserves knowai's charcoal/pale-green identity and its three reading depths.

## Included

- Clear homepage headline: **AI news everyone can understand.**
- Brand promise in the footer and follow page: **AI knowledge everyone can understand.**
- Published Brief hero explains the three reading depths and the human review step.
- “Get The Brief” in the reading-page header, mobile menu, and homepage hero. OpenRouter connection management remains in the Playground; editor navigation remains separate.
- A compact phone hero and text-first story cards. Edition/category filters and onboarding follow the first visible story, with stable filter focus and recovery controls for empty results.
- A lightweight follow prompt after the first homepage story and after a story page's short version.
- `/follow` explains feed readers, offers Feedly/Inoreader links, provides the canonical feed address with clipboard/manual-copy support, and explicitly says email delivery is not available.
- Follow cards on the homepage, story pages, and AI 101. Story follow cards now precede related-story links.
- Story-page introduction for new visitors, neutral “Read The Brief” navigation, and no assumption that an edition was published today.
- Per-page titles, descriptions, canonical URLs, and matching Open Graph/Twitter copy for `/`, `/learn`, `/models`, `/playground`, and `/follow`. `/follow` is in the sitemap.
- The fallback homepage uses the same headline and follow action without claiming its external news feed received human editorial review. Its unfulfilled “daily” promise is removed.

## Deliberate limits

- The default depth stays **Normal**. Quick scan remains available; changing the default should be a separately measured experiment.
- Raw RSS stays at `/feed.xml` for existing subscribers and machine discovery. Existing item IDs and feed content are not changed.
- No email form, fake subscriber count, invented testimonials, new tracking, forced modal, account creation, or paid model call.
- Reader-app links are handoffs, not completed subscriptions. Following requires confirmation in the chosen reader. No third-party account was created.
- No published article has been rewritten or republished. The readability work belongs in the editorial drafting/review path and should be reconciled with main's separate editorial changes first.
- Social preview copy improves in this pass; branded preview **images**, article sharing, model-library recommendations, and saved Playground examples remain follow-up work.

## Release constraint

The `feat/reader-conversion` branch targets `feat/story-images-weekly-feature` for a conversion-only PR. That base contains the previously merged reader work and has the same source tree as the `feat/headline-to-hands-on` baseline used for implementation and verification. `main` and the reader lineage diverge. These changes do not reconcile them and must not be deployed by replacing either history wholesale. Reconcile the editorial and reader branches in a separate authorized integration step before release.

Committing, pushing the new branch, and opening the conversion-only PR are authorized. Branch integration, merging, deployment, subscriptions, DNS changes, and production data mutations remain outside this pass.

## Review and tests

- `npm test` — unit/regression tests.
- `npm run test:brief` — production build and browser suite against the local SQL fixture, with synthetic credentials and no paid drafting key.
- Public fallback checks must explicitly disable Brief V2 and unset production database credentials, then run `npm run build` and `npm run test:e2e`.
- `./node_modules/.bin/tsc --noEmit --incremental false` and `git diff --check`.
- New conversion tests cover direct follow navigation, narrow-screen behavior, keyboard focus, copying/fallback, accessibility, canonical reader-app links, consistent metadata, and first-story visibility. Existing menu and follow tests track the new UI labels/entry points rather than dropping coverage.

Verified locally on October 11, 2026:

- Unit regressions: **187 passed**, with none failed, skipped, or cancelled.
- Published-reader/editor browser regressions: **49 passed**, including a successful production build.
- Fallback-site browser regressions: **33 passed**, after a separate successful production build.
- Fresh TypeScript and diff-whitespace checks passed.
- **10 new conversion tests** cover the added behavior.
- Independent review found no blocking security or logic issues. Non-blocking suggestions are to isolate each conversion test's fixture/cache state and add weekly-feature/empty-result focus scenarios.
- Earlier non-blocking UX suggestions remain follow-ups: announce filtered-result counts and offer a jump back to results; make the hero's “Read the latest stories” action edition-neutral because its in-page anchor retains archived editions and filters.
- Fresh-data desktop and phone captures cover the homepage, follow page, and a story page. All six views had no horizontal overflow or uncaught page exceptions. At 390 × 844, the complete first headline spans approximately y=659–771.

Local evidence (not included in the repository) is in `../../knowai-cro-audit/implementation-verification.md`, `../../knowai-cro-audit/implementation-screens/`, and `../../knowai-cro-audit/verification/`. Screenshots use fixture stories, local feed addresses, and intentionally non-resolving test image URLs; they are not a production deployment or live content review.

## Local review

To review only this conversion pass after fetching the remote branches:

```sh
git diff --stat origin/feat/story-images-weekly-feature...feat/reader-conversion
git diff origin/feat/story-images-weekly-feature...feat/reader-conversion
```

The comparison includes the new follow page, feed-address controls, metadata helper, both conversion test files, and this document.

Run `npm run test:brief` for the isolated reader/editor preview, browser tests, and screenshots in `test-results/`. It starts and stops its own local fixture services. Do not run another server on ports 4310/4311 during that command. Do not point the fixture test suite at production. Branch integration, merging, and deployment require a separate go-ahead.

## Remaining audit work

1. Reconcile the production reader and main editorial histories before release.
2. Choose and configure an owned domain before public promotion.
3. Decide an achievable publishing cadence.
4. Add editor-facing readability guidance/warnings and human-review copy rewrites.
5. Implement email delivery with real consent, unsubscribe handling, provider configuration, and a privacy-policy update.
6. Add a factual About/editor page once the editor identity and wording are approved.
7. Design branded home/story preview images and sharing affordances.
8. Add task-based model recommendations and a genuinely editor-run saved comparison.
9. Choose privacy-conscious analytics and measure follow-page visits, reader handoff clicks, engaged reading, and return visits. A click is not a verified subscription or a demonstrated conversion lift.
