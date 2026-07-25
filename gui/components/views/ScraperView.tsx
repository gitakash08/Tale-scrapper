"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Loader2, ShieldCheck, RefreshCw, Zap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";

type Status = {
  running: boolean; minutes: number; pass: number; added: number; baseline: number | null;
  log: string[]; error: string | null; elapsedMs: number; remainingMs: number; progress: number;
  job?: "discovery" | "refresh"; processed?: number; totalUnits?: number;
};
type Source = { id: number; name: string; enabled: boolean };
type RefreshInfo = {
  ongoing: number; withEpisodeData: number; withNextEpisode: number;
  lastCheckedAt: string | null; neverChecked: number;
};
/** "2h ago" — compact and locale-independent. */
function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function ScraperView({ onChange, newCount = 0 }: { onChange?: () => void; newCount?: number }) {
  const [minutes, setMinutes] = useState(30);
  const [status, setStatus] = useState<Status | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [info, setInfo] = useState<RefreshInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const s: Status = await fetch("/api/scrape/status", { cache: "no-store" }).then((r) => r.json());
      setStatus(s);
      if (wasRunning.current && !s.running) onChange?.();
      wasRunning.current = s.running;
    } catch { /* ignore */ }
  }, [onChange]);

  useEffect(() => { poll(); const id = setInterval(poll, 1000); return () => clearInterval(id); }, [poll]);
  useEffect(() => { fetch("/api/sources").then((r) => r.json()).then((d) => setSources(d.sources ?? [])).catch(() => {}); }, []);
  // refresh summary: reloaded whenever a run ends so the card reflects it
  useEffect(() => {
    fetch("/api/refresh/info", { cache: "no-store" })
      .then((r) => r.json()).then(setInfo).catch(() => {});
  }, [status?.running]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [status?.log]);

  const running = status?.running ?? false;
  const isRefresh = status?.job === "refresh";
  const start = async () => { setBusy(true); await fetch("/api/scrape/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes }) }); await poll(); setBusy(false); };
  // On-demand refresh: re-reads ongoing titles only (episodes/status/rating).
  const refreshNow = async () => {
    setBusy(true);
    await fetch("/api/scrape/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: "refresh" }) });
    await poll(); setBusy(false);
  };
  const stop = async () => { setBusy(true); await fetch("/api/scrape/stop", { method: "POST" }); await poll(); setBusy(false); };

  return (
    <div>
      <PageHeader title="Scraper" subtitle="Configure and run your scraping tasks.">
        {running ? (
          <Button variant="destructive" size="sm" onClick={stop} disabled={busy}>{busy ? <Loader2 className="spin" /> : <Square />} Stop</Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={refreshNow} disabled={busy}
              title="Re-read ongoing titles — episodes, status and rating. Adds nothing.">
              {busy ? <Loader2 className="spin" /> : <RefreshCw />} Refresh ongoing
            </Button>
            <Button size="sm" onClick={start} disabled={busy}>{busy ? <Loader2 className="spin" /> : <Play />} Start scraping</Button>
          </>
        )}
      </PageHeader>

      {newCount > 0 && !running && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 fade-up">
          <Sparkles className="size-5 shrink-0 text-emerald-400" />
          <p className="text-sm">
            <span className="font-semibold text-emerald-300">New data available</span>
            <span className="text-muted-foreground"> on {newCount} source{newCount > 1 ? "s" : ""} — start a scrape to pull it in.</span>
          </p>
          <Button size="sm" variant="success" className="ml-auto" onClick={start} disabled={busy}>
            {busy ? <Loader2 className="spin" /> : <Play />} Start scraping
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* New scrape */}
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">New Scrape</h2>
          <Label>Run duration</Label>
          <input type="range" min={5} max={120} step={5} value={minutes} disabled={running}
            onChange={(e) => setMinutes(Number(e.target.value))} className="w-full disabled:opacity-40" />
          <div className="mb-4 mt-2 flex gap-2">
            {[15, 30, 45, 60].map((m) => (
              <button key={m} disabled={running} onClick={() => setMinutes(m)}
                className={`tap-press rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-40 ${minutes === m ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>{m}m</button>
            ))}
            <span className="ml-auto self-center text-sm font-semibold tabular-nums">{minutes} min</span>
          </div>

          <Label>Sources</Label>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <span key={s.id} className={`rounded-md px-2 py-1 text-xs ${s.enabled ? "bg-primary/10 text-rose-light" : "border border-border text-muted-foreground line-through"}`}>{s.name}</span>
            ))}
            {sources.length === 0 && <span className="text-xs text-muted-foreground">Loading sources…</span>}
          </div>
          <p className="text-xs text-muted-foreground">A run sweeps all <span className="text-foreground">active</span> sources. Toggle them on the Sources page.</p>
        </div>

        {/* Ongoing titles — the refresh job, given equal billing to discovery */}
        <div className="card flex flex-col p-5">
          <div className="mb-4 flex items-center gap-2">
            <RefreshCw className="size-4 text-sky-400" />
            <h2 className="font-semibold">Ongoing titles</h2>
            <span className="ml-auto text-xs text-muted-foreground">checked {ago(info?.lastCheckedAt ?? null)}</span>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            <Stat label="Airing / upcoming" value={info?.ongoing ?? 0} />
            <Stat label="With episode data" value={info?.withEpisodeData ?? 0} />
            <Stat label="Next episode set" value={info?.withNextEpisode ?? 0} />
          </div>

          <p className="mb-4 text-xs text-muted-foreground">
            Re-reads each ongoing title from its source and updates
            <span className="text-foreground"> episodes aired</span>,
            <span className="text-foreground"> next episode</span>,
            <span className="text-foreground"> status</span> and
            <span className="text-foreground"> rating</span>. It never adds new titles.
            {(info?.neverChecked ?? 0) > 0 && (
              <> <span className="text-amber-300">{info?.neverChecked} never checked.</span></>
            )}
          </p>

          <Button variant="secondary" size="sm" className="mt-auto w-full" onClick={refreshNow} disabled={busy || running}>
            {busy ? <Loader2 className="spin" /> : <RefreshCw />} Refresh now
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Configuration */}
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Configuration</h2>
          <Row label="Politeness delay" value="550 ms / request" />
          <Row label="Daily cap" value="~55 items / source" />
          <div className="my-3 h-px bg-border" />
          <div className="space-y-2.5 text-sm">
            <ConfigOn icon={<ShieldCheck className="size-4 text-emerald-400" />} label="Respect robots.txt" />
            <ConfigOn icon={<RefreshCw className="size-4 text-emerald-400" />} label="Auto-retry on failure" />
            <ConfigOn icon={<ShieldCheck className="size-4 text-emerald-400" />} label="Single-writer advisory lock" />
          </div>
          <div className="mt-5 flex items-center justify-between rounded-lg bg-ink-2 p-3">
            <span className="text-xs text-muted-foreground">Estimated items</span>
            <span className="font-display text-lg font-semibold">≈ {minutes * 15}</span>
          </div>
        </div>
      </div>

      {/* Current run */}
      <div className="mt-5 card p-5">
        <h2 className="mb-4 font-semibold">Current Run</h2>

        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-4">
            <div className="relative grid size-20 place-items-center">
              <svg width="80" height="80" className="-rotate-90">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--muted)" strokeWidth="7" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--primary)" strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 34} strokeDashoffset={2 * Math.PI * 34 * (1 - (running ? status?.progress ?? 0 : 0))}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
              </svg>
              <span className="absolute text-sm font-semibold tabular-nums">{Math.round((running ? status?.progress ?? 0 : 0) * 100)}%</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${running ? "bg-emerald-400 pulse-dot" : "bg-muted-foreground"}`} />
                <span className="text-sm font-medium">
                  {running ? (isRefresh ? "Refreshing ongoing titles…" : "Scraping…") : status?.error ? "Error" : "Idle"}
                </span>
              </div>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {running
                  ? isRefresh
                    ? `${status?.processed ?? 0} of ${status?.totalUnits ?? 0} titles checked`
                    : `Pass ${status?.pass ?? 0} · ${fmt(status?.remainingMs ?? 0)} remaining`
                  : status?.error ?? "Set a duration and press Start."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={isRefresh ? "Updated" : "Added"} value={status?.added ?? 0} accent />
            {isRefresh
              ? <Stat label="Checked" value={`${status?.processed ?? 0}/${status?.totalUnits ?? 0}`} />
              : <Stat label="Pass" value={status?.pass ?? 0} />}
            <Stat label="Baseline" value={status?.baseline ?? 0} />
            <Stat label="Elapsed" value={fmt(status?.elapsedMs ?? 0)} />
          </div>
        </div>

        <div ref={logRef} className="thin-scroll mt-4 h-40 overflow-y-auto rounded-lg bg-ink-2 p-3 font-mono text-xs leading-relaxed">
          {(status?.log ?? []).length === 0 ? <p className="text-muted-foreground">Idle. Press Start to begin.</p> :
            status!.log.map((l, i) => (
              <div key={i} className={l.includes("+ ") ? "text-emerald-300" : /WARN|ERR/.test(l) ? "text-amber-300" : "text-muted-foreground"}>{l}</div>
            ))}
        </div>
      </div>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between py-1 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>
);
const ConfigOn = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
  <div className="flex items-center gap-2">{icon}<span className="flex-1">{label}</span><span className="text-xs text-emerald-400">on</span></div>
);
const Stat = ({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) => (
  <div className="rounded-lg bg-ink-2 p-3">
    <div className={`flex items-center gap-1 text-[11px] uppercase tracking-wide ${accent ? "text-primary" : "text-muted-foreground"}`}>{accent && <Zap className="size-3" />}{label}</div>
    <div className="mt-0.5 font-display text-xl font-semibold tabular-nums">{value}</div>
  </div>
);
