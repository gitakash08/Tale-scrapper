import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, kind, base_url AS "baseUrl", enabled, builtin,
              last_sync AS "lastSync"
       FROM scrape_sources ORDER BY builtin DESC, id`
    );
    return NextResponse.json({ sources: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = (b.name ?? "").trim();
  const baseUrl = (b.baseUrl ?? "").trim();
  const kind = ["api", "sitemap", "manual", "file"].includes(b.kind) ? b.kind : "sitemap";
  if (!name || !baseUrl) {
    return NextResponse.json({ error: "name and baseUrl are required" }, { status: 400 });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO scrape_sources (name, kind, base_url) VALUES ($1,$2,$3)
       RETURNING id, name, kind, base_url AS "baseUrl", enabled, builtin`,
      [name, kind, baseUrl]
    );
    return NextResponse.json({ source: rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const { id, enabled } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await pool.query("UPDATE scrape_sources SET enabled = $1 WHERE id = $2", [!!enabled, id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // built-in tuned connectors can't be deleted
  const { rowCount } = await pool.query(
    "DELETE FROM scrape_sources WHERE id = $1 AND NOT builtin",
    [id]
  );
  return NextResponse.json({ ok: rowCount! > 0 });
}
