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
import { runPass, refreshPass, lastSuccessMs } from "./pipeline.js";
import { enrichVikiWatchLinks } from "./sources.js";
import { evaluateChanges, storeSignals, probeUpdates } from "./changes.js";
import { cursorSet } from "./sources.js";

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

/**
 * A run whose finished_at is still NULL means a previous worker was killed or
 * crashed mid-pass (the single-writer lock guarantees no other run is live).
 * Mark those interrupted so the Logs view can explain the termination instead
 * of the run silently disappearing.
 */
async function reconcileStaleRuns() {
  const { rowCount } = await pool.query(
    `UPDATE scrape_runs SET ok = FALSE, finished_at = now(),
       error = coalesce(error, 'interrupted — worker restarted or was terminated')
     WHERE finished_at IS NULL`
  );
  if (rowCount) log.info(`[scraper] marked ${rowCount} interrupted run(s) from a previous session`);
}

async function migrate() {
  const sql = readFileSync(join(HERE, "..", "schema.sql"), "utf8");
  await pool.query(sql);
  log.info("schema applied.");
}

/**
 * Probe every active source for "new data since our last scrape" and cache the
 * result in scrape_cursors for the GUI. Read-only — takes no advisory lock and
 * never stores signals, so a source stays flagged "new" until an actual scrape.
 */
async function checkUpdates() {
  const { hasNew, statuses } = await probeUpdates();
  const snapshot = { checkedAt: new Date().toISOString(), hasNew, sources: statuses };
  await cursorSet("updates:snapshot", JSON.stringify(snapshot));
  await cursorSet("updates:checked_at", snapshot.checkedAt);
  log.info(`[updates] ${statuses.map((s) => `${s.src}=${s.status}`).join(" ")} → hasNew=${hasNew}`);
}

/** "Run for N ms": discovery passes back-to-back until the clock runs out. */
async function burst(ms, { ifChanged = false } = {}) {
  // Probe once up front: gate the burst when scheduled (--if-changed) and record
  // the tokens so the run acknowledges the current source state at the end.
  let signals = null;
  try {
    const { skip, tokens } = await evaluateChanges(log);
    signals = tokens;
    if (ifChanged && skip) {
      log.info("=== BURST SKIPPED — no new data since last run ===");
      return;
    }
  } catch (e) {
    log.warn(`[changes] probe failed (${e.message}) — bursting anyway`);
  }
  process.env.SCRAPE_SKIP_MAINTENANCE = "true"; // spend the window DISCOVERING
  for (const k of ["TVMAZE", "TRAKT", "SIMKL", "MDL", "VIKI", "CUSTOM"])
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
      await runPass(log, { noSignals: true }); // burst handles signals once, not per pass
    } catch (e) {
      log.error(`pass ${pass}: ${e.message}`);
    }
    log.info(`cumulative added this burst: ${(await countRows()) - base}`);
    await sleep(3000);
  }
  log.info(`=== BURST DONE — ${pass} passes, added ${(await countRows()) - base} ===`);
  if (signals) await storeSignals(signals).catch(() => {}); // remember freshness for next --if-changed
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
    case "run": {
      const ifChanged = rest.includes("--if-changed");
      await withLock(async () => {
        await reconcileStaleRuns();
        if (rest.includes("--daily")) await daily();
        else if (flag("duration")) await burst(parseDuration(flag("duration")), { ifChanged });
        else await runPass(log, { ifChanged });
      });
      break;
    }
    case "check-updates":
      await checkUpdates(); // read-only; no advisory lock needed
      break;
    case "refresh":
      await withLock(() => refreshPass(log));
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
  node src/worker.js run --if-changed         run only if a source has new data (add to run/--duration)
  node src/worker.js refresh                  re-read ongoing titles only (episodes/status/rating; never inserts)
  node src/worker.js check-updates            probe sources for new data (updates the GUI's "what's new")
  node src/worker.js enrich-watch-links       fill real Viki watch links on existing rows`);
  }
} catch (e) {
  log.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
