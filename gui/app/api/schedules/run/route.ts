import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { fireSchedule } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Run a schedule immediately (ignores enabled/next_run_at), then roll it forward. */
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, kind, config, duration_min, last_run_at
         FROM scrape_schedules WHERE id = $1`,
      [id]
    );
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    const r = await fireSchedule(rows[0], { force: true });
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
