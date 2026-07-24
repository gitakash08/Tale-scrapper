"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, Plus, Play, Trash2, Pencil, Loader2, Info, Clock,
  Repeat, CalendarDays, Terminal, X, Check, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import {
  computeNextRun, humanizeSchedule, relativeTime, WEEKDAYS,
  type Schedule, type ScheduleKind, type ScheduleConfig,
} from "@/lib/schedule-utils";

type Daemon = { enabled: boolean; running: boolean; trigger: string; next: { name: string; nextRunAt: string } | null };
type Draft = { id?: number; name: string; kind: ScheduleKind; config: ScheduleConfig; durationMin: number };

const KIND_META: { kind: ScheduleKind; label: string; icon: typeof Clock }[] = [
  { kind: "interval", label: "Interval", icon: Repeat },
  { kind: "daily", label: "Daily", icon: Clock },
  { kind: "weekly", label: "Weekly", icon: CalendarDays },
  { kind: "cron", label: "Advanced", icon: Terminal },
];
const INTERVAL_PRESETS = [
  { m: 30, label: "30 min" }, { m: 60, label: "1 hour" }, { m: 120, label: "2 hours" },
  { m: 360, label: "6 hours" }, { m: 720, label: "12 hours" }, { m: 1440, label: "Daily" },
];
const blankDraft = (): Draft => ({
  name: "", kind: "daily", durationMin: 30,
  config: { intervalMinutes: 720, times: ["09:00"], days: [1, 3, 5], expr: "0 */6 * * *" },
});
const fmtAbs = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function SchedulesView() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [daemon, setDaemon] = useState<Daemon | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      fetch("/api/schedules", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ schedules: [] })),
      fetch("/api/schedules/daemon", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    setSchedules(s.schedules ?? []);
    setDaemon(d);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);

  const toggleDaemon = async () => {
    setBusy(true);
    await fetch("/api/schedules/daemon", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !daemon?.enabled }),
    });
    await load(); setBusy(false);
  };
  const toggleSchedule = async (s: Schedule) => {
    await fetch("/api/schedules", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, enabled: !s.enabled }),
    });
    load();
  };
  const runNow = async (s: Schedule) => {
    await fetch("/api/schedules/run", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id }),
    });
    load();
  };
  const remove = async (s: Schedule) => {
    if (!confirm(`Delete schedule "${s.name}"?`)) return;
    await fetch(`/api/schedules?id=${s.id}`, { method: "DELETE" });
    load();
  };

  const on = daemon?.enabled ?? false;

  return (
    <div>
      <PageHeader title="Schedules" subtitle="Automate scraping on any cadence you need.">
        <Button size="sm" variant="secondary" onClick={() => setDraft(blankDraft())}>
          <Plus /> New schedule
        </Button>
      </PageHeader>

      {/* Master daemon switch */}
      <div className="card p-5">
        <div className="flex items-center gap-3">
          <div className={`grid size-10 place-items-center rounded-lg ${on ? "bg-emerald-500/15 text-emerald-400" : "bg-primary/10 text-primary"}`}>
            <CalendarClock className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold">Scheduler daemon</p>
            <p className="text-xs text-muted-foreground">
              {on
                ? daemon?.running
                  ? `Running now — ${daemon.trigger.replace("schedule:", "▶ ")}`
                  : daemon?.next
                    ? `Next: ${daemon.next.name} ${relativeTime(daemon.next.nextRunAt)} (${fmtAbs(daemon.next.nextRunAt)})`
                    : "On — no schedules yet"
                : "Off — schedules won't fire"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className={`flex items-center gap-1.5 text-sm ${on ? "text-emerald-400" : "text-muted-foreground"}`}>
              <span className={`size-2 rounded-full ${on ? "bg-emerald-400 pulse-dot" : "bg-muted-foreground"}`} />
              {on ? "Active" : "Paused"}
            </span>
            <button
              onClick={toggleDaemon} disabled={busy}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-secondary"}`}
              aria-label="Toggle scheduler"
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Editor */}
      {draft && (
        <ScheduleEditor
          draft={draft} setDraft={setDraft}
          onClose={() => setDraft(null)}
          onSaved={() => { setDraft(null); load(); }}
        />
      )}

      {/* Schedule list */}
      <div className="mt-4 space-y-3">
        {schedules.length === 0 && !draft && (
          <div className="card grid place-items-center p-10 text-center">
            <CalendarClock className="mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No schedules yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create one to run the scraper automatically.</p>
            <Button size="sm" className="mt-4" onClick={() => setDraft(blankDraft())}><Plus /> New schedule</Button>
          </div>
        )}
        {schedules.map((s) => (
          <div key={s.id} className={`card flex flex-wrap items-center gap-4 p-4 ${!s.enabled ? "opacity-60" : ""}`}>
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
              {(() => { const I = KIND_META.find((k) => k.kind === s.kind)?.icon ?? Clock; return <I className="size-5" />; })()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{s.name}</p>
                <span className="rounded bg-ink-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{s.kind}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {humanizeSchedule(s.kind, s.config)} · {s.durationMin === 0 ? "single pass" : `${s.durationMin} min burst`}
              </p>
            </div>
            <div className="text-right text-xs">
              <p className="text-muted-foreground">Next</p>
              <p className="font-medium tabular-nums">{s.enabled ? relativeTime(s.nextRunAt) : "paused"}</p>
              <p className="text-[10px] text-muted-foreground">{s.enabled ? fmtAbs(s.nextRunAt) : ""}</p>
            </div>
            <div className="text-right text-xs">
              <p className="text-muted-foreground">Last run</p>
              <p className="font-medium tabular-nums">{s.lastRunAt ? relativeTime(s.lastRunAt) : "never"}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => runNow(s)} title="Run now" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-emerald-400"><Play className="size-4" /></button>
              <button onClick={() => setDraft({ id: s.id, name: s.name, kind: s.kind, config: s.config, durationMin: s.durationMin })} title="Edit" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"><Pencil className="size-4" /></button>
              <button onClick={() => remove(s)} title="Delete" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-destructive"><Trash2 className="size-4" /></button>
              <button onClick={() => toggleSchedule(s)} title={s.enabled ? "Disable" : "Enable"} className={`relative ml-1 h-5 w-9 rounded-full transition-colors ${s.enabled ? "bg-primary" : "bg-secondary"}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${s.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Schedules fire from this control panel, so keep it running for them to trigger. Times use the
          <span className="text-foreground"> server&apos;s local timezone</span>. Only one scrape runs at a time — if a run is
          already going, a due schedule waits and fires right after.
        </p>
      </div>
    </div>
  );
}

/* ── editor ───────────────────────────────────────────────────────── */
function ScheduleEditor({
  draft, setDraft, onClose, onSaved,
}: {
  draft: Draft; setDraft: (d: Draft) => void; onClose: () => void; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = draft.config;
  const setCfg = (patch: Partial<ScheduleConfig>) => setDraft({ ...draft, config: { ...cfg, ...patch } });

  const preview = useMemo(() => computeNextRun(draft.kind, cfg, new Date()), [draft.kind, cfg]);

  const save = async () => {
    if (!draft.name.trim()) { setError("Give the schedule a name."); return; }
    if (!preview) { setError("This schedule never fires — check its timing."); return; }
    setSaving(true); setError(null);
    const body = { name: draft.name.trim(), kind: draft.kind, config: cfg, durationMin: draft.durationMin };
    const res = draft.id
      ? await fetch("/api/schedules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id, ...body }) })
      : await fetch("/api/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) onSaved();
    else setError((await res.json().catch(() => ({}))).error ?? "Save failed.");
  };

  const times = cfg.times ?? [];
  const setTimes = (t: string[]) => setCfg({ times: t.length ? t : ["09:00"] });

  return (
    <div className="mt-4 card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">{draft.id ? "Edit schedule" : "New schedule"}</h2>
        <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5"><X className="size-4" /></button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <Label>Name</Label>
          <input
            value={draft.name} placeholder="e.g. Twice-daily sweep"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm outline-none focus:border-primary"
          />

          <Label className="mt-4">Cadence</Label>
          <div className="flex flex-wrap gap-1.5">
            {KIND_META.map(({ kind, label, icon: I }) => (
              <button key={kind} onClick={() => setDraft({ ...draft, kind })}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${draft.kind === kind ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                <I className="size-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* kind-specific controls */}
          <div className="mt-4">
            {draft.kind === "interval" && (
              <>
                <Label>Run every</Label>
                <div className="flex flex-wrap gap-1.5">
                  {INTERVAL_PRESETS.map((p) => (
                    <button key={p.m} onClick={() => setCfg({ intervalMinutes: p.m })}
                      className={`rounded-lg px-3 py-1 text-xs font-medium ${cfg.intervalMinutes === p.m ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>{p.label}</button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <input type="number" min={5} max={10080} value={cfg.intervalMinutes ?? 720}
                    onChange={(e) => setCfg({ intervalMinutes: Math.max(5, Number(e.target.value) || 5) })}
                    className="w-24 rounded-lg border border-border bg-ink-2 px-3 py-1.5 outline-none focus:border-primary" />
                  <span className="text-muted-foreground">minutes</span>
                </div>
              </>
            )}

            {(draft.kind === "daily" || draft.kind === "weekly") && (
              <>
                {draft.kind === "weekly" && (
                  <>
                    <Label>On days</Label>
                    <div className="mb-4 flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((d, i) => {
                        const active = (cfg.days ?? []).includes(i);
                        return (
                          <button key={d} onClick={() => setCfg({ days: active ? (cfg.days ?? []).filter((x) => x !== i) : [...(cfg.days ?? []), i] })}
                            className={`w-11 rounded-lg py-1 text-xs font-medium ${active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>{d}</button>
                        );
                      })}
                    </div>
                  </>
                )}
                <Label>At {times.length > 1 ? "times" : "time"}</Label>
                <div className="space-y-2">
                  {times.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" value={t}
                        onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                        className="rounded-lg border border-border bg-ink-2 px-3 py-1.5 text-sm outline-none focus:border-primary [color-scheme:dark]" />
                      {times.length > 1 && (
                        <button onClick={() => setTimes(times.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-destructive"><X className="size-4" /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setTimes([...times, "21:00"])} className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="size-3.5" /> Add time</button>
                </div>
              </>
            )}

            {draft.kind === "cron" && (
              <>
                <Label>Cron expression</Label>
                <input value={cfg.expr ?? ""} placeholder="0 */6 * * *" spellCheck={false}
                  onChange={(e) => setCfg({ expr: e.target.value })}
                  className="w-full rounded-lg border border-border bg-ink-2 px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
                <p className="mt-1.5 text-xs text-muted-foreground">Five fields: <span className="font-mono text-foreground">minute hour day month weekday</span>. Example: <span className="font-mono text-foreground">0 9,21 * * *</span> = 09:00 and 21:00 daily.</p>
              </>
            )}
          </div>
        </div>

        {/* duration + preview */}
        <div>
          <Label>Scrape intensity</Label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[0, 15, 30, 45, 60].map((m) => (
              <button key={m} onClick={() => setDraft({ ...draft, durationMin: m })}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${draft.durationMin === m ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>{m === 0 ? "Single pass" : `${m}m`}</button>
            ))}
          </div>
          <input type="range" min={0} max={120} step={5} value={draft.durationMin}
            onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })} className="w-full" />
          <p className="mt-1 text-xs text-muted-foreground">
            {draft.durationMin === 0
              ? "One discovery pass across all sources (fast, light)."
              : `Scrape hard for ${draft.durationMin} minutes (~${draft.durationMin * 15} items).`}
          </p>

          <div className="mt-5 rounded-lg bg-ink-2 p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-primary"><Zap className="size-3" /> Next run preview</div>
            <p className="mt-1 font-display text-lg font-semibold">{preview ? relativeTime(preview.toISOString()) : "never — check timing"}</p>
            <p className="text-xs text-muted-foreground">{preview ? preview.toLocaleString([], { dateStyle: "full", timeStyle: "short" }) : ""}</p>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="spin" /> : <Check />} {draft.id ? "Save changes" : "Create schedule"}</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

const Label = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <p className={`mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground ${className}`}>{children}</p>
);
