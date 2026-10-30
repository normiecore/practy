import { addDays, addMonths, type IsoDate } from "../core/calendar.js";
import { fmtDate, fmtMoney, roundDiv, type Cents } from "./money.js";

/**
 * Statutory clearances that must be resolved before settlement money is released:
 * Medicare (Health and Other Services (Compensation) Act 1995), Centrelink (Social
 * Security Act 1991 Pt 3.14), NDIS (NDIS Act ss 104–107), DVA, private health funds.
 */

export const CLEARANCE_KINDS = ["medicare", "centrelink", "ndis", "dva", "private_health", "other"] as const;
export type ClearanceKind = (typeof CLEARANCE_KINDS)[number];

export const CLEARANCE_STATUSES = ["not_requested", "requested", "nopb_received", "mo022_lodged", "charge_received", "paid", "not_applicable"] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const CLEARANCE_RULES = {
  nopbValidityMonths: { value: 6, source: "Services Australia: Notice of past benefits (valid 6 months)", verified: true },
  mo022Days: { value: 28, source: "Health and Other Services (Compensation) Act 1995; Services Australia notification requirements (MO022 within 28 days)", verified: true },
} as const;

export type ClearanceEvent =
  | { type: "requested"; date: IsoDate; reference?: string }
  /** Medicare Notice of Past Benefits (form MO026 response). */
  | { type: "nopb_received"; issueDate: IsoDate; pastBenefitsCents?: Cents }
  /** Medicare settlement notification. */
  | { type: "mo022_lodged"; date: IsoDate }
  /** Medicare notice of charge, Centrelink charge, NDIS recovery/CRA, DVA or fund recovery. */
  | {
      type: "charge_received";
      date: IsoDate;
      amountCents: Cents;
      preclusion?: { from: IsoDate; to: IsoDate };
      /** NDIS Compensation Reduction Amount: reduces future plans, not a debt. */
      compensationReductionCents?: Cents;
    }
  | { type: "paid"; date: IsoDate; amountCents?: Cents }
  | { type: "not_applicable"; reason: string };

export interface Clearance {
  id: string;
  tenantId: string;
  matterId: string;
  kind: ClearanceKind;
  label?: string;
  status: ClearanceStatus;
  reference?: string;
  requestedOn?: IsoDate;
  nopbIssueDate?: IsoDate;
  nopbExpiresOn?: IsoDate;
  pastBenefitsCents?: Cents;
  mo022LodgedOn?: IsoDate;
  chargeCents?: Cents;
  chargeDate?: IsoDate;
  preclusion?: { from: IsoDate; to: IsoDate };
  compensationReductionCents?: Cents;
  paidOn?: IsoDate;
  paidCents?: Cents;
  notApplicableReason?: string;
  history: { at: string; by?: string; event: ClearanceEvent }[];
}

const ANY_OPEN: ClearanceStatus[] = ["not_requested", "requested", "nopb_received", "mo022_lodged", "charge_received"];

/** Which statuses each event may be applied from. */
const TRANSITIONS: Record<ClearanceEvent["type"], { kinds: ClearanceKind[] | "any"; from: ClearanceStatus[] }> = {
  requested: { kinds: "any", from: ["not_requested", "requested", "nopb_received"] },
  // A fresh NOPB may replace an expired one.
  nopb_received: { kinds: ["medicare"], from: ["not_requested", "requested", "nopb_received"] },
  mo022_lodged: { kinds: ["medicare"], from: ["not_requested", "requested", "nopb_received"] },
  charge_received: { kinds: "any", from: ["requested", "nopb_received", "mo022_lodged", "charge_received"] },
  paid: { kinds: "any", from: ["charge_received"] },
  not_applicable: { kinds: "any", from: ANY_OPEN },
};

export function newClearance(base: Pick<Clearance, "id" | "tenantId" | "matterId" | "kind"> & { label?: string }): Clearance {
  return { ...base, status: "not_requested", history: [] };
}

/** Pure transition. Throws on an event that is not allowed from the current status. */
export function applyClearanceEvent(c: Clearance, event: ClearanceEvent, meta: { at?: string; by?: string } = {}): Clearance {
  const rule = TRANSITIONS[event.type];
  if (rule.kinds !== "any" && !rule.kinds.includes(c.kind)) {
    throw new Error(`${event.type} does not apply to a ${c.kind} clearance`);
  }
  if (!rule.from.includes(c.status)) {
    throw new Error(`Cannot record ${event.type} on a ${c.kind} clearance that is ${c.status}`);
  }
  const next: Clearance = { ...c, history: [...c.history, { at: meta.at ?? new Date().toISOString(), ...(meta.by ? { by: meta.by } : {}), event }] };
  switch (event.type) {
    case "requested":
      next.status = c.status === "nopb_received" ? "nopb_received" : "requested";
      next.requestedOn = event.date;
      if (event.reference) next.reference = event.reference;
      break;
    case "nopb_received":
      next.status = "nopb_received";
      next.nopbIssueDate = event.issueDate;
      next.nopbExpiresOn = addMonths(event.issueDate, CLEARANCE_RULES.nopbValidityMonths.value).date;
      if (event.pastBenefitsCents !== undefined) next.pastBenefitsCents = event.pastBenefitsCents;
      break;
    case "mo022_lodged":
      next.status = "mo022_lodged";
      next.mo022LodgedOn = event.date;
      break;
    case "charge_received":
      next.status = "charge_received";
      next.chargeCents = event.amountCents;
      next.chargeDate = event.date;
      if (event.preclusion) next.preclusion = event.preclusion;
      if (event.compensationReductionCents !== undefined) next.compensationReductionCents = event.compensationReductionCents;
      break;
    case "paid":
      next.status = "paid";
      next.paidOn = event.date;
      next.paidCents = event.amountCents ?? c.chargeCents;
      break;
    case "not_applicable":
      next.status = "not_applicable";
      next.notApplicableReason = event.reason;
      break;
  }
  return next;
}

export interface ClearanceBlocker {
  clearanceId: string | null;
  kind: ClearanceKind;
  reason: string;
}

export interface ClearanceCheck {
  /** True when any clearance prevents release of the settlement funds. */
  blocked: boolean;
  blockers: ClearanceBlocker[];
  warnings: ClearanceBlocker[];
  /** Medicare MO022 due date (settlement + 28 days). */
  mo022DueOn: IsoDate;
}

/**
 * Funds may be released only when every clearance is paid or not applicable.
 * A known but unpaid charge still blocks: it is paid from the settlement first.
 */
export function clearanceBlockers(
  clearances: Clearance[],
  settlementDate: IsoDate,
  opts: { asAt?: IsoDate; required?: ClearanceKind[] } = {},
): ClearanceCheck {
  const required = opts.required ?? ["medicare", "centrelink"];
  const blockers: ClearanceBlocker[] = [];
  const warnings: ClearanceBlocker[] = [];
  const mo022DueOn = addDays(settlementDate, CLEARANCE_RULES.mo022Days.value);

  for (const kind of required) {
    if (!clearances.some((c) => c.kind === kind)) blockers.push({ clearanceId: null, kind, reason: `No ${kind} clearance recorded` });
  }
  for (const c of clearances) {
    const name = c.label ?? c.kind;
    switch (c.status) {
      case "paid":
      case "not_applicable":
        break;
      case "charge_received":
        blockers.push({ clearanceId: c.id, kind: c.kind, reason: `${name} charge of ${fmtMoney(c.chargeCents ?? 0)} must be paid before funds are released` });
        break;
      default:
        blockers.push({ clearanceId: c.id, kind: c.kind, reason: `${name} amount not yet known (status ${c.status})` });
    }
    if (c.kind === "medicare" && c.status !== "not_applicable") {
      if (c.nopbExpiresOn && c.nopbExpiresOn < settlementDate && !c.mo022LodgedOn && c.status !== "charge_received" && c.status !== "paid") {
        warnings.push({ clearanceId: c.id, kind: c.kind, reason: `Notice of Past Benefits expired on ${fmtDate(c.nopbExpiresOn)}, before settlement: use a s 23A statement (MO023) or re-request` });
      }
      if (!c.mo022LodgedOn && c.status !== "paid") {
        const overdue = opts.asAt && opts.asAt > mo022DueOn;
        (overdue ? blockers : warnings).push({
          clearanceId: c.id,
          kind: c.kind,
          reason: `MO022 ${overdue ? "overdue" : "due"}: lodge by ${fmtDate(mo022DueOn)} (28 days after settlement)`,
        });
      }
    }
  }
  return { blocked: blockers.length > 0, blockers, warnings, mo022DueOn };
}

// ---------------------------------------------------------------------------
// Centrelink preclusion period
// ---------------------------------------------------------------------------

export interface PreclusionInput {
  lumpSumCents: Cents;
  settlementType: "agreed" | "judgment";
  /** For a judgment: the economic-loss portion of the award. */
  economicLossCents?: Cents;
  incomeCutOutWeeklyCents: Cents;
  incomeCutOutSource: string;
  /** Date the cut-out figure applies at (the settlement date). */
  incomeCutOutDate: IsoDate;
  injuryDate: IsoDate;
  /** Start of the period, if not the injury date (e.g. when periodic payments stopped). */
  periodStart?: IsoDate;
}

export interface PreclusionEstimate {
  estimate: true;
  label: string;
  compensationPartCents: Cents | null;
  weeks: number | null;
  from: IsoDate;
  to: IsoDate | null;
  formula: string;
  verified: false;
  source: string;
  notes: string[];
}

/**
 * Compensation part (50% of an agreed lump sum) / income cut-out = whole weeks,
 * running from the injury date. An estimate only: Services Australia decides.
 */
export function centrelinkPreclusionEstimate(input: PreclusionInput): PreclusionEstimate {
  const notes = [`Income cut-out ${fmtMoney(input.incomeCutOutWeeklyCents)} per week as at ${fmtDate(input.incomeCutOutDate)} (${input.incomeCutOutSource}).`];
  const from = input.periodStart ?? input.injuryDate;
  let part: Cents | null;
  let partText: string;
  if (input.settlementType === "agreed") {
    part = roundDiv(input.lumpSumCents, 2);
    partText = `50% x ${fmtMoney(input.lumpSumCents)} = ${fmtMoney(part)}`;
  } else if (input.economicLossCents !== undefined) {
    part = input.economicLossCents;
    partText = `economic-loss portion of the judgment ${fmtMoney(part)}`;
  } else {
    part = null;
    partText = "economic-loss portion of the judgment (not supplied)";
    notes.push("For a judgment the compensation part is the economic-loss portion of the award, not 50%: supply it to estimate the period.");
  }
  if (input.incomeCutOutWeeklyCents <= 0) throw new Error("Income cut-out must be positive");
  // Part weeks are disregarded.
  const weeks = part === null ? null : Math.floor(part / input.incomeCutOutWeeklyCents);
  const to = weeks === null ? null : weeks === 0 ? null : addDays(from, weeks * 7 - 1);
  if (weeks === 0) notes.push("Compensation part is below one week of the income cut-out: no preclusion period.");
  return {
    estimate: true,
    label: "ESTIMATE ONLY: Services Australia determines the preclusion period",
    compensationPartCents: part,
    weeks,
    from,
    to,
    formula: `${partText} / ${fmtMoney(input.incomeCutOutWeeklyCents)} (income cut-out per week) = ${weeks ?? "?"} whole weeks from ${fmtDate(from)}${to ? ` to ${fmtDate(to)}` : ""}`,
    verified: false,
    source: "Social Security Act 1991 (Cth) Pt 3.14; Services Australia: How we calculate preclusion periods",
    notes,
  };
}
