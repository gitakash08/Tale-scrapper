import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Singleton scrape-job manager. Spawns the standalone worker CLI
 * (`node ../src/worker.js run --duration Nm`) and parses its stdout for live
 * progress, so the GUI never imports the worker internals — clean separation.
 * Cached on globalThis so Next's dev hot-reload doesn't spawn duplicates.
 */
export type JobState = {
  running: boolean;
  minutes: number;
  startedAt: number | null;
  finishedAt: number | null;
  pass: number;
  added: number;
  baseline: number | null;
  log: string[];
  error: string | null;
  trigger: string; // "manual" | "schedule:<name>" — who started this run
};

type Store = { state: JobState; child: ChildProcess | null };

const g = globalThis as unknown as { _rtsJob?: Store };
const store: Store =
  g._rtsJob ??
  (g._rtsJob = {
    state: {
      running: false, minutes: 0, startedAt: null, finishedAt: null,
      pass: 0, added: 0, baseline: null, log: [], error: null, trigger: "manual",
    },
    child: null,
  });

// repo root = one level up from the gui/ working directory
const REPO = path.resolve(process.cwd(), "..");
const WORKER = path.join(REPO, "src", "worker.js");

function push(line: string) {
  const s = store.state;
  for (const raw of line.split(/\r?\n/)) {
    const t = raw.trimEnd();
    if (!t) continue;
    s.log.push(t);
    if (s.log.length > 400) s.log.shift();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/baseline (\d+)/))) s.baseline = +m[1];
    if ((m = t.match(/pass (\d+)/))) s.pass = +m[1];
    if ((m = t.match(/cumulative added(?: this burst)?:\s*(\d+)/))) s.added = +m[1];
    if (/another scraper already holds the lock/i.test(t))
      s.error = "Another scraper is already running (worker/daemon). Stop it first.";
  }
}

export function getState(): JobState {
  return store.state;
}

export function startJob(
  minutes: number,
  opts: { trigger?: string } = {}
): { ok: boolean; error?: string } {
  const s = store.state;
  if (s.running) return { ok: false, error: "A scrape is already running." };
  const single = !Number.isFinite(minutes) || minutes <= 0; // 0 = one discovery pass
  const trigger = opts.trigger ?? "manual";
  Object.assign(s, {
    running: true, minutes: single ? 0 : minutes, startedAt: Date.now(), finishedAt: null,
    pass: 0, added: 0, baseline: null, error: null, trigger,
    log: [single ? "starting worker — single pass…" : `starting worker for ${minutes} minutes…`],
  });
  // A single pass runs `run` (one discovery sweep); a timed burst runs `--duration Nm`.
  const args = single ? [WORKER, "run"] : [WORKER, "run", "--duration", `${minutes}m`];
  const child = spawn(process.execPath, args, {
    cwd: REPO, // so the worker loads ../.env and resolves ../schema.sql
    env: process.env,
  });
  store.child = child;
  child.stdout?.on("data", (c) => push(c.toString()));
  child.stderr?.on("data", (c) => push(c.toString()));
  child.on("error", (e) => { s.error = e.message; s.running = false; s.finishedAt = Date.now(); });
  child.on("exit", () => { s.running = false; s.finishedAt = Date.now(); store.child = null; });
  return { ok: true };
}

export function stopJob(): { ok: boolean } {
  if (store.child && store.state.running) {
    store.child.kill();
    store.state.running = false;
    store.state.finishedAt = Date.now();
    store.state.log.push("stopped by user.");
  }
  return { ok: true };
}
