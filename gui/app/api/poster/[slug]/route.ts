import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve a poster's bytes straight from Postgres (BYTEA). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const { rows } = await pool.query(
      "SELECT mime, data FROM posters WHERE slug = $1",
      [slug]
    );
    if (rows.length === 0) return new Response("not found", { status: 404 });
    return new Response(rows[0].data, {
      headers: {
        "Content-Type": rows[0].mime ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("error", { status: 503 });
  }
}
