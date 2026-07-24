"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Gauge, Inbox, CalendarClock, Database, Settings, ScrollText, BookOpen,
  Clapperboard, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme";

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
  view, setView, pending, hasNew = false,
}: { view: View; setView: (v: View) => void; pending: number; hasNew?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore the saved state after mount (avoids a hydration mismatch — the
  // server always renders expanded).
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("rts-sidebar") === "1"); } catch { /* ignore */ }
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("rts-sidebar", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });

  return (
    <aside
      style={{ width: collapsed ? "4rem" : "15rem" }}
      className="flex h-screen shrink-0 grow-0 min-w-0 flex-col overflow-hidden border-r border-border bg-ink-2 transition-[width] duration-200"
    >
      {/* header: logo + collapse toggle */}
      <div className={`flex items-center py-5 ${collapsed ? "justify-center px-2" : "gap-2.5 px-5"}`}>
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Clapperboard className="size-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-display text-[15px] font-semibold">R-Tale Scraper</p>
            <p className="text-[11px] text-muted-foreground">Discover K/C dramas, TV<br />shows &amp; movies — one click.</p>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={toggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="tap-press grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <PanelLeftClose className="size-[18px]" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={toggle}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="tap-press mx-auto mb-1 grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <PanelLeftOpen className="size-[18px]" />
        </button>
      )}

      <nav className={`thin-scroll mt-1 flex-1 space-y-1 overflow-y-auto overflow-x-hidden ${collapsed ? "px-2" : "px-3"}`}>
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              title={collapsed ? n.label : undefined}
              className={`tap-press relative flex w-full items-center rounded-lg py-2.5 text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              } ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              {n.icon}
              {!collapsed && <span className="flex-1 text-left">{n.label}</span>}

              {/* expanded badges */}
              {!collapsed && n.id === "queue" && pending > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {pending}
                </span>
              )}
              {!collapsed && n.id === "scraper" && hasNew && (
                <span title="New data available on a source" className="size-2 rounded-full bg-emerald-400 pulse-dot" />
              )}

              {/* collapsed: corner dots so signals aren't lost */}
              {collapsed && n.id === "queue" && pending > 0 && (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
              )}
              {collapsed && n.id === "scraper" && hasNew && (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-emerald-400 pulse-dot" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        {collapsed ? (
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
              AK
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">Admin</p>
              <p className="truncate text-[11px] text-muted-foreground">local control panel</p>
            </div>
            <ThemeToggle />
          </div>
        )}
      </div>
    </aside>
  );
}
