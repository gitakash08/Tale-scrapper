import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 24));
  try {
    const { rows } = await pool.query(
      `SELECT slug, title, original_title AS "originalTitle", year, country,
              rating::float AS rating, content_type AS "contentType", source,
              synopsis, array_to_string(genres, ', ') AS genres
       FROM dramas WHERE NOT approved
       ORDER BY rating DESC, created_at DESC LIMIT $1`,
      [limit]
    );
    return NextResponse.json({ pending: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 503 }
    );
  }
}
