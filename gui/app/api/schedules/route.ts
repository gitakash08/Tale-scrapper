import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  computeNextRun,
  isValidSchedule,
  type ScheduleConfig,
  type ScheduleKind,
} from "@/lib/schedule-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ScheduleKind[] = ["interval", "daily", "weekly", "cron"];
const clampDuration = (v: unknown) => Math.max(0, Math.min(180, Math.round(Number(v) || 0)));

const SELECT = `SELECT id, name, enabled, kind, config,
       duration_min AS "durationMin",
       last_run_at  AS "lastRunAt",
       next_run_at  AS "nextRunAt"
  FROM scrape_schedules ORDER BY created_at`;

export async function GET() {
  try {
    const { rows } = await pool.query(SELECT);
    return NextResponse.json({ schedules: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  const kind: ScheduleKind = KINDS.includes(b.kind) ? b.kind : "daily";
  const config: ScheduleConfig = b.config ?? {};
  const durationMin = clampDuration(b.durationMin);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!isValidSchedule(kind, config))
    return NextResponse.json({ error: "schedule never fires — check its timing" }, { status: 400 });
  const next = computeNextRun(kind, config, new Date());
  try {
    const { rows } = await pool.query(
      `INSERT INTO scrape_schedules (name, kind, config, duration_min, next_run_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, kind, JSON.stringify(config), durationMin, next]
    );
    return NextResponse.json({ id: rows[0].id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const { rows } = await pool.query(
      "SELECT kind, config, enabled FROM scrape_schedules WHERE id = $1",
      [id]
    );
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });

    const kind: ScheduleKind = KINDS.includes(b.kind) ? b.kind : rows[0].kind;
    const config: ScheduleConfig = b.config ?? rows[0].config;
    const enabled = b.enabled ?? rows[0].enabled;
    // Recompute next when the timing (or enabled state) changes.
    if (!isValidSchedule(kind, config))
      return NextResponse.json({ error: "schedule never fires — check its timing" }, { status: 400 });
    const next = computeNextRun(kind, config, new Date());

    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.name !== undefined) set("name", String(b.name).trim());
    if (b.kind !== undefined) set("kind", kind);
    if (b.config !== undefined) set("config", JSON.stringify(config));
    if (b.durationMin !== undefined) set("duration_min", clampDuration(b.durationMin));
    if (b.enabled !== undefined) set("enabled", !!enabled);
    set("next_run_at", next);
    vals.push(id);
    await pool.query(`UPDATE scrape_schedules SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await pool.query("DELETE FROM scrape_schedules WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}
