import { cn } from "@/lib/utils";

/**
 * The one toggle switch used everywhere (Settings, Sources, Schedules).
 * A single component keeps every switch the same size, motion, and focus ring
 * instead of the hand-rolled pills each view used to carry.
 *
 *   <Switch checked={on} onCheckedChange={setOn} />
 *   <Switch size="sm" variant="success" checked={x} onCheckedChange={…} />
 */
type SwitchProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "success";
  className?: string;
  "aria-label"?: string;
  title?: string;
};

const SIZE = {
  md: { track: "h-6 w-11", knob: "size-5", on: "translate-x-5" },
  sm: { track: "h-5 w-9", knob: "size-4", on: "translate-x-4" },
} as const;

const ON_BG = {
  primary: "bg-primary shadow-inner shadow-primary/30",
  success: "bg-emerald-500 shadow-inner shadow-emerald-600/40",
} as const;

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  size = "md",
  variant = "primary",
  className,
  title,
  ...aria
}: SwitchProps) {
  const s = SIZE[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "transition-colors duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        s.track,
        checked ? ON_BG[variant] : "bg-accent",
        className
      )}
      {...aria}
    >
      <span
        className={cn(
          "pointer-events-none rounded-full bg-white shadow-md transition-transform duration-200 ease-out",
          s.knob,
          checked ? s.on : "translate-x-0"
        )}
      />
    </button>
  );
}
