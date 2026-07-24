/**
 * Pure scheduling helpers — no Node/DB imports, so both the API routes
 * (server) and the SchedulesView (client) can share them. Times are evaluated
 * in the machine's LOCAL timezone (the box the GUI runs on); the UI says so.
 */

export type ScheduleKind = "interval" | "daily" | "weekly" | "cron";

export type ScheduleConfig = {
  intervalMinutes?: number; // interval
  times?: string[]; // daily / weekly — "HH:MM"
  days?: number[]; // weekly — 0..6, 0 = Sunday
  expr?: string; // cron — "m h dom mon dow"
};

export type Schedule = {
  id: number;
  name: string;
  enabled: boolean;
  kind: ScheduleKind;
  config: ScheduleConfig;
  durationMin: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse ["HH:MM"] → sorted [[h,m]] pairs, dropping anything malformed. */
function parseTimes(times?: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const t of times ?? []) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? "").trim());
    if (!m) continue;
    const h = +m[1];
    const min = +m[2];
    if (h >= 0 && h < 24 && min >= 0 && min < 60) out.push([h, min]);
  }
  return out.sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
}

const atTime = (base: Date, h: number, m: number) => {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
};

/** One cron field → the set of allowed integers, or null if the field is bad. */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let range = part;
    let step = 1;
    const slash = part.split("/");
    if (slash.length === 2) {
      range = slash[0];
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step < 1) return null;
    } else if (slash.length > 2) {
      return null;
    }
    let lo = min;
    let hi = max;
    if (range === "*") {
      // full span
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      lo = a;
      hi = b;
    } else {
      const n = Number(range);
      if (!Number.isInteger(n)) return null;
      lo = hi = n;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

/** Next fire time strictly after `from` for a standard 5-field cron, or null. */
export function nextCron(expr: string, from: Date): Date | null {
  const parts = (expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const dow = parseCronField(parts[4], 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  const domRestricted = parts[2] !== "*";
  const dowRestricted = parts[4] !== "*";

  // start at the next whole minute after `from`
  const d = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (
      minute.has(d.getMinutes()) &&
      hour.has(d.getHours()) &&
      month.has(d.getMonth() + 1)
    ) {
      const domOk = dom.has(d.getDate());
      const dowOk = dow.has(d.getDay());
      // Standard cron: when BOTH day fields are restricted, either may match.
      const dayOk =
        domRestricted && dowRestricted
          ? domOk || dowOk
          : domRestricted
            ? domOk
            : dowRestricted
              ? dowOk
              : true;
      if (dayOk) return new Date(d);
    }
    d.setTime(d.getTime() + 60000);
  }
  return null;
}

/**
 * Next fire time strictly after `from`, or null if the config can't produce one.
 * For interval schedules, `lastRun` anchors the cadence (falls back to `from`).
 */
export function computeNextRun(
  kind: ScheduleKind,
  config: ScheduleConfig,
  from: Date = new Date(),
  lastRun: Date | null = null
): Date | null {
  const now = from.getTime();

  if (kind === "interval") {
    const mins = Math.max(1, Math.round(config.intervalMinutes ?? 60));
    const step = mins * 60000;
    const base = lastRun ? lastRun.getTime() : now;
    let next = base + step;
    if (next <= now) {
      const missed = Math.ceil((now - base) / step);
      next = base + Math.max(1, missed) * step;
    }
    return new Date(next);
  }

  if (kind === "daily") {
    const times = parseTimes(config.times);
    if (!times.length) return null;
    for (let day = 0; day <= 1; day++) {
      const base = new Date(from);
      base.setDate(base.getDate() + day);
      for (const [h, m] of times) {
        const c = atTime(base, h, m);
        if (c.getTime() > now) return c;
      }
    }
    return null;
  }

  if (kind === "weekly") {
    const times = parseTimes(config.times);
    const days = (config.days ?? []).filter((d) => d >= 0 && d <= 6);
    if (!times.length || !days.length) return null;
    for (let off = 0; off <= 7; off++) {
      const base = new Date(from);
      base.setDate(base.getDate() + off);
      if (!days.includes(base.getDay())) continue;
      for (const [h, m] of times) {
        const c = atTime(base, h, m);
        if (c.getTime() > now) return c;
      }
    }
    return null;
  }

  if (kind === "cron") return nextCron(config.expr ?? "", from);
  return null;
}

/** True when the config is complete enough to ever fire. */
export function isValidSchedule(kind: ScheduleKind, config: ScheduleConfig): boolean {
  return computeNextRun(kind, config, new Date()) !== null;
}

/** Human-readable one-liner for the schedule cards. */
export function humanizeSchedule(kind: ScheduleKind, config: ScheduleConfig): string {
  if (kind === "interval") {
    const m = Math.max(1, Math.round(config.intervalMinutes ?? 60));
    if (m % 1440 === 0) return `Every ${m / 1440} day${m / 1440 > 1 ? "s" : ""}`;
    if (m % 60 === 0) return `Every ${m / 60} hour${m / 60 > 1 ? "s" : ""}`;
    return `Every ${m} min`;
  }
  if (kind === "daily") {
    const t = parseTimes(config.times).map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    return t.length ? `Daily at ${t.join(", ")}` : "Daily (no time set)";
  }
  if (kind === "weekly") {
    const days = (config.days ?? []).filter((d) => d >= 0 && d <= 6).sort().map((d) => WEEKDAYS[d]);
    const t = parseTimes(config.times).map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    return `${days.length ? days.join(", ") : "No days"} at ${t.length ? t.join(", ") : "—"}`;
  }
  if (kind === "cron") return `cron: ${config.expr || "—"}`;
  return "";
}

/** Compact "in 3h 20m" / "2m ago" style relative label. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  const past = diff < 0;
  let s = Math.round(Math.abs(diff) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [d && `${d}d`, h && `${h}h`, !d && m ? `${m}m` : "", !d && !h && !m ? "<1m" : ""].filter(Boolean).slice(0, 2);
  const body = parts.join(" ");
  return past ? `${body} ago` : `in ${body}`;
}
