import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** { slug, action: "approve" | "reject" }. Reject deletes the pending row. */
export async function POST(req: Request) {
  const { slug, action } = await req.json().catch(() => ({}));
  if (!slug || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    if (action === "approve") {
      await pool.query(
        "UPDATE dramas SET approved = TRUE, updated_at = now() WHERE slug = $1 AND NOT approved",
        [slug]
      );
    } else {
      // posters row cascades on delete
      await pool.query("DELETE FROM dramas WHERE slug = $1 AND NOT approved", [slug]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 503 }
    );
  }
}
