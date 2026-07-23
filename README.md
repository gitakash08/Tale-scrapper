# R-Tale Scraper

A **standalone** worker that discovers Korean & Chinese **dramas, TV/variety
shows, and movies** from TVMaze, MyDramaList (via Kuryana), Viki, and Trakt,
enforces a strict quality gate, downloads posters, and inserts them into
PostgreSQL — every row `approved = FALSE` so you moderate before it goes live.

It writes into the **same database** as the Romantic Tales web app. Dedup
(slug + tvmaze_id + imdb_id + normalized title) guarantees **no duplicates**, and
a Postgres advisory lock guarantees **one scraper writes at a time**.

## Setup

```bash
npm install                      # only dependency is `pg`
cp .env.example .env             # then edit DATABASE_URL (+ optional TRAKT_CLIENT_ID)
node src/worker.js migrate       # create tables if the DB is empty (safe to re-run)
```

Requires **Node 20.6+** (uses built-in `.env` loading). The DB must be reachable
at `DATABASE_URL` — locally that's the app's docker Postgres on host port 5433.

## Run

```bash
# Scrape hard for a user-set duration (the headline feature):
node src/worker.js run --duration 45m      # also 35m, 2h, 90s …

# Background daemon — steady ~50/day, re-checks hourly, 12h cadence:
node src/worker.js run --daily

# One single pass:
node src/worker.js run

# Fill real "Watch on Viki" links onto existing catalog rows:
node src/worker.js enrich-watch-links
```

`--duration` lifts the per-source daily caps and runs discovery passes
back-to-back until the clock runs out, printing cumulative adds per pass.

## Sharing the database with the web app

Because both can write, **run only one scraper at a time**. Either:
- disable the app's built-in scraper (`SCRAPE_DISABLED=true` on the API), or
- do nothing — this worker takes a Postgres advisory lock, and a second scraper
  simply refuses to start while it's held.

New rows are `approved = FALSE`; approve them in pgAdmin
(`UPDATE dramas SET approved = TRUE WHERE …`) to publish.

## Package as a Windows .exe

The worker is pure JS (only `pg`). Either:

```bash
npx @yao-pkg/pkg src/worker.js --targets node20-win-x64 --output scraper.exe
scraper.exe run --duration 45m
```

or use Node's built-in Single Executable Applications (SEA). Ship `scraper.exe`
next to a `.env`. A tiny tray/GUI can expose a "run for [ 45 ] minutes → Start"
button that just spawns `scraper.exe run --duration <n>m`.

## Layout

| File | Role |
|---|---|
| `src/sources.js` | The 5 connectors + `enrich()` + quality gate. |
| `src/pipeline.js` | `runPass()` — one full discovery pass (dedup → enrich → gate → insert → maintenance → audit). |
| `src/worker.js` | CLI: `migrate`, `run --duration`, `run --daily`, `enrich-watch-links`; advisory lock. |
| `src/db.js` | Postgres pool. |
| `schema.sql` | The tables (dramas, posters, scrape_cursors, scrape_runs). |

See [`BLUEPRINT.md`](./BLUEPRINT.md) for the full spec: every source's exact
endpoints/codes, the data model + ERD, the quality gate, and the
Chrome-extension migration path.
