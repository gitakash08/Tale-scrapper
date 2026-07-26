"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * shadcn-style Calendar wrapping react-day-picker v10, mapped onto this app's
 * tokens so it themes with everything else (light and dark).
 *
 * Range selection paints a continuous band: rounded at the ends, square in the
 * middle, which is why the radius lives on the day CELL rather than the button.
 */
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "space-y-3",

        /* caption: month + year dropdowns flanked by nav arrows */
        month_caption: "flex items-center justify-center px-9 h-9",
        caption_label: "text-sm font-medium",
        dropdowns: "flex items-center gap-2",
        dropdown_root: "relative",
        dropdown:
          "appearance-none rounded-lg border border-border bg-card px-3 py-1.5 pr-7 text-sm " +
          "text-foreground outline-none transition-colors hover:border-primary/50 " +
          "focus-visible:border-primary cursor-pointer",

        nav: "flex items-center justify-between absolute inset-x-3 top-3 pointer-events-none",
        button_previous:
          "pointer-events-auto grid size-8 place-items-center rounded-lg text-muted-foreground " +
          "transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none",
        button_next:
          "pointer-events-auto grid size-8 place-items-center rounded-lg text-muted-foreground " +
          "transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none",

        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        weeks: "",
        week: "flex w-full mt-1",

        /* the cell carries the range band; the button carries the shape */
        day: "relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button:
          "size-9 rounded-lg font-normal transition-colors hover:bg-accent " +
          "focus-visible:outline-2 focus-visible:outline-ring aria-selected:opacity-100",

        range_start: "bg-primary/15 rounded-l-lg [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:font-semibold [&>button]:hover:bg-primary",
        range_middle: "bg-primary/15 [&>button]:hover:bg-primary/25",
        range_end: "bg-primary/15 rounded-r-lg [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:font-semibold [&>button]:hover:bg-primary",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:font-semibold",

        today: "[&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-primary/60",
        outside: "[&>button]:text-muted-foreground/40",
        disabled: "[&>button]:text-muted-foreground/30 [&>button]:pointer-events-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left"
            ? <ChevronLeft className="size-4" {...rest} />
            : <ChevronRight className="size-4" {...rest} />,
      }}
      {...props}
    />
  );
}
