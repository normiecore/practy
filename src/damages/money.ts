import type { IsoDate } from "../core/calendar.js";

/**
 * Integer arithmetic for money. All amounts are cents; rates are basis points
 * (1% = 100 bps); weeks and years are carried in hundredths, multipliers in tenths.
 *
 * Rounding policy: every figure that is displayed in a calculation line is rounded
 * (half away from zero) to its displayed precision before it is used in the next
 * step, so each printed line can be reproduced by hand from the printed numbers.
 */
export type Cents = number;

/** num / den rounded half away from zero, exact for integer inputs below 2^53. */
export function roundDiv(num: number, den: number): number {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0) {
    throw new Error(`roundDiv needs integers: ${num}/${den}`);
  }
  const sign = Math.sign(num) * Math.sign(den);
  const n = Math.abs(num);
  const d = Math.abs(den);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (2 * r >= d ? q + 1 : q);
}

/** Percent (e.g. 11.5) to basis points (1150). */
export const bps = (percent: number): number => Math.round(percent * 100);

export function fmtMoney(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  // Manual grouping: locale data is not guaranteed in every Node build.
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Plain number with thousands separators and 2 decimals, no "$" (Python's f"{x:,.2f}"). */
export function fmtNumber(cents: Cents): string {
  return fmtMoney(cents).replace("$", "");
}

/** Hundredths (weeks, years) as "130.29". */
export const fmtHundredths = (h: number): string => (h / 100).toFixed(2);

/** Basis points as a percent string without trailing zeros: 1150 -> "11.5%". */
export const fmtPct = (b: number): string => `${Number((b / 100).toFixed(2))}%`;

export function fmtDate(d: IsoDate): string {
  const [y, m, day] = d.split("-");
  return `${Number(day)}/${Number(m)}/${y}`;
}

const MS_PER_DAY = 86_400_000;
const utc = (d: IsoDate) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};

/** Days from `a` to `b` (b - a). */
export const diffDays = (a: IsoDate, b: IsoDate): number => Math.round((utc(b) - utc(a)) / MS_PER_DAY);

/** Weeks in an inclusive period, in hundredths (1/7/2024 to 30/6/2025 = 52.14 weeks). */
export const weeksInclusive = (from: IsoDate, to: IsoDate): number => roundDiv((diffDays(from, to) + 1) * 100, 7);

/** Years between two dates in hundredths, on a 365.25-day year. */
export const yearsBetween = (from: IsoDate, to: IsoDate): number => roundDiv(diffDays(from, to) * 400, 1461);
