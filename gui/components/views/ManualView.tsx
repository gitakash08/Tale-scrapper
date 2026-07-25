"use client";

import { useState } from "react";
import {
  Rocket, Inbox, CalendarClock, Database, Activity, ScrollText, Wrench, Sparkles,
  RefreshCw, LayoutDashboard, Settings, Terminal, Play,
  Lock,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Figure, MockBar, MockBtn, MockCard, MockRow, Dim } from "@/components/manual/Figure";

/**
 * In-app operating guide. Each screen gets an annotated diagram with numbered
 * callouts, so a new operator can be productive without a walkthrough.
 */
type SectionId =
  | "start" | "dashboard" | "scraper" | "queue" | "activity"
  | "schedules" | "sources" | "onair" | "logs" | "settings" | "cli" | "help";

const NAV: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "start", label: "Getting started", icon: <Rocket className="size-4" /> },
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { id: "scraper", label: "Scraper", icon: <Play className="size-4" /> },
  { id: "queue", label: "Approval Queue", icon: <Inbox className="size-4" /> },
  { id: "activity", label: "Activity", icon: <Activity className="size-4" /> },
  { id: "schedules", label: "Schedules", icon: <CalendarClock className="size-4" /> },
  { id: "sources", label: "Sources", icon: <Database className="size-4" /> },
  { id: "onair", label: "On-air tracking", icon: <RefreshCw className="size-4" /> },
  { id: "logs", label: "Logs", icon: <ScrollText className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="size-4" /> },
  { id: "cli", label: "Command line", icon: <Terminal className="size-4" /> },
  { id: "help", label: "Troubleshooting", icon: <Wrench className="size-4" /> },
];

export default function ManualView() {
  const [open, setOpen] = useState<SectionId>("start");

  return (
    <div>
      <PageHeader title="User Manual" subtitle="How to operate Magneto — each screen, annotated." />

      <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
        {/* section nav */}
        <nav className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-wrap gap-1 lg:flex-col">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => setOpen(n.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  open === n.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}>
                {n.icon}<span>{n.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {open === "start" && <GettingStarted />}
          {open === "dashboard" && <DashboardHelp />}
          {open === "scraper" && <ScraperHelp />}
          {open === "queue" && <QueueHelp />}
          {open === "activity" && <ActivityHelp />}
          {open === "schedules" && <SchedulesHelp />}
          {open === "sources" && <SourcesHelp />}
          {open === "onair" && <OnAirHelp />}
          {open === "logs" && <LogsHelp />}
          {open === "settings" && <SettingsHelp />}
          {open === "cli" && <CliHelp />}
          {open === "help" && <Troubleshooting />}
        </div>
      </div>
    </div>
  );
}

/* ── shared bits ──────────────────────────────────────────────────── */
const Card = ({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) => (
  <div className="card p-5">
    <div className="mb-3 flex items-center gap-3">
      {icon && <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>}
      <h2 className="font-semibold">{title}</h2>
    </div>
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
      {children}
    </div>
  </div>
);
const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-lg border border-dashed border-border bg-ink-2 p-3 text-xs">{children}</p>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-ink-2 px-1.5 py-0.5 font-mono text-[12px] text-foreground">{children}</code>
);

/* ── 1. getting started ───────────────────────────────────────────── */
function GettingStarted() {
  return (
    <>
      <Card title="What Magneto does" icon={<Sparkles className="size-5" />}>
        <p>
          Magneto finds <b>Korean &amp; Chinese</b> dramas, TV shows and movies and adds them to your catalog.
          Everything it finds waits in the <b>Approval Queue</b> — nothing reaches your live site until you approve it.
        </p>
        <p>It also keeps titles you already have <b>up to date</b>: episode counts, airing status and ratings.</p>
      </Card>

      <Card title="The five-minute version" icon={<Rocket className="size-5" />}>
        <ol className="ml-4 list-decimal space-y-2">
          <li><b>Scraper</b> → pick a duration → <b>Start scraping</b>.</li>
          <li><b>Approval Queue</b> → review what came in → approve (or bulk-approve 7.5★ and up).</li>
          <li><b>Schedules</b> → turn the daemon on and add a schedule so it runs itself.</li>
          <li><b>Activity</b> → see what changed and when, any time.</li>
        </ol>
        <Note>
          Two jobs exist, and the difference matters: <b>Discovery</b> finds <i>new</i> titles;
          <b> Refresh</b> updates <i>existing</i> ongoing ones. Both are on the Scraper page and can be scheduled.
        </Note>
      </Card>
    </>
  );
}

/* ── 2. dashboard ─────────────────────────────────────────────────── */
function DashboardHelp() {
  return (
    <Card title="Dashboard — the catalog at a glance" icon={<LayoutDashboard className="size-5" />}>
      <Figure
        title="Dashboard"
        caption="Opens on load. The four tiles are the health of your catalog."
        spots={[
          { n: 1, x: 12, y: 26, label: <><b>Total in catalog</b> — every title, approved or not.</>},
          { n: 2, x: 38, y: 26, label: <><b>Approved &amp; live</b> — visible on your website right now.</>},
          { n: 3, x: 64, y: 26, label: <><b>Pending approval</b> — click to jump straight to the queue.</>},
          { n: 4, x: 88, y: 26, label: <><b>Titles updated</b> — how many existing titles Magneto has corrected. Click for Activity.</>},
          { n: 5, x: 50, y: 78, label: <>Activity per run — <b>rose = added</b>, <b>blue = updated</b>. Click a bar to see exactly what changed.</>},
        ]}
      >
        <div className="grid grid-cols-4 gap-2">
          {[["Total", "1,440"], ["Approved", "1,334"], ["Pending", "106"], ["Updated", "153"]].map(([k, v]) => (
            <MockCard key={k}><Dim>{k}</Dim><div className="font-display text-lg font-semibold">{v}</div></MockCard>
          ))}
        </div>
        <MockCard className="mt-2">
          <div className="mb-2 flex items-center justify-between">
            <Dim>Activity per recent scrape run</Dim>
            <div className="flex gap-2">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />Added</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="size-1.5 rounded-full bg-sky-400" />Updated</span>
            </div>
          </div>
          <div className="flex h-12 items-end gap-1">
            {[30, 55, 20, 70, 15, 45, 80, 25, 60].map((h, i) => (
              <div key={i} className="flex flex-1 flex-col justify-end">
                <div className="w-full rounded-t bg-sky-400/90" style={{ height: `${h / 4}%` }} />
                <div className="w-full bg-primary" style={{ height: `${h}%` }} />
              </div>
            ))}
          </div>
        </MockCard>
      </Figure>
    </Card>
  );
}

/* ── 3. scraper ───────────────────────────────────────────────────── */
function ScraperHelp() {
  return (
    <Card title="Scraper — run a job by hand" icon={<Play className="size-5" />}>
      <Figure
        title="Scraper"
        caption="Two different jobs live here. Only one can run at a time."
        spots={[
          { n: 1, x: 61, y: 12, label: <><b>Refresh ongoing</b> — updates titles you already have (episodes, status, rating). Adds nothing. Fast.</>},
          { n: 2, x: 88, y: 12, label: <><b>Start scraping</b> — a discovery run that looks for new titles.</>},
          { n: 3, x: 22, y: 47, label: <>Run duration. Longer digs deeper (~15 items a minute). <b>Single pass</b> is quick and light.</>},
          { n: 4, x: 22, y: 82, label: <>Live log — every title found scrolls past here while the job runs.</>},
        ]}
      >
        <div className="mb-2 flex items-center justify-end gap-2">
          <MockBtn>↻ Refresh ongoing</MockBtn>
          <MockBtn tone="primary">▶ Start scraping</MockBtn>
        </div>
        <MockCard>
          <Dim>Run duration</Dim>
          <div className="my-2 h-1 rounded bg-border"><div className="h-1 w-1/3 rounded bg-primary" /></div>
          <div className="flex gap-1">{["15m", "30m", "45m", "60m"].map((d) => <MockBtn key={d}>{d}</MockBtn>)}</div>
        </MockCard>
        <MockCard className="mt-2">
          <Dim>Current run</Dim>
          <div className="mt-1 space-y-0.5 font-mono text-[10px] text-emerald-300">
            <div>+ Twinkling Watermelon via mdl — awaiting approval</div>
            <div>+ My Dearest Nemesis via tvmaze — awaiting approval</div>
          </div>
        </MockCard>
      </Figure>
      <Note>
        New titles land as <b>pending</b> — your live site doesn&apos;t change until you approve them in the queue.
      </Note>
    </Card>
  );
}

/* ── 4. queue ─────────────────────────────────────────────────────── */
function QueueHelp() {
  return (
    <Card title="Approval Queue — decide what goes live" icon={<Inbox className="size-5" />}>
      <Figure
        title="Approval Queue"
        caption="Nothing here is on your website yet. This is the gate."
        spots={[
          { n: 1, x: 20, y: 14, label: <>Priority tabs by rating — <b>High</b> ≥8.5, <b>Medium</b> ≥7.5, <b>Low</b> below.</>},
          { n: 2, x: 84, y: 14, label: <><b>Bulk approve</b> — approve everything, or everything above a rating. The fast way to clear a backlog.</>},
          { n: 3, x: 86, y: 52, label: <>Approve or reject a single title. Rejecting deletes it from the queue.</>},
        ]}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex gap-1">{["All 106", "High 12", "Medium 48", "Low 46"].map((t, i) => <MockBtn key={t} tone={i === 0 ? "primary" : "ghost"}>{t}</MockBtn>)}</div>
          <MockBtn tone="success">Bulk approve</MockBtn>
        </div>
        <MockCard className="p-0">
          {["Twinkling Watermelon · 8.9★", "My Dearest Nemesis · 7.8★"].map((t) => (
            <MockRow key={t}>
              <div className="size-6 rounded bg-border" />
              <span className="flex-1">{t}</span>
              <MockBtn tone="success">Approve</MockBtn><MockBtn>Reject</MockBtn>
            </MockRow>
          ))}
        </MockCard>
      </Figure>
    </Card>
  );
}

/* ── 5. activity ──────────────────────────────────────────────────── */
function ActivityHelp() {
  return (
    <Card title="Activity — what changed, and when" icon={<Activity className="size-5" />}>
      <Figure
        title="Activity"
        caption="A searchable history of every title added or updated."
        spots={[
          { n: 1, x: 16, y: 10, label: <>Filter by type — <b>All</b>, <b>Added</b>, or <b>Updated</b>, each with a live count.</>},
          { n: 2, x: 20, y: 33, label: <><b>When</b> — Today, Yesterday, last 7/30 days, or a custom calendar range.</>},
          { n: 3, x: 20, y: 55, label: <><b>Narrow by</b> source, type, which field changed (episodes/status/rating), and whether it went up or down.</>},
          { n: 4, x: 74, y: 80, label: <>The change itself, as <b>before → after</b>. ▲ green means it grew, ▼ amber means it fell.</>},
          { n: 5, x: 92, y: 10, label: <>Export the current filtered view to <b>CSV</b>.</>},
        ]}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex gap-1">{["All", "Added", "Updated"].map((t, i) => <MockBtn key={t} tone={i === 0 ? "primary" : "ghost"}>{t}</MockBtn>)}</div>
          <div className="flex gap-1"><MockBtn>⭳</MockBtn><MockBtn>↻</MockBtn></div>
        </div>
        <MockCard>
          <Dim>When</Dim>
          <div className="mt-1 flex flex-wrap gap-1">{["Today", "Yesterday", "Last 7 days", "Last 30 days", "All time", "Custom"].map((r, i) => <MockBtn key={r} tone={i === 4 ? "primary" : "ghost"}>{r}</MockBtn>)}</div>
          <div className="my-2 h-px bg-border" />
          <Dim>Narrow by</Dim>
          <div className="mt-1 flex flex-wrap gap-1">{["Source: any", "Type: any", "Changed: any", "Increased"].map((r) => <MockBtn key={r}>{r}</MockBtn>)}</div>
        </MockCard>
        <MockCard className="mt-2 p-0">
          <MockRow>
            <span className="grid size-5 place-items-center rounded bg-sky-400/15 text-sky-400">↻</span>
            <span className="flex-1">Knowing Bros</span>
            <span className="rounded bg-ink-2 px-1.5 py-0.5">Episodes <s className="opacity-60">547</s> → <b className="text-sky-300">600</b></span>
          </MockRow>
          <MockRow>
            <span className="grid size-5 place-items-center rounded bg-primary/15 text-primary">+</span>
            <span className="flex-1">Twinkling Watermelon</span>
            <Dim>added · mdl</Dim>
          </MockRow>
        </MockCard>
      </Figure>
    </Card>
  );
}

/* ── 6. schedules ─────────────────────────────────────────────────── */
function SchedulesHelp() {
  return (
    <Card title="Schedules — let it run itself" icon={<CalendarClock className="size-5" />}>
      <Figure
        title="Schedules"
        caption="Set it once and Magneto keeps your catalog current."
        spots={[
          { n: 1, x: 91, y: 13, label: <>Master <b>daemon switch</b>. Off means no schedule fires, no matter what&apos;s configured.</>},
          { n: 2, x: 22, y: 43, label: <><b>What to run</b> — <b>Discovery</b> finds new titles; <b>Refresh</b> updates ongoing ones.</>},
          { n: 3, x: 22, y: 62, label: <><b>Cadence</b> — Interval, Daily, Weekly, or an advanced cron expression.</>},
          { n: 4, x: 76, y: 62, label: <>Live preview of the next run, so you can confirm before saving.</>},
        ]}
      >
        <MockCard className="mb-2">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded bg-emerald-500/15 text-emerald-400">⏱</span>
            <div className="flex-1"><div className="text-[11px] font-semibold text-foreground">Scheduler daemon</div><Dim>Next: Daily refresh in 6h</Dim></div>
            <span className="h-4 w-7 rounded-full bg-emerald-500" />
          </div>
        </MockCard>
        <MockCard>
          <Dim>What to run</Dim>
          <div className="mt-1 flex gap-1"><MockBtn tone="primary">Discovery</MockBtn><MockBtn>Refresh</MockBtn></div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><Dim>Cadence</Dim><div className="mt-1 flex flex-wrap gap-1">{["Interval", "Daily", "Weekly", "Advanced"].map((c, i) => <MockBtn key={c} tone={i === 1 ? "primary" : "ghost"}>{c}</MockBtn>)}</div></div>
            <div className="rounded-lg bg-ink-2 p-2"><Dim>Next run preview</Dim><div className="text-[11px] font-semibold text-foreground">in 6h 12m</div></div>
          </div>
        </MockCard>
      </Figure>
      <p><b>A good default setup:</b> <i>Daily 06:00 → Refresh</i> to keep episode counts current, plus <i>Weekly → Discovery, 45 min</i> to find new titles.</p>
      <Note>
        Schedules only fire while this control panel is running, and times use the server&apos;s local timezone.
        Only one job runs at a time — a due schedule waits for the current one to finish.
      </Note>
    </Card>
  );
}

/* ── 7. sources ───────────────────────────────────────────────────── */
function SourcesHelp() {
  return (
    <Card title="Sources — where titles come from" icon={<Database className="size-5" />}>
      <Figure
        title="Sources"
        caption="Four tuned connectors ship built in. You can add your own."
        spots={[
          { n: 1, x: 60, y: 12, label: <><b>Check for updates</b> — asks each source whether it has anything new. Runs at most once a day on its own.</>},
          { n: 2, x: 90, y: 12, label: <><b>Add Source</b> — paste any site URL; Magneto reads its sitemap and standard metadata.</>},
          { n: 3, x: 30, y: 45, label: <>A green <b>New</b> badge means that source has fresh content worth scraping.</>},
          { n: 4, x: 72, y: 61, label: <>Toggle a source off and it&apos;s skipped by every run — discovery and refresh alike.</>},
        ]}
      >
        <div className="mb-2 flex items-center justify-end gap-2">
          <Dim>Checked 2h ago</Dim><MockBtn>↻ Check for updates</MockBtn><MockBtn tone="primary">+ Add Source</MockBtn>
        </div>
        <MockCard className="p-0">
          {[["MDL (MyDramaList)", true], ["TVMaze", false], ["Viki", false]].map(([name, isNew]) => (
            <MockRow key={String(name)}>
              <span className="flex-1">{String(name)} {isNew ? <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-300">New</span> : null}</span>
              <Dim>sitemap</Dim>
              <span className="h-3.5 w-6 rounded-full bg-emerald-500" />
              <Dim>Active</Dim>
            </MockRow>
          ))}
        </MockCard>
      </Figure>
      <p>
        <Lock className="mr-1 inline size-3" /> Built-in sources use tuned connectors and can&apos;t be deleted — only switched off.
        Custom sources use a best-effort generic reader: great for standard content sites, weaker on login-walled or
        heavily JavaScript-driven pages.
      </p>
    </Card>
  );
}

/* ── 8. on-air tracking ───────────────────────────────────────────── */
function OnAirHelp() {
  return (
    <Card title="On-air tracking — ongoing titles stay correct" icon={<RefreshCw className="size-5" />}>
      <p>
        For shows still airing, Magneto reads the <b>per-episode air dates</b> from the source and keeps four things
        current, so your website can show real progress instead of a static badge:
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ["Episodes aired", "“5 of 8 episodes” on the detail page"],
          ["Next episode", "“Next episode: Jul 28”"],
          ["Status", "flips airing → completed on its own"],
          ["Rating", "re-read as more people vote"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-ink-2 p-3"><div className="text-[11px] font-semibold text-foreground">{k}</div><Dim>{v}</Dim></div>
        ))}
      </div>
      <p><b>How to use it:</b> run <b>Refresh ongoing</b> on the Scraper page, or schedule a daily Refresh. That&apos;s it.</p>
      <Note>
        Two safety rules worth knowing. A failed fetch <b>never</b> erases good data — the stored value is kept.
        And a show is only auto-completed when no future episode is known <i>and</i> it has been quiet for 3 weeks,
        so a weekly show is never finished off during its normal gap.
      </Note>
      <p className="text-xs">
        If you hand-edit a rating and want it frozen, set that row&apos;s <Code>rating_locked</Code> flag — the refresher
        will skip it forever after.
      </p>
    </Card>
  );
}

/* ── 9. logs ──────────────────────────────────────────────────────── */
function LogsHelp() {
  return (
    <Card title="Logs — run history and problems" icon={<ScrollText className="size-5" />}>
      <Figure
        title="Logs"
        caption="One row per event. Runs expand to show their detail."
        spots={[
          { n: 1, x: 14, y: 12, label: <>Filter by level, or search the messages.</>},
          { n: 2, x: 45, y: 45, label: <>Click a run row to <b>expand it</b> and see every title it changed, with before → after values.</>},
          { n: 3, x: 45, y: 70, label: <>If a run stopped early you&apos;ll see why here — <b>stopped by user</b>, an exit code, or <b>interrupted</b> after a restart.</>},
        ]}
      >
        <div className="mb-2 flex gap-1"><MockBtn>All levels</MockBtn><MockBtn>Search…</MockBtn></div>
        <MockCard className="p-0">
          <MockRow><Dim>12:31</Dim><MockBtn tone="sky">INFO</MockBtn><span className="flex-1">Run completed — 0 added, 5 updated</span><Dim>Run #75</Dim></MockRow>
          <div className="border-b border-border/60 bg-ink-2/60 px-2.5 py-1.5">
            <div className="text-[10px] text-muted-foreground">↻ Knowing Bros — Episodes 547 → 600</div>
            <div className="text-[10px] text-muted-foreground">↻ BTS Dinner Party — Rating 9.1 → 8.5</div>
          </div>
          <MockRow><Dim>12:04</Dim><MockBtn>WARN</MockBtn><span className="flex-1">interrupted — worker restarted</span><Dim>Run #74</Dim></MockRow>
        </MockCard>
      </Figure>
    </Card>
  );
}

/* ── 10. settings ─────────────────────────────────────────────────── */
function SettingsHelp() {
  return (
    <Card title="Settings &amp; appearance" icon={<Settings className="size-5" />}>
      <p>Switch between <b>Dark</b> and <b>Light</b> on the Settings page, or with the sun/moon button at the bottom of the sidebar. Your choice is remembered.</p>
      <p>Collapse the sidebar to a narrow icon rail with the <b>«</b> button next to the logo — useful on smaller screens. It stays collapsed until you expand it again.</p>
    </Card>
  );
}

/* ── 11. cli ──────────────────────────────────────────────────────── */
function CliHelp() {
  const rows: [string, string][] = [
    ["node src/worker.js run", "one discovery pass"],
    ["node src/worker.js run --duration 45m", "scrape hard for 45 minutes"],
    ["node src/worker.js run --if-changed", "only run if a source has new data"],
    ["node src/worker.js refresh", "update ongoing titles only"],
    ["node src/worker.js refresh --dry-run", "show what would change; writes nothing"],
    ["node src/worker.js check-updates", "probe sources for new data"],
    ["node src/worker.js migrate", "apply the database schema"],
  ];
  return (
    <Card title="Command line" icon={<Terminal className="size-5" />}>
      <p>Everything the panel does can also be run directly — handy for automation or a scheduled task.</p>
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map(([cmd, what]) => (
          <div key={cmd} className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0">
            <code className="font-mono text-[12px] text-emerald-300">{cmd}</code>
            <span className="ml-auto text-xs text-muted-foreground">{what}</span>
          </div>
        ))}
      </div>
      <Note>
        <b>--dry-run</b> is the safe way to preview a refresh: it prints the exact diff and writes nothing at all.
      </Note>
    </Card>
  );
}

/* ── 12. troubleshooting ──────────────────────────────────────────── */
function Troubleshooting() {
  const items: [string, React.ReactNode][] = [
    ["“Another scraper is already running”", <>Only one job can write at a time. Stop the current run on the Scraper page, or wait for it to finish.</>],
    ["Schedules aren’t firing", <>The control panel must be running, and the master <b>Scheduler daemon</b> toggle must be on.</>],
    ["Episode counts look stale", <>Timed discovery bursts skip refreshing. Run <b>Refresh ongoing</b>, or add a Refresh schedule.</>],
    ["A custom source returns nothing", <>It may have no sitemap or no standard metadata. Not every site can be read automatically.</>],
    ["My website didn’t change", <>New titles stay pending until approved. Also, the site caches pages for about an hour.</>],
    ["A title vanished from On Air", <>It was probably auto-completed after 3 quiet weeks. Check <b>Logs</b> — every auto-completion is recorded with the reason.</>],
  ];
  return (
    <Card title="Troubleshooting" icon={<Wrench className="size-5" />}>
      <div className="space-y-3">
        {items.map(([q, a]) => (
          <div key={q}>
            <p className="text-sm font-medium text-foreground">{q}</p>
            <p className="text-sm">{a}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
