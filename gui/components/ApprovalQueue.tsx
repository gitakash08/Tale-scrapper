"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, RefreshCw, Star, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Pending = {
  slug: string; title: string; originalTitle: string | null; year: number;
  country: string; rating: number; contentType: "drama" | "tv" | "movie";
  source: string; synopsis: string; genres: string;
};

export default function ApprovalQueue({ refreshKey, onChange }: { refreshKey: number; onChange?: () => void }) {
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState<Record<string, "approve" | "reject">>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { pending } = await fetch("/api/pending?limit=36", { cache: "no-store" }).then((r) => r.json());
      setItems(pending ?? []);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function act(slug: string, action: "approve" | "reject") {
    setLeaving((l) => ({ ...l, [slug]: action }));
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, action }),
    });
    setTimeout(() => {
      setItems((it) => it.filter((x) => x.slug !== slug));
      onChange?.();
    }, 250);
  }

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading pending titles…</p>;

  if (items.length === 0)
    return (
      <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border bg-card py-16 text-center">
        <Inbox className="size-8 text-muted-foreground" />
        <p className="font-semibold">Queue clear 🎉</p>
        <p className="text-sm text-muted-foreground">Nothing awaiting approval. Run a scrape to fill it.</p>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw /> Refresh</Button>
      </div>
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{items.length}</span> titles awaiting your review
        </p>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw /> Refresh</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => {
          const gone = leaving[it.slug];
          return (
            <div
              key={it.slug}
              className={`flex gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-300 ${
                gone === "approve" ? "translate-x-4 border-emerald-500/60 opacity-0"
                : gone === "reject" ? "-translate-x-4 border-destructive/60 opacity-0" : "fade-up"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/poster/${it.slug}`}
                alt=""
                className="h-36 w-24 shrink-0 rounded-lg object-cover bg-night-2"
                loading="lazy"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={it.contentType}>{it.contentType}</Badge>
                  <Badge variant="outline">{it.country}</Badge>
                  <Badge variant="outline" className="capitalize">{it.source}</Badge>
                </div>
                <h3 className="mt-1.5 truncate font-display font-semibold leading-tight">{it.title}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {it.originalTitle} · {it.year}
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs">
                  <Star className="size-3 fill-primary text-primary" />
                  <span className="font-semibold tabular-nums">{it.rating.toFixed(1)}</span>
                  <span className="ml-1 truncate text-muted-foreground">{it.genres}</span>
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">{it.synopsis}</p>
                <div className="mt-auto flex gap-2 pt-2">
                  <Button size="sm" variant="success" className="flex-1" onClick={() => act(it.slug, "approve")}>
                    <Check /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => act(it.slug, "reject")}>
                    <X /> Reject
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
