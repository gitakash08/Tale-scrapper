import { NextResponse } from "next/server";
import { startJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // job defaults to discovery, so an existing {minutes} body behaves as before
  const job = body?.job === "refresh" ? "refresh" : "discovery";
  const n = Math.max(1, Math.min(180, Math.round(Number(body?.minutes) || 0)));
  const r = startJob(job === "refresh" ? 0 : n, { job });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
