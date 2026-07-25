import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flattens scrape_runs.details into a single timeline of change events, so the
 * UI can show "what changed, when" across runs without re-deriving anything.
 *
 * Handles BOTH shapes: new runs store structured records ({slug,title,changes}),
 * older runs stored pre-formatted strings — those are parsed best-effort so
 * history stays visible instead of disappearing.
 */
export type ChangeKind = "added" | "updated";

type Event = {
  runId: string;
  time: string;
  kind: ChangeKind;
  slug: string | null;
  title: string;
  source: string | null;
  contentType: string | null;
  /** field -> [before, after] */
  changes: Record<string, [unknown, unknown]>;
  /** extra context for added rows (country/year/defaulted rating) */
  meta: Record<string, unknown>;
};

/** "Knowing Bros [mdl]: 547→600ep, 7.7→7.4★" -> structured-ish event */
function parseLegacyRefreshed(s: string) {
  const m = /^(.*?)\s*(?:\[([^\]]+)\])?\s*:\s*(.*)$/.exec(s);
  const title = (m?.[1] ?? s).trim();
  const source = m?.[2] ?? null;
  const changes: Record<string, [unknown, unknown]> = {};
  for (const part of (m?.[3] ?? "").split(",")) {
    const p = part.trim();
    // 547→600ep | 7.7→7.4★ | airing→completed
    const d = /^(.+?)→(.+?)(ep|★)?$/.exec(p);
    if (!d) continue;
    const [, a, b, unit] = d;
    const field = unit === "ep" ? "episodes" : unit === "★" ? "rating" : "status";
    changes[field] = [a.trim(), b.trim()];
  }
  return { title, source, changes };
}

/** "Title (원제) [KR/drama] via mdl — Coming Soon" -> structured-ish event */
function parseLegacyAdded(s: string) {
  const title = (/^(.*?)\s*(?:\(|\[|via |—|$)/.exec(s)?.[1] ?? s).trim();
  const source = /via\s+([a-z:0-9]+)/i.exec(s)?.[1] ?? null;
  const ct = /\[([A-Z]{2})\/([a-z]+)\]/.exec(s);
  return {
    title,
    source,
    meta: {
      country: ct?.[1] ?? null,
      ratingDefaulted: /rating defaulted/i.test(s),
      comingSoon: /Coming Soon/i.test(s),
    },
    contentType: ct?.[2] ?? null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind"); // added | updated | null(all)
  const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
  const limit = Math.min(Number(url.searchParams.get("limit")) || 300, 5000);
  const runId = url.searchParams.get("runId"); // drill-down for one run
  // Date window is applied in SQL so a calendar range can reach runs far older
  // than the default page of recent runs.
  const from = url.searchParams.get("from"); // inclusive YYYY-MM-DD (local)
  const to = url.searchParams.get("to");     // inclusive YYYY-MM-DD (local)

  try {
    const { rows } = await pool.query(
      `SELECT id, started_at AS "startedAt", finished_at AS "finishedAt", details
         FROM scrape_runs
        WHERE ($1::bigint IS NULL OR id = $1::bigint)
          AND ($2::date IS NULL OR started_at >= $2::date)
          AND ($3::date IS NULL OR started_at < ($3::date + INTERVAL '1 day'))
        ORDER BY started_at DESC
        LIMIT $4`,
      [runId, from || null, to || null, runId || from || to ? 2000 : 200]
    );

    const events: Event[] = [];
    for (const r of rows) {
      const time = r.finishedAt ?? r.startedAt;
      const base = { runId: String(r.id), time };

      for (const raw of r.details?.added ?? []) {
        if (typeof raw === "string") {
          const p = parseLegacyAdded(raw);
          events.push({
            ...base, kind: "added", slug: null, title: p.title, source: p.source,
            contentType: p.contentType, changes: {}, meta: p.meta,
          });
        } else {
          events.push({
            ...base, kind: "added", slug: raw.slug ?? null, title: raw.title ?? "(untitled)",
            source: raw.source ?? null, contentType: raw.contentType ?? null, changes: {},
            meta: {
              country: raw.country ?? null, year: raw.year ?? null,
              rating: raw.rating ?? null, ratingDefaulted: !!raw.ratingDefaulted,
              episodes: raw.episodes ?? null, originalTitle: raw.originalTitle ?? null,
              comingSoon: raw.status === "upcoming",
            },
          });
        }
      }

      for (const raw of r.details?.refreshed ?? []) {
        if (typeof raw === "string") {
          const p = parseLegacyRefreshed(raw);
          events.push({
            ...base, kind: "updated", slug: null, title: p.title, source: p.source,
            contentType: null, changes: p.changes, meta: {},
          });
        } else {
          events.push({
            ...base, kind: "updated", slug: raw.slug ?? null, title: raw.title ?? "(untitled)",
            source: raw.source ?? null, contentType: raw.contentType ?? null,
            changes: raw.changes ?? {}, meta: {},
          });
        }
      }
    }

    const filtered = events
      .filter((e) => (!kind || e.kind === kind))
      .filter((e) => !q || e.title.toLowerCase().includes(q) || (e.source ?? "").toLowerCase().includes(q))
      .slice(0, limit);

    // facet values present in this window, so the UI only offers real options
    const sources = [...new Set(events.map((e) => e.source).filter(Boolean))].sort() as string[];
    const types = [...new Set(events.map((e) => e.contentType).filter(Boolean))].sort() as string[];

    return NextResponse.json({
      events: filtered,
      counts: {
        added: events.filter((e) => e.kind === "added").length,
        updated: events.filter((e) => e.kind === "updated").length,
      },
      facets: { sources, types },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 503 });
  }
}
