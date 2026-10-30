import type { IsoDate } from "../core/calendar.js";
import { roundDiv, type Cents } from "./money.js";

/**
 * Effective-dated rate tables for WA plaintiff damages. Every table carries a
 * `source`; anything not confirmed against a primary source is `verified: false`
 * and must be confirmed by a practitioner before it is relied on.
 */

const FIRM_DAMAGES_RULES = "Soul Legal particulars-of-damages rules (firm standing rules)";

/** Financial year (1 July start) containing `d`, as the start year: 2024-10-01 -> 2024. */
export function financialYear(d: IsoDate): number {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return m >= 7 ? y : y - 1;
}

/** "2024–25" */
export const fyLabel = (startYear: number): string => `${startYear}–${String(startYear + 1).slice(2)}`;

export const fyStartDate = (startYear: number): IsoDate => `${startYear}-07-01`;
export const fyEndDate = (startYear: number): IsoDate => `${startYear + 1}-06-30`;

// ---------------------------------------------------------------------------
// Resident income tax
// ---------------------------------------------------------------------------

export interface TaxBracket {
  /** Rate applies to each dollar over this amount (whole dollars). */
  over: number;
  rateBps: number;
  /** False where the bracket comes from general knowledge rather than the firm's rules. */
  verified: boolean;
}

export interface TaxTable {
  financialYear: number;
  label: string;
  brackets: TaxBracket[];
  source: string;
  verified: boolean;
  notes: string[];
}

const ATO_RATES = "ATO individual income tax rates (residents)";
const upper2024 = (verified = false): TaxBracket[] => [
  { over: 135_000, rateBps: 3700, verified },
  { over: 190_000, rateBps: 4500, verified },
];
const stage3 = (firstBps: number, firstVerified: boolean): TaxBracket[] => [
  { over: 0, rateBps: 0, verified: true },
  { over: 18_200, rateBps: firstBps, verified: firstVerified },
  { over: 45_000, rateBps: 3000, verified: firstVerified },
  ...upper2024(),
];
const preStage3 = (verified: boolean): TaxBracket[] => [
  { over: 0, rateBps: 0, verified },
  { over: 18_200, rateBps: 1900, verified },
  { over: 45_000, rateBps: 3250, verified },
  { over: 120_000, rateBps: 3700, verified: false },
  { over: 180_000, rateBps: 4500, verified: false },
];

/**
 * Only brackets up to the income ranges stated in the firm's rules are marked
 * verified. Net = gross less income tax only: no Medicare levy, no offsets.
 */
export const TAX_TABLES: readonly TaxTable[] = [
  ...[2020, 2021, 2022].map((fy) => ({
    financialYear: fy,
    label: fyLabel(fy),
    brackets: preStage3(false),
    source: `${ATO_RATES} ${fyLabel(fy)}`,
    verified: false,
    notes: ["Not in the firm's rules; assumed equal to 2023–24 (stage 2 rates). Confirm before use."],
  })),
  {
    financialYear: 2023,
    label: fyLabel(2023),
    brackets: preStage3(true),
    source: `${FIRM_DAMAGES_RULES}; ${ATO_RATES} 2023–24`,
    verified: true,
    notes: ["Brackets above $120,000 are not stated in the firm's rules and are unverified."],
  },
  ...[2024, 2025].map((fy) => ({
    financialYear: fy,
    label: fyLabel(fy),
    brackets: stage3(1600, true),
    source: `${FIRM_DAMAGES_RULES}; ${ATO_RATES} ${fyLabel(fy)}`,
    verified: true,
    notes: ["Brackets above $135,000 are not stated in the firm's rules and are unverified."],
  })),
  {
    financialYear: 2026,
    label: fyLabel(2026),
    brackets: stage3(1500, false),
    source: `${FIRM_DAMAGES_RULES} ("2026–27: 15% to $45,000; 30% to $135,000")`,
    verified: false,
    notes: ["Firm rule: verify any later year before using it."],
  },
  {
    financialYear: 2027,
    label: fyLabel(2027),
    brackets: stage3(1400, false),
    source: `${FIRM_DAMAGES_RULES} ("From 2027–28 the first rate becomes 14%")`,
    verified: false,
    notes: ["Firm rule: verify any later year before using it."],
  },
];

export function taxTableFor(fy: number): TaxTable | undefined {
  return TAX_TABLES.find((t) => t.financialYear === fy);
}

/** Resident income tax on an annual taxable income, rounded to the cent. */
export function incomeTaxCents(annualCents: Cents, table: TaxTable): Cents {
  let tax = 0; // in cents x 10,000 (exact integer)
  const b = table.brackets;
  for (let i = 0; i < b.length; i++) {
    const lower = b[i]!.over * 100;
    const upper = i + 1 < b.length ? b[i + 1]!.over * 100 : Infinity;
    if (annualCents > lower) tax += (Math.min(annualCents, upper) - lower) * b[i]!.rateBps;
  }
  return roundDiv(tax, 10_000);
}

export interface NetWeekly {
  financialYear: number;
  label: string;
  grossWeeklyCents: Cents;
  annualGrossCents: Cents;
  annualTaxCents: Cents;
  netWeeklyCents: Cents;
  verified: boolean;
  source: string;
}

/** Gross weekly x 52, less resident income tax for the year, then / 52. */
export function netWeekly(grossWeeklyCents: Cents, fy: number): NetWeekly {
  const table = taxTableFor(fy);
  if (!table) throw new Error(`No income tax table for ${fyLabel(fy)}`);
  const annualGrossCents = grossWeeklyCents * 52;
  const annualTaxCents = incomeTaxCents(annualGrossCents, table);
  const usedBrackets = table.brackets.filter((b) => annualGrossCents > b.over * 100);
  return {
    financialYear: fy,
    label: table.label,
    grossWeeklyCents,
    annualGrossCents,
    annualTaxCents,
    netWeeklyCents: roundDiv(annualGrossCents - annualTaxCents, 52),
    verified: table.verified && usedBrackets.every((b) => b.verified),
    source: table.source,
  };
}

// ---------------------------------------------------------------------------
// Superannuation guarantee
// ---------------------------------------------------------------------------

export interface EffectiveRate {
  from: IsoDate;
  /** Inclusive; undefined means open-ended. */
  to?: IsoDate;
  rateBps: number;
  source: string;
  verified: boolean;
}

const SG_SOURCE = `${FIRM_DAMAGES_RULES}; Superannuation Guarantee (Administration) Act 1992 s 19`;
export const SG_RATES: readonly EffectiveRate[] = [
  { from: "2014-07-01", to: "2021-06-30", rateBps: 950, source: SG_SOURCE, verified: true },
  { from: "2021-07-01", to: "2022-06-30", rateBps: 1000, source: SG_SOURCE, verified: true },
  { from: "2022-07-01", to: "2023-06-30", rateBps: 1050, source: SG_SOURCE, verified: true },
  { from: "2023-07-01", to: "2024-06-30", rateBps: 1100, source: SG_SOURCE, verified: true },
  { from: "2024-07-01", to: "2025-06-30", rateBps: 1150, source: SG_SOURCE, verified: true },
  { from: "2025-07-01", rateBps: 1200, source: SG_SOURCE, verified: true },
];

export function sgRateFor(d: IsoDate): EffectiveRate {
  const r = SG_RATES.find((x) => x.from <= d && (!x.to || d <= x.to));
  if (!r) throw new Error(`No SG rate for ${d}`);
  return r;
}

// ---------------------------------------------------------------------------
// 6% weekly multipliers
// ---------------------------------------------------------------------------

export const MULTIPLIER_SOURCE =
  'Sparke Helmore WA Workers\' Compensation Guide, 6% weekly multiplier table (Box: "Table of 6% Multiplier WA - source - Sparke & Helmore.pdf")';

/** Multipliers for 1..50 years, in tenths (index 0 = 1 year). Never interpolated. */
const MULTIPLIER_TENTHS: readonly number[] = [
  507, 985, 1436, 1862, 2263, 2642, 2999, 3337, 3655, 3955,
  4238, 4505, 4757, 4994, 5218, 5430, 5629, 5818, 5995, 6163,
  6321, 6470, 6611, 6743, 6869, 6987, 7098, 7203, 7302, 7396,
  7484, 7567, 7646, 7720, 7790, 7856, 7918, 7977, 8032, 8084,
  8134, 8180, 8224, 8265, 8304, 8341, 8376, 8409, 8440, 8469,
];

export interface Multiplier {
  /** The period as supplied, in years. */
  periodYears: number;
  /** Rounded to the nearest whole year (half up). */
  years: number;
  tenths: number;
  display: string;
  citation: string;
  source: string;
}

export function multiplierFor(periodYears: number): Multiplier {
  if (!Number.isFinite(periodYears) || periodYears < 0) throw new Error(`Bad multiplier period ${periodYears}`);
  const years = Math.floor(periodYears + 0.5);
  if (years < 1 || years > 50) {
    throw new Error(`No 6% weekly multiplier for ${periodYears} years (table covers 1 to 50 whole years)`);
  }
  const tenths = MULTIPLIER_TENTHS[years - 1]!;
  const display = (tenths / 10).toFixed(1);
  return {
    periodYears,
    years,
    tenths,
    display,
    citation: `The 6% weekly multiplier for ${years} years is ${display}`,
    source: MULTIPLIER_SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Standing parameters
// ---------------------------------------------------------------------------

export interface Parameter<T> {
  value: T;
  source: string;
  verified: boolean;
}

export const DAMAGES_DEFAULTS = {
  jongenPercent: {
    value: 15,
    source: `${FIRM_DAMAGES_RULES}; Jongen v CSR Ltd (1992) Aust Torts Reports 81-192 (WA)`,
    verified: true,
  } as Parameter<number>,
  jongenRange: { value: [15, 30] as const, source: "Jongen v CSR Ltd (1992) Aust Torts Reports 81-192 (WA)", verified: true },
  contingencyPercent: { value: 5, source: FIRM_DAMAGES_RULES, verified: true } as Parameter<number>,
  interestPercent: { value: 3, source: FIRM_DAMAGES_RULES, verified: true } as Parameter<number>,
  /** Annual cost / 52.14 = weekly cost. Carried in hundredths. */
  weeklyDivisorHundredths: { value: 5214, source: FIRM_DAMAGES_RULES, verified: true } as Parameter<number>,
  workingLifeAge: { value: 67, source: FIRM_DAMAGES_RULES, verified: true } as Parameter<number>,
} as const;

/**
 * WCIMA 2023 s 424: total damages are capped where WPI is at least 15% but less
 * than 25%. The cap amount is indexed and not held here.
 */
export const WORKCOVER_S424 = {
  wpiFrom: 15,
  wpiBelow: 25,
  capCents: null as Cents | null,
  source: "Workers Compensation and Injury Management Act 2023 (WA) s 424 (section number per firm rules)",
  verified: false,
};
