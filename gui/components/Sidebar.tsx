"use client";

import {
  LayoutDashboard, Gauge, Inbox, CalendarClock, Database, Settings, ScrollText, BookOpen, Clapperboard,
} from "lucide-react";

export type View =
  | "dashboard" | "scraper" | "queue" | "schedules" | "sources" | "settings" | "logs" | "manual";

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-[18px]" /> },
  { id: "scraper", label: "Scraper", icon: <Gauge className="size-[18px]" /> },
  { id: "queue", label: "Approval Queue", icon: <Inbox className="size-[18px]" /> },
  { id: "schedules", label: "Schedules", icon: <CalendarClock className="size-[18px]" /> },
  { id: "sources", label: "Sources", icon: <Database className="size-[18px]" /> },
  { id: "settings", label: "Settings", icon: <Settings className="size-[18px]" /> },
  { id: "logs", label: "Logs", icon: <ScrollText className="size-[18px]" /> },
  { id: "manual", label: "User Manual", icon: <BookOpen className="size-[18px]" /> },
];

export default function Sidebar({
  view, setView, pending,
}: { view: View; setView: (v: View) => void; pending: number }) {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-ink-2">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Clapperboard className="size-5" />
        </div>
        <div className="leading-tight">
          <p className="font-display text-[15px] font-semibold">R-Tale Scraper</p>
          <p className="text-[11px] text-muted-foreground">Discover K/C dramas, TV<br />shows &amp; movies — one click.</p>
        </div>
      </div>

      <nav className="thin-scroll mt-2 flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`tap-press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              {n.icon}
              <span className="flex-1 text-left">{n.label}</span>
              {n.id === "queue" && pending > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {pending}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-semibold">
            AK
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">Admin</p>
            <p className="truncate text-[11px] text-muted-foreground">local control panel</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
