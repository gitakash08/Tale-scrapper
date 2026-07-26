"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, RefreshCw, Plus, ArrowRight, Film, Tv, Clapperboard, Loader2, Inbox,
  X, Download, TrendingUp, TrendingDown, CalendarDays, SlidersHorizontal,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";

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
const FIELD_LABEL: Record<string, string> = { episodes: "Episodes", status: "Status", rating: "Rating" };

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
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** local YYYY-MM-DD — used for the CSV filename */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function ActivityView() {
  const [events, setEvents] = useState<Event[]>([]);
  const [counts, setCounts] = useState({ added: 0, updated: 0 });
  const [facets, setFacets] = useState<{ sources: string[]; types: string[] }>({ sources: [], types: [] });
  const [loading, setLoading] = useState(true);

  // filters
  const [kind, setKind] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");
  const [dates, setDates] = useState<Range>({ from: "", to: "" }); // empty = all time
  const [source, setSource] = useState("all");
  const [type, setType] = useState("all");
  const [field, setField] = useState("all");      // status | episodes | rating
  const [dir, setDir] = useState("all");          // up | down (rating/episodes)
  const [page, setPage] = useState(1);

  const { from, to } = dates;

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: "2000" });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const res = await fetch(`/api/activity?${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ events: [], counts: { added: 0, updated: 0 }, facets: { sources: [], types: [] } }));
    setEvents(res.events ?? []);
    setCounts(res.counts ?? { added: 0, updated: 0 });
    setFacets(res.facets ?? { sources: [], types: [] });
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [kind, q, source, type, field, dir, dates]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return events.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (source !== "all" && e.source !== source) return false;
      if (type !== "all" && e.contentType !== type) return false;
      if (field !== "all" && !(field in e.changes)) return false;
      if (dir !== "all") {
        // direction applies to the numeric fields; needs a numeric before/after
        const target = field !== "all" ? field : "rating";
        const pair = e.changes[target];
        if (!pair) return false;
        const a = num(pair[0]), b = num(pair[1]);
        if (a == null || b == null) return false;
        if (dir === "up" && !(b > a)) return false;
        if (dir === "down" && !(b < a)) return false;
      }
      if (needle && !e.title.toLowerCase().includes(needle) && !(e.source ?? "").toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [events, kind, q, source, type, field, dir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);

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

  const activeChips = [
    !!dates.from && { k: "range", label: `${dates.from} → ${dates.to}`, clear: () => setDates({ from: "", to: "" }) },
    kind !== "all" && { k: "kind", label: kind === "added" ? "Added" : "Updated", clear: () => setKind("all") },
    source !== "all" && { k: "source", label: `Source: ${source}`, clear: () => setSource("all") },
    type !== "all" && { k: "type", label: `Type: ${type}`, clear: () => setType("all") },
    field !== "all" && { k: "field", label: `Changed: ${FIELD_LABEL[field] ?? field}`, clear: () => setField("all") },
    dir !== "all" && { k: "dir", label: dir === "up" ? "Increased" : "Decreased", clear: () => setDir("all") },
    q.trim() && { k: "q", label: `“${q.trim()}”`, clear: () => setQ("") },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];

  const clearAll = () => {
    setDates({ from: "", to: "" }); setKind("all"); setSource("all"); setType("all");
    setField("all"); setDir("all"); setQ("");
  };

  /** Export exactly what's on screen (post-filter) as CSV. */
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Time", "Kind", "Title", "Source", "Type", "Field", "Before", "After", "Run"];
    const lines: string[] = [head.join(",")];
    for (const e of filtered) {
      const entries = Object.entries(e.changes);
      if (entries.length === 0) {
        lines.push([e.time, e.kind, e.title, e.source, e.contentType, "", "", "", e.runId].map(esc).join(","));
      } else {
        for (const [f, [a, b]] of entries) {
          lines.push([e.time, e.kind, e.title, e.source, e.contentType, FIELD_LABEL[f] ?? f, a, b, e.runId].map(esc).join(","));
        }
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `magneto-activity-${ymd(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Activity" subtitle="Every title added or updated — and exactly what changed.">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or source…"
            className="w-40 bg-transparent py-2 text-sm outline-none" />
        </div>
        <button onClick={exportCsv} disabled={filtered.length === 0} title="Export current view as CSV"
          className="tap-press grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40">
          <Download className="size-4" />
        </button>
        <button onClick={load} title="Refresh"
          className="tap-press grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
          {loading ? <Loader2 className="size-4 spin" /> : <RefreshCw className="size-4" />}
        </button>
      </PageHeader>

      {/* kind tabs */}
      <div className="mb-3 flex flex-wrap gap-1.5">
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

      {/* filter bar */}
      <div className="card mb-4 p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="size-3.5" /> When
        </div>
        <DateRangePicker value={dates} onChange={setDates} />

        <div className="my-3 h-px bg-border" />

        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <SlidersHorizontal className="size-3.5" /> Narrow by
        </div>
        <div className="flex flex-wrap gap-2">
          <Select label="Source" value={source} onChange={setSource}
            options={[["all", "Any source"], ...facets.sources.map((s) => [s, s] as [string, string])]} />
          <Select label="Type" value={type} onChange={setType}
            options={[["all", "Any type"], ...facets.types.map((t) => [t, t] as [string, string])]} />
          <Select label="Changed field" value={field} onChange={setField}
            options={[["all", "Any change"], ["episodes", "Episodes"], ["status", "Status"], ["rating", "Rating"]]} />
          {/* direction only makes sense on numeric change */}
          <div className="flex gap-1.5">
            {([["all", "Any"], ["up", "Increased"], ["down", "Decreased"]] as [string, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setDir(v)}
                className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  dir === v ? "bg-sky-400/15 text-sky-300" : "border border-border text-muted-foreground hover:text-foreground"
                }`}>
                {v === "up" && <TrendingUp className="size-3.5" />}
                {v === "down" && <TrendingDown className="size-3.5" />}
                {l}
              </button>
            ))}
          </div>
        </div>

        {activeChips.length > 0 && (
          <>
            <div className="my-3 h-px bg-border" />
            <div className="flex flex-wrap items-center gap-1.5">
              {activeChips.map((c) => (
                <span key={c.k} className="flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2.5 pr-1 text-[11px] text-primary">
                  {c.label}
                  <button onClick={c.clear} className="grid size-4 place-items-center rounded-full hover:bg-primary/20" aria-label="Remove filter">
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <button onClick={clearAll} className="ml-1 text-[11px] text-muted-foreground underline hover:text-foreground">Clear all</button>
            </div>
          </>
        )}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{filtered.length.toLocaleString()}</span> event
        {filtered.length === 1 ? "" : "s"}
        {events.length !== filtered.length && ` (of ${events.length.toLocaleString()} in range)`}
      </p>

      {filtered.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <Inbox className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">{loading ? "Loading activity…" : "Nothing matches these filters"}</p>
          {!loading && activeChips.length > 0 && (
            <button onClick={clearAll} className="mt-3 text-sm text-primary hover:underline">Clear all filters</button>
          )}
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
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                      e.kind === "added" ? "bg-primary/10 text-primary" : "bg-sky-400/10 text-sky-400"
                    }`}>
                      {e.kind === "added" ? <Plus className="size-4" /> : <RefreshCw className="size-4" />}
                    </span>

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

                    <div className="flex flex-wrap items-center gap-1.5">
                      {e.kind === "updated" && Object.entries(e.changes).map(([f, [fromV, toV]]) => {
                        const a = num(fromV), b = num(toV);
                        const rose = a != null && b != null && b > a;
                        const fell = a != null && b != null && b < a;
                        return (
                          <span key={f} className="flex items-center gap-1 rounded-md bg-ink-2 px-2 py-1 text-[11px]"
                            title={`${FIELD_LABEL[f] ?? f}: ${String(fromV)} → ${String(toV)}`}>
                            <span className="text-muted-foreground">{FIELD_LABEL[f] ?? f}</span>
                            <span className="text-muted-foreground line-through">{String(fromV)}</span>
                            {rose ? <TrendingUp className="size-3 text-emerald-400" />
                              : fell ? <TrendingDown className="size-3 text-amber-300" />
                              : <ArrowRight className="size-3 text-sky-400" />}
                            <span className="font-semibold text-sky-300">{String(toV)}</span>
                          </span>
                        );
                      })}
                      {e.kind === "added" && (
                        <>
                          {e.meta?.comingSoon ? (
                            <span className="rounded-md bg-amber-400/15 px-2 py-1 text-[11px] text-amber-300">Coming soon</span>
                          ) : null}
                          {e.meta?.rating ? (
                            <span className="rounded-md bg-ink-2 px-2 py-1 text-[11px] tabular-nums">★ {String(e.meta.rating)}</span>
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

/** Compact labelled select that matches the app's input styling. */
function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-ink-2 px-3 py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-transparent py-0.5 text-xs capitalize outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
