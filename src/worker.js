#!/usr/bin/env node
/**
 * R-Tale standalone scraper worker.
 *
 *   node src/worker.js migrate                 apply the schema
 *   node src/worker.js run --duration 45m      scrape hard for N minutes (35m/2h/90s)
 *   node src/worker.js run --daily             background daemon (~50/day, 12h cadence)
 *   node src/worker.js run                      one single pass
 *   node src/worker.js enrich-watch-links       fill real Viki links on existing rows
 *
 * Only ONE scraper may write at a time — enforced by a Postgres advisory lock,
 * so this worker is safe to run against the same DB as the web app (disable the
 * app's built-in scraper, or it'll just wait on the lock).
 */
import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first"); // containers/hosts w/o IPv6 route: avoid "fetch failed"

// Load .env from the current directory if present (Node 20.6+). Falls back to
// the ambient environment, so a packaged .exe can also read real env vars.
try { process.loadEnvFile?.(); } catch { /* no .env — use ambient env */ }

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";
import { runPass, lastSuccessMs } from "./pipeline.js";
import { enrichVikiWatchLinks } from "./sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (m) => console.log(`${ts()} ${m}`),
  warn: (m) => console.warn(`${ts()} WARN ${m}`),
  error: (m) => console.error(`${ts()} ERR ${m?.message ?? m}`),
};

const LOCK_KEY = 727274; // "RTS" — single-writer advisory lock

function parseDuration(s) {
  const m = /^(\d+)\s*(s|m|h)$/.exec((s || "").trim());
  if (!m) throw new Error(`bad --duration "${s}" — use e.g. 45m, 2h, 90s`);
  return +m[1] * (m[2] === "h" ? 3600000 : m[2] === "m" ? 60000 : 1000);
}
const countRows = async () =>
  (await pool.query("SELECT count(*)::int AS n FROM dramas")).rows[0].n;

/** Hold a session advisory lock for the whole of fn; refuse if already held. */
async function withLock(fn) {
  const client = await pool.connect();
  try {
    const { rows: [{ ok }] } = await client.query(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [LOCK_KEY]
    );
    if (!ok) {
      log.error("another scraper already holds the lock — exiting.");
      process.exitCode = 1;
      return;
    }
    await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function migrate() {
  const sql = readFileSync(join(HERE, "..", "schema.sql"), "utf8");
  await pool.query(sql);
  log.info("schema applied.");
}

/** "Run for N ms": discovery passes back-to-back until the clock runs out. */
async function burst(ms) {
  process.env.SCRAPE_SKIP_MAINTENANCE = "true"; // spend the window DISCOVERING
  for (const k of ["TVMAZE", "TRAKT", "SIMKL", "MDL", "VIKI"])
    process.env[`SCRAPE_${k}_PER_DAY`] = "1000000"; // lift daily caps for the burst
  const start = Date.now();
  const end = start + ms;
  const base = await countRows();
  log.info(`=== BURST START — baseline ${base}, budget ${(ms / 60000).toFixed(0)}m ===`);
  let pass = 0;
  while (Date.now() < end - 90_000) {
    // don't start a new pass with < 90s left
    log.info(`--- pass ${++pass} (t+${((Date.now() - start) / 60000).toFixed(1)}m) ---`);
    try {
      await runPass(log);
    } catch (e) {
      log.error(`pass ${pass}: ${e.message}`);
    }
    log.info(`cumulative added this burst: ${(await countRows()) - base}`);
    await sleep(3000);
  }
  log.info(`=== BURST DONE — ${pass} passes, added ${(await countRows()) - base} ===`);
}

/** Background daemon: run when the last success is older than the cadence. */
async function daily() {
  const cadenceMs = Number(process.env.SCRAPE_EVERY_HOURS ?? 12) * 3600000;
  log.info(`daemon started — runs when last success is > ${cadenceMs / 3600000}h old; re-checks hourly.`);
  for (;;) {
    try {
      if (Date.now() - (await lastSuccessMs()) >= cadenceMs) await runPass(log);
      else log.info("not due yet — sleeping an hour.");
    } catch (e) {
      log.error(e);
    }
    await sleep(3600_000);
  }
}

/* ── CLI ───────────────────────────────────────────────────────────── */
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

try {
  switch (cmd) {
    case "migrate":
      await migrate();
      break;
    case "run":
      if (rest.includes("--daily")) await withLock(daily);
      else if (flag("duration")) await withLock(() => burst(parseDuration(flag("duration"))));
      else await withLock(() => runPass(log));
      break;
    case "enrich-watch-links":
      await withLock(() => enrichVikiWatchLinks(log));
      break;
    default:
      console.log(`R-Tale Scraper — usage:
  node src/worker.js migrate                 apply the database schema
  node src/worker.js run --duration 45m      scrape hard for N minutes (e.g. 35m, 2h, 90s)
  node src/worker.js run --daily             background daemon (~50/day, 12h cadence)
  node src/worker.js run                      one single pass
  node src/worker.js enrich-watch-links       fill real Viki watch links on existing rows`);
  }
} catch (e) {
  log.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
