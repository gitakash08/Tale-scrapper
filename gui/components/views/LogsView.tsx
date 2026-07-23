"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 12;

type Log = { time: string; level: "INFO" | "WARN" | "ERROR"; source: string; message: string; detail: string };
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

  const load = () => fetch("/api/logs", { cache: "no-store" }).then((r) => r.json()).then((d) => setLogs(d.logs ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

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
      <header className="mb-6 flex items-end justify-between gap-4">
        <div><h1 className="font-display text-2xl font-semibold">Logs</h1><p className="text-sm text-muted-foreground">System activity and run history.</p></div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
            <Search className="size-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" className="w-40 bg-transparent py-2 text-sm outline-none" />
          </div>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none">
            {["ALL", "INFO", "WARN", "ERROR"].map((l) => <option key={l} value={l}>{l === "ALL" ? "All levels" : l}</option>)}
          </select>
          <button onClick={load} className="tap-press grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"><RefreshCw className="size-4" /></button>
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[160px_70px_100px_1fr_100px] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Time</span><span>Level</span><span>Source</span><span>Message</span><span>Details</span>
        </div>
        {shown.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No logs match.</p>}
        {shown.map((l, i) => (
          <div key={i} className="grid grid-cols-[160px_70px_100px_1fr_100px] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-sm last:border-0 hover:bg-white/[0.02]">
            <span className="text-xs text-muted-foreground">{new Date(l.time).toLocaleString()}</span>
            <span><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${LEVEL[l.level]}`}>{l.level}</span></span>
            <span className="text-muted-foreground">{l.source}</span>
            <span className="truncate">{l.message}</span>
            <span className="truncate text-xs text-muted-foreground">{l.detail}</span>
          </div>
        ))}

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
