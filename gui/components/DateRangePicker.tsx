"use client";

import * as React from "react";
import type { DateRange } from "react-day-picker";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Preset + custom range picker: quick ranges on the left, a calendar on the
 * right, and an explicit Apply so the caller isn't refetched on every click.
 *
 * Dates are exchanged as local YYYY-MM-DD strings (what the APIs expect);
 * an empty range means "all time".
 */
export type Range = { from: string; to: string };

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (n: number, base = new Date()) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
/** Monday-based start of the week containing `d`. */
const weekStart = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; };
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

type PresetId =
  | "all" | "today" | "yesterday" | "thisWeek" | "thisMonth"
  | "lastWeek" | "lastMonth" | "last7" | "last30";

/** Groups mirror the reference layout — separators fall between them. */
const PRESET_GROUPS: { id: PresetId; label: string }[][] = [
  [{ id: "all", label: "For all time" }, { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "thisWeek", label: "This week" }],
  [{ id: "thisMonth", label: "This month" }],
  [{ id: "lastWeek", label: "Last week" }, { id: "lastMonth", label: "Last month" }],
  [{ id: "last7", label: "Last 7 days" }, { id: "last30", label: "Last 30 days" }],
];
const ALL_PRESETS = PRESET_GROUPS.flat();

function presetRange(id: PresetId): Range {
  const now = new Date();
  switch (id) {
    case "today": return { from: ymd(now), to: ymd(now) };
    case "yesterday": return { from: ymd(shift(-1)), to: ymd(shift(-1)) };
    case "thisWeek": return { from: ymd(weekStart(now)), to: ymd(now) };
    case "thisMonth": return { from: ymd(monthStart(now)), to: ymd(now) };
    case "lastWeek": {
      const start = shift(-7, weekStart(now));
      return { from: ymd(start), to: ymd(shift(6, start)) };
    }
    case "lastMonth": {
      const m = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: ymd(monthStart(m)), to: ymd(monthEnd(m)) };
    }
    case "last7": return { from: ymd(shift(-6)), to: ymd(now) };
    case "last30": return { from: ymd(shift(-29)), to: ymd(now) };
    default: return { from: "", to: "" };
  }
}

/** Which preset (if any) a range corresponds to — drives the trigger label. */
function matchPreset(r: Range): PresetId | null {
  if (!r.from && !r.to) return "all";
  for (const p of ALL_PRESETS) {
    if (p.id === "all") continue;
    const pr = presetRange(p.id);
    if (pr.from === r.from && pr.to === r.to) return p.id;
  }
  return null;
}

const parse = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined;
};
const pretty = (s: string) =>
  parse(s)?.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) ?? "";

export function DateRangePicker({
  value, onChange, className,
}: { value: Range; onChange: (r: Range) => void; className?: string }) {
  const [open, setOpen] = React.useState(false);
  // draft state so Cancel can discard and Apply commits in one go
  const [draft, setDraft] = React.useState<Range>(value);
  const [month, setMonth] = React.useState<Date>(parse(value.from) ?? new Date());

  React.useEffect(() => { if (open) { setDraft(value); setMonth(parse(value.from) ?? new Date()); } }, [open, value]);

  const activePreset = matchPreset(draft);
  const label = (() => {
    const p = matchPreset(value);
    if (p) return ALL_PRESETS.find((x) => x.id === p)!.label;
    return value.from && value.to ? `${pretty(value.from)} – ${pretty(value.to)}` : "For all time";
  })();

  const selected: DateRange | undefined = draft.from
    ? { from: parse(draft.from), to: parse(draft.to) || parse(draft.from) }
    : undefined;

  const summary = draft.from
    ? `${pretty(draft.from)} – ${draft.to === ymd(new Date()) ? "Today" : pretty(draft.to)}`
    : "For all time";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "tap-press flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
            open ? "border-primary text-primary" : "border-border text-foreground hover:border-primary/50",
            className
          )}
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="max-w-[220px] truncate">{label}</span>
          <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          {/* presets */}
          <div className="min-w-[168px] border-b border-border p-2 sm:border-b-0 sm:border-r">
            {PRESET_GROUPS.map((group, gi) => (
              <div key={gi} className={cn(gi > 0 && "mt-1 border-t border-border pt-1")}>
                {group.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const r = presetRange(p.id);
                      setDraft(r);
                      if (r.from) setMonth(parse(r.from)!);
                    }}
                    className={cn(
                      "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      activePreset === p.id
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground hover:bg-accent"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* calendar */}
          <div className="relative">
            <Calendar
              mode="range"
              required={false}
              selected={selected}
              onSelect={(r: DateRange | undefined) =>
                setDraft({ from: r?.from ? ymd(r.from) : "", to: r?.to ? ymd(r.to) : r?.from ? ymd(r.from) : "" })
              }
              month={month}
              onMonthChange={setMonth}
              captionLayout="dropdown"
              startMonth={new Date(2015, 0)}
              endMonth={new Date(new Date().getFullYear() + 1, 11)}
              weekStartsOn={1}
              disabled={{ after: new Date() }}
            />
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-ink-2 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">{summary}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { onChange(draft); setOpen(false); }}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
