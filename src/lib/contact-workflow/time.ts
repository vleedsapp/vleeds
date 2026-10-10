import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";
import { isValidTimeZone } from "@/lib/config/timezone";

/**
 * Workspace time (P1-E7). Timestamps are stored as UTC instants; the
 * workspace's IANA time zone only decides "today", display and how a typed
 * date + time is read. Conversions use @date-fns/tz (IANA data from the
 * runtime's Intl), never hand-written offset arithmetic, so daylight-saving
 * changes are handled: a day can be 23 or 25 hours long, and a local time that
 * doesn't exist (clocks jump forward) is moved forward by the gap.
 */

export { isValidTimeZone, timeZoneOptions } from "@/lib/config/timezone";

/** Start (inclusive) and end (exclusive) of the workspace-local calendar day containing `now`, as UTC instants. */
export function dayBounds(now: Date, tz: string): { start: Date; end: Date } {
  const start = startOfDay(new TZDate(now.getTime(), tz));
  const end = addDays(start, 1);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Reads a date ("2026-10-12") and time ("14:00") typed in the workspace zone; null if either is not a real value. */
export function localDateTimeToUtc(date: string, time: string, tz: string): Date | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t || !isValidTimeZone(tz)) return null;
  const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  // Reject impossible calendar dates (e.g. 2026-02-30) instead of rolling them over.
  const probe = new Date(Date.UTC(y, m - 1, day));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return null;
  const local = new TZDate(y, m - 1, day, Number(t[1]), Number(t[2]), 0, tz);
  return Number.isNaN(local.getTime()) ? null : new Date(local.getTime());
}

/** The workspace-local date ("2026-10-12") and time ("14:00") of an instant (for prefilling inputs). */
export function utcToLocalInput(iso: string | Date, tz: string): { date: string; time: string } {
  const z = new TZDate(new Date(iso).getTime(), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}`, time: `${p(z.getHours())}:${p(z.getMinutes())}` };
}

const dayNumber = (iso: string | Date, tz: string) => {
  const z = new TZDate(new Date(iso).getTime(), tz);
  return Date.UTC(z.getFullYear(), z.getMonth(), z.getDate()) / 86_400_000;
};

/**
 * Compact workspace-local label: "Today · 10:42", "Yesterday · 16:05",
 * "Tomorrow · 14:00", "Mon 12 Oct · 09:30", or with the year when it differs.
 */
export function formatWhen(iso: string | Date, now: Date, tz: string): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const diff = dayNumber(at, tz) - dayNumber(now, tz);
  if (diff === 0) return `Today · ${time}`;
  if (diff === -1) return `Yesterday · ${time}`;
  if (diff === 1) return `Tomorrow · ${time}`;
  const sameYear = new TZDate(at.getTime(), tz).getFullYear() === new TZDate(now.getTime(), tz).getFullYear();
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
  return `${date.replace(",", "")} · ${time}`;
}

/** "Europe/London" → "Europe/London (GMT+1)" for the current offset; plain zone if the runtime can't name it. */
export function timeZoneLabel(tz: string, now: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value;
    return part && part !== tz ? `${tz} (${part})` : tz;
  } catch {
    return tz;
  }
}
