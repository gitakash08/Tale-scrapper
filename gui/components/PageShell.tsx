/**
 * Per-page layout: a FIXED header region (title + actions + optional extra row
 * like tabs/filters) that stays put, and a single scroll area beneath it for
 * the body. Keeps the sidebar and header stationary — only content moves.
 */
export default function PageShell({
  title, subtitle, actions, headerExtra, children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-end justify-between gap-4 px-8 pt-6 pb-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {headerExtra && <div className="mx-auto max-w-[1200px] px-8 pb-3">{headerExtra}</div>}
      </header>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-8 py-6">{children}</div>
      </div>
    </div>
  );
}
