"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar, { type View } from "@/components/Sidebar";
import DashboardView from "@/components/views/DashboardView";
import ScraperView from "@/components/views/ScraperView";
import QueueView from "@/components/views/QueueView";
import SchedulesView from "@/components/views/SchedulesView";
import SourcesView from "@/components/views/SourcesView";
import SettingsView from "@/components/views/SettingsView";
import LogsView from "@/components/views/LogsView";
import ManualView from "@/components/views/ManualView";

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => r.json())
        .then((s) => alive && setPending(s.pending ?? 0))
        .catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [refreshKey]);

  return (
    // Viewport-locked shell: the sidebar stays fixed, only <main> scrolls.
    <div className="flex h-screen overflow-hidden">
      <Sidebar view={view} setView={setView} pending={pending} />
      <main className="thin-scroll min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-[1200px] px-8 pb-10">
          {view === "dashboard" && <DashboardView key={refreshKey} onNavigate={setView} />}
          {view === "scraper" && <ScraperView onChange={refresh} />}
          {view === "queue" && <QueueView refreshKey={refreshKey} onChange={refresh} />}
          {view === "schedules" && <SchedulesView />}
          {view === "sources" && <SourcesView />}
          {view === "settings" && <SettingsView />}
          {view === "logs" && <LogsView />}
          {view === "manual" && <ManualView />}
        </div>
      </main>
    </div>
  );
}
