# Reader retention and first-visit hook — design

Date: 2026-10-09. Roadmap link: P0 "a way to return" (R02 follow-through) and R10 internal linking.

## Problem

First-time visitors who land on a story page reach a dead end (only "← Back to The Brief"). The homepage forgets them: depth resets, nothing marks what is new or already read, and the only return mechanism is a footer RSS link. The three-depth idea, knowai's hook, is never explained.

## Decisions (assumed; user did not answer the scoping questions)

- In scope: **A** on-device reader memory, **B** story pages as entry points, **C** visible subscribe.
- Out of scope: email digest (R04), analytics/measurement (R10), a zero-cost playground demo, accounts, server-side storage of reader data.
- A and the welcome strip apply to the activated Brief (`BriefFeed`) and story pages. The subscribe card also appears on the legacy homepage (`Newsroom`) because it works before rollout.
- Browser storage is allowed for **non-identifying reading state only**, with a privacy-page section and a clear control. No cookies, no network transmission.

## A. On-device reader memory

- One `localStorage` key: `knowai-reader`. JSON value `{ "v": 1, "depth": Depth | null, "lastVisit": ISO | null, "previousVisit": ISO | null, "read": string[], "welcomeDismissed": boolean }`.
- Missing, unparsable, wrong version, or wrongly typed fields → defaults (`depth: null`, visits `null`, `read: []`, `welcomeDismissed: false`). Invalid entries in `read` are dropped individually.
- **Visit rule:** a new visit begins when `lastVisit` is null or at least **30 minutes** earlier than now. On a new visit, `previousVisit = lastVisit`. Every page load sets `lastVisit = now`.
- **New since your last visit:** a story is new when `previousVisit` is non-null and `story.published_at > previousVisit`. First visit → nothing is marked new.
- **Read:** a story becomes read when the reader expands that story to Deep with its own control in the feed, or opens its `/brief/[slug]` page. Choosing Deep for the whole page does not mark every story read. `read` holds story ids, deduplicated, newest last, capped at **200** (oldest dropped).
- **Depth preference:** choosing a depth in the toggle saves it. On load, a valid `?depth=` in the URL always wins and is not saved; otherwise a remembered depth replaces the server default after hydration.
- Feed card markers: a "New" tag (`.brief-new`, text `New`) and a "Read" tag (`.brief-read`, text `Read`); a story can show only one, New taking precedence. The toolbar line gains ` · N new since your last visit` when N > 0, where N counts the stories currently rendered (featured + filtered list).
- If storage is unavailable or throws (private mode, disabled, quota), every feature behaves as a first visit and nothing crashes.
- The editor's preview (`BriefFeed preview`) never reads or writes memory and shows no markers, welcome, or subscribe card.
- Server HTML never contains memory-dependent markup; it appears only after hydration.
- Privacy page: new section "Reading preferences on this device" describing exactly the stored fields, that they never leave the browser, and a **"Clear reading history on this device"** button that removes the key and announces `Reading history cleared.` via `role="status"`. The "Browsing knowai" paragraph stays true (no trackers or tracking cookies).

## Welcome strip (the hook)

On the activated Brief, when `previousVisit` is null and `welcomeDismissed` is false, show above the briefing list:

> **New here?** Every story comes three ways: a one-liner, the short version, and the whole picture. Pick a depth above, and knowai will remember it on this device.

with a `Got it` button that sets `welcomeDismissed: true` and hides the strip; focus then moves to the pressed button in the `Reading depth` group. It is a `<section aria-label="Welcome to The Brief">`. It disappears on its own once a later visit begins (`previousVisit` non-null).

## B. Story pages as entry points

After the story content, `/brief/[slug]` renders, in order:

1. **Keep reading** (`<section aria-labelledby="keep-reading-title">`, heading `Keep reading`): up to **3** other published stories. Same category first, then others; each group newest `published_at` first. Each item links to `/brief/{slug}` and shows the category tag and one-liner. Omitted when there are no other stories.
2. The subscribe card (C).
3. A one-line about strip: `knowai explains AI news in plain English, at the depth you choose.` followed by a link `Read today’s Brief` to `/`.

If loading the other stories fails, the story still renders without "Keep reading". Opening a story page marks it read (A).

## C. Visible subscribe card

A card titled `Follow The Brief`, body `New stories arrive in your feed reader after editorial review. No account or email needed.` Actions:

- link `Open the RSS feed` → `/feed.xml` (`type="application/rss+xml"`)
- button `Copy feed address` → copies the canonical absolute feed URL (`siteUrl() + "/feed.xml"`, passed from the server). On success the label becomes `Copied` and a status announces `Feed address copied.` If the clipboard is unavailable, show a read-only text field labeled `Feed address` containing the URL.
- `<details>` summary `New to RSS?`, body `A feed reader collects new posts from sites you follow. Paste the feed address into any reader app.`

Placement: activated Brief after the digest bar and before the AI 101/Playground links; story pages (B); legacy homepage after the latest-news section. Touch targets ≥ 44px; no horizontal overflow at 320px.

## Non-goals and constraints

- No new dependencies, vendors, database migrations, or environment variables.
- Keep the charcoal/pale-green design, Manrope, Phosphor icons, calm voice, keyboard access, reduced-motion support.
- Existing behavior (j/k navigation, per-card overrides, digest copy, featured week, RSS) must be unchanged.
