"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, X, Eye, RefreshCw, Inbox, Star, CheckCheck, Sparkles, Loader2, ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Item = {
  slug: string; title: string; originalTitle: string | null; year: number;
  country: string; rating: number; contentType: "drama" | "tv" | "movie";
  source: string; synopsis: string; genres: string;
};
type Priority = "high" | "medium" | "low";
const priorityOf = (r: number): Priority => (r >= 8.5 ? "high" : r >= 7.5 ? "medium" : "low");
const PBADGE: Record<Priority, string> = {
  high: "bg-primary/15 text-rose-light",
  medium: "bg-amber-400/15 text-amber-300",
  low: "bg-white/10 text-muted-foreground",
};

export default function QueueView({ refreshKey, onChange }: { refreshKey: number; onChange?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | Priority>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { pending } = await fetch("/api/pending?limit=60", { cache: "no-store" }).then((r) => r.json());
      setItems(pending ?? []);
      setSelected(new Set());
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const counts = useMemo(() => {
    const c = { all: items.length, high: 0, medium: 0, low: 0 };
    for (const it of items) c[priorityOf(it.rating)]++;
    return c;
  }, [items]);

  const shown = useMemo(
    () => (tab === "all" ? items : items.filter((i) => priorityOf(i.rating) === tab)),
    [items, tab]
  );

  /**
   * Optimistic remove: animate out, then drop from local state. Deliberately
   * does NOT call the parent onChange — bumping the shared refreshKey would
   * re-fetch the whole queue and flash the loading state on every approval
   * (the "reloads again and again" jank). The sidebar's pending badge stays in
   * sync via its own 5s poll instead.
   */
  function removeLocal(slugs: string[]) {
    setLeaving((prev) => new Set([...prev, ...slugs]));
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => !slugs.includes(i.slug)));
      setLeaving((prev) => { const n = new Set(prev); slugs.forEach((s) => n.delete(s)); return n; });
      setSelected((prev) => { const n = new Set(prev); slugs.forEach((s) => n.delete(s)); return n; });
    }, 320);
  }

  async function single(slug: string, action: "approve" | "reject") {
    removeLocal([slug]); // update UI instantly
    fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, action }) });
  }

  async function bulk(payload: object, targetSlugs: string[]) {
    setBusy(true);
    setMenu(false);
    removeLocal(targetSlugs);
    await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
  }

  const toggle = (slug: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  const allShownSelected = shown.length > 0 && shown.every((i) => selected.has(i.slug));

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Approval Queue</h1>
          <p className="text-sm text-muted-foreground">Review and approve scraped items before they enter the catalog.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className={loading ? "spin" : ""} /> Refresh</Button>
          {/* Bulk approve menu */}
          <div className="relative" ref={menuRef}>
            <Button size="sm" onClick={() => setMenu((m) => !m)} disabled={busy || items.length === 0}>
              {busy ? <Loader2 className="spin" /> : <CheckCheck />} Bulk approve <ChevronDown className="size-3.5" />
            </Button>
            {menu && (
              <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-xl fade-up">
                <MenuItem icon={<Sparkles className="size-4 text-primary" />} label="Approve all pending"
                  hint={`${items.length}`} onClick={() => bulk({ action: "approve", scope: "all" }, items.map((i) => i.slug))} />
                <MenuItem icon={<Star className="size-4 text-rose-light" />} label="Approve rating 8.5+"
                  hint={`${counts.high}`} onClick={() => bulk({ action: "approve", scope: "rating", min: 8.5 }, items.filter((i) => i.rating >= 8.5).map((i) => i.slug))} />
                <MenuItem icon={<Star className="size-4 text-amber-300" />} label="Approve rating 7.5+"
                  hint={`${counts.high + counts.medium}`} onClick={() => bulk({ action: "approve", scope: "rating", min: 7.5 }, items.filter((i) => i.rating >= 7.5).map((i) => i.slug))} />
                <MenuItem icon={<Check className="size-4 text-emerald-400" />} label={`Approve selected`}
                  hint={`${selected.size}`} disabled={selected.size === 0}
                  onClick={() => bulk({ action: "approve", scope: "selected", slugs: [...selected] }, [...selected])} />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Priority tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`tap-press rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === id ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>
            {label} <span className="ml-1 opacity-70">{counts[id]}</span>
          </button>
        ))}
        {selected.size > 0 && (
          <Button size="sm" variant="success" className="ml-auto"
            onClick={() => bulk({ action: "approve", scope: "selected", slugs: [...selected] }, [...selected])}>
            <Check /> Approve selected ({selected.size})
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading pending titles…</p>
      ) : shown.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border bg-card py-20 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="font-semibold">Queue clear 🎉</p>
          <p className="text-sm text-muted-foreground">Nothing awaiting review here. Run a scrape to fill it.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* table header */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allShownSelected}
              onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((i) => i.slug)))} />
            <span className="flex-1">Item</span>
            <span className="hidden w-24 sm:block">Source</span>
            <span className="hidden w-20 md:block">Priority</span>
            <span className="w-28 text-right">Actions</span>
          </div>
          {shown.map((it) => {
            const pr = priorityOf(it.rating);
            const out = leaving.has(it.slug);
            return (
              <div key={it.slug}
                className={`flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-0 hover:bg-white/[0.02] ${out ? "row-out" : "fade-up"}`}>
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selected.has(it.slug)} onChange={() => toggle(it.slug)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/poster/${it.slug}`} alt="" className="h-14 w-10 shrink-0 rounded-md object-cover bg-secondary" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{it.title}</p>
                    <Badge variant={it.contentType}>{it.contentType}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {it.originalTitle} · {it.year} · {it.country} · <Star className="inline size-3 fill-primary text-primary" /> {it.rating.toFixed(1)}
                  </p>
                </div>
                <span className="hidden w-24 truncate text-xs capitalize text-muted-foreground sm:block">{it.source}</span>
                <span className="hidden w-20 md:block">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${PBADGE[pr]}`}>{pr}</span>
                </span>
                <div className="flex w-28 justify-end gap-1">
                  <button title="Preview" className="tap-press grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    onClick={() => window.open(`/api/poster/${it.slug}`, "_blank")}><Eye className="size-4" /></button>
                  <button title="Approve" className="tap-press grid size-8 place-items-center rounded-lg text-emerald-400 hover:bg-emerald-400/10"
                    onClick={() => single(it.slug, "approve")}><Check className="size-4" /></button>
                  <button title="Reject" className="tap-press grid size-8 place-items-center rounded-lg text-primary hover:bg-primary/10"
                    onClick={() => single(it.slug, "reject")}><X className="size-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick, disabled }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-white/[0.04] disabled:opacity-40">
      {icon}<span className="flex-1">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}
