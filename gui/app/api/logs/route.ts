import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Derive a log feed from scrape_runs (each run -> a few log lines). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Optional inclusive local-date window supplied by the range picker.
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  try {
    const { rows } = await pool.query(
      `SELECT id, started_at AS "startedAt", finished_at AS "finishedAt",
              ok, found, added, refreshed, skipped, error, details
       FROM scrape_runs
       WHERE ($1::date IS NULL OR started_at >= $1::date)
         AND ($2::date IS NULL OR started_at < ($2::date + INTERVAL '1 day'))
       ORDER BY started_at DESC LIMIT $3`,
      [from, to, from || to ? 500 : 60]
    );
    const logs: {
      time: string; level: "INFO" | "WARN" | "ERROR"; source: string; message: string;
      detail: string; runId?: string; added?: number; updated?: number;
    }[] = [];
    for (const r of rows) {
      const runId = `Run #${r.id}`;
      const when = r.finishedAt ?? r.startedAt;
      const interrupted = typeof r.error === "string" && /interrupted/i.test(r.error);
      if (r.details?.skippedNoChange) {
        // change-detection skip — a scheduled run that found nothing new
        logs.push({ time: when, level: "INFO", source: "Scheduler",
          message: "No new data — run skipped", detail: runId });
      } else if (r.error) {
        // interrupted (restart/termination) reads as a warning; real errors as errors
        logs.push({ time: when, level: interrupted ? "WARN" : "ERROR",
          source: interrupted ? "Worker" : "Scraper", message: r.error, detail: runId });
      } else {
        // headline row carries the counts so the UI can offer a drill-down
        logs.push({
          time: when, level: "INFO", source: "Scraper",
          message: `Run completed — ${r.added} added, ${r.refreshed} updated`,
          detail: runId, runId: String(r.id), added: r.added, updated: r.refreshed,
        });
        if (r.skipped > 0)
          logs.push({ time: when, level: "WARN", source: "Validator",
            message: `${r.skipped} items skipped by the quality gate`, detail: runId });
      }
    }
    logs.sort((a, b) => (a.time < b.time ? 1 : -1));
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
