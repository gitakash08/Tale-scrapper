"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Loader2, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = {
  running: boolean;
  minutes: number;
  pass: number;
  added: number;
  baseline: number | null;
  log: string[];
  error: string | null;
  elapsedMs: number;
  remainingMs: number;
  progress: number;
};

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function ControlPanel({ onChange }: { onChange?: () => void }) {
  const [minutes, setMinutes] = useState(30);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const s: Status = await fetch("/api/scrape/status", { cache: "no-store" }).then((r) => r.json());
      setStatus(s);
      if (wasRunning.current && !s.running) onChange?.(); // refresh stats/queue when a run ends
      wasRunning.current = s.running;
    } catch {
      /* ignore */
    }
  }, [onChange]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log]);

  const running = status?.running ?? false;

  async function start() {
    setBusy(true);
    await fetch("/api/scrape/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
    await poll();
    setBusy(false);
  }
  async function stop() {
    setBusy(true);
    await fetch("/api/scrape/stop", { method: "POST" });
    await poll();
    setBusy(false);
  }

  // progress ring geometry
  const R = 52, C = 2 * Math.PI * R;
  const p = running ? status?.progress ?? 0 : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* Left: dial + controls */}
      <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-card p-6">
        <div className="relative grid place-items-center">
          <svg width="140" height="140" className="-rotate-90">
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--muted)" strokeWidth="10" />
            <circle
              cx="70" cy="70" r={R} fill="none" stroke="var(--primary)" strokeWidth="10"
              strokeLinecap="round" strokeDasharray={C}
              strokeDashoffset={C * (1 - p)}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          <div className={`absolute grid place-items-center text-center ${running ? "pulse-ring rounded-full" : ""}`}>
            <span className="font-display text-3xl font-semibold tabular-nums">
              {running ? fmt(status?.remainingMs ?? 0) : `${minutes}m`}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {running ? "remaining" : "duration"}
            </span>
          </div>
        </div>

        {!running && (
          <div className="w-full space-y-3">
            <input
              type="range" min={5} max={120} step={5} value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
            <div className="flex justify-center gap-2">
              {[15, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => setMinutes(m)}
                  className={`tap-press rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    minutes === m ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        )}

        {running ? (
          <Button variant="destructive" size="lg" className="w-full" onClick={stop} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Square />} Stop
          </Button>
        ) : (
          <Button size="lg" className="w-full" onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Start scraping
          </Button>
        )}
        {status?.error && <p className="text-xs text-destructive text-center">{status.error}</p>}
      </div>

      {/* Right: live metrics + log terminal */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <div className="grid grid-cols-3 gap-3">
          <Metric icon={<Zap className="size-4" />} label="Added this run" value={status?.added ?? 0} accent />
          <Metric icon={<Loader2 className={`size-4 ${running ? "animate-spin" : ""}`} />} label="Pass" value={status?.pass ?? 0} />
          <Metric icon={<Clock className="size-4" />} label="Elapsed" value={fmt(status?.elapsedMs ?? 0)} />
        </div>
        <div
          ref={logRef}
          className="log-scroll h-64 overflow-y-auto rounded-lg bg-night-2 p-3 font-mono text-xs leading-relaxed"
        >
          {(status?.log ?? []).length === 0 ? (
            <p className="text-muted-foreground">Idle. Set a duration and press Start.</p>
          ) : (
            status!.log.map((line, i) => (
              <div key={i} className={line.includes("+ ") ? "text-emerald-300" : line.includes("WARN") || line.includes("ERR") ? "text-amber-300" : "text-cream-muted/80"}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-night-2 p-3">
      <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide ${accent ? "text-primary" : "text-muted-foreground"}`}>
        {icon} {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
