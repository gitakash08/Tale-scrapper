/**
 * Multi-source drama discovery + enrichment.
 *
 * Each connector returns NORMALIZED candidates:
 *   { src, title, year, country, premiered, status, rating, genres,
 *     synopsis, airDays, posterUrl, tvmazeId, imdbId }
 *
 * Sources:
 *  - TVMaze (keyless, always on): daily schedules — 7 days back for new
 *    premieres, 14 days forward for "Coming Soon" (status: upcoming).
 *  - Trakt (needs free TRAKT_CLIENT_ID): trending + anticipated shows.
 *    Trakt has real community ratings but NO images — posters and the
 *    original title are cross-filled from TVMaze via the shared IMDB id.
 *  - Simkl (needs free SIMKL_CLIENT_ID): weekly TV premieres.
 *  Connectors whose key is missing return [] and are logged as skipped.
 *
 * enrich() then completes every candidate from TVMaze (original title via
 * /akas, poster, synopsis, episode count) and applies the QUALITY GATE:
 * candidates missing an original title, a real synopsis, or a poster are
 * rejected — incomplete data never enters the database.
 */

import { pool } from "./db.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  await sleep(550); // stay polite with every provider
  const res = await fetch(url, {
    // Trakt's CDN returns 403 to requests without a User-Agent (Node's
    // fetch sends none by default) — identify ourselves on every call.
    headers: { "User-Agent": "RomanticTales/1.0 (drama discovery)", ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}
const tv = (path) => getJson(`https://api.tvmaze.com${path}`);

async function getText(url) {
  await sleep(550);
  const res = await fetch(url, {
    headers: { "User-Agent": "RomanticTales/1.0 (drama discovery)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

/* ── shared vocabulary ────────────────────────────────────────────── */
export const DAY_ABBR = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu",
  Friday: "Fri", Saturday: "Sat", Sunday: "Sun",
};
const TVMAZE_STATUS = {
  Running: "airing",
  Ended: "completed",
  "To Be Determined": "airing",
  "In Development": "upcoming",
};
const stripHtml = (html) =>
  (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const langCountry = (lang) =>
  lang === "Korean" || lang === "ko" ? "KR" :
  lang === "Chinese" || lang === "zh" ? "CN" : null;
const CJK = /[ᄀ-ᇿ㄰-㆏가-힯一-鿿㐀-䶿]/;

const isFuture = (iso) => iso && new Date(iso).getTime() > Date.now();

/* ── TVMaze: schedule scan (back 7 days + forward 14, keyless) ────── */
export async function tvmazeCandidates(log) {
  const shows = new Map();
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;

  const keep = (show) => {
    if (!show || shows.has(`tvmaze:${show.id}`)) return;
    const country = langCountry(show.language);
    if (!country || show.type !== "Scripted") return;
    if (!show.premiered || new Date(show.premiered).getTime() < cutoff) return;
    if (!show.genres?.some((g) => ["Drama", "Romance", "Comedy"].includes(g))) return;
    shows.set(`tvmaze:${show.id}`, {
      src: "tvmaze",
      title: show.name,
      year: Number(show.premiered.slice(0, 4)),
      country,
      premiered: show.premiered,
      status: isFuture(show.premiered)
        ? "upcoming"
        : TVMAZE_STATUS[show.status] ?? "upcoming",
      rating: show.rating?.average ?? null,
      genres: show.genres ?? [],
      synopsis: stripHtml(show.summary),
      airDays: (show.schedule?.days ?? []).map((d) => DAY_ABBR[d]).filter(Boolean),
      posterUrl: show.image?.medium ?? null,
      tvmazeId: show.id,
      imdbId: show.externals?.imdb ?? null,
    });
  };

  // back 7 days (new premieres) + forward 14 sampled every 2nd day (Coming Soon)
  const offsets = [0, -1, -2, -3, -4, -5, -6, 2, 4, 6, 8, 10, 12, 14];
  for (const off of offsets) {
    const d = new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
    for (const ep of (await tv(`/schedule?country=KR&date=${d}`)) ?? []) keep(ep.show);
    for (const ep of (await tv(`/schedule?country=CN&date=${d}`)) ?? []) keep(ep.show);
    for (const ep of (await tv(`/schedule/web?date=${d}`)) ?? []) keep(ep._embedded?.show);
  }
  log.info(`[sources] tvmaze: ${shows.size} candidates`);
  return [...shows.values()];
}

/* ── Trakt: trending + anticipated (free key required) ────────────── */
const TRAKT_STATUS = {
  "returning series": "airing", ended: "completed", canceled: "completed",
  "in production": "upcoming", planned: "upcoming", upcoming: "upcoming",
};

export async function traktCandidates(log) {
  const key = process.env.TRAKT_CLIENT_ID;
  if (!key) {
    log.info("[sources] trakt: skipped (no TRAKT_CLIENT_ID)");
    return [];
  }
  const headers = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": key,
  };
  const out = [];
  for (const list of ["trending", "anticipated"]) {
    const items =
      (await getJson(
        `https://api.trakt.tv/shows/${list}?limit=60&extended=full`,
        headers
      )) ?? [];
    for (const item of items) {
      const show = item.show ?? item;
      const country = langCountry(show.language) ??
        (show.country === "kr" ? "KR" : show.country === "cn" ? "CN" : null);
      if (!country || !show.year) continue;
      if (!show.genres?.some((g) => ["drama", "romance", "comedy"].includes(g))) continue;
      out.push({
        src: "trakt",
        title: show.title,
        year: show.year,
        country,
        premiered: show.first_aired?.slice(0, 10) ?? null,
        status: isFuture(show.first_aired)
          ? "upcoming"
          : TRAKT_STATUS[show.status] ?? "upcoming",
        rating: typeof show.rating === "number" && show.votes >= 10
          ? Math.round(show.rating * 10) / 10
          : null,
        genres: (show.genres ?? []).map((g) => g[0].toUpperCase() + g.slice(1)),
        synopsis: stripHtml(show.overview),
        airDays: show.airs?.day && DAY_ABBR[show.airs.day] ? [DAY_ABBR[show.airs.day]] : [],
        posterUrl: null, // Trakt ships no images; enrich() fills from TVMaze
        tvmazeId: null,
        imdbId: show.ids?.imdb ?? null,
      });
    }
  }
  log.info(`[sources] trakt: ${out.length} candidates`);
  return out;
}

/* ── Simkl: TV premieres (free key required) ──────────────────────── */
export async function simklCandidates(log) {
  const key = process.env.SIMKL_CLIENT_ID;
  if (!key) {
    log.info("[sources] simkl: skipped (no SIMKL_CLIENT_ID)");
    return [];
  }
  const out = [];
  for (const period of ["new", "soon"]) {
    const items =
      (await getJson(
        `https://api.simkl.com/tv/premieres/${period}?client_id=${key}&limit=60`
      )) ?? [];
    for (const item of items) {
      const country = (item.country ?? "").toLowerCase();
      if (country !== "kr" && country !== "cn") continue;
      out.push({
        src: "simkl",
        title: item.title,
        year: item.year ?? null,
        country: country.toUpperCase(),
        premiered: item.date?.slice(0, 10) ?? null,
        status: period === "soon" ? "upcoming" : "airing",
        rating: item.ratings?.simkl?.rating ?? null,
        genres: [],
        synopsis: "",
        airDays: [],
        posterUrl: item.poster ? `https://simkl.in/posters/${item.poster}_m.webp` : null,
        tvmazeId: null,
        imdbId: item.ids?.imdb ?? null,
      });
    }
  }
  log.info(`[sources] simkl: ${out.length} candidates`);
  return out;
}

/* ── MyDramaList: discovery pages + Kuryana detail wrapper ────────── */
/**
 * MDL has no public API (official one is private beta). Route verified
 * 2026-07-13: discovery slugs come from MDL's own listing pages — paths
 * allowed by their robots.txt, fetched politely with an identifying UA —
 * and structured details come from Kuryana (MIT-licensed OSS wrapper,
 * public instance kuryana.tbdh.app). MDL's community scores are the most
 * authoritative ratings for K/C-dramas, so candidates carry real ratings
 * (when scored by ≥ 10 users) and native titles out of the box.
 *
 * `want` is how many enrichable candidates to gather (the scraper passes
 * its remaining daily quota); `existingSlugs` avoids wasting detail
 * fetches on dramas already in the database.
 */
const MDL_COUNTRY = { "South Korea": "KR", China: "CN" };

// MDL advanced-search filter codes (decoded from the search form, 2026-07-22).
const MDL_CO = { KR: 3, CN: 2 };
const MDL_TY = { drama: 68, movie: 77, tv: 86 };
const advUrl = (co, ty, page) =>
  `https://mydramalist.com/search?adv=titles&co=${co}&ty=${ty}&so=top` +
  (page > 1 ? `&page=${page}` : "");

/**
 * The MDL listings we crawl. Each has a `url(page)` builder and, when
 * `paginate`, a per-listing cursor (scrape_cursors) that advances one page
 * per run and wraps at `maxPage` — so successive runs walk the whole ranking
 * instead of re-reading page 1. `status` seeds the airing state when detail
 * dates can't decide.
 *
 * The advanced-search listings (country × type, top-sorted) are the deep
 * back-catalog unlock: they expose every KR/CN drama, movie, and TV show on
 * MDL in rating order, thousands per combo — far beyond the popular top ~600
 * that the fixed /shows/ listings surface.
 */
const MDL_LISTINGS = [
  // fresh-content listings (page 1 only — newest walks a little)
  { key: "top_airing", url: () => "https://mydramalist.com/shows/top_airing", paginate: false, status: "airing", maxPage: 1 },
  { key: "upcoming", url: () => "https://mydramalist.com/shows/upcoming", paginate: false, status: "upcoming", maxPage: 1 },
  { key: "newest", url: (p) => `https://mydramalist.com/shows/newest${p > 1 ? `?page=${p}` : ""}`, paginate: true, status: null, maxPage: 20 },
  // deep back catalog: KR/CN × drama/movie/tv, top-rated first
  ...["KR", "CN"].flatMap((c) =>
    ["drama", "movie", "tv"].map((t) => ({
      key: `adv:${c}:${t}`,
      url: (p) => advUrl(MDL_CO[c], MDL_TY[t], p),
      paginate: true,
      status: null,
      maxPage: 100, // ~2000 titles per combo before wrapping
    }))
  ),
];

/**
 * Map the GUI's scrape_sources rows to connector on/off flags. Built-in rows
 * are matched to their connector by base_url (name as a fallback); a connector
 * with no row defaults ON (e.g. Simkl, which isn't seeded). Custom rows return
 * only the enabled ones. Used by BOTH the pipeline and change detection so the
 * Sources page toggles gate everything consistently.
 */
const BUILTIN_SRC = [
  { src: "tvmaze", url: /api\.tvmaze\.com/i, name: /tvmaze/i },
  { src: "trakt", url: /api\.trakt\.tv/i, name: /trakt/i },
  { src: "viki", url: /viki\.com/i, name: /viki/i },
  { src: "mdl", url: /mydramalist\.com/i, name: /mdl|mydramalist/i },
];

export async function loadSourceConfig() {
  const enabled = { tvmaze: true, trakt: true, simkl: true, mdl: true, viki: true };
  const custom = [];
  const { rows } = await pool.query(
    "SELECT id, name, base_url, enabled, builtin FROM scrape_sources ORDER BY id"
  );
  for (const r of rows) {
    if (r.builtin) {
      const hit = BUILTIN_SRC.find((b) => b.url.test(r.base_url ?? "") || b.name.test(r.name ?? ""));
      if (hit) enabled[hit.src] = r.enabled;
    } else if (r.enabled) {
      custom.push({ id: r.id, name: r.name, base_url: r.base_url });
    }
  }
  return { enabled, custom };
}

export async function cursorGet(key, fallback) {
  const { rows } = await pool.query("SELECT value FROM scrape_cursors WHERE key = $1", [key]);
  return rows[0]?.value ?? fallback;
}
export async function cursorSet(key, value) {
  await pool.query(
    `INSERT INTO scrape_cursors (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

/** "Feb 1, 2026 - Mar 24, 2026" / "Jul 30, 2026 - ?" / "Jul 30, 2026" */
function airedStatus(aired, fallback) {
  const [startS, endS] = (aired ?? "").split(/\s+-\s+/).map((s) => s?.trim());
  const start = startS && !Number.isNaN(Date.parse(startS)) ? new Date(startS) : null;
  const end = endS && !Number.isNaN(Date.parse(endS)) ? new Date(endS) : null;
  if (start && start.getTime() > Date.now()) return "upcoming";
  if (end && end.getTime() < Date.now()) return "completed";
  if (start) return "airing";
  return fallback ?? "upcoming";
}

export async function mdlCandidates(log, existingSlugs, want) {
  const slugify = (s) =>
    s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

  // 1) discovery: walk EVERY listing (one page each per run, cursor-advanced)
  const seen = new Set();
  const perListing = new Map(); // listing path -> [{ slug, title, status }]
  // Big quotas need deeper discovery: crawl up to 3 consecutive pages per
  // paginated listing per run, starting at the listing's cursor.
  const pagesPerListing = Math.max(1, Math.min(3, Math.ceil(want / 15)));
  for (const listing of MDL_LISTINGS) {
    const bucket = [];
    perListing.set(listing.key, bucket);
    const cursorKey = `mdl:${listing.key}:page`;
    const base = listing.paginate ? Number(await cursorGet(cursorKey, "1")) : 1;
    const pages = listing.paginate ? pagesPerListing : 1;
    let consecutiveExhausted = true; // cursor only advances past exhausted pages
    for (let i = 0; i < pages; i++) {
      const page = ((base + i - 1) % listing.maxPage) + 1;
      const url = listing.url(page);
      try {
        // MDL's CDN intermittently 403s non-browser clients; one spaced retry
        // often passes. If both attempts are blocked we log and move on —
        // never disguise the client to evade the block.
        const html = await getText(url).catch(async () => {
          await sleep(5000);
          return getText(url);
        });
        let newHere = 0;
        for (const m of html.matchAll(/<a href="\/(\d+-[a-z0-9-]+)"[^>]*>([^<]+)<\/a>/g)) {
          const [, slug, rawTitle] = m;
          const title = rawTitle.trim();
          if (!title || seen.has(slug)) continue;
          if (existingSlugs.has(slugify(title.replace(/\s*\(\d{4}\)\s*$/, "")))) continue;
          seen.add(slug);
          bucket.push({ slug, title, status: listing.status });
          newHere++;
        }
        log.info(`[sources] mdl: ${listing.key} p${page} → ${newHere} new slugs`);
        // advance the cursor while leading pages are duplicate-heavy
        if (listing.paginate && newHere < 5 && consecutiveExhausted) {
          await cursorSet(cursorKey, (page % listing.maxPage) + 1);
        } else {
          consecutiveExhausted = false;
        }
      } catch (err) {
        log.warn(`[sources] mdl: ${listing.key} p${page} failed (${err.message})`);
      }
    }
  }

  // round-robin across listings so every listing contributes candidates,
  // not just whichever was crawled first
  const found = new Map();
  const buckets = [...perListing.values()];
  for (let i = 0; buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) {
      if (i < b.length) found.set(b[i].slug, b[i]);
    }
  }

  // 2) details via Kuryana until we have enough KR/CN candidates
  const out = [];
  let fetches = 0;
  for (const [slug, seed] of found) {
    // headroom for the gate, bounded so a run never hammers Kuryana
    if (out.length >= want * 2 || fetches >= Math.min(want * 4, 120)) break;
    fetches++;
    try {
      const { data } = (await getJson(`https://kuryana.tbdh.app/id/${slug}`)) ?? {};
      if (!data) continue;
      const country = MDL_COUNTRY[data.details?.country];
      if (!country) continue; // KR/CN site only (skips JP/TH/TW/HK)

      // MDL "type" -> our content_type. Movies are kept now (own tab);
      // anything neither Drama nor Movie (TV Program/Special/Show) is "tv".
      const mdlType = data.details?.type ?? "Drama";
      const contentType =
        mdlType === "Movie" ? "movie" : /drama/i.test(mdlType) ? "drama" : "tv";

      const votes = Number((data.details?.score ?? "").match(/scored by ([\d,]+)/)?.[1]?.replace(/,/g, "") ?? 0);
      const airedStartS = (data.details?.aired ?? "").split(/\s+-\s+/)[0]?.trim();
      const airedStart = airedStartS && !Number.isNaN(Date.parse(airedStartS))
        ? new Date(airedStartS) : null;
      const genres = (data.details?.genres ?? "").split(",").map((g) => g.trim()).filter(Boolean);
      if (contentType === "tv" && !genres.includes("Variety")) genres.push("Variety");
      const year = Number(data.year) || (airedStart ? airedStart.getFullYear() : null);
      // Movies don't "air" over weeks — they're released or not yet. MDL gives
      // movies no weekly aired range, so decide by date/year, not airedStatus
      // (which would otherwise default every movie to "upcoming").
      const status =
        contentType === "movie"
          ? (airedStart && airedStart.getTime() > Date.now()) ||
            (year && year > new Date().getFullYear())
            ? "upcoming"
            : "completed"
          : airedStatus(data.details?.aired, seed.status);
      out.push({
        src: "mdl",
        contentType,
        title: data.title.replace(/\s*\(\d{4}\)\s*$/, ""),
        year,
        country,
        premiered: airedStart ? airedStart.toISOString().slice(0, 10) : null,
        status,
        rating: typeof data.rating === "number" && votes >= 10 ? data.rating : null,
        genres,
        synopsis: stripHtml(data.synopsis).replace(/\s*\(Source:.*$/i, "").trim(),
        airDays: (data.details?.aired_on ?? "").split(",").map((d) => DAY_ABBR[d.trim()]).filter(Boolean),
        posterUrl: data.poster || null,
        originalTitle: data.others?.native_title?.[0] ?? null,
        // movies have no episode list; 0 means "not applicable" (UI hides it)
        episodes: contentType === "movie" ? 0 : Number(data.details?.episodes) || null,
        tvmazeId: null,
        imdbId: null,
      });
    } catch {
      /* skip this slug; kuryana scrapes live and can hiccup */
    }
  }
  log.info(`[sources] mdl: ${out.length} candidates (${fetches} detail fetches)`);
  return out;
}

/* ── Viki: sitemap discovery + __NEXT_DATA__ metadata (login-free) ── */
/**
 * Viki route (verified 2026-07-22): robots.txt permits show pages and
 * publishes sitemaps (tv.xml, movies.xml) — the sanctioned discovery path.
 * We never touch the disallowed /search, never log in, and never disguise
 * the client. Pages are a Next.js app; the embedded __NEXT_DATA__ JSON gives
 * origin country, EN title, year, synopsis, poster, and — as the real prize —
 * a genuine "Watch on Viki" URL. Viki exposes NO native title, so new adds
 * lean on enrich() to cross-fill it (and are rejected if it can't).
 */
const VIKI_SECTION_TYPE = { tv: "drama", movie: "movie" };

function deepFind(o, key, depth = 0, seen = new Set()) {
  if (depth > 10 || o == null || typeof o !== "object" || seen.has(o)) return undefined;
  seen.add(o);
  if (!Array.isArray(o) && key in o && o[key] != null) return o[key];
  for (const v of Array.isArray(o) ? o : Object.values(o)) {
    const r = deepFind(v, key, depth + 1, seen);
    if (r !== undefined) return r;
  }
  return undefined;
}

const vikiTitleFromSlug = (slug) =>
  slug.replace(/^[a-z0-9]+-/, "").replace(/-/g, " ").trim();

/** All unique Viki show URLs from the sitemaps (tv + movies). */
async function vikiSitemap(log) {
  const shows = new Map(); // slug -> { section, slug, url, seedTitle }
  for (const kind of ["tv", "movies"]) {
    try {
      const xml = await getText(`https://www.viki.com/sitemaps/${kind}.xml`);
      for (const m of xml.matchAll(/\/(tv|movie)\/([a-z0-9]+-[a-z0-9-]+)/g)) {
        const [, section, slug] = m;
        if (!shows.has(slug))
          shows.set(slug, {
            section,
            slug,
            url: `https://www.viki.com/${section}/${slug}`,
            seedTitle: vikiTitleFromSlug(slug),
          });
      }
    } catch (err) {
      log.warn(`[sources] viki: ${kind} sitemap failed (${err.message})`);
    }
  }
  return [...shows.values()];
}

/** Parse one Viki show page into a candidate (or null if not KR/CN/usable). */
async function vikiParse(entry) {
  const html = await getText(entry.url);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const origin = deepFind(data, "origin");
  const country =
    origin?.country === "kr" ? "KR" : origin?.country === "cn" ? "CN" : null;
  if (!country) return null; // KR/CN only (Viki also carries JP/TH/TW…)

  const titles = deepFind(data, "titles");
  const title = (titles?.en ?? entry.seedTitle ?? "").trim();
  const descriptions = deepFind(data, "descriptions");
  const synopsis = stripHtml(descriptions?.en ?? "").trim();
  const created = deepFind(data, "created_at");
  const year = created ? new Date(created).getFullYear() : null;
  const poster = deepFind(data, "poster");
  const posterUrl =
    typeof poster === "string" ? poster : poster?.url ?? poster?.source?.url ?? null;
  const contentType = VIKI_SECTION_TYPE[entry.section] ?? "drama";

  return {
    src: "viki",
    contentType,
    title,
    originalTitle: null, // Viki has no native title; enrich() cross-fills it
    year,
    country,
    premiered: created ? created.slice(0, 10) : null,
    status: contentType === "movie" ? "completed" : "completed",
    rating: null, // Viki ratings aren't reliably in the payload
    genres: [],
    synopsis,
    airDays: [],
    posterUrl,
    episodes: contentType === "movie" ? 0 : null,
    tvmazeId: null,
    imdbId: null,
    watchUrl: entry.url, // the real prize: a working Viki deep link
  };
}

/**
 * Viki candidates for NEW titles: walk the sitemap (cursor-paginated across
 * runs), skip slugs already in the catalog, fetch pages until `want` KR/CN
 * candidates are gathered. Returns candidates carrying a real `watchUrl`.
 */
export async function vikiCandidates(log, existingSlugs, want) {
  const slugify = (s) =>
    s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const entries = await vikiSitemap(log);
  log.info(`[sources] viki: ${entries.length} shows in sitemap`);

  // cursor over the sitemap so successive runs cover different shows
  const cursorKey = "viki:sitemap:offset";
  let offset = Number(await cursorGet(cursorKey, "0"));
  if (offset >= entries.length) offset = 0;

  const out = [];
  let fetches = 0;
  let i = offset;
  const limit = Math.min(entries.length, want * 6, 80); // bound page fetches/run
  while (out.length < want * 2 && fetches < limit) {
    const entry = entries[i % entries.length];
    i++;
    if (i - offset > entries.length) break; // full lap
    if (existingSlugs.has(slugify(entry.seedTitle))) continue;
    fetches++;
    try {
      const cand = await vikiParse(entry);
      if (cand && cand.title) out.push(cand);
    } catch {
      /* skip; Viki page hiccup */
    }
  }
  await cursorSet(cursorKey, String(i % entries.length));
  log.info(`[sources] viki: ${out.length} candidates (${fetches} page fetches)`);
  return out;
}

/**
 * Attach real Viki watch links to EXISTING catalog rows by matching the Viki
 * sitemap's slug-titles to our titles. Cheap: matches on slug text, no
 * per-page fetch. Returns the number of rows updated.
 */
export async function enrichVikiWatchLinks(log) {
  const norm = (s) =>
    (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  const entries = await vikiSitemap(log);
  const byTitle = new Map();
  for (const e of entries) if (!byTitle.has(norm(e.seedTitle))) byTitle.set(norm(e.seedTitle), e.url);

  const { rows } = await pool.query(
    "SELECT slug, title, watch FROM dramas WHERE approved OR NOT approved"
  );
  let updated = 0;
  for (const row of rows) {
    const url = byTitle.get(norm(row.title));
    if (!url) continue;
    const watch = Array.isArray(row.watch) ? row.watch : [];
    const viki = watch.find((w) => /viki/i.test(w.name));
    // only update when there's no real Viki link yet
    if (viki && viki.url && viki.url.startsWith("http")) continue;
    const next = viki
      ? watch.map((w) => (/viki/i.test(w.name) ? { ...w, url } : w))
      : [...watch, { name: "Rakuten Viki", url }];
    await pool.query("UPDATE dramas SET watch = $1, updated_at = now() WHERE slug = $2", [
      JSON.stringify(next),
      row.slug,
    ]);
    updated++;
  }
  log.info(`[sources] viki: ${updated} existing rows got real watch links`);
  return updated;
}

/* ── Generic custom-source connector (sitemap + JSON-LD/OpenGraph) ── */
/**
 * The "add any URL and scrape it" connector. Custom sources live in
 * scrape_sources (added from the GUI); the pipeline hands each enabled,
 * non-builtin row to genericCandidates(). We stay strictly within what a
 * site sanctions — robots.txt Sitemap: entries and /sitemap.xml for
 * discovery, an identifying User-Agent, polite spacing — never /search or
 * anything robots disallows, and we never disguise the client.
 *
 * Each discovered page is parsed for schema.org JSON-LD (TVSeries/Movie)
 * with OpenGraph/`<meta>` as fallback. Only KR/CN titles survive (the
 * dramas table's country CHECK); everything else is dropped. Output matches
 * the same candidate shape as the built-in connectors, so enrich()'s quality
 * gate applies unchanged — incomplete pages are rejected, not stored.
 */
const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const HAN = /[一-鿿㐀-䶿]/;
const genericSlugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

/** Grab the `content` of the first `<meta property|name="key">` tag. */
function metaTag(html, key) {
  const esc = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const tag = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*>`, "i")
  )?.[0];
  return tag ? tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null : null;
}

/** All JSON-LD entities on a page, flattening @graph and arrays. */
function jsonLdEntities(html) {
  const out = [];
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"] && Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const e of arr) if (e && typeof e === "object") out.push(e);
    } catch {
      /* malformed JSON-LD block — ignore */
    }
  }
  return out;
}
const ldTypes = (e) =>
  [].concat(e?.["@type"] ?? []).map((t) => String(t).toLowerCase());

function extractImage(ld) {
  const img = ld?.image ?? ld?.thumbnailUrl;
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return typeof img[0] === "string" ? img[0] : img[0]?.url ?? null;
  return img.url ?? img.contentUrl ?? null;
}

/** Prefer a CJK alternateName as the native title; else the title if CJK. */
function pickOriginalTitle(ld, title) {
  const alts = [].concat(ld?.alternateName ?? []).filter((s) => typeof s === "string");
  const cjkAlt = alts.find((a) => CJK.test(a));
  if (cjkAlt) return cjkAlt.trim();
  if (CJK.test(title)) return title.trim();
  return null; // enrich() cross-fills from TVMaze
}

/** KR/CN from JSON-LD countryOfOrigin / inLanguage, og:locale, or <html lang>. */
function detectCountry(ld, html) {
  const norm = (v) => (typeof v === "string" ? v.toLowerCase() : "");
  const coo = ld?.countryOfOrigin;
  const cooName = norm(typeof coo === "string" ? coo : coo?.name ?? coo?.["@id"]);
  if (/korea|대한민국|\bkr\b/.test(cooName)) return "KR";
  if (/china|中国|中國|\bcn\b/.test(cooName)) return "CN";
  const langs = [].concat(ld?.inLanguage ?? []).map((l) => norm(typeof l === "string" ? l : l?.name));
  if (langs.some((l) => l === "ko" || l.startsWith("ko-") || l.includes("korean"))) return "KR";
  if (langs.some((l) => l === "zh" || l.startsWith("zh") || l.includes("chinese"))) return "CN";
  const locale = norm(metaTag(html, "og:locale"));
  if (locale.startsWith("ko")) return "KR";
  if (locale.startsWith("zh")) return "CN";
  const htmlLang = norm(html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1]);
  if (htmlLang.startsWith("ko")) return "KR";
  if (htmlLang.startsWith("zh")) return "CN";
  return null;
}

/** Last-resort country guess from the script of the title/alt names. */
function countryFromScript(title, ld) {
  const alt = [].concat(ld?.alternateName ?? []).filter((s) => typeof s === "string").join(" ");
  const s = `${title} ${alt}`;
  if (HANGUL.test(s)) return "KR";
  if (HAN.test(s)) return "CN";
  return null;
}

/** schema.org aggregateRating → a 0–10 score, only when ≥10 votes back it. */
function parseRating(ld) {
  const ar = ld?.aggregateRating;
  if (!ar) return null;
  const val = Number(ar.ratingValue);
  if (!Number.isFinite(val)) return null;
  const count = Number(ar.ratingCount ?? ar.reviewCount ?? 0);
  if (count && count < 10) return null;
  const best = Number(ar.bestRating);
  const round = (x) => Math.round(x * 10) / 10;
  if (best === 5) return round(val * 2);
  if (best === 100) return round(val / 10);
  if (!best || best === 10) return val <= 10 ? round(val) : null;
  return null;
}

/** Sitemap/robots discovery: return candidate detail-page URLs for a source. */
async function discoverCustomUrls(log, source) {
  let origin;
  try {
    origin = new URL(source.base_url).origin;
  } catch {
    log.warn(`[sources] custom(${source.name}): bad base_url`);
    return [];
  }

  const sitemaps = [];
  const addSitemap = (u) => {
    try {
      const abs = new URL(u, origin).toString();
      if (!sitemaps.includes(abs)) sitemaps.push(abs);
    } catch {
      /* skip bad sitemap url */
    }
  };
  if (/\.xml($|\?)/i.test(source.base_url)) addSitemap(source.base_url);
  try {
    const robots = await getText(`${origin}/robots.txt`);
    for (const m of robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) addSitemap(m[1].trim());
  } catch {
    /* no robots.txt — fall back to the well-known path */
  }
  if (sitemaps.length === 0) addSitemap(`${origin}/sitemap.xml`);

  // Walk sitemaps (bounded), following one level of <sitemapindex>.
  const urls = new Set();
  const MAX_SITEMAPS = 8;
  let processed = 0;
  const queue = [...sitemaps];
  while (queue.length && processed < MAX_SITEMAPS) {
    const sm = queue.shift();
    processed++;
    try {
      const xml = await getText(sm);
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      if (/<sitemapindex/i.test(xml)) {
        for (const l of locs) if (processed + queue.length < MAX_SITEMAPS) queue.push(l);
      } else {
        for (const l of locs) urls.add(l);
      }
    } catch (e) {
      log.warn(`[sources] custom(${source.name}): sitemap ${sm} failed (${e.message})`);
    }
  }

  // Fallback: no sitemap → scrape same-origin links off the base page.
  if (urls.size === 0 && !/\.xml($|\?)/i.test(source.base_url)) {
    try {
      const html = await getText(source.base_url);
      for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
        try {
          const abs = new URL(m[1], source.base_url);
          if (abs.origin === origin) urls.add(abs.toString());
        } catch {
          /* skip unparseable href */
        }
      }
    } catch (e) {
      log.warn(`[sources] custom(${source.name}): base page failed (${e.message})`);
    }
  }

  // Drop assets and sitemap files — keep plausible detail pages.
  return [...urls].filter(
    (u) => !/\.(xml|jpe?g|png|webp|gif|css|js|ico|svg|pdf|mp4|json)(\?|$)/i.test(u)
  );
}

/** Parse one page into a normalized KR/CN candidate, or null if unusable. */
async function parseGenericPage(url, source) {
  const html = await getText(url);
  const entities = jsonLdEntities(html);
  const WANTED = ["tvseries", "movie", "creativework", "series", "tvseason", "videoobject"];
  const ld = entities.find((e) => ldTypes(e).some((t) => WANTED.includes(t))) ?? null;

  const ogType = (metaTag(html, "og:type") ?? "").toLowerCase();
  const title = (
    ld?.name ||
    metaTag(html, "og:title") ||
    (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "")
  ).trim();
  if (!title) return null;

  const country = detectCountry(ld, html) ?? countryFromScript(title, ld);
  if (country !== "KR" && country !== "CN") return null; // schema is KR/CN-only

  const isMovie = ldTypes(ld).includes("movie") || ogType.includes("movie");
  const contentType = isMovie ? "movie" : "drama";
  const dateStr =
    ld?.startDate || ld?.datePublished || ld?.dateCreated || ld?.releasedEvent?.startDate || null;
  const year = dateStr ? Number(String(dateStr).slice(0, 4)) || null : null;
  const premiered = dateStr ? String(dateStr).slice(0, 10) : null;
  const future = (d) => d && Date.parse(d) > Date.now();
  const status = isMovie
    ? future(premiered) || (year && year > new Date().getFullYear())
      ? "upcoming"
      : "completed"
    : future(premiered)
      ? "upcoming"
      : ld?.endDate && Date.parse(ld.endDate) < Date.now()
        ? "completed"
        : "completed";

  return {
    src: `custom:${source.id}`,
    contentType,
    title,
    originalTitle: pickOriginalTitle(ld, title),
    year,
    country,
    premiered,
    status,
    rating: parseRating(ld),
    genres: [].concat(ld?.genre ?? []).map((g) => String(g).trim()).filter(Boolean),
    synopsis: stripHtml(
      ld?.description || metaTag(html, "og:description") || metaTag(html, "description") || ""
    ),
    airDays: [],
    posterUrl: extractImage(ld) || metaTag(html, "og:image") || null,
    episodes: isMovie ? 0 : Number(ld?.numberOfEpisodes) || null,
    tvmazeId: null,
    imdbId: null,
    watchUrl: url, // the source page is itself a legit "watch/info" deep link
  };
}

/**
 * Candidates from a custom source. Discovers pages once, cursor-paginates the
 * URL list across runs (scrape_cursors: `custom:<id>:offset`), skips slugs
 * already in the catalog, and parses pages until `want` KR/CN candidates are
 * gathered. Bounded fetch budget so one run never hammers a site.
 */
export async function genericCandidates(log, source, existingSlugs, want) {
  const urls = await discoverCustomUrls(log, source);
  if (urls.length === 0) {
    log.info(`[sources] custom(${source.name}): no pages discovered`);
    return [];
  }
  log.info(`[sources] custom(${source.name}): ${urls.length} candidate pages`);

  const cursorKey = `custom:${source.id}:offset`;
  let offset = Number(await cursorGet(cursorKey, "0"));
  if (offset >= urls.length) offset = 0;

  const out = [];
  let fetches = 0;
  let i = offset;
  const limit = Math.min(urls.length, want * 6, 80);
  while (out.length < want * 2 && fetches < limit) {
    const url = urls[i % urls.length];
    i++;
    if (i - offset > urls.length) break; // one full lap of the URL list
    fetches++;
    try {
      const cand = await parseGenericPage(url, source);
      if (cand && cand.title && !existingSlugs.has(genericSlugify(cand.title))) out.push(cand);
    } catch {
      /* page hiccup — skip */
    }
  }
  await cursorSet(cursorKey, String(i % urls.length));
  log.info(`[sources] custom(${source.name}): ${out.length} candidates (${fetches} page fetches)`);
  return out;
}

/* ── enrichment + QUALITY GATE (TVMaze as the completion source) ──── */

/** Original title from TVMaze /akas: prefer the drama's home-country aka,
 *  else any CJK-script aka, else the main title if it is already CJK. */
export async function fetchOriginalTitle(tvmazeId, country, mainTitle) {
  const akas = (await tv(`/shows/${tvmazeId}/akas`)) ?? [];
  const home = akas.find((a) => a.country?.code === country && CJK.test(a.name ?? ""));
  const cjk = akas.find((a) => CJK.test(a.name ?? ""));
  if (home) return home.name;
  if (cjk) return cjk.name;
  if (CJK.test(mainTitle)) return mainTitle;
  return null;
}

/**
 * Complete a candidate from TVMaze and enforce the quality gate.
 * Returns { ok: true, drama } or { ok: false, reason }.
 */
export async function enrich(c) {
  const isMovie = c.contentType === "movie";
  // resolve the TVMaze record (by id, IMDB id, or title search) — but never
  // for movies: TVMaze is a TV database, so a movie title only ever matches a
  // same-named series, which would attach wrong metadata/ids.
  let show = null;
  if (!isMovie) {
    if (c.tvmazeId) show = await tv(`/shows/${c.tvmazeId}`);
    else if (c.imdbId) show = await tv(`/lookup/shows?imdb=${c.imdbId}`);
    if (!show) {
      show = await tv(`/singlesearch/shows?q=${encodeURIComponent(c.title)}`);
      if (show && langCountry(show.language) !== c.country) show = null;
    }
  }

  if (show) {
    c.tvmazeId = show.id;
    c.imdbId = c.imdbId ?? show.externals?.imdb ?? null;
    c.posterUrl = c.posterUrl ?? show.image?.medium ?? null;
    c.synopsis = c.synopsis || stripHtml(show.summary);
    c.rating = c.rating ?? show.rating?.average ?? null;
    c.premiered = c.premiered ?? show.premiered ?? null;
    if (c.genres.length === 0) c.genres = show.genres ?? [];
    if (c.airDays.length === 0)
      c.airDays = (show.schedule?.days ?? []).map((d) => DAY_ABBR[d]).filter(Boolean);
    if (!c.year && c.premiered) c.year = Number(c.premiered.slice(0, 4));
  }

  // sources like MDL supply the original title / episode count directly —
  // keep theirs; otherwise derive from TVMaze.
  const originalTitle =
    c.originalTitle ??
    (c.tvmazeId
      ? await fetchOriginalTitle(c.tvmazeId, c.country, c.title)
      : CJK.test(c.title) ? c.title : null);

  // episode count: real when listed; 0 (= "TBA") is legitimate for upcoming
  let episodes = c.episodes ?? 0;
  if (!episodes && c.tvmazeId)
    episodes = ((await tv(`/shows/${c.tvmazeId}/episodes`)) ?? []).length;

  /* quality gate — reject rather than store incomplete data */
  if (!c.title || !c.year) return { ok: false, reason: "missing title/year" };
  if (!originalTitle) return { ok: false, reason: "no original title found" };
  if (!c.posterUrl) return { ok: false, reason: "no poster available" };
  if ((c.synopsis ?? "").length < 40) return { ok: false, reason: "no real synopsis" };
  // movies legitimately have no episode list; series must have one unless upcoming
  if (episodes === 0 && c.status !== "upcoming" && !isMovie)
    return { ok: false, reason: "no episode list" };

  return {
    ok: true,
    drama: { ...c, originalTitle, episodes, contentType: c.contentType ?? "drama" },
  };
}
