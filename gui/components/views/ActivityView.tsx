"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, RefreshCw, Plus, ArrowRight, Film, Tv, Clapperboard, Loader2, Inbox,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";

type Kind = "added" | "updated";
type Event = {
  runId: string; time: string; kind: Kind;
  slug: string | null; title: string; source: string | null; contentType: string | null;
  changes: Record<string, [unknown, unknown]>;
  meta: Record<string, unknown>;
};

const PAGE = 25;
const TYPE_ICON: Record<string, React.ReactNode> = {
  drama: <Film className="size-3.5" />,
  tv: <Tv className="size-3.5" />,
  movie: <Clapperboard className="size-3.5" />,
};

/** "2h ago" / "just now" — compact and locale-independent. */
function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const FIELD_LABEL: Record<string, string> = {
  episodes: "Episodes", status: "Status", rating: "Rating",
};

export default function ActivityView() {
  const [events, setEvents] = useState<Event[]>([]);
  const [counts, setCounts] = useState({ added: 0, updated: 0 });
  const [kind, setKind] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/activity?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ events: [], counts: { added: 0, updated: 0 } }));
    setEvents(res.events ?? []);
    setCounts(res.counts ?? { added: 0, updated: 0 });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [kind, q]);

  // filter client-side so tab/search switching is instant
  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return events.filter(
      (e) =>
        (kind === "all" || e.kind === kind) &&
        (!needle ||
          e.title.toLowerCase().includes(needle) ||
          (e.source ?? "").toLowerCase().includes(needle))
    );
  }, [events, kind, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);

  // group by day for a scannable timeline
  const groups = useMemo(() => {
    const out: { day: string; items: Event[] }[] = [];
    for (const e of shown) {
      const day = new Date(e.time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [shown]);

  return (
    <div>
      <PageHeader title="Activity" subtitle="Every title added or updated — and exactly what changed.">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or source…"
            className="w-44 bg-transparent py-2 text-sm outline-none" />
        </div>
        <button onClick={load} title="Refresh"
          className="tap-press grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
          {loading ? <Loader2 className="size-4 spin" /> : <RefreshCw className="size-4" />}
        </button>
      </PageHeader>

      {/* type tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([
          { id: "all" as const, label: "All", n: counts.added + counts.updated },
          { id: "added" as const, label: "Added", n: counts.added },
          { id: "updated" as const, label: "Updated", n: counts.updated },
        ]).map((t) => (
          <button key={t.id} onClick={() => setKind(t.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              kind === t.id ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"
            }`}>
            {t.label}
            <span className={`rounded px-1.5 text-[11px] tabular-nums ${kind === t.id ? "bg-black/20" : "bg-ink-2"}`}>{t.n}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <Inbox className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">{loading ? "Loading activity…" : "No activity yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "" : "Run a scrape — additions and updates will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.day}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.day}</p>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {g.items.map((e, i) => (
                  <div key={`${e.runId}-${e.title}-${i}`}
                    className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0 hover:bg-white/[0.02]">
                    {/* kind badge */}
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                      e.kind === "added" ? "bg-primary/10 text-primary" : "bg-sky-400/10 text-sky-400"
                    }`}>
                      {e.kind === "added" ? <Plus className="size-4" /> : <RefreshCw className="size-4" />}
                    </span>

                    {/* title + context */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{e.title}</p>
                        {e.contentType && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                            {TYPE_ICON[e.contentType]}{e.contentType}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {e.source && <span className="capitalize">{e.source}</span>}
                        {e.meta?.country ? ` · ${e.meta.country}` : ""}
                        {e.meta?.year ? ` · ${e.meta.year}` : ""}
                        {` · run #${e.runId}`}
                      </p>
                    </div>

                    {/* the diff — the point of this screen */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {e.kind === "updated" && Object.entries(e.changes).map(([field, [from, to]]) => (
                        <span key={field}
                          className="flex items-center gap-1 rounded-md bg-ink-2 px-2 py-1 text-[11px]"
                          title={`${FIELD_LABEL[field] ?? field}: ${String(from)} → ${String(to)}`}>
                          <span className="text-muted-foreground">{FIELD_LABEL[field] ?? field}</span>
                          <span className="text-muted-foreground line-through">{String(from)}</span>
                          <ArrowRight className="size-3 text-sky-400" />
                          <span className="font-semibold text-sky-300">{String(to)}</span>
                        </span>
                      ))}
                      {e.kind === "added" && (
                        <>
                          {e.meta?.comingSoon ? (
                            <span className="rounded-md bg-amber-400/15 px-2 py-1 text-[11px] text-amber-300">Coming soon</span>
                          ) : null}
                          {e.meta?.rating ? (
                            <span className="rounded-md bg-ink-2 px-2 py-1 text-[11px] tabular-nums">★ {String(e.meta.rating)}</span>
                          ) : null}
                          {e.meta?.ratingDefaulted ? (
                            <span className="rounded-md bg-ink-2 px-2 py-1 text-[11px] text-muted-foreground">rating defaulted</span>
                          ) : null}
                        </>
                      )}
                    </div>

                    <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{ago(e.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* pager */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing <span className="text-foreground">{(current - 1) * PAGE + 1}</span>–
              <span className="text-foreground">{Math.min(current * PAGE, filtered.length)}</span> of{" "}
              <span className="text-foreground">{filtered.length}</span>
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current <= 1}
                className="tap-press rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">
                Previous
              </button>
              <span className="px-2 tabular-nums text-muted-foreground">{current} / {pages}</span>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={current >= pages}
                className="tap-press rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
