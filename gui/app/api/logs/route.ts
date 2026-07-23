import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Derive a log feed from scrape_runs (each run -> a few log lines). */
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, started_at AS "startedAt", finished_at AS "finishedAt",
              ok, found, added, refreshed, skipped, error
       FROM scrape_runs ORDER BY started_at DESC LIMIT 40`
    );
    const logs: {
      time: string; level: "INFO" | "WARN" | "ERROR"; source: string; message: string; detail: string;
    }[] = [];
    for (const r of rows) {
      const runId = `Run #${r.id}`;
      if (r.error) {
        logs.push({ time: r.startedAt, level: "ERROR", source: "Scraper", message: r.error, detail: runId });
      } else {
        logs.push({ time: r.finishedAt ?? r.startedAt, level: "INFO", source: "Scraper",
          message: `Run completed — ${r.added} added, ${r.found} found`, detail: runId });
        if (r.added > 0)
          logs.push({ time: r.finishedAt ?? r.startedAt, level: "INFO", source: "Catalog",
            message: `${r.added} items added to catalog`, detail: runId });
        if (r.skipped > 0)
          logs.push({ time: r.finishedAt ?? r.startedAt, level: "WARN", source: "Validator",
            message: `${r.skipped} items skipped by the quality gate`, detail: runId });
      }
    }
    logs.sort((a, b) => (a.time < b.time ? 1 : -1));
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
