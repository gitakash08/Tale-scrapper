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
  vikiCandidates, genericCandidates, enrichVikiWatchLinks, enrich, fetchOriginalTitle,
  loadSourceConfig, refresherFor, findMdlSlug,
} from "./sources.js";
import { evaluateChanges, storeSignals } from "./changes.js";

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
// Custom sources (src = "custom:<id>") share one intake cap; the burst lifts it
// via the same SCRAPE_CUSTOM_PER_DAY key the discovery bursts set.
const DEFAULT_CUSTOM_PER_DAY = 10;
export const perDay = (s) =>
  typeof s === "string" && s.startsWith("custom")
    ? Number(process.env.SCRAPE_CUSTOM_PER_DAY ?? DEFAULT_CUSTOM_PER_DAY)
    : Number(process.env[PER_DAY_ENV[s]] ?? DEFAULT_PER_DAY[s]);
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
          approved, tvmaze_id, imdb_id, source, content_type, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,FALSE,$16,$17,$18,$19,$20)`,
      [
        String(nextId), slug, d.title, d.originalTitle, d.year, d.country,
        rating, d.episodes,
        d.airDays, d.status, mapMoods(d.genres, d.rating), mapGenres(d.genres),
        d.synopsis, `/posters/${slug}.jpg`, JSON.stringify(watch),
        d.tvmazeId, d.imdbId, d.src, d.contentType ?? "drama",
        d.sourceRef ?? null,
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

/* ── backfill source_ref on rows that predate the column ──────────── */
/**
 * Without a source_ref a row can't be refreshed, so fill it in for existing
 * rows. Most sources are recoverable from data we already hold — that's pure
 * SQL, no network. Only MDL needs a lookup, so it's paced and capped per run
 * (SCRAPE_SOURCEREF_PER_RUN, default 10), ongoing titles first. A row we can't
 * resolve confidently is simply left NULL and skipped by the refresher —
 * never a guessed match.
 */
const SOURCEREF_PER_RUN = () => Number(process.env.SCRAPE_SOURCEREF_PER_RUN ?? 10);

async function backfillSourceRefs(log, details, enabled) {
  // 1) free wins: identifiers already stored on the row
  const sqlFills = [
    ["tvmaze", `UPDATE dramas SET source_ref = tvmaze_id::text
                 WHERE source_ref IS NULL AND tvmaze_id IS NOT NULL AND source = 'tvmaze'`],
    ["trakt", `UPDATE dramas SET source_ref = imdb_id
                WHERE source_ref IS NULL AND imdb_id IS NOT NULL AND source = 'trakt'`],
    // Viki rows carry their real watch URL in the watch JSONB
    ["viki", `UPDATE dramas d SET source_ref = sub.url
               FROM (SELECT slug, (SELECT w->>'url' FROM jsonb_array_elements(watch) w
                                    WHERE w->>'url' LIKE 'http%viki.com/%' LIMIT 1) AS url
                       FROM dramas WHERE source = 'viki' AND source_ref IS NULL) sub
              WHERE d.slug = sub.slug AND sub.url IS NOT NULL`],
  ];
  let filled = 0;
  for (const [name, sql] of sqlFills) {
    const { rowCount } = await pool.query(sql);
    if (rowCount) log.info(`[source_ref] ${name}: filled ${rowCount} from existing ids`);
    filled += rowCount ?? 0;
  }

  // 2) MDL: resolve the slug via search, ongoing titles first, small batch
  if (enabled?.mdl !== false) {
    const { rows } = await pool.query(
      `SELECT slug, title, year FROM dramas
        WHERE source = 'mdl' AND source_ref IS NULL
        ORDER BY (status IN ('airing','upcoming')) DESC, updated_at ASC
        LIMIT $1`,
      [SOURCEREF_PER_RUN()]
    );
    let mdlResolved = 0;
    for (const row of rows) {
      try {
        const ref = await findMdlSlug(row.title, row.year);
        if (!ref) {
          details.skipped.push(`${row.title}: no confident MDL match for refresh`);
          continue;
        }
        await pool.query(
          "UPDATE dramas SET source_ref = $1 WHERE slug = $2 AND source_ref IS NULL",
          [ref, row.slug]
        );
        mdlResolved++;
      } catch {
        /* transient search failure — next run retries */
      }
    }
    filled += mdlResolved;
    if (rows.length) log.info(`[source_ref] mdl: resolved ${mdlResolved} of ${rows.length} looked up`);
  }
  return filled;
}

/* ── refresh ongoing titles (source-agnostic) ─────────────────────── */
/**
 * Re-reads every ONGOING title (airing/upcoming) from whichever source
 * originally supplied it, and updates only the fields that legitimately change:
 * episodes, status, rating. Each source implements its own `refresh()`
 * (see refresherFor in sources.js), so a new source — including a user-added
 * custom URL — becomes refreshable without touching this function.
 *
 * Safety rules (an enterprise catalog must never lose good data):
 *  - a null/missing field from the source KEEPS the stored value; a failed
 *    fetch can never blank out episodes, status, or a rating,
 *  - ratings need >= MIN_VOTES backing when the source reports a vote count,
 *  - rows with rating_locked = TRUE never have their rating touched (that flag
 *    marks a human-curated score),
 *  - rows whose source is disabled on the Sources page are skipped,
 *  - UPDATE by slug only — this pass can never INSERT, so it cannot duplicate.
 *
 * Fairness/cost: least-recently-updated rows go first, capped per run
 * (SCRAPE_REFRESH_PER_RUN, default 60), so the pass is bounded and every row
 * comes round over time without a cursor to maintain.
 */
const MIN_VOTES = 10;
const REFRESH_PER_RUN = () => Number(process.env.SCRAPE_REFRESH_PER_RUN ?? 60);

async function refreshOngoing(log, details, enabled) {
  const { rows } = await pool.query(
    `SELECT slug, title, source, source_ref, tvmaze_id, imdb_id, content_type,
            status, rating::float AS rating, episodes, rating_locked
       FROM dramas
      WHERE status IN ('airing', 'upcoming')
      ORDER BY updated_at ASC NULLS FIRST
      LIMIT $1`,
    [REFRESH_PER_RUN()]
  );

  let refreshed = 0, attempted = 0;
  for (const row of rows) {
    // honour the Sources page toggles (built-ins keyed by name, custom by id)
    const key = row.source?.startsWith("custom") ? "custom" : row.source;
    if (key !== "custom" && enabled && enabled[key] === false) continue;

    const refresh = refresherFor(row.source);
    if (!refresh) continue;                 // unknown/manual source — leave alone
    if (!row.source_ref && !row.tvmaze_id && !row.imdb_id) continue; // nothing to key on

    attempted++;
    try {
      const fresh = await refresh(row);
      if (!fresh) continue;

      // Keep the stored value whenever the source didn't give us a better one.
      const episodes = Number.isFinite(fresh.episodes) && fresh.episodes > 0
        ? fresh.episodes
        : row.episodes;
      const status = fresh.status ?? row.status;
      const ratingOk =
        !row.rating_locked &&
        typeof fresh.rating === "number" && fresh.rating > 0 &&
        (fresh.votes == null || fresh.votes >= MIN_VOTES);
      const rating = ratingOk ? fresh.rating : row.rating;

      if (status === row.status && episodes === row.episodes && rating === row.rating) continue;

      await pool.query(
        `UPDATE dramas SET status = $1, episodes = $2, rating = $3, updated_at = now()
          WHERE slug = $4`,
        [status, episodes, rating, row.slug]
      );
      refreshed++;
      const bits = [];
      if (status !== row.status) bits.push(`${row.status}→${status}`);
      if (episodes !== row.episodes) bits.push(`${row.episodes}→${episodes}ep`);
      if (rating !== row.rating) bits.push(`${row.rating}→${rating}★`);
      details.refreshed.push(`${row.title} [${row.source}]: ${bits.join(", ")}`);
      log.info(`[refresh] ${row.title}: ${bits.join(", ")}`);
    } catch (err) {
      details.skipped.push(`${row.title}: refresh failed (${err.message})`);
    }
  }
  log.info(`[scraper] refreshed ${refreshed}/${attempted} ongoing titles (of ${rows.length} scanned)`);
  return refreshed;
}

/* ── one full run, logged to scrape_runs ──────────────────────────── */
let running = false;

export async function runPass(log, opts = {}) {
  if (running) return;
  running = true;

  // Change detection: probe each active source once. When scheduled
  // (ifChanged), skip the whole pass if nothing is new; either way remember the
  // tokens so a successful run acknowledges the current source state. Burst
  // passes set noSignals so only the burst wrapper probes/stores, not each pass.
  let signals = null;
  if (!opts.noSignals) {
    try {
      const { skip, tokens, summary } = await evaluateChanges(log);
      signals = tokens;
      if (opts.ifChanged && skip) {
        await pool.query(
          `INSERT INTO scrape_runs (started_at, finished_at, ok, found, added, refreshed, skipped, details)
           VALUES (now(), now(), TRUE, 0, 0, 0, 0, $1)`,
          [JSON.stringify({ skippedNoChange: true, note: `no new data — ${summary}` })]
        );
        log.info("[scraper] skipped — no new data since last run");
        running = false;
        return;
      }
    } catch (e) {
      log.warn(`[changes] probe failed (${e.message}) — running anyway`);
    }
  }

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

    // Sources page toggles gate which connectors run. A disabled built-in is
    // skipped entirely (logged), so turning it off on the Sources page actually
    // stops it — and change detection uses the same flags.
    const { enabled: on, custom: customSources } = await loadSourceConfig();
    const builtin = (src, run) =>
      !on[src]
        ? (log.info(`[sources] ${src}: disabled on Sources page`), [])
        : quota(src) > 0
          ? run()
          : (log.info(`[sources] ${src}: daily quota reached`), Promise.resolve([]));

    const perSource = [
      {
        cap: on.tvmaze ? quota("tvmaze") : 0,
        list: await builtin("tvmaze", () =>
          tvmazeCandidates(log).catch((e) => (details.skipped.push(`tvmaze: ${e.message}`), []))),
      },
      {
        cap: on.trakt ? quota("trakt") : 0,
        list: await builtin("trakt", () =>
          traktCandidates(log).catch((e) => (details.skipped.push(`trakt: ${e.message}`), []))),
      },
      {
        cap: on.simkl ? quota("simkl") : 0,
        list: await builtin("simkl", () =>
          simklCandidates(log).catch((e) => (details.skipped.push(`simkl: ${e.message}`), []))),
      },
      {
        cap: on.mdl ? quota("mdl") : 0,
        list: await builtin("mdl", () =>
          mdlCandidates(log, slugs, quota("mdl")).catch((e) => (details.skipped.push(`mdl: ${e.message}`), []))),
      },
      {
        cap: on.viki ? quota("viki") : 0,
        list: await builtin("viki", () =>
          vikiCandidates(log, slugs, quota("viki")).catch((e) => (details.skipped.push(`viki: ${e.message}`), []))),
      },
    ];

    // Custom sources added from the GUI (enabled, non-builtin). Each gets the
    // shared custom daily cap and the generic sitemap+JSON-LD connector.
    const crawledCustomIds = [];
    for (const cs of customSources) {
      const src = `custom:${cs.id}`;
      const cap = Math.max(0, perDay(src) - (usedToday[src] ?? 0));
      let list = [];
      if (cap > 0) {
        crawledCustomIds.push(cs.id);
        list = await genericCandidates(log, cs, slugs, cap).catch(
          (e) => (details.skipped.push(`custom(${cs.name}): ${e.message}`), [])
        );
      } else {
        log.info(`[sources] custom(${cs.name}): daily quota reached`);
      }
      perSource.push({ cap, list });
    }

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

    // Record that we crawled each custom source this run (drives GUI "last sync").
    if (crawledCustomIds.length) {
      await pool.query(
        "UPDATE scrape_sources SET last_sync = now() WHERE id = ANY($1)",
        [crawledCustomIds]
      );
    }

    // Maintenance passes (fill missing original titles, refresh airing rows).
    // Skippable for back-to-back discovery bursts, where re-refreshing the
    // same rows every pass would waste the window. Default off = normal daily.
    if (process.env.SCRAPE_SKIP_MAINTENANCE !== "true") {
      await backfillOriginalTitles(log, details);
      await backfillSourceRefs(log, details, on);
      refreshed = await refreshOngoing(log, details, on);
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
    // Remember this run's freshness tokens so the next --if-changed run can skip.
    if (signals) await storeSignals(signals).catch(() => {});
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

/**
 * Refresh-only pass: no discovery, just re-read ongoing titles (and top up
 * source_refs). Cheap enough to schedule often — it never inserts rows.
 */
export async function refreshPass(log) {
  const { enabled } = await loadSourceConfig();
  const details = { added: [], refreshed: [], enriched: [], skipped: [] };
  const { rows: [run] } = await pool.query(
    "INSERT INTO scrape_runs DEFAULT VALUES RETURNING id"
  );
  try {
    await backfillSourceRefs(log, details, enabled);
    const refreshed = await refreshOngoing(log, details, enabled);
    await pool.query(
      `UPDATE scrape_runs SET finished_at=now(), ok=TRUE,
         found=0, added=0, refreshed=$1, skipped=$2, details=$3 WHERE id=$4`,
      [refreshed, details.skipped.length, JSON.stringify({ ...details, refreshOnly: true }), run.id]
    );
    log.info(`[scraper] refresh-only run #${run.id}: refreshed ${refreshed}`);
    return refreshed;
  } catch (err) {
    await pool.query(
      `UPDATE scrape_runs SET finished_at=now(), ok=FALSE, details=$1, error=$2 WHERE id=$3`,
      [JSON.stringify(details), err.message, run.id]
    );
    throw err;
  }
}

/** Timestamp (ms) of the last successful pass, or 0. Used by --daily mode. */
export async function lastSuccessMs() {
  const { rows } = await pool.query(
    "SELECT started_at FROM scrape_runs WHERE ok ORDER BY started_at DESC LIMIT 1"
  );
  return rows[0]?.started_at ? new Date(rows[0].started_at).getTime() : 0;
}
