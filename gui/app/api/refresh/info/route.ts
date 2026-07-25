import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only summary for the Scraper page's "Ongoing titles" card — answers
 * "is a refresh worth running right now?" before you click it.
 */
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT
         count(*)::int                                   AS ongoing,
         count(episodes_aired)::int                      AS "withEpisodeData",
         count(next_episode_at)::int                     AS "withNextEpisode",
         max(status_checked_at)                          AS "lastCheckedAt",
         min(status_checked_at)                          AS "stalestCheckedAt",
         count(*) FILTER (WHERE status_checked_at IS NULL)::int AS "neverChecked"
       FROM dramas
       WHERE status IN ('airing', 'upcoming')`
    );
    return NextResponse.json(rows[0]);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
