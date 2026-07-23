# Romantic Tales — Standalone Scraper Worker Blueprint

> A single, self-contained spec to build the drama/TV/movie scraper as an
> **independent worker** in a fresh project/chat. Hand this file to a new
> session and it has everything: database schema, ERD, every data source with
> exact endpoints and codes, the scraping algorithm, the quality rules, the
> "run for N minutes" worker design, how to package it as a Windows `.exe`, and
> the migration path to a Chrome extension.
>
> **How to use this file:** paste **§0 (the kickoff prompt) together with this
> entire file** into a fresh chat. §0 tells that chat what to build; §1–§13 are
> the full spec it builds from. The ERD is in §2.

---

## 0. Kickoff prompt — paste this (with the rest of this file) into the new chat

```text
You are a senior Node.js engineer. Build me a STANDALONE, executable drama/TV/
movie scraper worker exactly as specified in the document below (sections 1–13).
Do not ask me to design anything that the spec already defines — follow it.

GOAL
- A headless Node.js worker (ESM, Node 20+, dependency: `pg` only unless a source
  needs more) that discovers Korean & Chinese DRAMAS, TV/VARIETY SHOWS, and MOVIES
  from the sources in §5, normalizes them (§4), enriches + quality-gates them
  (§7–§8), downloads posters, and inserts into PostgreSQL (§3) with approved=FALSE.
- It runs STANDALONE: I start the worker and it scrapes on its own.
- A user-set-DURATION feature: `worker run --duration 45m` runs discovery passes
  back-to-back until the time is up (§9). Also a `--daily` daemon mode.
- Later I will turn the .exe into a Chrome extension (§11) — keep the source
  parsers and the enrich+gate+insert pipeline in separate, reusable modules so
  both the worker and an extension's ingest endpoint can share them.

DELIVERABLES (produce actual files, runnable)
1. `schema.sql` — the DDL from §3, plus a `worker migrate` command that applies it.
2. `src/config.js`, `src/db.js` (pg Pool).
3. `src/sources.js` — the five connectors + enrich() + qualityGate() from §5–§8.
   Build TVMaze first (keyless + enrichment backbone), then MDL (+Kuryana), then
   Viki, then Trakt, then optional Simkl. Each connector returns the §4 candidate.
4. `src/pipeline.js` — runPass() implementing §6 (discover → dedup → enrich → gate
   → insert poster bytes + row in one transaction → maintenance → scrape_runs log).
5. `src/cli.js` / `worker.js` — commands: `migrate`, `run --duration <Ns|Nm|Nh>`,
   `run --daily`, `enrich-watch-links`.
6. `.env.example`, `package.json`, and a short `README.md` with run instructions.
7. Packaging notes to produce `scraper.exe` (§10).

HARD REQUIREMENTS
- Respect every rule in §5 and §12: obey robots.txt, honest User-Agent, >=550ms
  between external calls, `dns.setDefaultResultOrder('ipv4first')` at startup,
  never log in, never solve CAPTCHAs, never disguise the client to evade bot
  detection. If a source blocks you, skip it — do not evade.
- Enforce the QUALITY GATE (§8) strictly: never insert a row missing a native
  title, poster, a >=40-char synopsis, year, or (for series) an episode count.
- Dedup on slug + tvmaze_id + imdb_id + normalized-title (§6).
- Per-source PER-CALENDAR-DAY quotas (§9); in --daily mode take a Postgres
  advisory lock so two workers can't double-scrape.
- Content types: one `dramas` table, `content_type` in {drama,tv,movie}; movies
  get episodes=0 and date/year-based status (§8).

PROCESS
- Work in the build order in §13. After wiring each source, do a `run --duration 5m`
  and show me the audit: counts by source/content_type and a check that gated
  fields have zero nulls. Then continue. Ask me for my TRAKT_CLIENT_ID only when
  you reach the Trakt connector (optional; skip if I don't provide it).

Now read sections 1–13 below and start with the schema and the TVMaze connector.
```

> After the new chat scaffolds it, it can literally lift the code snippets in §5,
> §7, §9 and the DDL in §3 verbatim — they are copy-paste ready.

---

## 1. What this worker does

A headless Node.js worker that, on demand or on a schedule, discovers **Korean
and Chinese dramas, TV/variety shows, and movies** from several public sources,
normalizes them to one shape, enforces a strict quality gate, downloads posters,
and inserts them into PostgreSQL — **each row flagged `approved = FALSE`** so a
human moderates before anything goes public.

**Core properties**
- Sources: TVMaze, Trakt, MyDramaList (via the Kuryana wrapper), Viki. Simkl optional.
- Dedup across sources by slug, TVMaze id, IMDB id, and normalized title.
- Every image is stored as bytes **inside** Postgres (`posters.data BYTEA`).
- Politeness: ≥550 ms between external requests; honest `User-Agent`; obey `robots.txt`; never solve CAPTCHAs, never log in, never disguise the client to evade bot-detection.
- **User-set duration**: `worker run --duration 45m` runs discovery passes back-to-back until the clock runs out. Also a `--daily` daemon mode.

---

## 2. Database — ERD

```mermaid
erDiagram
    DRAMAS ||--o| POSTERS : "has (slug)"
    DRAMAS {
        text id PK
        text slug UK "unique; slugified title"
        text title
        text original_title "native title (한글/汉字)"
        int  year
        text country "KR | CN"
        numeric rating "0.0–10.0"
        int  episodes "0 = N/A (movies)"
        text_array air_days "Mon..Sun"
        text status "airing | completed | upcoming"
        text_array moods
        text_array genres
        text synopsis
        text poster "path: /posters/<slug>.jpg"
        jsonb watch "[{name,url}]"
        bool approved "scraper writes FALSE"
        int  tvmaze_id UK
        text imdb_id UK
        text source "tvmaze|trakt|mdl|viki|manual"
        text content_type "drama | tv | movie"
        timestamptz created_at
        timestamptz updated_at
    }
    POSTERS {
        text slug PK, FK "-> dramas.slug (cascade)"
        text mime
        int  bytes
        bytea data "the image itself"
        timestamptz updated_at
    }
    SCRAPE_CURSORS {
        text key PK "e.g. mdl:adv:KR:movie:page"
        text value "next page/offset"
    }
    SCRAPE_RUNS {
        bigint id PK
        timestamptz started_at
        timestamptz finished_at
        bool ok
        int found
        int added
        int refreshed
        int skipped
        jsonb details "{added:[],skipped:[],...}"
        text error
    }
```

`dramas` is the one content table for **all three** content types — `content_type`
distinguishes them. `posters` holds the binaries (1:1 with `dramas.slug`).
`scrape_cursors` lets paginated sources resume where the last run stopped.
`scrape_runs` is the audit log.

---

## 3. Database — full DDL (copy-paste ready)

```sql
-- Everything is idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS dramas (
  id             TEXT PRIMARY KEY,               -- stringified incrementing int
  slug           TEXT UNIQUE NOT NULL,           -- slugify(title)
  title          TEXT NOT NULL,
  original_title TEXT,                           -- native title; REQUIRED by the gate
  year           INT  NOT NULL,
  country        TEXT NOT NULL CHECK (country IN ('KR','CN')),
  rating         NUMERIC(3,1) NOT NULL DEFAULT 0,
  episodes       INT  NOT NULL,                  -- 0 for movies (UI hides it)
  air_days       TEXT[] NOT NULL DEFAULT '{}',   -- ['Mon','Tue',...]
  status         TEXT NOT NULL CHECK (status IN ('airing','completed','upcoming')),
  moods          TEXT[] NOT NULL DEFAULT '{}',
  genres         TEXT[] NOT NULL DEFAULT '{}',
  synopsis       TEXT NOT NULL,
  poster         TEXT NOT NULL DEFAULT '',       -- '/posters/<slug>.jpg'
  watch          JSONB NOT NULL DEFAULT '[]',    -- [{ "name":"Netflix", "url":"..." }]
  approved       BOOLEAN NOT NULL DEFAULT FALSE, -- scraper inserts FALSE; human approves
  tvmaze_id      INT  UNIQUE,
  imdb_id        TEXT UNIQUE,
  source         TEXT NOT NULL DEFAULT 'manual', -- tvmaze | trakt | mdl | viki | simkl | manual
  content_type   TEXT NOT NULL DEFAULT 'drama' CHECK (content_type IN ('drama','tv','movie')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dramas_status_idx       ON dramas (status);
CREATE INDEX IF NOT EXISTS dramas_country_idx      ON dramas (country);
CREATE INDEX IF NOT EXISTS dramas_content_type_idx ON dramas (content_type);
CREATE INDEX IF NOT EXISTS dramas_moods_idx        ON dramas USING GIN (moods);
CREATE INDEX IF NOT EXISTS dramas_genres_idx       ON dramas USING GIN (genres);

CREATE TABLE IF NOT EXISTS posters (
  slug       TEXT PRIMARY KEY REFERENCES dramas (slug) ON DELETE CASCADE ON UPDATE CASCADE,
  mime       TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes      INT  NOT NULL,
  data       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_cursors (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN NOT NULL DEFAULT FALSE,
  found       INT NOT NULL DEFAULT 0,
  added       INT NOT NULL DEFAULT 0,
  refreshed   INT NOT NULL DEFAULT 0,
  skipped     INT NOT NULL DEFAULT 0,
  details     JSONB NOT NULL DEFAULT '{}',
  error       TEXT
);
```

> The consuming web app also has `subscribers` and `site_reviews` tables — **not
> the scraper's concern**, omitted here. The worker only touches the four above.

---

## 4. The normalized candidate

Every source connector emits this shape; the pipeline then enriches + gates it.

```js
// A "candidate" before the quality gate:
{
  src:          'mdl',            // tvmaze | trakt | mdl | viki | simkl
  contentType:  'drama',          // drama | tv | movie
  title:        'King of Ambition',
  originalTitle:'야왕',            // may be null -> enrich() tries to fill from TVMaze
  year:          2013,
  country:      'KR',             // KR | CN only (others dropped)
  premiered:    '2013-01-14',     // YYYY-MM-DD | null
  status:       'completed',      // airing | completed | upcoming
  rating:        8.2,             // number | null (null -> default 7.5 at insert)
  genres:       ['Drama','Thriller'],
  synopsis:     'Born into poverty…',   // must be >= 40 chars after cleaning
  airDays:      ['Wed','Thu'],    // [] for movies
  posterUrl:    'https://…/x.jpg', // remote poster to download
  episodes:      24,              // 0 for movies
  tvmazeId:      null,
  imdbId:        null,
  watchUrl:     'https://www.viki.com/tv/…' // OPTIONAL: real deep link (Viki)
}
```

---

## 5. Sources — exact endpoints, codes, parsing

All requests: `User-Agent: RomanticTales/1.0 (+catalog metadata)`, `sleep(550ms)`
before each call, 15 s timeout. **Set `dns.setDefaultResultOrder('ipv4first')`**
at process start — many hosts publish AAAA records but Docker/containers often
have no IPv6 route, and Node's fetch otherwise fails with a bare "fetch failed".

### 5.1 TVMaze — keyless, always on. Also the **enrichment backbone**.
Base `https://api.tvmaze.com`. Rate limit ~20 req / 10 s.
| Purpose | Endpoint |
|---|---|
| KR broadcast schedule | `/schedule?country=KR&date=YYYY-MM-DD` |
| CN broadcast schedule | `/schedule?country=CN&date=YYYY-MM-DD` |
| Global streaming sched | `/schedule/web?date=YYYY-MM-DD` (show at `ep._embedded.show`) |
| Show by id | `/shows/{id}` |
| Episodes (count) | `/shows/{id}/episodes` → `.length` |
| **Native title** | `/shows/{id}/akas` → aka where `country.code === country` and name is CJK |
| By IMDB id | `/lookup/shows?imdb={imdbId}` |
| Title search | `/singlesearch/shows?q={title}` (verify `show.language` is Korean/Chinese) |
- Discovery: scan `date` = today back 7 days (new premieres) + forward ~14 days (Coming Soon).
- Language → country: `Korean`→`KR`, `Chinese`→`CN`.
- Status: `Running`→`airing`, `Ended`→`completed`; future `premiered`→`upcoming`.
- Keep only `type === 'Scripted'` with a poster and genres ∩ {Drama,Romance,Comedy}.

### 5.2 Trakt — free Client ID (create an app at trakt.tv/oauth/applications).
Base `https://api.trakt.tv`. Headers: `trakt-api-version: 2`, `trakt-api-key: <ID>`,
`Content-Type: application/json`, **and a `User-Agent` (Trakt's CDN 403s without one)**.
| Purpose | Endpoint |
|---|---|
| Trending | `/shows/trending?limit=60&extended=full` |
| Anticipated (pre-release) | `/shows/anticipated?limit=60&extended=full` |
- `show.country` `kr`/`cn` or `language`; keep genres ∩ {drama,romance,comedy}.
- Real ratings when `votes >= 10`. **No images** → `enrich()` fills poster + native title from TVMaze.

### 5.3 Simkl — optional, free Client ID (simkl.com/settings/developer).
`https://api.simkl.com/tv/premieres/{new|soon}?client_id=<ID>&limit=60`. Filter `country` kr/cn. If no key, skip.

### 5.4 MyDramaList (MDL) — the deepest source. Discovery from MDL, details from **Kuryana**.
MDL has **no public API** (private beta). Legit route: MDL's own listing/search
pages (robots-allowed) for slugs + **Kuryana** (MIT OSS wrapper) for structured JSON.

**Discovery (server-rendered HTML; extract `<a href="/<digits>-<slug>">Title</a>`):**
| Listing | URL | Notes |
|---|---|---|
| Airing | `https://mydramalist.com/shows/top_airing` | page 1 |
| Upcoming | `https://mydramalist.com/shows/upcoming` | page 1 |
| Newest | `https://mydramalist.com/shows/newest?page=N` | paginate |
| **Back catalog** | `https://mydramalist.com/search?adv=titles&co={CO}&ty={TY}&so=top&page=N` | deep-paginate |

**Advanced-search codes (decoded from MDL's search form):**
- Country `co`: **South Korea = 3, China = 2**
- Type `ty`: **Dramas = 68, Movies = 77, TV Shows = 86**
- Iterate `{KR,CN} × {drama,movie,tv}`, `so=top`, page 1..~100 → the entire back catalog in rating order.
- MDL's CDN intermittently returns **403** to non-browser clients → do **one** retry after a 5 s sleep, then give up (never spoof to evade).

**Detail via Kuryana:** `https://kuryana.tbdh.app/id/{numeric-slug}` (e.g. `750569-suga-road-to-d-day`). Response `.data`:
```
data.title                       -> title (strip trailing " (YYYY)")
data.year                        -> year
data.synopsis                    -> synopsis (strip "(Source: …)")
data.poster                      -> posterUrl
data.others.native_title[0]      -> originalTitle  (한글/汉字)
data.details.country             -> "South Korea"->KR, "China"->CN  (else drop)
data.details.type                -> "Movie"->movie; /drama/i->drama; else tv
data.details.episodes            -> episodes (movies: force 0)
data.details.aired               -> "Feb 1, 2016 - Mar 24, 2016" | single date
data.details.aired_on            -> "Monday, Tuesday" -> air_days
data.details.genres              -> "Romance, Thriller" -> genres[]
data.details.score               -> "8.2 (scored by 12345 users)" -> use rating only if votes>=10
```
> Kuryana's `/seasonal` and `/schedule` endpoints are broken — don't use them.

### 5.5 Viki — login-free, robots-respecting.
`robots.txt` disallows only `/search`,`/player`,`/users/`,`/explore`,`/v1`,`/v2`
and **publishes sitemaps**. Never hit `/search`.
| Purpose | URL |
|---|---|
| TV sitemap | `https://www.viki.com/sitemaps/tv.xml` |
| Movies sitemap | `https://www.viki.com/sitemaps/movies.xml` |
| Show page | from sitemap `<loc>`, e.g. `https://www.viki.com/tv/<id>c-<slug>` |
- Slug carries the English title: `10220c-king-of-ambition` → "king of ambition" (cheap matching).
- Pages are a **Next.js** app. Extract the embedded JSON:
  `html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)` — **note the
  `[^>]*`: the tag carries a `nonce` attribute**, so a fixed-tag match fails.
- From the parsed JSON (deep-search keys): `origin.country` (`kr`/`cn` filter),
  `titles.en` (title), `descriptions.en` (synopsis), `created_at` (→ year),
  `images.poster` (poster). The page URL itself is the real **watch link**.
- **Viki has no native title** → set `originalTitle: null` and let `enrich()`
  cross-fill from TVMaze. Movies (no TVMaze) usually get rejected — that's fine.
- Two jobs: (a) add new titles carrying a real `watchUrl`; (b) **watch-link
  enrichment** — slug-match the sitemap to existing rows and fill real
  "Watch on Viki" URLs into their `watch` JSON (no per-page fetch needed).

### 5.6 iQIYI — evaluated and **declined**
Sitemaps are stale gzipped (2021), heavier bot protection, no clean parse path. Not a reliable source. Keep it as a watch-link destination only.

---

## 6. The pipeline (one "pass")

```
for each source (respecting its per-day quota):
  1. DISCOVER candidates (cursor-paginated; advance the cursor in scrape_cursors)
  2. for each candidate, in rating order, until the source's cap is hit:
     a. DEDUP: skip if slug OR tvmaze_id OR imdb_id OR normTitle(title) already known
     b. ENRICH (§7)  -> fills native title / poster / synopsis / episodes; may reject
     c. QUALITY GATE (§8) -> reject incomplete data
     d. re-check dedup (enrich may have resolved ids/original title)
     e. INSERT: download poster bytes; write dramas row (approved=FALSE) + posters row
        in ONE transaction. Use candidate.watchUrl for the Viki button if present.
MAINTENANCE (skippable in burst mode via SKIP_MAINTENANCE):
  - backfill missing original_title on old rows (TVMaze akas)
  - refresh 'airing'/'upcoming' rows (status/episodes; rating only for source='tvmaze')
  - Viki watch-link enrichment (slug-match sitemap -> existing rows)
Write a scrape_runs audit row (found/added/refreshed/skipped/details).
```

**Dedup keys** (all normalized): `slug = slugify(title)`,
`normTitle = lower + NFKD + strip all non-alphanumerics` (so "It's Okay" == "its okay").
Keep sets of existing slugs, tvmaze_ids, imdb_ids, and normTitles; check all four.

**slugify**: `s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'')`

---

## 7. Enrichment (`enrich(candidate)`) → `{ ok, drama }` | `{ ok:false, reason }`

```
isMovie = candidate.contentType === 'movie'
if NOT isMovie:                          # TVMaze is TV-only; never match movies to it
  show = TVMaze by tvmazeId | by imdbId | singlesearch(title) [verify language==country]
  if show: fill missing posterUrl, synopsis, rating, premiered, genres, airDays, year, ids
originalTitle = candidate.originalTitle
             ?? (tvmazeId ? fetchNativeTitleFromAkas() : (isCJK(title) ? title : null))
episodes = candidate.episodes ?? 0
if !episodes && tvmazeId && !isMovie: episodes = TVMaze episodes length
```

---

## 8. Quality gate (the "no-compromise data" rule)

Reject (do **not** insert) if any of:
- no `title` or no `year`
- no `originalTitle` (native title) — the authenticity bar
- no `posterUrl`
- `synopsis` shorter than 40 chars (after stripping HTML + "(Source: …)")
- `episodes === 0` **and** not `upcoming` **and** not a movie (movies legitimately have 0)

**Field derivation notes**
- **content_type**: from the source (Viki section, MDL `ty`/type). Movies → `content_type='movie'`, `episodes=0`, `air_days=[]`.
- **status for movies**: date/year based, not weekly-air based — `year > thisYear` (or future premiered) → `upcoming`, else `completed`. (Series use the aired-range: future start → upcoming, past end → completed, else airing.)
- **moods/genres**: map source genres to your vocabulary; default `genres=['Drama']`, `moods=['heartwarming']`; add `binge-worthy` when rating ≥ 8; tag TV/variety with a `Variety` genre.
- **rating**: `null` → store `7.5` (flag it in the run details as "defaulted").
- **watch**: `KR → [Netflix, Rakuten Viki]`, `CN → [iQIYI, Rakuten Viki]`; url `'#'` unless a real `watchUrl` (Viki) is known.
- **poster**: download the bytes, store in `posters` (mime/bytes/data), set `dramas.poster = '/posters/<slug>.jpg'`.

---

## 9. The worker — user-set duration

```
worker.js
  ├─ config.js        # env: DATABASE_URL, TRAKT_CLIENT_ID, quotas…
  ├─ db.js            # pg Pool
  ├─ sources.js       # the 5 connectors + enrich + gate (§5–8)
  ├─ pipeline.js      # runPass(): one full pass (§6)
  └─ cli.js           # argument parsing + the two run modes
```

**Per-source daily quota** (env-overridable), counted against rows added *today*:
```
SCRAPE_TVMAZE_PER_DAY=10  SCRAPE_TRAKT_PER_DAY=5  SCRAPE_MDL_PER_DAY=35
SCRAPE_VIKI_PER_DAY=10    SCRAPE_SIMKL_PER_DAY=5     # ~= 50–65/day
```

**Two run modes:**
```bash
# BURST — "run the scraper for exactly N minutes" (the requested feature)
node worker.js run --duration 45m     # or 35m, 2h, 90s …
#   loops runPass() back-to-back until the deadline; lifts quotas for the burst;
#   sets SKIP_MAINTENANCE=true so each loop spends its time DISCOVERING.

# DAEMON — steady background trickle
node worker.js run --daily
#   hourly "is a successful run > 12h old?" check + a run at boot; ~50/day.
#   Laptop-friendly: no fixed clock time to miss while asleep.

# ONE-OFFS
node worker.js enrich-watch-links     # Viki links onto existing rows
node worker.js migrate                # apply the DDL in §3
```

**Duration burst skeleton:**
```js
function parseDuration(s){ const m=s.match(/^(\d+)(s|m|h)$/); const n=+m[1];
  return n*(m[2]==='h'?3600:m[2]==='m'?60:1)*1000; }

async function burst(ms, log){
  process.env.SCRAPE_SKIP_MAINTENANCE = 'true';
  for (const k of ['TVMAZE','TRAKT','MDL','VIKI','SIMKL']) process.env[`SCRAPE_${k}_PER_DAY`]='1000000';
  const end = Date.now()+ms; let pass=0, base=await countRows();
  while (Date.now() < end - 90_000) {          // stop starting a pass with <90s left
    log(`pass ${++pass} …`);
    await runPass(log);
    log(`added so far: ${await countRows()-base}`);
    await sleep(3000);
  }
  log(`DONE: ${await countRows()-base} added in ${pass} passes`);
}
```
> **Concurrency guard**: only one scraper may write at once. In daemon mode take a
> Postgres advisory lock (`SELECT pg_try_advisory_lock(42)`) at pass start and
> release at end, so a second worker/replica can't double-scrape and race the quota.

**.env**
```
DATABASE_URL=postgres://user:pass@localhost:5432/romantic_tales
TRAKT_CLIENT_ID=…        # optional but recommended (real ratings + pre-release)
SIMKL_CLIENT_ID=…        # optional
```

---

## 10. Package as a Windows `.exe`

The worker is pure JS (only `pg`, which is pure JS — no native build). Options:

- **Node SEA** (built-in, Node 20+): `node --experimental-sea-config sea-config.json`
  then inject the blob into a copied `node.exe`. No extra deps.
- **`@yao-pkg/pkg`** (maintained `pkg` fork, supports ESM):
  ```bash
  npx @yao-pkg/pkg worker.js --targets node20-win-x64 --output scraper.exe
  scraper.exe run --duration 45m
  ```
Ship `scraper.exe` + a `.env` next to it. A tiny tray/GUI (e.g. a small Electron or
`systray` wrapper) can expose a "run for [ 45 ] minutes → Start" button that just
spawns `scraper.exe run --duration <n>m`.

---

## 11. Migration path → Chrome extension (real-time page scraping)

The parsers are the reusable core. A worker **fetches** pages; an extension
**reads the page the user is already viewing** — same extraction logic, no CORS,
no bot-detection (it's the user's real session).

```
extension/
  manifest.json        # MV3; content_scripts match viki.com, mydramalist.com, …
  content.js           # runs IN the page: reuse the §5 parsers on document.* / __NEXT_DATA__
  background.js        # dedup queue; POST candidates to your backend
  popup.html/js        # "Capture this page" + "Auto-capture as I browse" + a counter
```
- **content.js** on a Viki show page: read `document.getElementById('__NEXT_DATA__').textContent`,
  run the exact same `deepFind`/field extraction from §5.5 → a candidate. On MDL,
  read the DOM/`__NEXT_DATA__` similarly (no Kuryana needed — you're already on the page).
- **background.js**: hold a `Set` of seen ids; `POST /api/ingest` (a thin endpoint that
  runs enrich + gate + insert server-side, reusing `sources.js`/`pipeline.js`).
- The backend `/api/ingest` and the worker share **the same `enrich()` + gate + insert**
  code — so the extension and the exe produce identical, deduped, gated rows.
- Because the extension sees only the current page, it captures **exactly what the
  user browses in real time** — great for "I found a new drama, grab it now", while
  the exe worker does the bulk sitemap sweeps.

**Keep it clean**: the extension must respect the same rules — no auto-clicking
through paywalls, no credential capture, only read pages the user opens themselves.

---

## 12. Gotchas (learned the hard way — bake these in)

| Symptom | Cause / Fix |
|---|---|
| `fetch failed` in a container, works on host | No IPv6 route; `dns.setDefaultResultOrder('ipv4first')` at startup. |
| Trakt returns 403 | Missing `User-Agent` header on Trakt requests. |
| Viki `__NEXT_DATA__` "not found" | Script tag has a `nonce` attr — match `id="__NEXT_DATA__"[^>]*`, not a fixed tag. |
| MDL page 403 intermittently | CDN bot check; one retry after 5 s, then skip. Never spoof to evade. |
| Duplicate of a hand-seeded row | Manual rows lack ids and slugify differently — dedup on `normTitle` (strip all non-alphanumerics), not just slug/id. |
| Every movie shows "upcoming" | Movies have no weekly aired range; derive movie status from year/date, not the series rule. |
| Movie attached to a wrong TV id | TVMaze is TV-only — **skip TVMaze enrichment entirely for movies**. |
| Runaway growth / heavy site | Per-source **per-calendar-day** quotas; the front end windows/paginates rendering. |
| Two workers double-scraping | Postgres advisory lock around a pass (daemon mode). |
| Poster shows wrong image | Source mismatch (e.g. a variety show vs the drama) — spot-check after big runs; store bytes so you can re-fetch/replace by updating the `posters` row. |

---

## 13. Build order for the fresh chat

1. `migrate` — run the DDL (§3). 2. `db.js` + `config.js`. 3. `sources.js` — one
connector at a time, starting with **TVMaze** (keyless, also the enrichment
backbone), then **MDL** (biggest catalog), then **Viki** (watch links), then
Trakt/Simkl. 4. `pipeline.js` (§6–8). 5. `cli.js` with `--duration` (§9).
6. Verify with a short `run --duration 5m`, audit the `dramas`/`posters`/`scrape_runs`
rows for completeness (0 nulls on the gated fields). 7. Package (§10). 8. Extension (§11).

**Definition of done for a pass**: new rows have a native title, a stored poster
binary, a ≥40-char synopsis, correct `content_type`/`status`, and are `approved=FALSE`.
