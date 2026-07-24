import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { masterEnabled, setMasterEnabled } from "@/lib/scheduler";
import { getState } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Master scheduler switch + a snapshot of what it's doing. */
export async function GET() {
  try {
    const enabled = await masterEnabled();
    const s = getState();
    const { rows } = await pool.query(
      `SELECT name, next_run_at AS "nextRunAt"
         FROM scrape_schedules
        WHERE enabled AND next_run_at IS NOT NULL
        ORDER BY next_run_at ASC LIMIT 1`
    );
    return NextResponse.json({
      enabled,
      running: s.running,
      trigger: s.trigger,
      next: rows[0] ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const { enabled } = await req.json().catch(() => ({}));
  try {
    await setMasterEnabled(!!enabled);
    return NextResponse.json({ ok: true, enabled: !!enabled });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
