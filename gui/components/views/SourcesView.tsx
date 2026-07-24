"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Database, Link2, Lock, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";

type Source = {
  id: number; name: string; kind: string; baseUrl: string;
  enabled: boolean; builtin: boolean; lastSync: string | null;
};

export default function SourcesView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", baseUrl: "", kind: "sitemap" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() =>
    fetch("/api/sources", { cache: "no-store" }).then((r) => r.json()).then((d) => setSources(d.sources ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setErr("");
    if (!form.name.trim() || !form.baseUrl.trim()) { setErr("Name and URL are required."); return; }
    try { new URL(form.baseUrl); } catch { setErr("That doesn't look like a valid URL."); return; }
    setSaving(true);
    const res = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    if (res.ok) { setOpen(false); setForm({ name: "", baseUrl: "", kind: "sitemap" }); load(); }
    else setErr((await res.json()).error ?? "Failed to add source.");
  }
  async function toggle(s: Source) {
    setSources((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    await fetch("/api/sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, enabled: !s.enabled }) });
  }
  async function remove(s: Source) {
    setSources((prev) => prev.filter((x) => x.id !== s.id));
    await fetch(`/api/sources?id=${s.id}`, { method: "DELETE" });
  }

  return (
    <div>
      <PageHeader title="Sources" subtitle="Manage your data sources and connection settings.">
        <Button size="sm" onClick={() => setOpen(true)}><Plus /> Add Source</Button>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1.6fr_0.7fr_1.8fr_0.7fr_0.6fr] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Source name</span><span>Type</span><span>Base URL / endpoint</span><span>Status</span><span className="text-right">Actions</span>
        </div>
        {sources.map((s) => (
          <div key={s.id} className="grid grid-cols-[1.6fr_0.7fr_1.8fr_0.7fr_0.6fr] items-center gap-3 border-b border-border/60 px-4 py-3 text-sm last:border-0 hover:bg-white/[0.02] fade-up">
            <div className="flex items-center gap-2 font-medium">
              <Database className="size-4 text-muted-foreground" /> {s.name}
              {s.builtin && <Lock className="size-3 text-muted-foreground" />}
            </div>
            <span className="capitalize text-muted-foreground">{s.kind}</span>
            <span className="truncate text-muted-foreground">{s.baseUrl}</span>
            <button onClick={() => toggle(s)} className="flex w-fit items-center gap-1.5">
              <span className={`size-2 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-muted-foreground"}`} />
              <span className={s.enabled ? "text-emerald-400" : "text-muted-foreground"}>{s.enabled ? "Active" : "Inactive"}</span>
            </button>
            <div className="flex justify-end gap-1">
              {s.builtin ? (
                <span className="grid size-8 place-items-center text-muted-foreground/40" title="Built-in tuned connector"><Lock className="size-4" /></span>
              ) : (
                <button onClick={() => remove(s)} title="Remove" className="tap-press grid size-8 place-items-center rounded-lg text-primary hover:bg-primary/10"><Trash2 className="size-4" /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        <Lock className="mr-1 inline size-3" /> Built-in sources use tuned connectors and can't be removed. Custom sources use a
        best-effort generic connector (sitemap + Open&nbsp;Graph / JSON-LD) — great for standard sites, but arbitrary or
        JS-heavy pages may not yield clean data.
      </p>

      {/* Add-source modal */}
      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Add a source</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
            </div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. AsianWiki"
              className="mb-3 w-full rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm outline-none focus:border-primary" />
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Base URL / endpoint</label>
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-ink-2 px-3 focus-within:border-primary">
              <Link2 className="size-4 text-muted-foreground" />
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://example.com"
                className="w-full bg-transparent py-2 text-sm outline-none" />
            </div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Kind</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="mb-4 w-full rounded-lg border border-border bg-ink-2 px-3 py-2 text-sm outline-none focus:border-primary">
              <option value="sitemap">Website (sitemap + OG/JSON-LD)</option>
              <option value="api">API endpoint</option>
              <option value="manual">Manual entry</option>
            </select>
            {err && <p className="mb-3 text-xs text-primary">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={add} disabled={saving}>{saving ? <Loader2 className="spin" /> : <Plus />} Add source</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
