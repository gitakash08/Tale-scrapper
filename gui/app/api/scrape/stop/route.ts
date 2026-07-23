import { NextResponse } from "next/server";
import { stopJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(stopJob());
}
