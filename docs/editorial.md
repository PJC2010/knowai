# The three-depth Brief

The Brief uses original AI-assisted copy at three depths: one line (at most 140 Unicode characters), one paragraph (40–80 words), and two or three paragraphs of context (150–300 words). Each story also has a “why it matters” line and private evidence excerpts. Length checks run on generated output, in the editor, and in the database before publication. They are structural checks, not proof of factual accuracy; an editor must check the original reporting.

The four starter texts are versioned examples in this public source repository, not confidential drafts. Imported database drafts and future generated content stay behind editor access. Full article captures are fetched into the private database and are not committed to the repository.

## Enable on Vercel

1. Create a Supabase project. Run the complete `supabase/migrations/202610040001_brief.sql` script in its SQL editor, or apply it with the Supabase CLI. The script can be rerun after a complete or partial setup; it preserves existing rows and refreshes its functions and access policies in a transaction. The migration enables row-level security and grants anonymous readers access only to approved publications. Do not disable these policies.
2. Add the variables from `.env.example` through Vercel **Project → Settings → Environment Variables**. Use the project URL and publishable key from Supabase. Keep `SUPABASE_SECRET_KEY`, `EDITORIAL_OPENROUTER_API_KEY`, and `CRON_SECRET` server-only. Use a dedicated OpenRouter key with a spending limit; do not reuse a visitor's playground key. `CRON_SECRET` should be a randomly generated secret of at least 32 characters. Never put keys in GitHub or chat.
3. Set `NEXT_PUBLIC_SITE_URL` to the production HTTPS origin. In Supabase Authentication URL Configuration, set the same site URL and allow exactly `https://YOUR-DOMAIN/editor/callback`. Add a separate local callback only if needed for development. Configure production email delivery for reliable magic links. The default Supabase email service has sending restrictions.
4. Create/invite your editor user through Supabase Authentication and complete email verification. Put the email in `EDITOR_EMAIL_ALLOWLIST`. Grant that user's ID with the SQL below. Disable public sign-ups in Supabase; the app itself uses `shouldCreateUser: false`.
5. Deploy with `BRIEF_V2_ENABLED=false`. Visit `/editor`, request a magic link, and open it in the same browser. The editor allowlist restricts sign-in requests; the `brief_editors` table is the authoritative authorization check on both server actions and database functions.
6. Choose **Import four starter drafts** to load the included, dated, AI-assisted starter texts. Their original pages are fetched again and evidence excerpts verified. They remain private and require your review. This import makes no LLM calls. Alternatively, **Refresh sources and prepare drafts** discovers current stories and calls your configured model.
7. Check every tier and its original source, save edits, tick both review confirmations, then **Approve and publish**. Verify the story's permanent link. Set `BRIEF_V2_ENABLED=true` and redeploy to switch the homepage. Without an approved story, the original RSS homepage stays available. A database error after activation produces an error state rather than silently substituting unreviewed content.

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

The updated script uses `IF NOT EXISTS` for tables and indexes, replaces its functions and policies, and inserts the worker lock only when missing. Existing editor grants, stories, drafts, review history, and active worker leases are preserved. The transaction keeps the changes together. This supports repeated application of knowai's schema; it does not reconcile unrelated tables or custom schema changes that happen to use the same names.

Running SQL manually does not record a Supabase CLI migration. If you later switch to `supabase db push`, reconcile the CLI migration history after verifying the schema. The updated script also tolerates a first CLI application over this matching schema.

## Ingestion and review

`vercel.json` schedules `/api/cron/editorial` daily at 07:00 UTC, compatible with a daily Vercel cron schedule. Actual delivery time is controlled by the hosting plan. Vercel supplies the `Authorization: Bearer CRON_SECRET` header. Manual refresh uses the same worker. Allow a function duration of up to 300 seconds on the deployment plan.

Discovery reads the existing OpenAI, Google, Hugging Face, and TechCrunch feeds. It normalizes source URLs, preserves source dates and authorship, and deduplicates by URL. Story slugs remain stable. The worker fetches article text from approved HTTPS hosts, validates redirects, bounds response sizes and timeouts, and rejects thin source material instead of inventing context. No paywall bypass is attempted.

A normal story makes one OpenRouter structured-output call for all tiers and evidence. The default model is `openai/gpt-4.1-mini`; `EDITORIAL_MODEL` can select another model supporting strict JSON schema through OpenRouter. Incomplete responses, nonmatching quotes, or invalid lengths go to **Failed**. Requests are not automatically retried: explicitly queue a new generation after checking the cause. Failed/interrupted calls can still incur charges. Reported usage is retained before output validation; missing usage remains unavailable, not zero.

The database lease prevents overlapping batches. Each batch attempts up to three jobs, prioritizing the newest source dates, and the database caps attempts at ten per UTC day across manual and scheduled calls. Starter imports also count toward this conservative attempt limit, though they make no model call. Set a monetary limit on the dedicated OpenRouter key as well. The cap is a request cap, not a promise about dollar costs.

The queues distinguish pending generation, failures, drafts needing review, published revisions, and rejected revisions. A source failure remains visible with its original URL and an explicit regeneration option. Once published, a revision is immutable. **Create an editable revision** preserves the public version while a correction is prepared. Saving uses version checks to prevent overwriting concurrent edits. Publishing a stale draft over a newer publication is rejected. History records saved versions, approvals, rejections, and editor IDs.

After approval, publication is transactional and cache invalidation updates the homepage, story, JSON feed, and sitemap. First publication determines the UTC edition; corrections retain that edition and first publication date and update the modification timestamp. Public pages distinguish original-source dates from knowai's dates.

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

`npm test` executes the actual SQL migration and permission/publication/job functions against an isolated PGlite Postgres instance as well as content and generation validation tests. No hosted database is modified.

`npm run test:brief` builds with an isolated, localhost-only Supabase HTTP fixture and runs browser tests for the new feed and editor. Its fixture keys cannot access real services. It checks UI flow while the SQL tests independently exercise actual access policies. It does not call a paid model or send sign-in emails. **Run a normal build afterward before deploying**: this test command deliberately builds with local fixture configuration.

The live Supabase project, real email delivery, production cron, and a paid generation call require the configured accounts. Test these in staging before activating the new homepage. Existing playground keys, request routing, model selection, comparison costs, and authentication remain separate from the editorial system.
