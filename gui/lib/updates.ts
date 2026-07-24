import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Spawns the worker's read-only `check-updates` probe (same clean-separation
 * approach as jobs.ts — the GUI never imports worker internals). An in-flight
 * guard on globalThis coalesces concurrent callers onto one probe.
 */
const REPO = path.resolve(process.cwd(), "..");
const WORKER = path.join(REPO, "src", "worker.js");

const g = globalThis as unknown as { _rtsUpdateCheck?: Promise<void> | null };

export function runUpdateCheck(): Promise<void> {
  if (g._rtsUpdateCheck) return g._rtsUpdateCheck;
  const p = new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [WORKER, "check-updates"], { cwd: REPO, env: process.env });
    const done = () => resolve();
    child.on("exit", done);
    child.on("error", done);
  }).finally(() => {
    g._rtsUpdateCheck = null;
  });
  g._rtsUpdateCheck = p;
  return p;
}
