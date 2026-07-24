"use client";

import {
  Rocket, Inbox, CalendarClock, Database, Activity, ScrollText, Wrench, Sparkles,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";

/**
 * In-app user manual — a concise operating guide for whoever runs the scraper.
 * Intentionally short: what each screen does and the few rules worth knowing.
 */
export default function ManualView() {
  return (
    <div>
      <PageHeader title="User Manual" subtitle="How to operate the scraper — the short version." />

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          This tool finds new <span className="text-foreground">Korean &amp; Chinese</span> dramas, TV shows, and movies and
          adds them to your catalog. Everything it finds waits in the <span className="text-foreground">Approval Queue</span>{" "}
          until you approve it — nothing goes live automatically.
        </p>
      </div>

      <div className="space-y-4">
        <Section icon={<Rocket className="size-5" />} title="1. Run a scrape">
          <p>Go to <B>Scraper</B>, pick a duration, and press <B>Start scraping</B>. It sweeps every active source and stops on its own. A quick single pass adds a handful; a longer burst digs deeper (~15 items/minute).</p>
          <p>New titles land in the queue as <B>pending</B> — the catalog on your live site doesn&apos;t change until you approve them.</p>
        </Section>

        <Section icon={<Inbox className="size-5" />} title="2. Approve titles">
          <p>Open <B>Approval Queue</B> to review what was found — poster, rating, synopsis. Approve one at a time, or use <B>Bulk approve</B> (e.g. everything rated 7.5+) to clear the backlog fast. Approved titles go live immediately; the rest stay hidden.</p>
        </Section>

        <Section icon={<Database className="size-5" />} title="3. Manage sources">
          <p>The <B>Sources</B> page lists the built-in connectors (MDL, TVMaze, Trakt, Viki) — toggle any off you don&apos;t want. To add your own, click <B>Add Source</B> and paste a website URL: the scraper auto-discovers its pages via sitemap and reads standard <B>Open&nbsp;Graph / JSON-LD</B> tags.</p>
          <p className="text-muted-foreground">Only KR/CN titles are kept. Standard content sites work best; login-walled or heavily JavaScript-driven pages may return little.</p>
        </Section>

        <Section icon={<CalendarClock className="size-5" />} title="4. Schedule automatic runs">
          <p>On <B>Schedules</B>, flip the <B>Scheduler daemon</B> on, then add a schedule — <B>Interval</B>, <B>Daily</B>, <B>Weekly</B>, or an advanced <B>cron</B>. Each shows a live preview of its next run.</p>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            <li>Schedules only fire while this control panel is running, in the machine&apos;s local time.</li>
            <li>Only one scrape runs at a time; a run that&apos;s due waits for the current one to finish.</li>
            <li><B>Run now</B> forces an immediate run; automatic runs are change-aware (below).</li>
          </ul>
        </Section>

        <Section icon={<Activity className="size-5" />} title="5. Run only when there's new data">
          <p>Scheduled runs first check each source for a change signal (update timestamps, sitemap dates, ETags). If <B>nothing</B> has new data, the run is skipped and logged as <span className="text-foreground">&quot;No new data — run skipped&quot;</span> — saving pointless work.</p>
          <p className="text-muted-foreground">A run is skipped only when <B>every</B> active source reports no change, so nothing is ever missed. Churny sources like Trakt/MDL usually report changes — disable them if you want idle-skipping to trigger more often.</p>
        </Section>

        <Section icon={<ScrollText className="size-5" />} title="6. Read the logs">
          <p><B>Logs</B> shows recent run history: items added, titles skipped by the quality gate, skipped-for-no-change runs, and — if a run stopped early — the reason (<B>stopped by user</B>, an exit code, or <B>interrupted</B> after a restart/termination).</p>
        </Section>

        <Section icon={<Wrench className="size-5" />} title="Troubleshooting">
          <ul className="ml-4 list-disc space-y-1">
            <li><B>&quot;Another scraper is already running&quot;</B> — only one scrape can write at a time. Stop the current run (Scraper page) or wait for it to finish.</li>
            <li><B>Schedules not firing</B> — the control panel must be running, and the master <B>Scheduler daemon</B> toggle must be on.</li>
            <li><B>A custom source returns nothing</B> — it may lack a sitemap or standard metadata; not every site can be read automatically.</li>
            <li><B>Catalog didn&apos;t change</B> — new titles are pending until approved in the Approval Queue.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <div className="card p-5">
    <div className="mb-3 flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <h2 className="font-semibold">{title}</h2>
    </div>
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{children}</div>
  </div>
);
const B = ({ children }: { children: React.ReactNode }) => <b>{children}</b>;
