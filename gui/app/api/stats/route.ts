import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [totals, bySource, runs, lifetime] = await Promise.all([
      pool.query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE approved)::int AS approved,
          count(*) FILTER (WHERE NOT approved)::int AS pending,
          count(*) FILTER (WHERE content_type='drama')::int AS drama,
          count(*) FILTER (WHERE content_type='tv')::int AS tv,
          count(*) FILTER (WHERE content_type='movie')::int AS movie,
          count(*) FILTER (WHERE country='KR')::int AS kr,
          count(*) FILTER (WHERE country='CN')::int AS cn
        FROM dramas`),
      pool.query(`SELECT source, count(*)::int AS n FROM dramas GROUP BY source ORDER BY n DESC`),
      pool.query(`
        SELECT id, started_at AS "startedAt", added, refreshed, found, ok
        FROM scrape_runs ORDER BY started_at DESC LIMIT 12`),
      // lifetime intake vs upkeep — drives the Added / Updated tiles
      pool.query(`
        SELECT coalesce(sum(added), 0)::int     AS "addedTotal",
               coalesce(sum(refreshed), 0)::int AS "updatedTotal"
        FROM scrape_runs WHERE ok`),
    ]);
    return NextResponse.json({
      ...totals.rows[0],
      ...lifetime.rows[0],
      bySource: bySource.rows,
      runs: runs.rows.reverse(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 503 }
    );
  }
}
