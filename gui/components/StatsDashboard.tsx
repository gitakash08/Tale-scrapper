"use client";

import { useEffect, useRef, useState } from "react";
import { Film, Tv, Clapperboard, Clock3, Layers } from "lucide-react";

type Stats = {
  total: number; approved: number; pending: number;
  drama: number; tv: number; movie: number; kr: number; cn: number;
  bySource: { source: string; n: number }[];
  runs: { id: number; added: number; ok: boolean }[];
};

/** Count-up animation for the big numbers. */
function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(Math.round(a + (target - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    // Fallback: rAF is suspended in a backgrounded/undisplayed tab — guarantee
    // the number still lands on its final value.
    const settle = setTimeout(() => { setV(target); from.current = target; }, ms + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, [target, ms]);
  return v;
}

export default function StatsDashboard({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => {});
  }, [refreshKey]);

  const total = useCountUp(s?.total ?? 0);
  const pending = useCountUp(s?.pending ?? 0);

  const seg = [
    { label: "Dramas", v: s?.drama ?? 0, cls: "bg-rose", icon: <Film className="size-4" /> },
    { label: "TV shows", v: s?.tv ?? 0, cls: "bg-amber-400", icon: <Tv className="size-4" /> },
    { label: "Movies", v: s?.movie ?? 0, cls: "bg-emerald-400", icon: <Clapperboard className="size-4" /> },
  ];
  const sum = seg.reduce((a, b) => a + b.v, 0) || 1;
  const maxRun = Math.max(1, ...(s?.runs ?? []).map((r) => r.added));

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <BigStat icon={<Layers className="size-5" />} label="Total in catalog" value={total} />
      <BigStat icon={<Clock3 className="size-5" />} label="Pending approval" value={pending} accent />
      {/* content-type breakdown */}
      <div className="rounded-xl border border-border bg-card p-4 md:col-span-2">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Content mix</p>
        <div className="flex h-3 overflow-hidden rounded-full">
          {seg.map((x) => (
            <div key={x.label} className={x.cls} style={{ width: `${(x.v / sum) * 100}%` }} title={`${x.label}: ${x.v}`} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {seg.map((x) => (
            <div key={x.label} className="flex items-center gap-1.5 text-sm">
              <span className={`inline-block size-2.5 rounded-full ${x.cls}`} />
              <span className="text-muted-foreground">{x.label}</span>
              <span className="font-semibold tabular-nums">{x.v}</span>
            </div>
          ))}
          <div className="ml-auto text-sm text-muted-foreground">
            🇰🇷 {s?.kr ?? 0} · 🇨🇳 {s?.cn ?? 0}
          </div>
        </div>
      </div>

      {/* by source */}
      <div className="rounded-xl border border-border bg-card p-4 md:col-span-2">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">By source</p>
        <div className="space-y-2">
          {(s?.bySource ?? []).map((row) => {
            const top = Math.max(1, ...(s?.bySource ?? []).map((r) => r.n));
            return (
              <div key={row.source} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 capitalize text-muted-foreground">{row.source}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-night-2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(row.n / top) * 100}%` }} />
                </div>
                <span className="w-10 text-right font-semibold tabular-nums">{row.n}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* scrape runs chart */}
      <div className="rounded-xl border border-border bg-card p-4 md:col-span-2 xl:col-span-4">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Added per recent scrape run</p>
        <div className="flex h-28 items-end gap-1.5">
          {(s?.runs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          {(s?.runs ?? []).map((r) => (
            <div
              key={r.id}
              className="group relative flex-1 rounded-t bg-gradient-to-t from-primary/40 to-primary transition-all hover:opacity-80"
              style={{ height: `${(r.added / maxRun) * 100}%`, minHeight: r.added ? 4 : 0 }}
              title={`run #${r.id}: +${r.added}`}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100">
                {r.added}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BigStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
  return (
    <div className="fade-up rounded-xl border border-border bg-card p-5">
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wide ${accent ? "text-primary" : "text-muted-foreground"}`}>
        {icon} {label}
      </div>
      <div className="mt-2 font-display text-4xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
