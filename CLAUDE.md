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
- **Custom sources**: Sources page adds a source by URL into `scrape_sources`,
  but the worker does NOT yet actually scrape custom URLs — a **generic connector**
  (sitemap + OG/JSON-LD) still needs wiring into `src/sources.js` + the pipeline.
- Not yet packaged as a Windows `.exe` (README has the `@yao-pkg/pkg` / Node SEA steps).

## Likely next steps
1. Wire the generic custom-URL connector into the worker (the real other half of
   "add a source and scrape it").
2. Build the daemon start/stop + real Schedules from the GUI.
3. Package the `.exe` / wrap worker+GUI in Tauri or Electron for a double-click app.
4. Native-speaker review of ko/zh/ja on the main site (romantic-tales TODO).
