-- R-Tale Scraper schema. Idempotent (safe to re-run). This is the SAME schema
-- the Romantic Tales web app uses — point DATABASE_URL at that database and the
-- scraper writes straight into it (approved = FALSE, so a human moderates).

CREATE TABLE IF NOT EXISTS dramas (
  id             TEXT PRIMARY KEY,
  slug           TEXT UNIQUE NOT NULL,
  title          TEXT NOT NULL,
  original_title TEXT,
  year           INT  NOT NULL,
  country        TEXT NOT NULL CHECK (country IN ('KR','CN')),
  rating         NUMERIC(3,1) NOT NULL DEFAULT 0,
  episodes       INT  NOT NULL,
  air_days       TEXT[] NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL CHECK (status IN ('airing','completed','upcoming')),
  moods          TEXT[] NOT NULL DEFAULT '{}',
  genres         TEXT[] NOT NULL DEFAULT '{}',
  synopsis       TEXT NOT NULL,
  poster         TEXT NOT NULL DEFAULT '',
  watch          JSONB NOT NULL DEFAULT '[]',
  approved       BOOLEAN NOT NULL DEFAULT FALSE,
  tvmaze_id      INT  UNIQUE,
  imdb_id        TEXT UNIQUE,
  source         TEXT NOT NULL DEFAULT 'manual',
  content_type   TEXT NOT NULL DEFAULT 'drama' CHECK (content_type IN ('drama','tv','movie')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dramas_status_idx       ON dramas (status);
CREATE INDEX IF NOT EXISTS dramas_country_idx      ON dramas (country);
CREATE INDEX IF NOT EXISTS dramas_content_type_idx ON dramas (content_type);
CREATE INDEX IF NOT EXISTS dramas_moods_idx        ON dramas USING GIN (moods);
CREATE INDEX IF NOT EXISTS dramas_genres_idx       ON dramas USING GIN (genres);

-- For a database created before these columns existed (safe no-ops otherwise):
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS approved     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS tvmaze_id    INT UNIQUE;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS imdb_id      TEXT UNIQUE;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS source       TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'drama';

-- Refresh support (source-agnostic). source_ref is the ORIGIN source's own
-- identifier for the row — MDL slug, TVMaze id, IMDB id, or a page URL for
-- sitemap/custom sources — so any connector can re-fetch its own rows without
-- guessing by title. rating_locked marks a human-curated rating that the
-- refresher must never overwrite.
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS source_ref    TEXT;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS rating_locked BOOLEAN NOT NULL DEFAULT FALSE;
-- refresher scans ongoing titles; partial index keeps it cheap as the catalog grows
CREATE INDEX IF NOT EXISTS dramas_refresh_idx
  ON dramas (status) WHERE status IN ('airing', 'upcoming');

-- On-air episode tracking. Owned by the web app's migration (already applied);
-- repeated here so this schema stays self-contained and re-runnable.
--   next_episode_at / episodes_aired are PUBLIC (site shows "5 of 8 episodes",
--   "Next episode: Jul 28"); last_episode_at / status_checked_at are the
--   worker's own bookkeeping. All UTC-anchored — the site renders in UTC.
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS next_episode_at   TIMESTAMPTZ;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS last_episode_at   DATE;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS episodes_aired    INT;
ALTER TABLE dramas ADD COLUMN IF NOT EXISTS status_checked_at TIMESTAMPTZ;
-- the re-check priority queue orders by staleness, so index that directly
CREATE INDEX IF NOT EXISTS dramas_status_checked_idx
  ON dramas (status_checked_at NULLS FIRST) WHERE status IN ('airing', 'upcoming');

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

-- Data sources shown/managed in the GUI (built-in connectors + custom ones).
CREATE TABLE IF NOT EXISTS scrape_sources (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'api',      -- api | sitemap | manual | file
  base_url   TEXT,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  builtin    BOOLEAN NOT NULL DEFAULT FALSE,   -- tuned connectors; can't be deleted
  last_sync  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO scrape_sources (name, kind, base_url, builtin, last_sync)
SELECT * FROM (VALUES
  ('MDL (MyDramaList)','api','https://mydramalist.com', TRUE, now()),
  ('TVMaze','api','https://api.tvmaze.com', TRUE, now()),
  ('Trakt','api','https://api.trakt.tv', TRUE, now()),
  ('Viki','sitemap','https://www.viki.com', TRUE, now())
) v(name,kind,base_url,builtin,last_sync)
WHERE NOT EXISTS (SELECT 1 FROM scrape_sources WHERE builtin);

-- GUI-owned scheduler: each row is one recurring rule the control panel fires.
-- kind decides how `config` (JSONB) is read:
--   interval  {intervalMinutes}
--   daily     {times:["HH:MM", ...]}
--   weekly    {days:[0..6 (0=Sun)], times:["HH:MM", ...]}
--   cron      {expr:"m h dom mon dow"}
-- duration_min is how long the triggered burst runs (0 = a single pass).
-- next_run_at is precomputed by the GUI so the tick loop is a cheap lookup.
CREATE TABLE IF NOT EXISTS scrape_schedules (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  kind         TEXT NOT NULL DEFAULT 'daily'
                 CHECK (kind IN ('interval','daily','weekly','cron')),
  config       JSONB NOT NULL DEFAULT '{}',
  duration_min INT  NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 0 AND 180),
  last_run_at  TIMESTAMPTZ,
  next_run_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scrape_schedules_due_idx
  ON scrape_schedules (next_run_at) WHERE enabled;

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
