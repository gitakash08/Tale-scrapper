/**
 * Multi-source scrape pipeline — one `runPass()` = one full discovery pass.
 * The worker (worker.js) owns scheduling/duration; this file owns the work.
 *
 *  1. NEW-RELEASE WATCH — discovers recently premiered + upcoming
 *     ("Coming Soon") KR/CN dramas from every enabled source
 *     (TVMaze always; Trakt/Simkl when their free API keys are set).
 *  2. SAFETY CAP — at most SCRAPE_MAX_NEW (default 5) new dramas
 *     PER SOURCE per run.
 *  3. APPROVAL QUEUE — auto-added rows get approved = FALSE and stay
 *     invisible on the site until flipped TRUE in pgAdmin.
 *  4. STATUS REFRESHER — re-checks all "airing" dramas on TVMaze and
 *     updates status / episodes (ratings only on scraper-added rows —
 *     curated ratings are never overwritten).
 *  5. DATA QUALITY — enrich() completes each candidate (original title,
 *     poster, synopsis, episode count) and REJECTS incomplete ones; a
 *     backfill pass also fills missing original titles on old rows.
 *  7. SCRAPE LOG — every run writes a row to scrape_runs.
 *
 * Dedup: by slug, tvmaze_id, AND imdb_id — across the DB and within a
 * run, so the same drama arriving from two sources is stored once.
 *
 * Scheduling is laptop-friendly: an hourly "is a run overdue?" check
 * plus a boot catch-up. 12 h cadence = morning run on container start,
 * evening run while the laptop is on. SCRAPE_RUN_ON_BOOT=true forces a
 * run at startup (handy for testing).
 */
import { setDefaultResultOrder } from "node:dns";
import { pool } from "./db.js";
import {
  tvmazeCandidates, traktCandidates, simklCandidates, mdlCandidates,
  vikiCandidates, enrichVikiWatchLinks, enrich, fetchOriginalTitle,
} from "./sources.js";

// Docker containers often have no IPv6 route, but these APIs publish AAAA
// records — without this, fetch tries IPv6 first and dies ("fetch failed").
setDefaultResultOrder("ipv4first");

// Intake quotas are per CALENDAR DAY per source (not per run) — the total
// target is 50 new dramas/day (user request 2026-07-15): MDL carries the
// bulk because its paginated rankings run deepest and its ratings are the
// most authentic. The second daily run only gets each source's remainder.
// Per-CALENDAR-DAY intake cap per source. Read LIVE from env on every call so
// a `--duration` burst (which lifts the caps) takes effect without reimporting.
const DEFAULT_PER_DAY = { tvmaze: 10, trakt: 5, simkl: 5, mdl: 35, viki: 10 };
const PER_DAY_ENV = {
  tvmaze: "SCRAPE_TVMAZE_PER_DAY", trakt: "SCRAPE_TRAKT_PER_DAY",
  simkl: "SCRAPE_SIMKL_PER_DAY", mdl: "SCRAPE_MDL_PER_DAY", viki: "SCRAPE_VIKI_PER_DAY",
};
export const perDay = (s) => Number(process.env[PER_DAY_ENV[s]] ?? DEFAULT_PER_DAY[s]);
const BACKFILL_PER_RUN = 30;

const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

/**
 * Dedup key that survives punctuation/spacing differences — strips ALL
 * non-alphanumerics ("It's Okay" and "Its Okay" both -> "itsokay"). Catches
 * the case slug/id dedup can't: a manually-seeded drama (no tvmaze/imdb id,
 * slug built by a different slugifier) matching a freshly scraped twin.
 */
const normTitle = (s) =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

const MOOD_MAP = {
  Romance: "swoony", Comedy: "funny", Fantasy: "fantasy",
  Thriller: "suspenseful", Crime: "suspenseful", Mystery: "suspenseful",
  Horror: "suspenseful", History: "epic", Family: "heartwarming",
  Music: "youth", Sports: "youth",
};
const GENRE_MAP = {
  "Science-Fiction": "Sci-Fi", History: "Historical", Mystery: "Thriller",
  Adventure: "Action", Medical: "Drama", Legal: "Drama", War: "Military",
  Anime: null, Children: null,
};
const mapGenres = (genres) => {
  const out = new Set();
  for (const g of genres ?? []) {
    const m = GENRE_MAP[g] === undefined ? g : GENRE_MAP[g];
    if (m) out.add(m);
  }
  if (out.size === 0) out.add("Drama");
  return [...out];
};
const mapMoods = (genres, rating) => {
  const out = new Set();
  for (const g of genres ?? []) if (MOOD_MAP[g]) out.add(MOOD_MAP[g]);
  if ((rating ?? 0) >= 8) out.add("binge-worthy");
  if (out.size === 0) out.add("heartwarming");
  return [...out].slice(0, 3);
};

/* ── insert one enriched drama (approved = FALSE) ─────────────────── */
async function insertDrama(d, nextId) {
  const slug = slugify(d.title);
  const imgRes = await fetch(d.posterUrl, { signal: AbortSignal.timeout(15000) });
  if (!imgRes.ok) throw new Error(`poster fetch ${imgRes.status}`);
  const img = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get("content-type") ?? "image/jpeg";

  const rating = d.rating ?? 7.5; // flagged in run details when defaulted
  // Use a real Viki deep link when the candidate came with one (Viki source).
  const vikiUrl = d.watchUrl?.startsWith("http") ? d.watchUrl : "#";
  const watch =
    d.country === "KR"
      ? [{ name: "Netflix", url: "#" }, { name: "Rakuten Viki", url: vikiUrl }]
      : [{ name: "iQIYI", url: "#" }, { name: "Rakuten Viki", url: vikiUrl }];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO dramas
         (id, slug, title, original_title, year, country, rating, episodes,
          air_days, status, moods, genres, synopsis, poster, watch,
          approved, tvmaze_id, imdb_id, source, content_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,FALSE,$16,$17,$18,$19)`,
      [
        String(nextId), slug, d.title, d.originalTitle, d.year, d.country,
        rating, d.episodes,
        d.airDays, d.status, mapMoods(d.genres, d.rating), mapGenres(d.genres),
        d.synopsis, `/posters/${slug}.jpg`, JSON.stringify(watch),
        d.tvmazeId, d.imdbId, d.src, d.contentType ?? "drama",
      ]
    );
    await client.query(
      "INSERT INTO posters (slug, mime, bytes, data) VALUES ($1,$2,$3,$4)",
      [slug, mime, img.length, img]
    );
    await client.query("COMMIT");
    return slug;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* ── backfill original titles on existing rows ────────────────────── */
async function backfillOriginalTitles(log, details) {
  const { rows } = await pool.query(
    `SELECT slug, title, country, tvmaze_id FROM dramas
     WHERE original_title IS NULL ORDER BY tvmaze_id NULLS LAST LIMIT $1`,
    [BACKFILL_PER_RUN]
  );
  let filled = 0;
  for (const row of rows) {
    try {
      let id = row.tvmaze_id;
      if (!id) {
        const hit = await fetch(
          `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(row.title)}`,
          { signal: AbortSignal.timeout(15000) }
        ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const lang = hit?.language;
        const c = lang === "Korean" ? "KR" : lang === "Chinese" ? "CN" : null;
        if (!hit || c !== row.country) continue;
        id = hit.id;
        await pool.query(
          "UPDATE dramas SET tvmaze_id=$1 WHERE slug=$2 AND tvmaze_id IS NULL",
          [id, row.slug]
        );
      }
      const original = await fetchOriginalTitle(id, row.country, row.title);
      if (original) {
        await pool.query(
          "UPDATE dramas SET original_title=$1, updated_at=now() WHERE slug=$2",
          [original, row.slug]
        );
        filled++;
        details.enriched.push(`${row.title} → ${original}`);
      }
    } catch {
      /* next run retries */
    }
  }
  if (rows.length) log.info(`[scraper] backfilled ${filled}/${rows.length} original titles`);
  return filled;
}

/* ── refresh airing dramas (status / episodes; rating only if scraped) ─ */
const TVMAZE_STATUS = {
  Running: "airing", Ended: "completed",
  "To Be Determined": "airing", "In Development": "upcoming",
};

async function refreshAiring(log, details) {
  const { rows } = await pool.query(
    `SELECT slug, title, country, tvmaze_id, status, rating::float AS rating,
            episodes, source
     FROM dramas WHERE status IN ('airing', 'upcoming')`
  );
  let refreshed = 0;
  for (const row of rows) {
    if (!row.tvmaze_id) continue; // backfill pass resolves ids over time
    try {
      const show = await fetch(`https://api.tvmaze.com/shows/${row.tvmaze_id}`, {
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? r.json() : null));
      if (!show) continue;
      const premiered = show.premiered && new Date(show.premiered).getTime() > Date.now();
      const status = premiered ? "upcoming" : TVMAZE_STATUS[show.status] ?? row.status;
      // TVMaze ratings only ever overwrite TVMaze-sourced rows; curated,
      // Trakt, and MDL ratings are more trustworthy and stay untouched.
      const rating =
        row.source === "tvmaze" ? show.rating?.average ?? row.rating : row.rating;
      const eps = await fetch(`https://api.tvmaze.com/shows/${row.tvmaze_id}/episodes`, {
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? r.json() : []));
      const episodes = eps.length || row.episodes;
      if (status !== row.status || rating !== row.rating || episodes !== row.episodes) {
        await pool.query(
          "UPDATE dramas SET status=$1, rating=$2, episodes=$3, updated_at=now() WHERE slug=$4",
          [status, rating, episodes, row.slug]
        );
        refreshed++;
        details.refreshed.push(
          `${row.title}: ${row.status}→${status}, ${row.rating}→${rating}★, ${row.episodes}→${episodes}ep`
        );
      }
    } catch (err) {
      details.skipped.push(`${row.title}: refresh failed (${err.message})`);
    }
  }
  log.info(`[scraper] refreshed ${refreshed}/${rows.length} airing/upcoming dramas`);
  return refreshed;
}

/* ── one full run, logged to scrape_runs ──────────────────────────── */
let running = false;

export async function runPass(log) {
  if (running) return;
  running = true;
  const { rows: [run] } = await pool.query(
    "INSERT INTO scrape_runs DEFAULT VALUES RETURNING id"
  );
  const details = { added: [], refreshed: [], enriched: [], skipped: [] };
  let found = 0, added = 0, refreshed = 0;
  try {
    const existing = await pool.query(
      "SELECT slug, title, original_title, tvmaze_id, imdb_id FROM dramas"
    );
    const slugs = new Set(existing.rows.map((r) => r.slug));
    const tvIds = new Set(existing.rows.map((r) => r.tvmaze_id).filter(Boolean));
    const imdbIds = new Set(existing.rows.map((r) => r.imdb_id).filter(Boolean));
    // Punctuation-insensitive title keys (both title and original title).
    const titleKeys = new Set();
    for (const r of existing.rows) {
      titleKeys.add(normTitle(r.title));
      if (r.original_title) titleKeys.add(normTitle(r.original_title));
    }
    let nextId = (
      await pool.query("SELECT coalesce(max(id::int),0) AS m FROM dramas WHERE id ~ '^[0-9]+$'")
    ).rows[0].m;

    const usedToday = Object.fromEntries(
      (
        await pool.query(
          "SELECT source, count(*)::int AS n FROM dramas WHERE created_at >= date_trunc('day', now()) GROUP BY source"
        )
      ).rows.map((r) => [r.source, r.n])
    );
    const quota = (s) => Math.max(0, perDay(s) - (usedToday[s] ?? 0));

    const perSource = [
      {
        cap: quota("tvmaze"),
        list: quota("tvmaze") > 0
          ? await tvmazeCandidates(log).catch((e) => (details.skipped.push(`tvmaze: ${e.message}`), []))
          : [],
      },
      {
        cap: quota("trakt"),
        list: quota("trakt") > 0
          ? await traktCandidates(log).catch((e) => (details.skipped.push(`trakt: ${e.message}`), []))
          : [],
      },
      {
        cap: quota("simkl"),
        list: quota("simkl") > 0
          ? await simklCandidates(log).catch((e) => (details.skipped.push(`simkl: ${e.message}`), []))
          : [],
      },
      {
        cap: quota("mdl"),
        list: quota("mdl") > 0
          ? await mdlCandidates(log, slugs, quota("mdl")).catch((e) => (details.skipped.push(`mdl: ${e.message}`), []))
          : (log.info("[sources] mdl: daily quota reached"), []),
      },
      {
        cap: quota("viki"),
        list: quota("viki") > 0
          ? await vikiCandidates(log, slugs, quota("viki")).catch((e) => (details.skipped.push(`viki: ${e.message}`), []))
          : (log.info("[sources] viki: daily quota reached"), []),
      },
    ];
    found = perSource.reduce((n, s) => n + s.list.length, 0);

    for (const { cap, list: candidates } of perSource) {
      let addedFromSource = 0;
      // best-rated first; unrated sink to the end
      candidates.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      for (const c of candidates) {
        if (addedFromSource >= cap) break;
        if (slugs.has(slugify(c.title))) continue;
        if (titleKeys.has(normTitle(c.title))) continue;
        if (c.tvmazeId && tvIds.has(c.tvmazeId)) continue;
        if (c.imdbId && imdbIds.has(c.imdbId)) continue;
        try {
          const result = await enrich(c);
          if (!result.ok) {
            details.skipped.push(`${c.title} (${c.src}): ${result.reason}`);
            continue;
          }
          const d = result.drama;
          // re-check after enrichment resolved ids / original title
          if (slugs.has(slugify(d.title))) continue;
          if (titleKeys.has(normTitle(d.title))) continue;
          if (d.originalTitle && titleKeys.has(normTitle(d.originalTitle))) continue;
          if (d.tvmazeId && tvIds.has(d.tvmazeId)) continue;
          if (d.imdbId && imdbIds.has(d.imdbId)) continue;

          const slug = await insertDrama(d, ++nextId);
          slugs.add(slug);
          titleKeys.add(normTitle(d.title));
          if (d.originalTitle) titleKeys.add(normTitle(d.originalTitle));
          if (d.tvmazeId) tvIds.add(d.tvmazeId);
          if (d.imdbId) imdbIds.add(d.imdbId);
          added++;
          addedFromSource++;
          details.added.push(
            `${d.title} (${d.originalTitle}) [${d.country}/${d.contentType ?? "drama"}] via ${d.src}` +
              `${d.status === "upcoming" ? " — Coming Soon" : ""}` +
              `${d.rating == null ? " — rating defaulted" : ""}`
          );
          log.info(`[scraper] + ${d.title} via ${d.src} — awaiting approval`);
        } catch (err) {
          nextId--;
          details.skipped.push(`${c.title} (${c.src}): ${err.message}`);
        }
      }
    }

    // Maintenance passes (fill missing original titles, refresh airing rows).
    // Skippable for back-to-back discovery bursts, where re-refreshing the
    // same rows every pass would waste the window. Default off = normal daily.
    if (process.env.SCRAPE_SKIP_MAINTENANCE !== "true") {
      await backfillOriginalTitles(log, details);
      refreshed = await refreshAiring(log, details);
      // Attach real Viki watch links to matching catalog rows.
      await enrichVikiWatchLinks(log).catch((e) =>
        details.skipped.push(`viki-links: ${e.message}`)
      );
    }

    await pool.query(
      `UPDATE scrape_runs SET finished_at=now(), ok=TRUE,
         found=$1, added=$2, refreshed=$3, skipped=$4, details=$5 WHERE id=$6`,
      [found, added, refreshed, details.skipped.length, JSON.stringify(details), run.id]
    );
    log.info(`[scraper] run #${run.id} done: found ${found}, added ${added}, refreshed ${refreshed}`);
  } catch (err) {
    await pool.query(
      `UPDATE scrape_runs SET finished_at=now(), ok=FALSE,
         found=$1, added=$2, refreshed=$3, details=$4, error=$5 WHERE id=$6`,
      [found, added, refreshed, JSON.stringify(details), err.message, run.id]
    );
    log.error(`[scraper] run #${run.id} failed: ${err.message}`);
  } finally {
    running = false;
  }
}

/** Timestamp (ms) of the last successful pass, or 0. Used by --daily mode. */
export async function lastSuccessMs() {
  const { rows } = await pool.query(
    "SELECT started_at FROM scrape_runs WHERE ok ORDER BY started_at DESC LIMIT 1"
  );
  return rows[0]?.started_at ? new Date(rows[0].started_at).getTime() : 0;
}
