import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runUpdateCheck } from "@/lib/updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 60 * 60 * 1000; // manual "Check now" no more than once an hour

type Snapshot = {
  checkedAt: string;
  hasNew: boolean;
  sources: { src: string; name: string; status: "new" | "same" | "unknown" }[];
};

async function readSnapshot(): Promise<Snapshot | null> {
  const { rows } = await pool.query("SELECT value FROM scrape_cursors WHERE key = 'updates:snapshot'");
  if (!rows[0]?.value) return null;
  try {
    return JSON.parse(rows[0].value) as Snapshot;
  } catch {
    return null;
  }
}

/**
 * "What's new since our last scrape." Reads the cached snapshot; re-probes at
 * most once per 24h automatically, or on ?refresh=1 with a 1-hour cooldown.
 * Probing spawns the worker's read-only check (no scraping, no lock).
 */
export async function GET(req: Request) {
  try {
    const forced = new URL(req.url).searchParams.get("refresh") === "1";
    let snap = await readSnapshot();
    const ageMs = snap ? Date.now() - Date.parse(snap.checkedAt) : Infinity;

    const dueDaily = ageMs > DAY_MS; // auto: once a day
    const dueManual = forced && ageMs > COOLDOWN_MS; // manual: 1h cooldown
    if (dueDaily || dueManual) {
      await runUpdateCheck();
      snap = await readSnapshot();
    }

    return NextResponse.json({
      checkedAt: snap?.checkedAt ?? null,
      hasNew: snap?.hasNew ?? false,
      sources: snap?.sources ?? [],
      newCount: (snap?.sources ?? []).filter((s) => s.status === "new").length,
      // tell the client whether a manual refresh would actually re-probe yet
      cooldownUntil: snap ? new Date(Date.parse(snap.checkedAt) + COOLDOWN_MS).toISOString() : null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
