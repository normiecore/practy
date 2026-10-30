/**
 * Date arithmetic on plain ISO dates (YYYY-MM-DD), timezone-free.
 * Legal dates are calendar dates in the matter's jurisdiction, not instants.
 */

export type IsoDate = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parts(d: IsoDate): [number, number, number] {
  if (!ISO.test(d)) throw new Error(`Not an ISO date: ${d}`);
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return [y, m, day];
}

const fmt = (dt: Date): IsoDate => dt.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = parts(d);
  return fmt(utc(y, m, day + n));
}

/**
 * Adds calendar months. If the target month is shorter (e.g. 29 Feb + 12 months)
 * the day is clamped to the month end and `clamped` is true so callers can flag it.
 */
export function addMonths(d: IsoDate, n: number): { date: IsoDate; clamped: boolean } {
  const [y, m, day] = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const max = daysInMonth(ty, tm);
  return { date: fmt(utc(ty, tm, Math.min(day, max))), clamped: day > max };
}

export const addYears = (d: IsoDate, n: number) => addMonths(d, n * 12);

export function weekday(d: IsoDate): number {
  const [y, m, day] = parts(d);
  return utc(y, m, day).getUTCDay();
}

export interface WorkingCalendar {
  isWorkingDay(d: IsoDate): boolean;
}

export function workingCalendar(holidays: Iterable<IsoDate>): WorkingCalendar {
  const set = new Set(holidays);
  return {
    isWorkingDay: (d) => {
      const wd = weekday(d);
      return wd !== 0 && wd !== 6 && !set.has(d);
    },
  };
}

/** The date `n` working days after `d` (d itself is not counted). */
export function addWorkingDays(cal: WorkingCalendar, d: IsoDate, n: number): IsoDate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (cal.isWorkingDay(cur)) left--;
  }
  return cur;
}

/** Working days strictly after `from` up to and including `to`. */
export function workingDaysBetween(cal: WorkingCalendar, from: IsoDate, to: IsoDate): number {
  let count = 0;
  for (let cur = addDays(from, 1); cur <= to; cur = addDays(cur, 1)) {
    if (cal.isWorkingDay(cur)) count++;
  }
  return count;
}

export function endOfMonth(d: IsoDate): IsoDate {
  const [y, m] = parts(d);
  return fmt(utc(y, m, daysInMonth(y, m)));
}

/**
 * WA public holidays (Public and Bank Holidays Act 1972 (WA)), including
 * substitute days when a holiday falls on a weekend.
 * [verify] against https://www.wa.gov.au/service/employment/workplace-arrangements/public-holidays-western-australia
 * before relying on deadline computations. Tenants can override via configuration.
 */
export const WA_PUBLIC_HOLIDAYS: readonly IsoDate[] = [
  // 2026
  "2026-01-01", "2026-01-26", "2026-03-02", "2026-04-03", "2026-04-05", "2026-04-06",
  "2026-04-27", "2026-06-01", "2026-09-28", "2026-12-25", "2026-12-28",
  // 2027
  "2027-01-01", "2027-01-26", "2027-03-01", "2027-03-26", "2027-03-28", "2027-03-29",
  "2027-04-26", "2027-06-07", "2027-09-27", "2027-12-27", "2027-12-28",
];

export const WA_CALENDAR = workingCalendar(WA_PUBLIC_HOLIDAYS);
