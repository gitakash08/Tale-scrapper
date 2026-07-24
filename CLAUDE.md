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
- **Schedules** and **Settings** pages are styled scaffolds (Settings persists to
  localStorage; Schedules explains the `--daily` daemon). Real per-source cron +
  start/stop-daemon-from-browser is not built.
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
1. Build the daemon start/stop + real Schedules from the GUI.
2. Package the `.exe` / wrap worker+GUI in Tauri or Electron for a double-click app.
3. Native-speaker review of ko/zh/ja on the main site (romantic-tales TODO).
4. (Custom connector polish) surface a per-source "test scrape" button in the GUI
   Sources page that calls a dry-run of `genericCandidates` so users can confirm a
   URL yields KR/CN candidates before enabling it.
