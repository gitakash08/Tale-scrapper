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
  lastExit: string | null; // how the last run ended: "ok" | "stopped by user" | "exit code N" | "signal SIGX"
  job: JobKind; // what this run is doing
};

/** discovery = find new titles; refresh = re-read ongoing titles only. */
export type JobKind = "discovery" | "refresh";

type Store = { state: JobState; child: ChildProcess | null; stopping: boolean };

const g = globalThis as unknown as { _rtsJob?: Store };
const store: Store =
  g._rtsJob ??
  (g._rtsJob = {
    state: {
      running: false, minutes: 0, startedAt: null, finishedAt: null,
      pass: 0, added: 0, baseline: null, log: [], error: null, trigger: "manual", lastExit: null,
      job: "discovery",
    },
    child: null,
    stopping: false,
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
    // refresh runs report "refreshed N/M ongoing titles" — surface N as progress
    if ((m = t.match(/refreshed (\d+)\/\d+ ongoing titles/))) s.added = +m[1];
    if (/another scraper already holds the lock/i.test(t))
      s.error = "Another scraper is already running (worker/daemon). Stop it first.";
  }
}

export function getState(): JobState {
  return store.state;
}

export function startJob(
  minutes: number,
  opts: { trigger?: string; ifChanged?: boolean; job?: JobKind } = {}
): { ok: boolean; error?: string } {
  const s = store.state;
  if (s.running) return { ok: false, error: "A scrape is already running." };
  const job: JobKind = opts.job === "refresh" ? "refresh" : "discovery";
  const single = !Number.isFinite(minutes) || minutes <= 0; // 0 = one discovery pass
  const trigger = opts.trigger ?? "manual";
  store.stopping = false;
  Object.assign(s, {
    running: true,
    // a refresh is a single bounded pass — duration doesn't apply
    minutes: job === "refresh" || single ? 0 : minutes,
    startedAt: Date.now(), finishedAt: null,
    pass: 0, added: 0, baseline: null, error: null, trigger, lastExit: null, job,
    log: [
      job === "refresh"
        ? "starting worker — refreshing ongoing titles…"
        : single ? "starting worker — single pass…" : `starting worker for ${minutes} minutes…`,
    ],
  });
  // refresh = `worker.js refresh`; otherwise a discovery pass or timed burst.
  // Scheduled discovery adds `--if-changed` so a source with no new data is skipped.
  const args =
    job === "refresh"
      ? [WORKER, "refresh"]
      : single
        ? [WORKER, "run"]
        : [WORKER, "run", "--duration", `${minutes}m`];
  if (opts.ifChanged && job !== "refresh") args.push("--if-changed");
  const child = spawn(process.execPath, args, {
    cwd: REPO, // so the worker loads ../.env and resolves ../schema.sql
    env: process.env,
  });
  store.child = child;
  child.stdout?.on("data", (c) => push(c.toString()));
  child.stderr?.on("data", (c) => push(c.toString()));
  child.on("error", (e) => {
    s.error = `failed to start worker: ${e.message}`;
    s.lastExit = s.error;
    s.running = false;
    s.finishedAt = Date.now();
    store.child = null;
  });
  child.on("exit", (code, signal) => {
    // Record HOW the run ended so the Logs/Scraper views can explain restarts
    // and terminations instead of a run just silently vanishing.
    let reason: string;
    if (store.stopping) reason = "stopped by user";
    else if (signal) reason = `terminated by signal ${signal}`;
    else if (code === 0) reason = "ok";
    else reason = `worker exited with code ${code}`;
    s.lastExit = reason;
    if (reason !== "ok" && !s.error) s.error = reason;
    s.log.push(`worker ended: ${reason}`);
    s.running = false;
    s.finishedAt = Date.now();
    store.child = null;
    store.stopping = false;
  });
  return { ok: true };
}

export function stopJob(): { ok: boolean } {
  if (store.child && store.state.running) {
    store.stopping = true; // so the exit handler labels this a user stop, not a crash
    store.child.kill();
    store.state.log.push("stop requested by user…");
  }
  return { ok: true };
}
