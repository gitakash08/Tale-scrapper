import { NextResponse } from "next/server";
import { getState } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = getState();
  const elapsed = s.startedAt ? (s.finishedAt ?? Date.now()) - s.startedAt : 0;
  const total = s.minutes * 60000;

  // A refresh has no duration — it's a bounded pass over N rows — so its
  // progress comes from rows completed, not elapsed time. Timed discovery runs
  // keep the original time-based maths.
  const countBased = s.totalUnits > 0;
  const progress = countBased
    ? Math.min(1, s.processed / s.totalUnits)
    : total
      ? Math.min(1, elapsed / total)
      : 0;

  return NextResponse.json({
    ...s,
    log: s.log.slice(-80),
    elapsedMs: elapsed,
    remainingMs: s.running && !countBased ? Math.max(0, total - elapsed) : 0,
    progress,
  });
}
