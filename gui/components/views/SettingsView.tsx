"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";

type Prefs = { appName: string; itemsPerPage: number; confirmDelete: boolean; sound: boolean };
const DEFAULTS: Prefs = { appName: "R-Tale Scraper", itemsPerPage: 20, confirmDelete: true, sound: false };

export default function SettingsView() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try { const raw = localStorage.getItem("rts-prefs"); if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) }); } catch { /* */ }
  }, []);
  function save() {
    localStorage.setItem("rts-prefs", JSON.stringify(prefs));
    setSaved(true); setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your application preferences.">
        <Button size="sm" onClick={save}>{saved ? <Check /> : null} {saved ? "Saved" : "Save changes"}</Button>
      </PageHeader>

      <div className="card max-w-lg p-5">
        <h2 className="mb-4 font-semibold">General</h2>
        <Field label="Application name">
          <input value={prefs.appName} onChange={(e) => setPrefs({ ...prefs, appName: e.target.value })}
            className="w-full rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm outline-none focus:border-primary" />
        </Field>
        <Field label="Items per page">
          <select value={prefs.itemsPerPage} onChange={(e) => setPrefs({ ...prefs, itemsPerPage: Number(e.target.value) })}
            className="w-full rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm outline-none focus:border-primary">
            {[10, 20, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Theme"><div className="rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm text-muted-foreground">Dark (default)</div></Field>
        <Toggle label="Confirm before deleting" checked={prefs.confirmDelete} onChange={(v) => setPrefs({ ...prefs, confirmDelete: v })} />
        <Toggle label="Enable sound" checked={prefs.sound} onChange={(v) => setPrefs({ ...prefs, sound: v })} />
        <p className="mt-4 text-xs text-muted-foreground">Preferences are stored locally in your browser.</p>
      </div>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-4"><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>{children}</div>
);
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      <button onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-primary" : "bg-secondary"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
