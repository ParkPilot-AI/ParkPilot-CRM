/**
 * Time-zone helpers without a date library. Parks enter tour times in their own local time
 * (Europe/London by default); the database stores UTC.
 */

/** Offset of `timeZone` from UTC at the instant `utcMs`, in minutes (e.g. BST → 60). */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** "2026-11-21" + "14:30" in `timeZone` → UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset correctly around clock changes.
  let utc = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  utc = naive - zoneOffsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc);
}

/** Calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function zonedDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Start and end (exclusive) of the local day containing `at`, as UTC ISO strings. */
export function dayBounds(at: Date, timeZone: string): { start: string; end: string } {
  const today = zonedDate(at, timeZone);
  const start = zonedToUtc(today, "00:00", timeZone);
  const end = zonedToUtc(addDays(today, 1), "00:00", timeZone);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Add whole days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
