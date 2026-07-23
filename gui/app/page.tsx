"use client";

import { useCallback, useState } from "react";
import { Clapperboard, Gauge, Inbox, BarChart3 } from "lucide-react";
import ControlPanel from "@/components/ControlPanel";
import ApprovalQueue from "@/components/ApprovalQueue";
import StatsDashboard from "@/components/StatsDashboard";

type Tab = "control" | "queue" | "stats";

export default function Home() {
  const [tab, setTab] = useState<Tab>("control");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "control", label: "Scraper", icon: <Gauge className="size-4" /> },
    { id: "queue", label: "Approval Queue", icon: <Inbox className="size-4" /> },
    { id: "stats", label: "Dashboard", icon: <BarChart3 className="size-4" /> },
  ];

  return (
    <main className="min-h-screen">
      <div className="aurora">
        <header className="mx-auto max-w-6xl px-6 pt-10 pb-6">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <Clapperboard className="size-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold leading-tight">R-Tale Scraper</h1>
              <p className="text-sm text-muted-foreground">
                Discover K/C dramas, TV shows & movies — one click.
              </p>
            </div>
          </div>

          {/* tabs */}
          <div className="mt-6 flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`tap-press -mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-20">
        {tab === "control" && <ControlPanel onChange={refresh} />}
        {tab === "queue" && <ApprovalQueue refreshKey={refreshKey} onChange={refresh} />}
        {tab === "stats" && <StatsDashboard refreshKey={refreshKey} />}
      </div>
    </main>
  );
}
