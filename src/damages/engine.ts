import { addDays, addYears, type IsoDate } from "../core/calendar.js";
import {
  bps,
  fmtDate,
  fmtHundredths,
  fmtMoney,
  fmtPct,
  roundDiv,
  weeksInclusive,
  yearsBetween,
  type Cents,
} from "./money.js";
import {
  DAMAGES_DEFAULTS,
  WORKCOVER_S424,
  financialYear,
  fyEndDate,
  fyLabel,
  fyStartDate,
  multiplierFor,
  netWeekly,
  sgRateFor,
  taxTableFor,
  type Multiplier,
  type NetWeekly,
} from "./tables.js";

/**
 * Plaintiff's particulars of damages (WA District Court r 45C(3), Stott CPC-A1 heads)
 * as a pure function of its inputs. The model stores every figure and every
 * calculation line so the document, the summary and the audit can't drift apart.
 */

export type DamagesScheme = "icwa_mva" | "workcover_wa" | "public_liability" | "medical_negligence" | "other";

export interface Period {
  from: IsoDate;
  to: IsoDate;
}

export interface DamagesInput {
  scheme?: DamagesScheme;
  /** Whole person impairment, for the WorkCover s 424 band. */
  wpiPercent?: number;
  plaintiff: {
    name?: string;
    dateOfBirth: IsoDate;
    sex: "male" | "female";
    /** As instructed or as the evidence shows, e.g. "manual work background". */
    background?: string;
  };
  injuryDate: IsoDate;
  calculationDate: IsoDate;
  /** Rate at the date of the accident (demonstrated capacity). Give weekly or annual (annual / 52). */
  preInjuryEarnings: { grossWeeklyCents?: Cents; grossAnnualCents?: Cents; source?: string };
  /** Weekly payments actually paid by the insurer, at the gross amounts paid. */
  weeklyPayments?: (Period & { grossPaidCents: Cents; payer: string; source?: string })[];
  /** Claimed net. Omitted: from the day after the last weekly payment (or the injury) to the calculation date. */
  unindemnifiedPeriods?: (Period & { grossWeeklyCents?: Cents; note?: string })[];
  /** Past super runs from this date (default: injury date; weekly payments attract no super). */
  pastSuperFrom?: IsoDate;
  specialDamages?: {
    from?: IsoDate;
    to?: IsoDate;
    /** Display text for the period column; defaults to the dates. */
    period?: string;
    providerPayer: string;
    item: string;
    amountCents: Cents;
    paidBy: "insurer" | "plaintiff";
  }[];
  pastGratuitousServices?: (Period & {
    provider: string;
    service: string;
    hourlyRateCents: Cents;
    hoursPerWeek: number;
    /** Narrative as described in the evidence, e.g. "2 hours a day". Audited against hoursPerWeek. */
    hoursDescription?: string;
  })[];
  futureMedical?: {
    service: string;
    costCents: Cents;
    frequencyPerYear: number;
    /** Narrative frequency, e.g. "every 4 months". Audited against frequencyPerYear. */
    frequency?: string;
    evidence?: string;
  }[];
  futureCare?: { description?: string; hourlyRateCents: Cents; hoursPerWeek: number; hoursDescription?: string; evidence?: string }[];
  aids?: { item: string; amountCents: Cents; note?: string }[];
  otherItems?: { item: string; amountCents: Cents; calculation?: string }[];
  /** Set by the practitioner. Null leaves a marked placeholder; never invented. */
  generalDamagesCents: Cents | null;
  lifeExpectancy: { years: number; citation: string };
  /** Overrides for the multiplier periods (years). Defaults: working life to 67, and life expectancy. */
  multiplierYears?: { earnings?: number; lifetime?: number };
  /** Partial loss of future earning capacity, percent (default 100). */
  futureLossPercent?: number;
  jongenPercent?: number;
  contingencyPercent?: number;
  interestPercent?: number;
  /** WorkCover s 424 cap amount, if the practitioner has confirmed it. */
  s424CapCents?: Cents;
}

export type HeadId = "1.1" | "1.2" | "2.1" | "2.2" | "3" | "4" | "5" | "6.1" | "6.2" | "6.3" | "6.4" | "7";

export interface HeadTable {
  columns: string[];
  rows: string[][];
  totalRow?: string[];
}

export interface DamagesHead {
  id: HeadId;
  title: string;
  /** Lettered narrative paragraphs and indented calculation lines, in order. */
  lines: string[];
  tables: HeadTable[];
  amountCents: Cents;
  /** Future heads only: the contingency deduction applied, in bps. */
  contingencyBps?: number;
  /** Set when the figure is a placeholder (general damages not yet set). */
  placeholder?: boolean;
}

export interface InterestLine {
  head: HeadId;
  label: string;
  principalCents: Cents;
  from: IsoDate;
  yearsHundredths: number;
  amountCents: Cents;
}

export interface DamagesFlag {
  code: string;
  message: string;
  verified?: boolean;
}

export interface DamagesModel {
  calculationDate: IsoDate;
  injuryDate: IsoDate;
  plaintiff: DamagesInput["plaintiff"] & { ageAtCalculation: number };
  parameters: {
    grossWeeklyCents: Cents;
    grossWeeklySource: string;
    currentFinancialYear: string;
    netWeeklyCurrent: NetWeekly;
    netWeeklyByYear: NetWeekly[];
    jongenBps: number;
    contingencyBps: number;
    interestBps: number;
    weeklyDivisorHundredths: number;
    workingLifeAge: number;
    workingLifeYearsHundredths: number;
    earningsMultiplier: Multiplier | null;
    lifetimeMultiplier: Multiplier | null;
    lifeExpectancy: DamagesInput["lifeExpectancy"];
    futureLossBps: number;
  };
  heads: DamagesHead[];
  interest: InterestLine[];
  summary: {
    lines: { id: HeadId; title: string; amountCents: Cents }[];
    totalCents: Cents;
    refundable: { weeklyPaymentsCents: Cents; insurerPaidExpensesCents: Cents; totalCents: Cents };
    netCents: Cents;
    statement: string;
  };
  flags: DamagesFlag[];
}

const HEAD_TITLES: Record<HeadId, string> = {
  "1.1": "Past loss of earning capacity",
  "1.2": "Future loss of earning capacity",
  "2.1": "Past loss of superannuation",
  "2.2": "Future loss of superannuation",
  "3": "Special damages",
  "4": "Past gratuitous services",
  "5": "Interest on past loss and expenditure",
  "6.1": "Future medical expenses",
  "6.2": "Future care and gratuitous services",
  "6.3": "Aids and appliances",
  "6.4": "Other future items",
  "7": "General damages",
};

const letter = (i: number) => `(${String.fromCharCode(97 + i)})`;
const fmtPeriod = (p: Period) => `${fmtDate(p.from)} to ${fmtDate(p.to)}`;
const minDate = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Splits an inclusive period at each 30 June. */
export function splitByFinancialYear(p: Period): (Period & { financialYear: number })[] {
  const out: (Period & { financialYear: number })[] = [];
  let from = p.from;
  while (from <= p.to) {
    const fy = financialYear(from);
    const to = minDate(p.to, fyEndDate(fy));
    out.push({ from, to, financialYear: fy });
    from = fyStartDate(fy + 1);
  }
  return out;
}

export function ageOn(dob: IsoDate, on: IsoDate): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Weekly figure x multiplier, then less contingencies: returns [beforeContingencies, after]. */
function discount(weeklyCents: Cents, m: Multiplier, contingencyBps: number): [Cents, Cents] {
  const pv = roundDiv(weeklyCents * m.tenths, 10);
  return [pv, roundDiv(pv * (10_000 - contingencyBps), 10_000)];
}

const factor = (contingencyBps: number) => ((10_000 - contingencyBps) / 10_000).toFixed(2);

export function computeDamages(input: DamagesInput): DamagesModel {
  const calc = input.calculationDate;
  const flags: DamagesFlag[] = [];

  const jongenPercent = input.jongenPercent ?? DAMAGES_DEFAULTS.jongenPercent.value;
  const [jMin, jMax] = DAMAGES_DEFAULTS.jongenRange.value;
  if (jongenPercent < jMin || jongenPercent > jMax) {
    throw new Error(`Jongen discount must be between ${jMin}% and ${jMax}% (got ${jongenPercent}%)`);
  }
  const jongenBps = bps(jongenPercent);
  const contingencyBps = bps(input.contingencyPercent ?? DAMAGES_DEFAULTS.contingencyPercent.value);
  const interestBps = bps(input.interestPercent ?? DAMAGES_DEFAULTS.interestPercent.value);
  const futureLossBps = bps(input.futureLossPercent ?? 100);
  const divisor = DAMAGES_DEFAULTS.weeklyDivisorHundredths.value;
  const workingLifeAge = DAMAGES_DEFAULTS.workingLifeAge.value;

  // --- gross weekly: the rate at the date of the accident ---
  const pe = input.preInjuryEarnings;
  let grossWeeklyCents: Cents;
  let grossWeeklySource: string;
  if (pe.grossWeeklyCents !== undefined) {
    grossWeeklyCents = pe.grossWeeklyCents;
    grossWeeklySource = pe.source ?? "Pre-injury gross weekly earnings";
  } else if (pe.grossAnnualCents !== undefined) {
    grossWeeklyCents = roundDiv(pe.grossAnnualCents, 52);
    grossWeeklySource = `${fmtMoney(pe.grossAnnualCents)} / 52 = ${fmtMoney(grossWeeklyCents)}${pe.source ? ` (${pe.source})` : ""}`;
  } else {
    throw new Error("Pre-injury earnings need a gross weekly or gross annual figure");
  }

  const currentFy = financialYear(calc);
  const netCurrent = netWeekly(grossWeeklyCents, currentFy);
  if (!netCurrent.verified) {
    flags.push(taxFlag(netCurrent));
  }
  const laterTable = taxTableFor(currentFy + 1);
  const thisTable = taxTableFor(currentFy);
  if (laterTable && thisTable && JSON.stringify(laterTable.brackets.map((b) => [b.over, b.rateBps])) !== JSON.stringify(thisTable.brackets.map((b) => [b.over, b.rateBps]))) {
    flags.push({
      code: "future_tax_change",
      message: `Future loss uses ${thisTable.label} rates. Legislated change from ${laterTable.label} (e.g. first rate ${fmtPct(laterTable.brackets[1]!.rateBps)}) is not applied.`,
    });
  }

  // --- multipliers ---
  const age = ageOn(input.plaintiff.dateOfBirth, calc);
  const retirement = addYears(input.plaintiff.dateOfBirth, workingLifeAge).date;
  const workingLifeYearsHundredths = Math.max(0, yearsBetween(calc, retirement));
  const earningsYears = input.multiplierYears?.earnings ?? workingLifeYearsHundredths / 100;
  const earningsMultiplier = earningsYears >= 0.5 ? multiplierFor(earningsYears) : null;
  if (!earningsMultiplier) flags.push({ code: "no_working_life", message: `Plaintiff is within six months of, or past, age ${workingLifeAge}: no future earnings multiplier.` });
  const lifetimeYears = input.multiplierYears?.lifetime ?? input.lifeExpectancy.years;
  const lifetimeMultiplier = lifetimeYears >= 0.5 ? multiplierFor(Math.min(lifetimeYears, 50)) : null;
  if (lifetimeYears > 50.5) flags.push({ code: "multiplier_capped", message: `Life expectancy ${lifetimeYears} years exceeds the 50-year table; 50 years used.` });

  const heads: DamagesHead[] = [];
  const head = (id: HeadId, h: Omit<DamagesHead, "id" | "title" | "tables"> & { tables?: HeadTable[] }) =>
    heads.push({ id, title: HEAD_TITLES[id], tables: [], ...h });
  const interest: InterestLine[] = [];
  const netByYear = new Map<string, NetWeekly>();
  const addInterest = (h: HeadId, label: string, principalCents: Cents, from: IsoDate) => {
    if (principalCents <= 0) return;
    const yearsHundredths = Math.max(0, yearsBetween(from, calc));
    interest.push({ head: h, label, principalCents, from, yearsHundredths, amountCents: roundDiv(principalCents * interestBps * yearsHundredths, 1_000_000) });
  };

  // --- 1.1 past loss of earning capacity ---
  {
    const lines: string[] = [];
    const tables: HeadTable[] = [];
    const wp = input.weeklyPayments ?? [];
    const wpTotal = sum(wp.map((w) => w.grossPaidCents));
    let li = 0;
    if (wp.length) {
      lines.push(`${letter(li++)} Weekly payments paid by the insurer, claimed at the gross amounts paid (refundable to the insurer):`);
      for (const w of wp) lines.push(`    ${fmtPeriod(w)}: paid by ${w.payer}${w.source ? ` (${w.source})` : ""} = ${fmtMoney(w.grossPaidCents)}`);
      lines.push(`    Total weekly payments = ${fmtMoney(wpTotal)}`);
    }
    const lastWp = wp.map((w) => w.to).sort().at(-1);
    const unind: NonNullable<DamagesInput["unindemnifiedPeriods"]> =
      input.unindemnifiedPeriods ??
      [{ from: lastWp ? addDays(lastWp, 1) : input.injuryDate, to: calc }].filter((p) => p.from <= p.to);
    const rows: string[][] = [];
    let unindTotal = 0;
    for (const p of unind) {
      const gross = p.grossWeeklyCents ?? grossWeeklyCents;
      for (const part of splitByFinancialYear(p)) {
        const nw = netWeekly(gross, part.financialYear);
        netByYear.set(`${nw.financialYear}:${gross}`, nw);
        if (!nw.verified) flags.push(taxFlag(nw));
        const weeks = weeksInclusive(part.from, part.to);
        const amount = roundDiv(weeks * nw.netWeeklyCents, 100);
        unindTotal += amount;
        rows.push([fmtPeriod(part), fmtHundredths(weeks), fmtMoney(nw.netWeeklyCents), fmtMoney(amount)]);
        lines.push(`    ${fmtHundredths(weeks)} weeks x ${fmtMoney(nw.netWeeklyCents)} (net weekly wage ${nw.label}) = ${fmtMoney(amount)}`);
      }
    }
    if (rows.length) {
      lines.splice(lines.length - rows.length, 0, `${letter(li++)} Unindemnified loss, claimed net of income tax (no Medicare levy deducted), at the rate at the date of the accident (${fmtMoney(grossWeeklyCents)} gross per week):`);
      tables.push({
        columns: ["Year", "Gross weekly", "Annual gross", "Income tax", "Net weekly"],
        rows: [...netByYear.values()].map((n) => [n.label, fmtMoney(n.grossWeeklyCents), fmtMoney(n.annualGrossCents), fmtMoney(n.annualTaxCents), fmtMoney(n.netWeeklyCents)]),
      });
      tables.push({ columns: ["Period", "Weeks", "Net per week", "Amount"], rows, totalRow: ["Total", "", "", fmtMoney(unindTotal)] });
      lines.push(`    Total unindemnified loss = ${fmtMoney(unindTotal)}`);
      const firstUnind = unind.map((p) => p.from).sort()[0]!;
      addInterest("1.1", "Past loss of earning capacity (unindemnified period)", unindTotal, firstUnind);
    }
    head("1.1", { lines, tables, amountCents: wpTotal + unindTotal });
  }

  // --- 1.2 future loss of earning capacity ---
  {
    const lines: string[] = [];
    let amount = 0;
    if (earningsMultiplier) {
      let weekly = netCurrent.netWeeklyCents;
      lines.push(`(a) Net weekly wage at ${netCurrent.label} rates: ${fmtMoney(grossWeeklyCents)} gross less income tax = ${fmtMoney(weekly)} net per week.`);
      lines.push(`(b) Working life to age ${workingLifeAge}: ${fmtHundredths(workingLifeYearsHundredths)} years. ${earningsMultiplier.citation}.`);
      if (futureLossBps !== 10_000) {
        const reduced = roundDiv(weekly * futureLossBps, 10_000);
        lines.push(`    ${fmtMoney(weekly)} x ${fmtPct(futureLossBps)} (loss of capacity) = ${fmtMoney(reduced)}`);
        weekly = reduced;
      }
      const [pv, after] = discount(weekly, earningsMultiplier, contingencyBps);
      lines.push(`    ${fmtMoney(weekly)} x ${earningsMultiplier.display} = ${fmtMoney(pv)} x ${factor(contingencyBps)} (${fmtPct(contingencyBps)} contingencies) = ${fmtMoney(after)}`);
      amount = after;
    }
    head("1.2", { lines, amountCents: amount, contingencyBps });
  }

  // --- 2.1 past superannuation: gross x SG by financial year, no deduction ---
  {
    const lines: string[] = [];
    const rows: string[][] = [];
    const from = input.pastSuperFrom ?? input.injuryDate;
    let total = 0;
    if (from <= calc) {
      for (const part of splitByFinancialYear({ from, to: calc })) {
        const sg = sgRateFor(part.from);
        const weeks = weeksInclusive(part.from, part.to);
        const amount = roundDiv(weeks * grossWeeklyCents * sg.rateBps, 1_000_000);
        total += amount;
        const calcText = `${fmtHundredths(weeks)} weeks x ${fmtMoney(grossWeeklyCents)} x ${fmtPct(sg.rateBps)}`;
        rows.push([fmtPeriod(part), fmtHundredths(weeks), fmtPct(sg.rateBps), calcText, fmtMoney(amount)]);
        lines.push(`    ${calcText} = ${fmtMoney(amount)}`);
      }
      lines.unshift(`(a) Superannuation guarantee on the gross weekly wage of ${fmtMoney(grossWeeklyCents)} at the rate for each financial year, with no deduction:`);
      addInterest("2.1", "Past loss of superannuation", total, from);
    }
    head("2.1", { lines, tables: rows.length ? [{ columns: ["Period", "Weeks", "SG rate", "Calculation", "Amount"], rows, totalRow: ["Total", "", "", "", fmtMoney(total)] }] : [], amountCents: total });
  }

  // --- 2.2 future superannuation: gross x SG x (1 - Jongen) x multiplier x (1 - contingencies) ---
  {
    const lines: string[] = [];
    let amount = 0;
    if (earningsMultiplier) {
      const sg = sgRateFor(calc);
      let gross = grossWeeklyCents;
      if (futureLossBps !== 10_000) gross = roundDiv(gross * futureLossBps, 10_000);
      const weekly = roundDiv(gross * sg.rateBps * (10_000 - jongenBps), 100_000_000);
      const [pv, after] = discount(weekly, earningsMultiplier, contingencyBps);
      lines.push(`(a) Gross weekly wage x ${fmtPct(sg.rateBps)} superannuation guarantee, reduced by ${fmtPct(jongenBps)} (Jongen discount) to take into account fund management fees. ${earningsMultiplier.citation}.`);
      lines.push(`    ${fmtMoney(gross)} x ${fmtPct(sg.rateBps)} x ${fmtPct(10_000 - jongenBps)} = ${fmtMoney(weekly)} per week x ${earningsMultiplier.display} = ${fmtMoney(pv)} x ${factor(contingencyBps)} = ${fmtMoney(after)}`);
      amount = after;
    }
    head("2.2", { lines, amountCents: amount, contingencyBps });
  }

  // --- 3 special damages (insurer-paid rows included; interest only on the plaintiff's own) ---
  const specials = input.specialDamages ?? [];
  const insurerSpecials = sum(specials.filter((s) => s.paidBy === "insurer").map((s) => s.amountCents));
  {
    const own = specials.filter((s) => s.paidBy === "plaintiff");
    const ownTotal = sum(own.map((s) => s.amountCents));
    const total = ownTotal + insurerSpecials;
    const rows = specials.map((s) => [
      s.period ?? (s.from ? (s.to && s.to !== s.from ? fmtPeriod({ from: s.from, to: s.to }) : fmtDate(s.from)) : ""),
      s.paidBy === "insurer" ? `${s.providerPayer} (paid by insurer)` : s.providerPayer,
      s.item,
      fmtMoney(s.amountCents),
    ]);
    const lines = specials.length
      ? [
          `(a) Paid by the plaintiff: ${fmtMoney(ownTotal)}`,
          `(b) Paid by the insurer (claims history; refundable): ${fmtMoney(insurerSpecials)}`,
          `    Total special damages = ${fmtMoney(total)}`,
        ]
      : [];
    if (own.length) {
      const dated = own.filter((s) => s.from).map((s) => s.from!).sort();
      if (dated.length < own.length) flags.push({ code: "special_undated", message: "Some plaintiff-paid special damages have no date; interest runs from the injury date for them." });
      addInterest("3", "Special damages paid by the plaintiff", ownTotal, dated.length === own.length ? dated[0]! : input.injuryDate);
    }
    head("3", { lines, tables: rows.length ? [{ columns: ["Period", "Provider/payer", "Item", "Amount"], rows, totalRow: ["", "", "Total", fmtMoney(total)] }] : [], amountCents: total });
  }

  // --- 4 past gratuitous services ---
  {
    const services = input.pastGratuitousServices ?? [];
    const rows: string[][] = [];
    let total = 0;
    services.forEach((s) => {
      const weeks = weeksInclusive(s.from, s.to);
      const amount = roundDiv(weeks * s.hourlyRateCents * Math.round(s.hoursPerWeek * 100), 10_000);
      total += amount;
      rows.push([fmtDate(s.from), fmtDate(s.to), fmtHundredths(weeks), s.provider, s.service, fmtMoney(s.hourlyRateCents), String(s.hoursPerWeek), fmtMoney(amount)]);
    });
    const lines = services.map(
      (s, i) => `${letter(i)} ${s.provider}: ${s.service}, ${s.hoursPerWeek} hours per week at ${fmtMoney(s.hourlyRateCents)} per hour, ${fmtPeriod(s)}.`,
    );
    if (services.length) addInterest("4", "Past gratuitous services", total, services.map((s) => s.from).sort()[0]!);
    head("4", {
      lines,
      tables: rows.length ? [{ columns: ["Date from", "Date to", "Number of weeks", "Provider", "Service", "Hourly rate", "Hours", "Total $"], rows, totalRow: ["", "", "", "", "", "", "Total", fmtMoney(total)] }] : [],
      amountCents: total,
    });
  }

  // --- 5 interest: plaintiff's own past losses only ---
  head("5", {
    lines: interest.map(
      (x, i) => `${letter(i)} ${x.label}: ${fmtMoney(x.principalCents)} x ${fmtPct(interestBps)} x ${fmtHundredths(x.yearsHundredths)} years (from ${fmtDate(x.from)}) = ${fmtMoney(x.amountCents)}`,
    ),
    amountCents: sum(interest.map((x) => x.amountCents)),
  });

  // --- 6.1 future medical: annual / 52.14 weekly x multiplier x (1 - contingencies) ---
  const lifetimeText = lifetimeMultiplier
    ? `Life expectancy ${input.lifeExpectancy.years} years (${input.lifeExpectancy.citation}). ${lifetimeMultiplier.citation}.`
    : "";
  const lifetimeHead = (id: "6.1" | "6.2", weeklyTotal: Cents, lines: string[], tables: HeadTable[]) => {
    let amount = 0;
    if (weeklyTotal > 0 && lifetimeMultiplier) {
      const [pv, after] = discount(weeklyTotal, lifetimeMultiplier, contingencyBps);
      lines.push(lifetimeText);
      lines.push(`    ${fmtMoney(weeklyTotal)} per week x ${lifetimeMultiplier.display} = ${fmtMoney(pv)} x ${factor(contingencyBps)} (${fmtPct(contingencyBps)} contingencies) = ${fmtMoney(after)}`);
      amount = after;
    }
    head(id, { lines, tables, amountCents: amount, contingencyBps });
  };
  {
    const rows: string[][] = [];
    let weeklyTotal = 0;
    const lines: string[] = [];
    (input.futureMedical ?? []).forEach((m, i) => {
      const annual = Math.round(m.costCents * m.frequencyPerYear);
      const weekly = roundDiv(annual * 100, divisor);
      weeklyTotal += weekly;
      rows.push([m.service, fmtMoney(m.costCents), m.frequency ?? `${m.frequencyPerYear} per year`, fmtMoney(weekly)]);
      lines.push(`${letter(i)} ${m.service}${m.evidence ? ` (${m.evidence})` : ""}: ${fmtMoney(m.costCents)} x ${m.frequencyPerYear} per year = ${fmtMoney(annual)} / ${fmtHundredths(divisor)} = ${fmtMoney(weekly)} per week`);
    });
    lifetimeHead("6.1", weeklyTotal, lines, rows.length ? [{ columns: ["Service", "Cost", "Frequency", "Weekly cost"], rows, totalRow: ["Total", "", "", fmtMoney(weeklyTotal)] }] : []);
  }

  // --- 6.2 future care ---
  {
    const rows: string[][] = [];
    let weeklyTotal = 0;
    const lines: string[] = [];
    (input.futureCare ?? []).forEach((c, i) => {
      const weekly = roundDiv(c.hourlyRateCents * Math.round(c.hoursPerWeek * 100), 100);
      weeklyTotal += weekly;
      rows.push([fmtMoney(c.hourlyRateCents), String(c.hoursPerWeek), fmtMoney(weekly)]);
      lines.push(`${letter(i)} ${c.description ?? "Care"}${c.evidence ? ` (${c.evidence})` : ""}: ${c.hoursPerWeek} hours per week x ${fmtMoney(c.hourlyRateCents)} = ${fmtMoney(weekly)} per week`);
    });
    lifetimeHead("6.2", weeklyTotal, lines, rows.length ? [{ columns: ["Hourly rate", "Hours per week", "Weekly cost"], rows, totalRow: ["Total", "", fmtMoney(weeklyTotal)] }] : []);
  }

  // --- 6.3 aids, 6.4 other ---
  {
    const aids = input.aids ?? [];
    head("6.3", {
      lines: aids.map((a, i) => `${letter(i)} ${a.item}${a.note ? ` (${a.note})` : ""}: ${fmtMoney(a.amountCents)}`),
      amountCents: sum(aids.map((a) => a.amountCents)),
    });
    const other = input.otherItems ?? [];
    head("6.4", {
      lines: other.map((o, i) => `${letter(i)} ${o.item}${o.calculation ? `: ${o.calculation}` : ""} = ${fmtMoney(o.amountCents)}`),
      amountCents: sum(other.map((o) => o.amountCents)),
    });
  }

  // --- 7 general damages: never invented ---
  if (input.generalDamagesCents === null) {
    head("7", { lines: ["[General damages: to be set by the practitioner]"], amountCents: 0, placeholder: true });
    flags.push({ code: "general_damages_placeholder", message: "General damages not set: a placeholder is shown and excluded from the total." });
  } else {
    head("7", { lines: [`General damages: ${fmtMoney(input.generalDamagesCents)}`], amountCents: input.generalDamagesCents });
  }

  // --- summary ---
  const totalCents = sum(heads.map((h) => h.amountCents));
  const weeklyPaymentsCents = sum((input.weeklyPayments ?? []).map((w) => w.grossPaidCents));
  const refundableTotal = weeklyPaymentsCents + insurerSpecials;
  const netCents = totalCents - refundableTotal;
  const statement =
    refundableTotal > 0
      ? `The total of ${fmtMoney(totalCents)} includes statutory compensation of ${fmtMoney(refundableTotal)} (weekly payments ${fmtMoney(weeklyPaymentsCents)}; medical and other expenses ${fmtMoney(insurerSpecials)}) which is refundable to the insurer. The net figure is ${fmtMoney(netCents)}.`
      : `Total ${fmtMoney(totalCents)}.`;

  // --- WorkCover s 424 band ---
  if (input.scheme === "workcover_wa" && input.wpiPercent !== undefined && input.wpiPercent >= WORKCOVER_S424.wpiFrom && input.wpiPercent < WORKCOVER_S424.wpiBelow) {
    const cap = input.s424CapCents ?? WORKCOVER_S424.capCents;
    flags.push({
      code: "workcover_s424_cap",
      message:
        `WPI ${input.wpiPercent}% is in the ${WORKCOVER_S424.wpiFrom}–<${WORKCOVER_S424.wpiBelow}% band: the s 424 cap on total damages applies. ` +
        (cap === null ? "Cap amount not recorded: confirm the current indexed figure." : `Cap ${fmtMoney(cap)}${totalCents > cap ? `; the total of ${fmtMoney(totalCents)} exceeds it` : ""}.`),
      verified: false,
    });
  }

  return {
    calculationDate: calc,
    injuryDate: input.injuryDate,
    plaintiff: { ...input.plaintiff, ageAtCalculation: age },
    parameters: {
      grossWeeklyCents,
      grossWeeklySource,
      currentFinancialYear: fyLabel(currentFy),
      netWeeklyCurrent: netCurrent,
      netWeeklyByYear: [...netByYear.values()],
      jongenBps,
      contingencyBps,
      interestBps,
      weeklyDivisorHundredths: divisor,
      workingLifeAge,
      workingLifeYearsHundredths,
      earningsMultiplier,
      lifetimeMultiplier,
      lifeExpectancy: input.lifeExpectancy,
      futureLossBps,
    },
    heads,
    interest,
    summary: {
      lines: heads.map((h) => ({ id: h.id, title: h.title, amountCents: h.amountCents })),
      totalCents,
      refundable: { weeklyPaymentsCents, insurerPaidExpensesCents: insurerSpecials, totalCents: refundableTotal },
      netCents,
      statement,
    },
    flags: uniqueFlags(flags),
  };
}

const taxFlag = (nw: NetWeekly): DamagesFlag => ({
  code: "tax_unverified",
  message: `Income tax rates for ${nw.label} are not verified (${nw.source}); confirm before relying on the net figures.`,
  verified: false,
});

function uniqueFlags(flags: DamagesFlag[]): DamagesFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => (seen.has(f.message) ? false : (seen.add(f.message), true)));
}


// ---------------------------------------------------------------------------
// Accuracy checks (particulars-of-damages §8)
// ---------------------------------------------------------------------------

export interface AuditWarning {
  code:
    | "annual_divisor"
    | "period_beyond_calculation_date"
    | "working_life_age"
    | "summary_mismatch"
    | "frequency_mismatch"
    | "hours_mismatch"
    | "contingency_inconsistent"
    | "interest_on_insurer_paid"
    | "general_damages_placeholder"
    | "workcover_s424_cap";
  head?: HeadId;
  message: string;
}

/** Parses narrative frequencies such as "every 4 months", "fortnightly", "3 times a year". */
export function parseFrequencyPerYear(text: string): number | null {
  const t = text.toLowerCase().trim();
  const word: Record<string, number> = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12 };
  const num = (s: string) => (s in word ? word[s]! : Number(s));
  const fixed: [RegExp, number][] = [
    [/^(daily|every day)$/, 365],
    [/^(weekly|every week|once a week)$/, 52],
    [/^(fortnightly|every fortnight|every two weeks)$/, 26],
    [/^(monthly|every month|once a month)$/, 12],
    [/^(quarterly|every quarter)$/, 4],
    [/^(annually|yearly|every year|once a year)$/, 1],
  ];
  for (const [re, v] of fixed) if (re.test(t)) return v;
  let m = /^every (\w+) (week|month|year)s?$/.exec(t);
  if (m) {
    const n = num(m[1]!);
    if (!n) return null;
    return m[2] === "week" ? 52 / n : m[2] === "month" ? 12 / n : 1 / n;
  }
  m = /^(\w+)(?: times)? (?:a|per) (week|month|year)$/.exec(t);
  if (m) {
    const n = num(m[1]!);
    if (!n) return null;
    return m[2] === "week" ? n * 52 : m[2] === "month" ? n * 12 : n;
  }
  return null;
}

/** Parses "2 hours a day" / "12 hours per week" into hours per week. */
export function parseHoursPerWeek(text: string): number | null {
  const m = /([\d.]+)\s*hours?\s*(?:a|per|each)\s*(day|week)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "day" ? n * 7 : n;
}

export function auditDamages(model: DamagesModel, input: DamagesInput): AuditWarning[] {
  const w: AuditWarning[] = [];
  const calc = input.calculationDate;
  const pe = input.preInjuryEarnings;

  if (pe.grossAnnualCents !== undefined) {
    const expected = roundDiv(pe.grossAnnualCents, 52);
    const weekly = pe.grossWeeklyCents ?? model.parameters.grossWeeklyCents;
    if (Math.abs(weekly - expected) > 1) {
      w.push({ code: "annual_divisor", head: "1.1", message: `Gross weekly ${fmtMoney(weekly)} does not equal ${fmtMoney(pe.grossAnnualCents)} / 52 = ${fmtMoney(expected)}.` });
    }
  }

  const periods: [string, { from?: IsoDate; to?: IsoDate }][] = [
    ...(input.weeklyPayments ?? []).map((p) => ["Weekly payments", p] as [string, Period]),
    ...(input.unindemnifiedPeriods ?? []).map((p) => ["Unindemnified period", p] as [string, Period]),
    ...(input.specialDamages ?? []).map((p) => [`Special damages: ${p.item}`, p] as [string, { from?: IsoDate; to?: IsoDate }]),
    ...(input.pastGratuitousServices ?? []).map((p) => [`Past gratuitous services: ${p.service}`, p] as [string, Period]),
  ];
  for (const [label, p] of periods) {
    const end = p.to ?? p.from;
    if (end && end > calc) w.push({ code: "period_beyond_calculation_date", message: `${label} runs to ${fmtDate(end)}, after the calculation date ${fmtDate(calc)}.` });
  }

  if (model.parameters.workingLifeAge !== DAMAGES_DEFAULTS.workingLifeAge.value) {
    w.push({ code: "working_life_age", head: "1.2", message: `Working life is to age ${model.parameters.workingLifeAge}, not ${DAMAGES_DEFAULTS.workingLifeAge.value}.` });
  }
  const em = model.parameters.earningsMultiplier;
  const toAge = Math.floor(model.parameters.workingLifeYearsHundredths / 100 + 0.5);
  if (em && em.years !== toAge) {
    w.push({ code: "working_life_age", head: "1.2", message: `Future earnings multiplier uses ${em.years} years, but working life to age 67 is ${fmtHundredths(model.parameters.workingLifeYearsHundredths)} years (${toAge} whole years).` });
  }

  const headSum = model.heads.reduce((s, h) => s + h.amountCents, 0);
  const lineSum = model.summary.lines.reduce((s, l) => s + l.amountCents, 0);
  if (headSum !== model.summary.totalCents || lineSum !== model.summary.totalCents) {
    w.push({ code: "summary_mismatch", message: `Summary total ${fmtMoney(model.summary.totalCents)} does not equal the sum of the heads ${fmtMoney(headSum)}.` });
  }
  for (const h of model.heads) {
    const line = model.summary.lines.find((l) => l.id === h.id);
    if (!line || line.amountCents !== h.amountCents) w.push({ code: "summary_mismatch", head: h.id, message: `Summary line for ${h.id} does not match the head amount ${fmtMoney(h.amountCents)}.` });
  }
  const interestHead = model.heads.find((h) => h.id === "5");
  if (interestHead && interestHead.amountCents !== model.interest.reduce((s, x) => s + x.amountCents, 0)) {
    w.push({ code: "summary_mismatch", head: "5", message: "Interest head does not equal the sum of its lines." });
  }

  for (const m of input.futureMedical ?? []) {
    const parsed = m.frequency ? parseFrequencyPerYear(m.frequency) : null;
    if (parsed !== null && Math.abs(parsed - m.frequencyPerYear) > 0.01) {
      w.push({ code: "frequency_mismatch", head: "6.1", message: `${m.service}: "${m.frequency}" is ${Number(parsed.toFixed(2))} a year but is costed at ${m.frequencyPerYear} a year.` });
    }
  }
  const hoursRows: [HeadId, string, number, string | undefined][] = [
    ...(input.futureCare ?? []).map((c) => ["6.2", c.description ?? "Care", c.hoursPerWeek, c.hoursDescription] as [HeadId, string, number, string | undefined]),
    ...(input.pastGratuitousServices ?? []).map((s) => ["4", s.service, s.hoursPerWeek, s.hoursDescription] as [HeadId, string, number, string | undefined]),
  ];
  for (const [h, label, hours, desc] of hoursRows) {
    const parsed = desc ? parseHoursPerWeek(desc) : null;
    if (parsed !== null && Math.abs(parsed - hours) > 0.01) {
      w.push({ code: "hours_mismatch", head: h, message: `${label}: "${desc}" is ${parsed} hours a week but is costed at ${hours} hours a week.` });
    }
  }

  const futureHeads = model.heads.filter((h) => ["1.2", "2.2", "6.1", "6.2"].includes(h.id) && h.amountCents > 0);
  const contingencies = new Set(futureHeads.map((h) => h.contingencyBps));
  if (contingencies.size > 1 || futureHeads.some((h) => h.contingencyBps !== model.parameters.contingencyBps)) {
    w.push({ code: "contingency_inconsistent", message: `Contingencies differ between future heads: ${futureHeads.map((h) => `${h.id} ${fmtPct(h.contingencyBps ?? 0)}`).join(", ")}.` });
  }

  const ownSpecials = (input.specialDamages ?? []).filter((s) => s.paidBy === "plaintiff").reduce((s, x) => s + x.amountCents, 0);
  const head11 = model.heads.find((h) => h.id === "1.1")?.amountCents ?? 0;
  const wp = (input.weeklyPayments ?? []).reduce((s, x) => s + x.grossPaidCents, 0);
  const limits: Partial<Record<HeadId, Cents>> = { "1.1": head11 - wp, "3": ownSpecials };
  for (const x of model.interest) {
    const limit = limits[x.head];
    if (limit !== undefined && x.principalCents > limit) {
      w.push({ code: "interest_on_insurer_paid", head: x.head, message: `Interest on ${x.label} is charged on ${fmtMoney(x.principalCents)}, more than the plaintiff's own loss of ${fmtMoney(limit)}: no interest runs on amounts the insurer paid.` });
    }
  }

  if (model.heads.some((h) => h.placeholder)) {
    w.push({ code: "general_damages_placeholder", head: "7", message: "General damages is a placeholder: the practitioner must set the figure." });
  }
  for (const f of model.flags) {
    if (f.code === "workcover_s424_cap") w.push({ code: "workcover_s424_cap", message: f.message });
  }
  return w;
}

