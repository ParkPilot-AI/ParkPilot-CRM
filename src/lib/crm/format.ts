/** Display helpers. British English, en-GB formats. */

type Named = {
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  phone?: string | null;
};

export function personName(p: Named | null | undefined): string {
  if (!p) return "Unknown";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || p.phone || "Unnamed";
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s@.]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function formatDate(iso: string | null | undefined, timeZone = "Europe/London"): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone = "Europe/London"): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone = "Europe/London"): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined, timeZone = "Europe/London"): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function formatMoney(value: number | null | undefined): string {
  return value == null ? "" : money.format(value);
}

export function formatBudget(min: number | null, max: number | null): string {
  if (min == null && max == null) return "";
  if (min != null && max != null) return `${formatMoney(min)}–${formatMoney(max)}`;
  return min != null ? `From ${formatMoney(min)}` : `Up to ${formatMoney(max)}`;
}

/** Whole days between an ISO time and now (never negative). */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

export function ago(iso: string, now: Date = new Date()): string {
  const d = daysSince(iso, now);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  if (d < 31) return w === 1 ? "1 week ago" : `${w} weeks ago`;
  const m = Math.floor(d / 30);
  return m <= 1 ? "1 month ago" : `${m} months ago`;
}

/** Display a stored E.164 number in UK style where it's a UK number (+447700900123 → 07700 900123). */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  if (!e164.startsWith("+44") || e164.length !== 13) return e164;
  const local = `0${e164.slice(3)}`;
  // 02x area codes (London, Cardiff, Belfast…) read as 020 7946 0000; others as 01754 123456.
  return local.startsWith("02")
    ? `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`
    : `${local.slice(0, 5)} ${local.slice(5)}`;
}
