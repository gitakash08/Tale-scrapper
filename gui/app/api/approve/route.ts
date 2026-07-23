import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body shapes:
 *   { slug, action: "approve" | "reject" }            single card
 *   { action: "approve", scope: "all" }               approve every pending
 *   { action: "approve", scope: "rating", min: 8.5 }  approve pending >= min
 *   { action: "approve", scope: "selected", slugs }   approve a checked set
 *   { action: "reject",  slug }                        delete one pending
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const action = b.action;
  try {
    if (action === "reject" && b.slug) {
      await pool.query("DELETE FROM dramas WHERE slug = $1 AND NOT approved", [b.slug]);
      return NextResponse.json({ ok: true, affected: 1 });
    }
    if (action === "approve") {
      let sql = "UPDATE dramas SET approved = TRUE, updated_at = now() WHERE NOT approved";
      const params: unknown[] = [];
      if (b.slug) {
        sql += " AND slug = $1";
        params.push(b.slug);
      } else if (b.scope === "rating" && typeof b.min === "number") {
        sql += " AND rating >= $1";
        params.push(b.min);
      } else if (b.scope === "selected" && Array.isArray(b.slugs) && b.slugs.length) {
        sql += " AND slug = ANY($1)";
        params.push(b.slugs);
      } else if (b.scope !== "all") {
        return NextResponse.json({ error: "bad request" }, { status: 400 });
      }
      const { rowCount } = await pool.query(sql, params);
      return NextResponse.json({ ok: true, affected: rowCount });
    }
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
