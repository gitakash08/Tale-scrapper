/**
 * Change detection — "only scrape when a source actually has new data."
 *
 * Each active source is probed for a cheap freshness token (a validator the
 * site already publishes), which we compare against the token stored from the
 * last run:
 *   - TVMaze : /updates/shows?since=day — the max update timestamp
 *   - Viki   : the sitemaps' HTTP ETag / Last-Modified
 *   - MDL    : the "newest" listing's ETag / Last-Modified (hash fallback)
 *   - Trakt  : the trending endpoint's ETag (needs the key; trending churns)
 *   - custom : the source's sitemap.xml / base-URL ETag / Last-Modified
 *
 * SAFE BY DESIGN: a run is skipped only when EVERY active source returns a
 * token AND none changed. Any source we can't probe (null token) forces the
 * run, so we never miss new data — at worst we scrape when we didn't need to.
 */
import { cursorGet, cursorSet, loadSourceConfig } from "./sources.js";

const UA = "RomanticTales/1.0 (drama discovery)";
const SIGNAL_KEY = (src) => `signal:${src}`;

/** Tiny non-crypto hash for the body-length fallback. */
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const readValidator = (res) => {
  const etag = res.headers.get("etag");
  if (etag) return `etag:${etag}`;
  const lm = res.headers.get("last-modified");
  if (lm) return `lm:${lm}`;
  return null;
};

/** ETag / Last-Modified validator for a URL (HEAD, then GET). Null if none. */
async function httpSignature(url) {
  try {
    const head = await fetch(url, {
      method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    if (head.ok) {
      const sig = readValidator(head);
      if (sig) return sig;
    }
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    return res.ok ? readValidator(res) : null;
  } catch {
    return null;
  }
}

/** Validator if the server sends one, else a hash of the (truncated) body. */
async function bodySignature(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return readValidator(res) ?? `hash:${djb2((await res.text()).slice(0, 200000))}`;
  } catch {
    return null;
  }
}

async function tvmazeSignal() {
  try {
    const res = await fetch("https://api.tvmaze.com/updates/shows?since=day", {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const map = await res.json();
    const max = Math.max(0, ...Object.values(map).map(Number).filter(Number.isFinite));
    return `tv:${max}`;
  } catch {
    return null;
  }
}

async function traktSignal() {
  const key = process.env.TRAKT_CLIENT_ID;
  if (!key) return null;
  return bodySignature("https://api.trakt.tv/shows/trending?limit=1", {
    "trakt-api-version": "2", "trakt-api-key": key,
  });
}

/** One source -> its freshness token (or null = "can't tell, must run"). */
async function probeSignal(src, source) {
  if (src === "tvmaze") return tvmazeSignal();
  if (src === "trakt") return traktSignal();
  if (src === "simkl") return null; // premieres endpoint is date-bucketed; treat as always-run
  if (src === "mdl") return bodySignature("https://mydramalist.com/shows/newest");
  if (src === "viki") {
    const a = await httpSignature("https://www.viki.com/sitemaps/tv.xml");
    const b = await httpSignature("https://www.viki.com/sitemaps/movies.xml");
    return a || b ? `viki:${a ?? "-"}|${b ?? "-"}` : null;
  }
  if (src.startsWith("custom") && source?.base_url) {
    let origin;
    try {
      origin = new URL(source.base_url).origin;
    } catch {
      return null;
    }
    return (await httpSignature(`${origin}/sitemap.xml`)) ?? (await bodySignature(source.base_url));
  }
  return null;
}

/** The sources a normal pass would actually hit (respecting Sources toggles). */
export async function activeSources() {
  const { enabled, custom } = await loadSourceConfig();
  const list = [];
  if (enabled.tvmaze) list.push({ src: "tvmaze" });
  if (enabled.mdl) list.push({ src: "mdl" });
  if (enabled.viki) list.push({ src: "viki" });
  if (enabled.trakt && process.env.TRAKT_CLIENT_ID) list.push({ src: "trakt" });
  if (enabled.simkl && process.env.SIMKL_CLIENT_ID) list.push({ src: "simkl" });
  for (const r of custom) list.push({ src: `custom:${r.id}`, source: r });
  return list;
}

/**
 * Probe all active sources. Returns { skip, tokens, summary }.
 * `skip` is true only when every source was probeable and none changed.
 * Call storeSignals(tokens) AFTER a successful pass so the next run compares.
 */
export async function evaluateChanges(log) {
  const sources = await activeSources();
  const tokens = {};
  let allProbeable = true;
  let changed = false;
  const parts = [];
  for (const { src, source } of sources) {
    const token = await probeSignal(src, source).catch(() => null);
    if (token == null) {
      allProbeable = false;
      parts.push(`${src}=?`);
      continue;
    }
    tokens[src] = token;
    const prev = await cursorGet(SIGNAL_KEY(src), null);
    const same = prev === token;
    if (!same) changed = true;
    parts.push(`${src}=${same ? "same" : "NEW"}`);
  }
  const skip = allProbeable && !changed;
  const summary = parts.join(" ");
  log.info(`[changes] ${summary} → ${skip ? "SKIP (no new data)" : "RUN"}`);
  return { skip, tokens, summary };
}

/** Persist this run's tokens so the next run can detect "no change". */
export async function storeSignals(tokens) {
  for (const [src, token] of Object.entries(tokens ?? {})) {
    await cursorSet(SIGNAL_KEY(src), token);
  }
}
