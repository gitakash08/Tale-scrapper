# R-Tale Scraper — session handoff

Standalone scraper worker + GUI for the **Romantic Tales** catalog. Lives in
its own repo: **https://github.com/gitakash08/Tale-scrapper** (branch `main`).
Everything below is committed & pushed.

## What this is
- **`src/`** — the standalone Node worker (ESM, dep: `pg` only). CLI:
  `node src/worker.js migrate | run --duration 45m | run --daily | enrich-watch-links`.
  Sources: TVMaze, MDL (via Kuryana), Viki, Trakt. Quality gate + dedup
  (slug + tvmaze_id + imdb_id + normalized title). Postgres advisory lock =
  single writer. Rows land `approved = FALSE`.
- **`gui/`** — Next.js 15 + React 19 + Tailwind v4 + shadcn control panel.
  Sidebar admin layout with 7 views: Dashboard, Scraper, Approval Queue,
  Schedules, Sources, Settings, Logs. **Dev on port 4500** (`cd gui && npm run dev`).
- **`schema.sql`** — dramas, posters, scrape_cursors, scrape_runs, scrape_sources.
- **`BLUEPRINT.md`** — full spec (sources' endpoints/codes, data model + ERD,
  Chrome-extension path). **`README.md`** — setup/run/exe packaging.

## Shared database
Both worker and GUI point at the SAME Postgres as the Romantic Tales app:
`DATABASE_URL=postgres://romantic:romantic@localhost:5433/romantic_tales`
(docker container `romantic-tales-db`, host port 5433). GUI reads it from
`gui/.env.local`; worker from `./.env` (gitignored; has the real Trakt key).

## Architecture notes
- GUI **spawns the worker CLI** (`lib/jobs.ts`, singleton on globalThis) and
  parses its stdout for live progress — it never imports worker internals.
- API routes (`gui/app/api/`): `scrape/{start,stop,status}`, `stats`, `pending`
  (client paginates; cap 500), `approve` (single + bulk: all / rating ≥ min /
  selected), `poster/[slug]` (BYTEA), `sources` (CRUD), `logs` (from scrape_runs).
- **Approval Queue**: optimistic removal only — approvals must NOT trigger a
  refetch (that was the "reloads again and again" bug). Paginated 10/page,
  priority tabs by rating (High ≥8.5, Medium ≥7.5, Low <7.5).
- Shared **`components/PageHeader.tsx`** is sticky; shell is `h-screen` +
  `overflow-hidden`, only `<main>` scrolls, sidebar `h-screen` pinned.

## Gotchas (carried from romantic-tales)
- `dns.setDefaultResultOrder("ipv4first")` at worker startup (containers lack IPv6).
- Trakt CDN 403s without a User-Agent. MDL 403s intermittently → one 5s retry.
- Viki `__NEXT_DATA__` tag has a `nonce` attr → match `id="__NEXT_DATA__"[^>]*`.
- Movies: skip TVMaze enrichment, episodes=0, status by year/date.
- Never run two scrapers at once — advisory lock protects, but disable the
  romantic-tales API's in-container scraper (`SCRAPE_DISABLED=true`) if this
  worker becomes the primary.

## Current state / open items (2026-07-23)
- Catalog ~890 rows. **~127 pending** in the queue — inflated because rows were
  un-approved to test queue pagination; some were live before. Fastest cleanup:
  GUI → Approval Queue → Bulk approve → rating 7.5+, then review the rest.
- **Schedules**: DONE — fully browser-driven. The **GUI server process owns a
  tick loop** (`gui/lib/scheduler.ts`, started from `gui/instrumentation.ts`)
  that fires due schedules via the shared job manager; the worker's Postgres
  advisory lock still guarantees a single writer. Schedules live in the new
  `scrape_schedules` table (kind = interval | daily | weekly | cron, JSONB
  config, duration_min, precomputed next_run_at). Master on/off is a
  `scrape_cursors` row (`scheduler:enabled`). Next-run math + a minimal 5-field
  cron parser are in `gui/lib/schedule-utils.ts` (21 unit tests). API:
  `api/schedules` (CRUD, rejects schedules that can never fire),
  `api/schedules/daemon` (master switch + status), `api/schedules/run` (run
  now). `SchedulesView` has the daemon toggle, a schedule list (next/last run,
  enable/run-now/edit/delete), and a friendly builder with a live next-run
  preview. `jobs.startJob(minutes, {trigger})` now also does a single pass when
  minutes = 0. NOTE: schedules only fire while the GUI (`npm run dev`/`start`)
  is running — times are in the server's LOCAL timezone.
- **Ongoing-title refresh**: DONE and **source-agnostic**. `dramas.source_ref`
  stores each row's ORIGIN identifier (MDL slug / TVMaze id / IMDB id / page URL)
  so any connector can re-read its own rows; `refresherFor(source)` in
  `src/sources.js` maps a source to its `refresh(row)` → `{episodes, status,
  rating, votes}`. Viki **and every custom source** refresh for free by
  re-parsing the stored page URL's JSON-LD. `refreshOngoing()` in
  `src/pipeline.js` scans airing/upcoming rows least-recently-updated first,
  capped by `SCRAPE_REFRESH_PER_RUN` (60). New CLI: **`node src/worker.js
  refresh`** = refresh-only pass (never inserts). Safety rules: a null field
  KEEPS the stored value (a failed fetch can't blank data), ratings need ≥10
  votes when the source reports them, `dramas.rating_locked = TRUE` protects a
  human-curated rating, disabled sources are skipped, and it's UPDATE-by-slug
  only so it **cannot duplicate**. Legacy rows are backfilled by
  `backfillSourceRefs()` — SQL for tvmaze/trakt/viki, Kuryana search for MDL
  (capped by `SCRAPE_SOURCEREF_PER_RUN`, default 10; unmatched rows stay NULL
  rather than guess). Verified: 102/104 ongoing MDL rows resolved, real catches
  like `Knowing Bros 547→600ep`.
- **On-air episode tracking**: DONE (2026-07-25). Fills the four columns the
  romantic-tales app already reads: `episodes_aired`, `next_episode_at`,
  `last_episode_at`, `status_checked_at` — the site renders "5 of 8 episodes" /
  "Next episode: Jul 28". Folded into `refreshOngoing` (one fetch, one UPDATE):
  TVMaze `/shows/:id/episodes` (airdate + **airstamp**), MDL via Kuryana
  `/id/{source_ref}/episodes` — **keyed on `source_ref`, NOT `dramas.slug`**
  (slug is our slugified title). Everything is **UTC-anchored** (bare date →
  UTC midnight, "today" = UTC day) because the site renders in UTC; local
  midnight would show the wrong day. Queue is `status_checked_at ASC NULLS
  FIRST` (index `dramas_status_checked_idx`), capped by
  `SCRAPE_REFRESH_PER_RUN`. Two guards for open-ended shows: `episodes` only
  ever **grows** (max of stored/aired/list-length — freezing printed
  "601 of 600", overwriting printed "5 of 5"), and auto-completion needs NO
  known future episode AND (source says ended OR last episode older than
  `SCRAPE_STALE_DAYS`, default 21) — completing on date alone would finish a
  weekly show mid-gap, and completed rows leave the scan permanently. Every
  auto-completion is logged (title, last episode, days stale, branch).
  Unfetchable rows still get `status_checked_at` stamped or they jam the queue.
  `node src/worker.js refresh --dry-run` prints the diff and writes nothing.
  First run: 80 rows updated, 33 stale "airing" titles auto-completed (least
  stale 113d), zero episode shrinks. Coverage gap: MDL publishes no per-episode
  dates for specials/BTS extras, so those stay NULL by design.
- **Settings** page is still a styled scaffold (persists to localStorage only).
- **Custom sources**: DONE. The Sources page adds a source by URL into
  `scrape_sources`, and the worker now scrapes it via a **generic connector**
  (`genericCandidates()` in `src/sources.js`): robots.txt/`sitemap.xml`
  discovery (follows one `<sitemapindex>` level; falls back to same-origin
  links off the base page), then per-page schema.org JSON-LD parsing with
  OpenGraph/`<meta>` fallback. Only KR/CN titles survive (country from JSON-LD
  countryOfOrigin/inLanguage, og:locale, `<html lang>`, or Hangul/Han script);
  everything else is dropped, and candidates run the same `enrich()` quality
  gate as the built-ins. Wired into `runPass` (`src/pipeline.js`): enabled
  non-builtin `scrape_sources` rows each get `src = "custom:<id>"`, share one
  daily cap (`SCRAPE_CUSTOM_PER_DAY`, default 10; lifted by `--duration`
  bursts), cursor-paginate the URL list (`scrape_cursors: custom:<id>:offset`),
  and stamp `scrape_sources.last_sync`.
- Not yet packaged as a Windows `.exe` (README has the `@yao-pkg/pkg` / Node SEA steps).

## Likely next steps
1. Package the `.exe` / wrap worker+GUI in Tauri or Electron for a double-click app.
2. Native-speaker review of ko/zh/ja on the main site (romantic-tales TODO).
3. (Custom connector polish) surface a per-source "test scrape" button in the GUI
   Sources page that calls a dry-run of `genericCandidates` so users can confirm a
   URL yields KR/CN candidates before enabling it.
4. (Scheduler polish) optional per-schedule source selection (today a run always
   sweeps all enabled sources), and a timezone note/picker in the UI.
