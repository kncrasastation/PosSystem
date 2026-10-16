/** Calendar date (YYYY-MM-DD) of `at` in the given IANA timezone. */
export function businessDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-MY", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateString = (s: string | undefined): s is string => !!s && DATE_RE.test(s);

/** Monday of the week containing `date` (YYYY-MM-DD). Pure calendar arithmetic in UTC. */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
