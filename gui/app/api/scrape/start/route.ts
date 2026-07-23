import { NextResponse } from "next/server";
import { startJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { minutes } = await req.json().catch(() => ({ minutes: 0 }));
  const n = Math.max(1, Math.min(180, Math.round(Number(minutes) || 0)));
  const r = startJob(n);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
