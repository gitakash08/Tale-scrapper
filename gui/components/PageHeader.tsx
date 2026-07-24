/**
 * Sticky page header. Sits at the top of the scrolling <main>, spans the
 * container's horizontal padding (-mx-8 px-8) and stays put while content
 * scrolls beneath it.
 */
export default function PageHeader({
  title, subtitle, children,
}: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 -mx-8 mb-5 border-b border-border bg-background/95 px-8 pb-4 pt-7 backdrop-blur">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}
