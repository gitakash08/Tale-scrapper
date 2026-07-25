"use client";

/**
 * Annotated screen guide: a miniature of a real screen with numbered markers,
 * plus a legend explaining each one.
 *
 * These are built from the app's own tokens rather than captured PNGs, so they
 * follow the active theme and can't drift out of date the way a screenshot
 * would. `spots` are positioned in % of the mock, so they stay aligned at any
 * width.
 */
export type Spot = { n: number; x: number; y: number; label: React.ReactNode };

export function Figure({
  title, caption, spots, children,
}: {
  title: string;
  caption?: string;
  spots: Spot[];
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Screen</span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>

      {/* the mock, with markers layered on top */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-ink-2 p-3">
        <div className="pointer-events-none select-none">{children}</div>
        {spots.map((s) => (
          <span
            key={s.n}
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-lg ring-2 ring-card"
            aria-hidden
          >
            {s.n}
          </span>
        ))}
      </div>

      <figcaption className="mt-3">
        {caption && <p className="mb-2 text-sm text-muted-foreground">{caption}</p>}
        <ol className="space-y-1.5">
          {spots.map((s) => (
            <li key={s.n} className="flex gap-2.5 text-sm">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                {s.n}
              </span>
              <span className="text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{s.label}</span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

/* ── tiny building blocks for the mocks ───────────────────────────── */

export const MockBar = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 ${className}`}>{children}</div>
);

export const MockBtn = ({ children, tone = "ghost" }: { children: React.ReactNode; tone?: "primary" | "ghost" | "success" | "sky" }) => (
  <span
    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
      tone === "primary" ? "bg-primary text-primary-foreground"
        : tone === "success" ? "bg-emerald-500 text-emerald-950"
        : tone === "sky" ? "bg-sky-400/20 text-sky-300"
        : "border border-border text-muted-foreground"
    }`}
  >
    {children}
  </span>
);

export const MockCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-lg border border-border bg-card p-2.5 ${className}`}>{children}</div>
);

export const MockRow = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2 text-[11px] last:border-0">{children}</div>
);

export const Dim = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] text-muted-foreground">{children}</span>
);
