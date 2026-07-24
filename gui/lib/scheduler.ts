import { pool } from "./db";
import { startJob, getState } from "./jobs";
import { computeNextRun, type ScheduleKind, type ScheduleConfig } from "./schedule-utils";

/**
 * GUI-owned scheduler. A single tick loop (cached on globalThis so Next's dev
 * hot-reload never spawns duplicates) wakes every TICK_MS, and when the master
 * switch is on and no scrape is already running, fires the most-overdue enabled
 * schedule via the shared job manager. Because the worker also holds a Postgres
 * advisory lock, a stray CLI run can never collide with a scheduled one.
 *
 * State lives entirely in the database:
 *   - scrape_schedules holds each rule + its precomputed next_run_at
 *   - scrape_cursors["scheduler:enabled"] is the master on/off switch
 * so schedules survive restarts and the loop is a cheap "anything due?" lookup.
 */
const TICK_MS = 30_000;
const MASTER_KEY = "scheduler:enabled";

const g = globalThis as unknown as { _rtsScheduler?: NodeJS.Timeout };

export async function masterEnabled(): Promise<boolean> {
  try {
    const { rows } = await pool.query("SELECT value FROM scrape_cursors WHERE key = $1", [MASTER_KEY]);
    return rows[0]?.value === "true";
  } catch {
    return false;
  }
}

export async function setMasterEnabled(on: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO scrape_cursors (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [MASTER_KEY, on ? "true" : "false"]
  );
}

/** Fire a schedule now: start the job and roll its last/next run forward. */
export async function fireSchedule(row: {
  id: number;
  name: string;
  kind: ScheduleKind;
  config: ScheduleConfig;
  duration_min: number;
  last_run_at: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const res = startJob(row.duration_min, { trigger: `schedule:${row.name}` });
  const now = new Date();
  // Anchor the next interval run on this fire; daily/weekly/cron ignore lastRun.
  const next = computeNextRun(row.kind, row.config, now, now);
  await pool.query(
    "UPDATE scrape_schedules SET last_run_at = $1, next_run_at = $2 WHERE id = $3",
    [res.ok ? now : row.last_run_at, next, row.id]
  );
  return res;
}

async function tick(): Promise<void> {
  try {
    if (!(await masterEnabled())) return;
    if (getState().running) return; // single writer — let the current run finish
    const { rows } = await pool.query(
      `SELECT id, name, kind, config, duration_min, last_run_at
         FROM scrape_schedules
        WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= now()
        ORDER BY next_run_at ASC
        LIMIT 1`
    );
    if (rows.length) await fireSchedule(rows[0]);
  } catch {
    /* transient DB/tick error — try again next tick */
  }
}

/** Idempotent: start the tick loop once per process. */
export function startScheduler(): void {
  if (g._rtsScheduler) return;
  g._rtsScheduler = setInterval(tick, TICK_MS);
  // A prompt first tick so a due schedule fires shortly after boot.
  void tick();
}
