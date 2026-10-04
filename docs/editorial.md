# The three-depth Brief

The Brief uses original AI-assisted copy at three depths: one line (at most 140 Unicode characters), one paragraph (40–80 words), and two or three paragraphs of context (150–300 words). Each story also has a “why it matters” line and private evidence excerpts. Length checks run on generated output, in the editor, and in the database before publication. They are structural checks, not proof of factual accuracy; an editor must check the original reporting.

The four starter texts are versioned examples in this public source repository, not confidential drafts. Imported database drafts and future generated content stay behind editor access. Full article captures are fetched into the private database and are not committed to the repository.

## Enable on Vercel

1. Create a Supabase project. Apply **all three complete migrations, in order**: `supabase/migrations/202610040001_brief.sql`, `supabase/migrations/202610040002_editorial_desk.sql`, then `supabase/migrations/202610040003_editorial_daily_cap.sql`. Use the SQL editor or the Supabase CLI, not selected snippets. Existing installations with the base and desk migrations need the third before deploying the configurable-limit application. These transactional, rerunnable scripts preserve existing rows and refresh functions/access policies. Anonymous readers see only approved publications; do not disable row-level security.
2. Add the variables from `.env.example` through Vercel **Project → Settings → Environment Variables**. Use the project URL and publishable key from Supabase. Keep `SUPABASE_SECRET_KEY`, `EDITORIAL_OPENROUTER_API_KEY`, and `CRON_SECRET` server-only. Use a dedicated OpenRouter key with a spending limit; do not reuse a visitor's playground key. `CRON_SECRET` should be a randomly generated secret of at least 32 characters. Never put keys in GitHub or chat.
3. Set `NEXT_PUBLIC_SITE_URL` to the production HTTPS origin. In Supabase Authentication URL Configuration, set the same site URL and allow exactly `https://YOUR-DOMAIN/editor/callback`. Add a separate local callback only if needed for development. Configure production email delivery for reliable magic links. The default Supabase email service has sending restrictions.
4. Create/invite your editor user through Supabase Authentication and complete email verification. Put the email in `EDITOR_EMAIL_ALLOWLIST`. Grant that user's ID with the SQL below. Disable public sign-ups in Supabase; the app itself uses `shouldCreateUser: false`.
5. Deploy with `BRIEF_V2_ENABLED=false`. Visit `/editor`, request a magic link, and open it in the same browser. The editor allowlist restricts sign-in requests; the `brief_editors` table is the authoritative authorization check on both server actions and database functions.
6. Open **Inbox**, refresh sources (discovery only), or import an approved publisher article URL. Select stories deliberately, then confirm charges to generate drafts. Discovery, URL metadata import, selection, and manual writing do not call a model. Automatic drafting starts off. Existing starter drafts remain available; the workspace does not need a starter import to operate.
7. Open a draft, check the saved source capture and original article, edit all three depths, and resolve evidence/length issues. Choose **Start final review**, tick both saved-version confirmations, then **Approve and publish** and confirm publication. Verify the permanent link. Set `BRIEF_V2_ENABLED=true` and redeploy only after staging checks. This flag controls the reader homepage, not editor access, cron, or spending. Without an approved story, the original RSS homepage stays available. A database error after activation produces an error state rather than silently substituting unreviewed content.

Grant an editor after creating their verified account (replace the example email):

```sql
insert into public.brief_editors(user_id)
select id from auth.users
where lower(email) = lower('editor@example.com')
  and email_confirmed_at is not null
on conflict do nothing;
```

To revoke access, remove the user's row from `brief_editors` and their address from `EDITOR_EMAIL_ALLOWLIST`. Every protected read/mutation checks authorization; knowing `/editor` is not access. Public routes and public REST tables never return drafts, source captures, reviewer IDs, or evidence notes.

## SQL Editor: “relation already exists”

If an earlier copy of the setup script reports `42P07: relation "brief_editors" already exists`, that table was created previously. The message alone does not show whether the rest of the setup completed. Open the latest migration file from this repository, copy its entire contents into a **new SQL Editor query**, and run it as the project's `postgres` role. Do not delete existing tables or continue by skipping individual failing statements.

The scripts use `IF NOT EXISTS` for tables and indexes, replace functions and policies, and insert settings/worker locks only when missing. Existing editor grants, stories, drafts, review history, and active worker leases are preserved. Reapply the complete ordered sequence if repairing the base schema: the desk and daily-cap migrations override earlier functions. Rerunning an older migration alone afterward would undo hardening or restore fixed-ten behavior. The daily-cap migration preserves an already chosen limit. This supports repeated application of knowai's schema; it does not reconcile unrelated tables or custom schema changes that happen to use the same names.

Running SQL manually does not record a Supabase CLI migration. If you later switch to `supabase db push`, reconcile the CLI migration history after verifying the schema. The updated script also tolerates a first CLI application over this matching schema.

## Editor sign-in: no email arrives

The app does not create accounts during sign-in (`shouldCreateUser: false`). An account used to log in to the Supabase dashboard is **not** automatically a user in your project's **Authentication → Users**. Create the editor there first, complete verification, and grant `brief_editors` access using the SQL above. Creating database tables does not create an Auth user.

The login form also checks `EDITOR_EMAIL_ALLOWLIST` in the active Vercel deployment. Set it for the deployment's environment and redeploy after changes. Missing configuration now reports a setup error. An address outside the allowlist gets a neutral response and no email request; the same neutral response is used when the provider accepts an allowed address, to keep membership private. Provider acceptance is not proof of inbox delivery.

To diagnose an attempt, open Vercel project **Logs**, filter for `/editor`, and search for `[editor-signin]`. These logs contain only a reason, a recognized provider error code, and an HTTP status—no email addresses, keys, links, or tokens. They are available after deploying the sign-in diagnostics update.

| Log reason / code | What to check |
| --- | --- |
| `allowlist_missing` | Set `EDITOR_EMAIL_ALLOWLIST` and redeploy. |
| `not_allowlisted` | Check the exact submitted email against the deployed allowlist, including which Vercel environment was configured. |
| `provider_rejected` / `otp_disabled`, `signup_disabled`, or `user_not_found` | Confirm the account exists in Authentication → Users and email/magic-link authentication is enabled. Check Supabase Auth logs for the exact cause; keep public sign-ups disabled. |
| `provider_rejected` / `email_address_not_authorized` | Supabase's default SMTP restricts recipients to organization team members. Configure custom SMTP for other recipients; an Auth user alone does not satisfy this restriction. |
| `provider_rejected` / `over_email_send_rate_limit`, `over_request_rate_limit`, or HTTP 429 | Wait for the rate limit. Repeated submissions do not speed delivery. Check Authentication rate limits and SMTP provider limits. |
| `provider_rejected` / `unknown` with HTTP 401 or 403 | Check the Supabase project URL and matching publishable key in Vercel. Do not put a server secret in the publishable-key variable. |
| Other `provider_rejected` | Open Supabase **Logs → Auth** and inspect the failed `/otp` request. SMTP errors may appear as an unexpected failure; check the sender, credentials, email template, and delivery provider logs. |
| `request_failed` | Check URL/key configuration and connectivity in the deployed environment. |
| `provider_accepted` | Check spam and the SMTP provider's delivery/bounce logs. |

Supabase's [default email service](https://supabase.com/docs/guides/auth/auth-smtp) is for initial testing, currently limited to two messages per hour, with no delivery guarantee. Configure custom SMTP for production. Do not add people to your Supabase organization merely to bypass delivery restrictions.

Once email arrives, a link that lands on the wrong page is a separate redirect issue: set `NEXT_PUBLIC_SITE_URL` to the production origin and allow that exact origin plus `/editor/callback` in Supabase URL Configuration. Open the link in the browser that requested it. A successful login followed by an access rejection means checking the verified user and `brief_editors` grant.

For the current Vercel deployment, use these matching settings:

| Setting | Value |
| --- | --- |
| Vercel `NEXT_PUBLIC_SITE_URL` | `https://knowai-sepia.vercel.app` |
| Supabase Authentication → URL Configuration → Site URL | `https://knowai-sepia.vercel.app` |
| Supabase Authentication → URL Configuration → Redirect URLs | `https://knowai-sepia.vercel.app/editor/callback` |

The app now normalizes the site origin, including a mistakenly copied trailing slash, before constructing links. Older deployments could send `//editor/callback`, which does not match the intended allowed URL. Supabase can fall back to its Site URL when a requested redirect is not allowed; this can land on the homepage or a different Vercel alias without completing the editor callback. The callback must run on the same origin where the browser requested the link, so it can read the PKCE cookie.

Save Supabase's URL settings and redeploy after changing Vercel environment variables. Request a **new** email from the canonical `/editor` URL and open it in the same browser. Existing emails retain their previous redirect URL. Keep the magic-link template's default `{{ .ConfirmationURL }}` link instead of hard-coding another site URL. Avoid sharing verification tokens or complete sign-in links in logs sent to others.

## Workspace migration and rollout

The desk migration adds publisher health/settings, persistent source triage, explicit job selection/authorization, paginated workspace reads, atomic save/review/restore functions, and a private suggestion audit. It also hardens inherited worker entry points and function grants. Legacy queued jobs start **held**, not implicitly approved for paid work; existing publications are unchanged. Auto-drafting defaults to `false`, and reapplying the migration preserves an already chosen setting rather than resetting it.

Before deploying the redesigned workspace:

- Back up and test the ordered migrations in staging. Check anonymous denial of captures, drafts, history, settings, and suggestion audits, plus editor and service-role RPC grants. Never expose `SUPABASE_SECRET_KEY` or use it in a browser.
- Keep automatic drafting off while verifying discovery and selection. Disable/pause the existing cron during an upgrade if needed: an old deployed worker may still call its old generation path until the new application is active.
- Verify the integrated **Run selected queued jobs** path before rollout. Its protected `authorize_brief_selected_queue` RPC authorizes only currently selected queued jobs and returns their exact IDs to the worker; an empty result starts no worker. Selection/Undo alone does not renew paid-call authorization. Deselection stops queued work, not an already reserved/in-flight call.
- Confirm the 200-story selection ceiling. The database serializes selection changes across editors and regeneration. Automatic drafting only uses remaining capacity and leaves excess stories in the inbox; deselect stories to make room.
- Check all four desk views, source filters/pagination, saved draft reload, a two-editor conflict, source/evidence inspection, history refresh after saving, and restore-as-new-draft. Test generation/suggestions using fake model responses first, including failures and the shared cap.
- Only with separate operational approval, perform a bounded staging model call using the dedicated key's spending limit, verify its audit, and then test explicit publication/correction. No deployment, live migration, real email, or paid model call is implied by running repository tests.

If rolling back, disable auto-drafting and pause cron first. Prefer retaining the additive schema and published data; do not drop tables to roll back the UI. Revalidate the worker behavior of any older application against the desk migration before enabling its cron. `BRIEF_V2_ENABLED=false` is a reader fallback, not an editorial spending kill switch.

## Discovery, selection, and generation

The workspace has **Inbox**, **Drafts**, **Published**, and **Sources** views. Inbox supports search and publisher/category/status/date filters with database-backed pagination. Move stories between inbox, selected, saved, and dismissed states; selecting a story does not generate it. Selection is persistent across filters/pages, with a 200-story selection ceiling. Generation confirmation covers only the explicit selected job IDs; remaining authorized jobs stay queued for a later confirmed run. Failures and existing drafts require explicit regeneration rather than silent retry.

Discovery reads enabled OpenAI, Google, Hugging Face, and TechCrunch feeds, normalizes URLs, preserves dates/authorship, and deduplicates without changing an existing story's selection. **Sources** shows per-publisher health and enable/disable controls. Approved URL import requires a trustworthy original publication date; it never invents today's date. Disabled publishers stop feed discovery; manual import remains an explicit editor operation.

`vercel.json` schedules `/api/cron/editorial` daily at 07:00 UTC. Actual delivery time depends on the hosting plan; Vercel supplies the configured bearer authorization. The default cron discovers only. Consented automatic drafting queues newly discovered eligible stories and runs the selected worker; it does not publish and does not adopt held legacy jobs. Allow a function duration of up to 300 seconds on the deployment plan.

Generation fetches article text from approved HTTPS hosts, validates redirects, bounds response sizes/timeouts, and rejects thin source material. No paywall bypass is attempted. One OpenRouter structured-output call produces all tiers and evidence. `EDITORIAL_MODEL` defaults to `openai/gpt-4.1-mini` and must support strict JSON schema. Draft generation and field suggestions omit `temperature` only for the exact model IDs `openai/gpt-6-sol` and `openai/gpt-6.1-sol`. Neither the [GPT-6 Sol endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-sol/endpoints) nor the [GPT-6.1 Sol endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6.1-sol/endpoints) advertise that parameter. All other model IDs retain the existing `temperature: 0.3`; aliases and variants are not implicitly covered. Strict provider-parameter matching and JSON-schema output remain enabled. Set `EDITORIAL_MODEL` in the deployment environment and redeploy to use the chosen model. Invalid lengths, incomplete responses, or nonmatching quotes fail without publishing. Requests are not automatically retried; failed/interrupted calls can still incur charges.

The shared database worker lease prevents overlapping generation and suggestions. Each generation batch attempts at most three jobs, newest sources first. SQL atomically caps generation and field-suggestion reservations at the **configured shared daily attempt limit (default 10)**; failures still count. Legacy starter imports also count if used, even though they make no LLM call. Count displays come from the database after the action; an unavailable count is not guessed. A reservation cap is not a dollar budget: also configure a monetary limit on the dedicated OpenRouter key.

## Configurable daily model limit

In **Editor → Sources → Daily model limit**, authorized editors can choose an integer from **1 to 1000 attempts per UTC day**. The default remains **10** until an editor explicitly changes it; there is no zero/unlimited mode. The setting is shared across editors and persists for future days. All generation, regeneration, selected queued jobs, automatic drafting, and field suggestions use the same reservation cap.

To recover from 10/10, follow **Change daily limit**, enter the desired cap (for example, 25), choose **Save daily limit**, acknowledge potential additional charges, and confirm the increase. Return to selected stories: usage stays 10 and generation is enabled if the cap exceeds usage. Changing the setting itself does not run a model, clear attempts, alter selection/jobs, or enable automatic drafting. If automatic drafting is already enabled, a higher cap also permits more future scheduled attempts.

Increases require explicit charge consent. Decreases and unchanged values do not; SQL compares against the current stored limit under the same transaction lock as reservations, rather than trusting a stale client value. Lowering below attempts already used blocks new reservations without erasing usage; an already reserved/in-flight request may finish. This is an **attempt limit, not a dollar budget**. Keep a monetary spending limit on the dedicated provider key.

When exhausted, the editor explains **“Daily limit reached. Resets at 00:00 UTC.”** and links to the setting. Reload after the reset or another editor changes the limit. Failed/interrupted reservations count even if no draft was produced; a reservation is not proof of a paid API call. UI counts and limits come from database snapshots, not invented fallback values.

### Migration and rollout

- Apply `202610040003_editorial_daily_cap.sql` after migrations 001 and 002, then deploy the matching application. It adds `brief_settings.daily_attempt_limit`, an editor-only setter, and database-enforced dynamic caps for both reservation paths and automatic enqueueing. It preserves existing usage, selections, jobs, leases, and automatic-drafting settings.
- Test the exhausted-limit recovery, explicit increase consent, lower-than-used behavior, actual role permissions, and simultaneous cap changes/reservations in staging. Local PGlite tests inspect real locks but do not simulate multiple database connections.
- Missing, invalid, or unavailable cap configuration fails closed. If the app reports a daily-cap migration/configuration error, check migration order; do not bypass it with a service-role client or guessed default.
- Changing the default, running tests, or deploying code is not authorization to raise the live cap. Saving a new cap requires an authorized editor's explicit action.
- On rollback, retain the additive schema and coordinate the application with it: older UI builds still display/enforce ten, while migrated workers use the stored cap. Disable automatic drafting and pause cron until the mismatch is resolved; do not silently reset usage or drop tables.

## Writing, evidence, and final review

**Write** provides the three tier editors plus why-it-matters; **Evidence** holds private claims and exact excerpts; **Preview** shows the unpublished reader view. The source reader uses the revision's saved capture, with exact-excerpt navigation and an original-article link for checking updates. Text matches and length checks are not factual verification.

Writing autosaves with optimistic version checks; manual save is also available. Save errors/conflicts preserve local text, and navigation guards warn about unsaved or pending work. Copy changes before explicitly reloading a newer server version. **Start final review** saves and pauses autosave, binding the source/tier attestations to that saved version. Any edit, including acceptance of a suggestion, invalidates the checks. Publication requires fresh review of all three standalone tiers and source context.

Published/rejected revisions are immutable. **Create an editable revision** prepares a correction without changing the live story. History refreshes saved entries and compares historical content; **Restore as new draft** creates a private same-story revision, never a live rollback. History records saved versions and decisions with editor IDs privately. Publishing a stale draft over a newer publication is rejected; rejection leaves an existing publication untouched.

After explicit approval, transactional publication and cache invalidation update the homepage, permanent story, JSON feed, and sitemap. First publication determines the UTC edition. Corrections retain that edition and first publication date while changing the modification timestamp. Public pages distinguish source dates from knowai's dates.

## Single-field AI suggestions

Choose **Simplify**, **Shorten**, or **Suggest an alternative** for one of the three tiers or why-it-matters, then explicitly confirm the potential charge. The UI saves first. The server accepts only a revision ID/version, supported field/task, and consent—not caller-supplied source text or draft content. It reads the authorized saved snapshot once, checks that exact revision/version is editable, and uses its immutable source capture rather than refetching the article. A missing/unusable capture fails before reservation.

The backend uses only `EDITORIAL_OPENROUTER_API_KEY`, never a playground/visitor key. After acquiring the shared worker lease, the service-only `reserve_brief_suggestion` RPC rechecks the editor, revision/version, shared daily cap, and duplicate-request window atomically. The checked-in interface is this reservation RPC plus updates to `brief_suggestions`; there is no separate begin/finish RPC. A save race before reservation is rejected, not silently rewritten against a newer draft. A busy worker or rejected reservation makes no model call.

The request labels source/headline/draft/evidence as untrusted data, asks for source-supported prose, and returns only the selected field. Structural parsing requires a complete structured response and the target field's length/paragraph rules. This is a source-grounded editing aid, **not automated fact verification**: existing evidence is neither rewritten nor certified by a suggestion.

The result is a review candidate, never an automatic content save or publication. Compare current/suggested text, then **Accept** or **Discard**. Acceptance changes only that field locally and follows the normal save/review flow; a locally changed field cannot be overwritten by an old suggestion, and a server-side save race still conflicts. Recheck claims, evidence, and all tiers before publication.

Private audits retain revision/version, field/task, actor, model, reservation/completion state, reported cost/tokens, and sanitized failures. Known usage is saved **before** parsing/length validation, including billed invalid or token-truncated responses. Missing/invalid usage remains `null` (unavailable), never a fabricated zero. Transport failure or an unreadable/truncated HTTP body may prevent usage recovery; a charge is still possible. Audit failures fail the action closed. Requests are not automatically retried, leases are released in a `finally` path, and abandoned attempts remain counted for interrupted-worker recovery.

## Reader behavior

Normal is the default. Quick scan hides paragraphs; Deep reveals full context. A global change resets per-story overrides. Readers can then expand individual stories inline. The URL records `depth`, `date`, and category preferences. Keyboard `j`/`k` moves focus between visible stories; Space cycles the focused article's depth. Input fields, buttons, links, and dialogs keep their normal keyboard behavior.

The copy action includes the entire selected edition, regardless of category filtering, plus the brand, UTC date, and a Quick scan URL. An explicit selectable-text fallback handles blocked clipboard access. Old editions are never labeled “today.”

`/brief/[slug]` serves all three tiers in server-rendered HTML, with `#one-liner`, `#short`, and `#full` anchors, canonical metadata, social tags, NewsArticle JSON-LD, and sitemap entries. These fragments are sections of one indexed article, not three separately indexed pages. The feed currently loads the latest 500 published stories; permanent story URLs remain accessible beyond that window.

## Validation

```bash
npm run typecheck
npm test
npm run test:brief
npm run build
npm run test:e2e
```

`npm test` executes the actual base, desk, and daily-cap migrations and permission/publication/job/suggestion-reservation functions against an isolated PGlite Postgres instance, plus content, workspace-state, and generation/action validation tests. `npx tsx --test tests/editorial-suggestion-actions.test.ts` isolates the field-suggestion backend: fake model/REST responses cover success, saved-capture consistency, consent/key/input gates, revision conflicts, lease/cap denials, invalid/truncated output charges, audit/transport failures, and authoritative attempt counts. No hosted database or paid provider is contacted. The default unit suite also tests disposable PostgreSQL runner cleanup through a filesystem-backed Docker executable double: a lost create response, SIGTERM during creation, and refusal to delete a container without the current run's ownership label. These lifecycle regressions do not require Docker or a database.

`npm run test:brief` builds with an isolated, localhost-only Supabase HTTP fixture backed by PGlite and the actual SQL migrations, then runs browser tests for the new feed and editor. Its fixture keys cannot access real services. It exercises UI flows through real database functions, including a held daily-limit save: input/consent/confirm/cancel/close controls stay disabled, Escape/outside clicks cannot dismiss the pending dialog, duplicate submissions do not queue another mutation, and a failed request restores controls without claiming a saved increase. The dedicated SQL tests additionally check roles, default function grants, migration reapplication, selection limits, and worker reservations. It does not call a paid model or send sign-in emails. **Run a normal build afterward before deploying**: this test command deliberately builds with local fixture configuration.

PGlite uses one connection. Its tests verify transaction-held selection/attempt locks and atomic rollback, but do not simulate genuine concurrent PostgreSQL sessions. For daily-cap concurrency, run `node tests/run-editorial-cap-postgres.mjs`. This requires local Docker and a preloaded `postgres:18` image (`docker --host unix:///var/run/docker.sock pull postgres:18`); the runner does not download images. It creates an owned disposable container with networking disabled, no published ports, and temporary in-memory data, then removes it on completion. It never reads a database URL or uses a remote Docker context.

The PostgreSQL suite uses separate persistent backend sessions and observes actual advisory-lock waits. It covers both orderings of cap decreases racing generator/suggestion reservations, stale unconfirmed cap changes, both orderings of the final shared attempt slot, and default-grant permissions. Optional negative controls remove a lock only inside the disposable test database: `--mutate generator --case setter-first-generator`, `--mutate suggestion --case setter-first-suggestion`, or `--mutate setter --case stale-unconfirmed-setter`; these runs are expected to fail.

Before production rollout, still verify deployment-specific permissions and simultaneous editors selecting the last available story-selection slot against staging PostgreSQL/Supabase. The daily-cap concurrency suite does not replace that separate 200-story selection-cap check. Browser conflict tests cover two editors saving against the same revision version.

The live Supabase project, real email delivery, production cron, and a paid generation call require the configured accounts. Test these in staging before activating the new homepage. Existing playground keys, request routing, model selection, comparison costs, and authentication remain separate from the editorial system.
