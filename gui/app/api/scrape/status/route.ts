import { NextResponse } from "next/server";
import { getState } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = getState();
  const elapsed = s.startedAt ? (s.finishedAt ?? Date.now()) - s.startedAt : 0;
  const total = s.minutes * 60000;
  return NextResponse.json({
    ...s,
    log: s.log.slice(-80),
    elapsedMs: elapsed,
    remainingMs: s.running ? Math.max(0, total - elapsed) : 0,
    progress: total ? Math.min(1, elapsed / total) : 0,
  });
}
