"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, Plus, ArrowRight, Loader2,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";

const PAGE_SIZE = 10;

type Log = {
  time: string; level: "INFO" | "WARN" | "ERROR"; source: string; message: string; detail: string;
  runId?: string; added?: number; updated?: number;
};
type Event = {
  kind: "added" | "updated"; title: string; source: string | null;
  changes: Record<string, [unknown, unknown]>; meta: Record<string, unknown>;
};
const FIELD_LABEL: Record<string, string> = { episodes: "Episodes", status: "Status", rating: "Rating" };
const LEVEL: Record<string, string> = {
  INFO: "bg-emerald-400/15 text-emerald-300",
  WARN: "bg-amber-400/15 text-amber-300",
  ERROR: "bg-primary/15 text-rose-light",
};

export default function LogsView() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("ALL");
  const [page, setPage] = useState(1);

  // per-run drill-down: runId -> change events (lazy-loaded on expand)
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<Record<string, Event[] | "loading">>({});

  const load = () => fetch("/api/logs", { cache: "no-store" }).then((r) => r.json()).then((d) => setLogs(d.logs ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function toggleRun(runId?: string) {
    if (!runId) return;
    if (openRun === runId) { setOpenRun(null); return; }
    setOpenRun(runId);
    if (runEvents[runId]) return; // already fetched
    setRunEvents((p) => ({ ...p, [runId]: "loading" }));
    const res = await fetch(`/api/activity?runId=${runId}&limit=500`, { cache: "no-store" })
      .then((r) => r.json()).catch(() => ({ events: [] }));
    setRunEvents((p) => ({ ...p, [runId]: res.events ?? [] }));
  }

  const filtered = useMemo(() =>
    logs.filter((l) => (level === "ALL" || l.level === level) && (!q || (l.message + l.source).toLowerCase().includes(q.toLowerCase()))),
    [logs, q, level]);

  // reset to page 1 whenever the filter/search changes
  useEffect(() => { setPage(1); }, [q, level]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, filtered.length);

  return (
    <div>
      <PageHeader title="Logs" subtitle="System activity and run history.">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" className="w-40 bg-transparent py-2 text-sm outline-none" />
        </div>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none">
          {["ALL", "INFO", "WARN", "ERROR"].map((l) => <option key={l} value={l}>{l === "ALL" ? "All levels" : l}</option>)}
        </select>
        <button onClick={load} className="tap-press grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"><RefreshCw className="size-4" /></button>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[160px_70px_100px_1fr_100px] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Time</span><span>Level</span><span>Source</span><span>Message</span><span>Details</span>
        </div>
        {shown.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No logs match.</p>}
        {shown.map((l, i) => {
          const drillable = !!l.runId && ((l.added ?? 0) + (l.updated ?? 0) > 0);
          const isOpen = openRun === l.runId;
          const evs = l.runId ? runEvents[l.runId] : undefined;
          return (
            <div key={i} className="border-b border-border/60 last:border-0">
              <div
                onClick={() => drillable && toggleRun(l.runId)}
                className={`grid grid-cols-[160px_70px_100px_1fr_100px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.02] ${drillable ? "cursor-pointer" : ""}`}
              >
                <span className="text-xs text-muted-foreground">{new Date(l.time).toLocaleString()}</span>
                <span><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${LEVEL[l.level]}`}>{l.level}</span></span>
                <span className="text-muted-foreground">{l.source}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {drillable && (
                    <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
                  )}
                  <span className="truncate">{l.message}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">{l.detail}</span>
              </div>

              {/* drill-down: what actually changed in this run */}
              {isOpen && (
                <div className="border-t border-border/60 bg-ink-2/60 px-4 py-3">
                  {evs === "loading" || evs === undefined ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 spin" /> Loading changes…</p>
                  ) : evs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No per-title detail recorded for this run.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {evs.slice(0, 60).map((e, j) => (
                        <div key={j} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={`grid size-5 shrink-0 place-items-center rounded ${
                            e.kind === "added" ? "bg-primary/15 text-primary" : "bg-sky-400/15 text-sky-400"
                          }`}>
                            {e.kind === "added" ? <Plus className="size-3" /> : <RefreshCw className="size-3" />}
                          </span>
                          <span className="min-w-0 max-w-[40%] truncate font-medium">{e.title}</span>
                          {e.source && <span className="capitalize text-muted-foreground">{e.source}</span>}
                          {Object.entries(e.changes).map(([f, [from, to]]) => (
                            <span key={f} className="flex items-center gap-1 rounded bg-card px-1.5 py-0.5">
                              <span className="text-muted-foreground">{FIELD_LABEL[f] ?? f}</span>
                              <span className="text-muted-foreground line-through">{String(from)}</span>
                              <ArrowRight className="size-2.5 text-sky-400" />
                              <span className="font-semibold text-sky-300">{String(to)}</span>
                            </span>
                          ))}
                          {e.kind === "added" && e.meta?.country ? (
                            <span className="text-muted-foreground">{String(e.meta.country)}</span>
                          ) : null}
                        </div>
                      ))}
                      {evs.length > 60 && (
                        <p className="pt-1 text-[11px] text-muted-foreground">+{evs.length - 60} more — see the Activity page.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Showing <span className="text-foreground">{from}</span>–<span className="text-foreground">{to}</span> of{" "}
              <span className="text-foreground">{filtered.length}</span> logs
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current <= 1}
                className="tap-press grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-2 tabular-nums text-muted-foreground">{current} / {pages}</span>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={current >= pages}
                className="tap-press grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
