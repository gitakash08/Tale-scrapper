"use client";

import { CalendarClock, Info } from "lucide-react";

export default function SchedulesView() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-muted-foreground">Automate scraping on a cadence.</p>
      </header>

      <div className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarClock className="size-5" /></div>
          <div>
            <p className="font-semibold">Daily daemon</p>
            <p className="text-xs text-muted-foreground">The worker can run unattended on a 12-hour cadence (~50 new items/day).</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground"><span className="size-2 rounded-full bg-muted-foreground" /> Not running</span>
        </div>
        <pre className="thin-scroll overflow-x-auto rounded-lg bg-ink-2 p-3 font-mono text-xs text-emerald-300">node src/worker.js run --daily</pre>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="text-foreground">Per-source cron schedules</span> (the table in the design) need a scheduler
          service and a way to start/stop the daemon from the browser — planned next. Today, scheduling is the single
          <span className="text-foreground"> daily daemon</span> above, run from the CLI.
        </p>
      </div>
    </div>
  );
}
