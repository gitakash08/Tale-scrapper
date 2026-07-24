"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, Clock3, CheckCircle2, Film, Tv, Clapperboard, ArrowRight } from "lucide-react";
import type { View } from "@/components/Sidebar";
import PageHeader from "@/components/PageHeader";

type Stats = {
  total: number; approved: number; pending: number; drama: number; tv: number; movie: number;
  kr: number; cn: number; bySource: { source: string; n: number }[]; runs: { id: number; added: number }[];
};

function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now(); const a = from.current; let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - start) / ms); setV(Math.round(a + (target - a) * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); else from.current = target; };
    raf = requestAnimationFrame(tick);
    const settle = setTimeout(() => { setV(target); from.current = target; }, ms + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, [target, ms]);
  return v;
}

export default function DashboardView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { fetch("/api/stats", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => {}); }, []);
  const total = useCountUp(s?.total ?? 0);
  const pending = useCountUp(s?.pending ?? 0);
  const approved = useCountUp(s?.approved ?? 0);

  const seg = [
    { label: "Dramas", v: s?.drama ?? 0, cls: "bg-rose-light" },
    { label: "TV shows", v: s?.tv ?? 0, cls: "bg-amber-400" },
    { label: "Movies", v: s?.movie ?? 0, cls: "bg-emerald-400" },
  ];
  const sum = seg.reduce((a, b) => a + b.v, 0) || 1;
  const maxRun = Math.max(1, ...(s?.runs ?? []).map((r) => r.added));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your catalog at a glance." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<Layers className="size-5" />} label="Total in catalog" value={total} />
        <Stat icon={<CheckCircle2 className="size-5 text-emerald-400" />} label="Approved & live" value={approved} />
        <button onClick={() => onNavigate("queue")} className="text-left">
          <Stat icon={<Clock3 className="size-5 text-primary" />} label="Pending approval" value={pending} accent cta />
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Content mix</p>
          <div className="flex h-3 overflow-hidden rounded-full">
            {seg.map((x) => <div key={x.label} className={x.cls} style={{ width: `${(x.v / sum) * 100}%` }} title={`${x.label}: ${x.v}`} />)}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Mini icon={<Film className="size-4 text-rose-light" />} label="Dramas" value={s?.drama ?? 0} />
            <Mini icon={<Tv className="size-4 text-amber-300" />} label="TV shows" value={s?.tv ?? 0} />
            <Mini icon={<Clapperboard className="size-4 text-emerald-300" />} label="Movies" value={s?.movie ?? 0} />
          </div>
          <p className="mt-3 text-right text-xs text-muted-foreground">🇰🇷 {s?.kr ?? 0} Korean · 🇨🇳 {s?.cn ?? 0} Chinese</p>
        </div>

        <div className="card p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">By source</p>
          <div className="space-y-2">
            {(s?.bySource ?? []).map((row) => {
              const top = Math.max(1, ...(s?.bySource ?? []).map((r) => r.n));
              return (
                <div key={row.source} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 capitalize text-muted-foreground">{row.source}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-2"><div className="h-full rounded-full bg-primary" style={{ width: `${(row.n / top) * 100}%` }} /></div>
                  <span className="w-10 text-right font-semibold tabular-nums">{row.n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 card p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Added per recent scrape run</p>
          <button onClick={() => onNavigate("scraper")} className="flex items-center gap-1 text-xs text-primary hover:underline">Run a scrape <ArrowRight className="size-3" /></button>
        </div>
        <div className="flex h-28 items-end gap-1.5">
          {(s?.runs ?? []).length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          {(s?.runs ?? []).map((r) => (
            <div key={r.id} className="group relative flex-1 rounded-t bg-gradient-to-t from-primary/40 to-primary hover:opacity-80"
              style={{ height: `${(r.added / maxRun) * 100}%`, minHeight: r.added ? 4 : 0 }} title={`run #${r.id}: +${r.added}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, accent, cta }: { icon: React.ReactNode; label: string; value: number; accent?: boolean; cta?: boolean }) {
  return (
    <div className={`card p-5 ${cta ? "transition-colors hover:border-primary/50" : ""}`}>
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wide ${accent ? "text-primary" : "text-muted-foreground"}`}>{icon}{label}</div>
      <div className="mt-2 flex items-end justify-between">
        <span className="font-display text-4xl font-semibold tabular-nums">{value.toLocaleString()}</span>
        {cta && <span className="mb-1 flex items-center gap-1 text-xs text-primary">Review <ArrowRight className="size-3" /></span>}
      </div>
    </div>
  );
}
const Mini = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) => (
  <div className="rounded-lg bg-ink-2 p-2.5"><div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div><div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div></div>
);
