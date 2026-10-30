import type { IsoDate } from "../core/calendar.js";
import { roundDiv, type Cents } from "../damages/money.js";
import { determinationFor, rateFor, type FeeCategory, type Forum, type RateLookup, type TableBItem } from "./scales.js";

/**
 * 6-minute unit time capture and the timesheet behind a bill of costs. The
 * Determinations are not calculated on 6-minute minimums: the timesheet is the
 * evidence of the work, and each item is claimed up to its maximum.
 */

export const UNIT_HEURISTICS = {
  emailSentWordsPerUnit: 120,
  emailReceivedWordsPerUnit: 350,
  perusalUnitsPerPage: { dense: 2, medium: 1, light: 0.5, clinical: 0.5, certificate: 0.5 },
  draftingUnitsPerPage: { dense: 4 },
  formUnits: { low: 1, high: 2 },
  source: "Soul Legal bill-of-costs rules (firm standing rules), section 2",
} as const;

export interface UnitEstimate {
  units: number;
  rationale: string;
  /** Suggested fee-earner category, where the firm's rules give one. */
  suggestedCategory?: FeeCategory;
  claimable: boolean;
}

/** Each email is at least 1 unit; internal staff-to-staff and automated emails are not chargeable. */
export function estimateEmailUnits(e: { direction: "sent" | "received"; words: number; internal?: boolean; automated?: boolean }): UnitEstimate {
  const per = e.direction === "sent" ? UNIT_HEURISTICS.emailSentWordsPerUnit : UNIT_HEURISTICS.emailReceivedWordsPerUnit;
  const units = Math.max(1, Math.ceil(Math.max(0, e.words) / per));
  const claimable = !e.internal && !e.automated;
  return {
    units,
    rationale: `${e.direction === "sent" ? "Sent" : "Received"} email, ${e.words} new words at about ${per} words per unit (minimum 1)${claimable ? "" : "; internal/automated: not chargeable"}`,
    claimable,
  };
}

export type PerusalDensity = keyof typeof UNIT_HEURISTICS.perusalUnitsPerPage;

/**
 * Perusal by page and complexity. Large clinical record sets run 0.5–0.75 unit per
 * page (0.5 by default; pass unitsPerPage to use more). Certificates, payslips and
 * receipts are about 0.5 unit each, by a paralegal.
 */
export function estimatePerusalUnits(p: { pages: number; density: PerusalDensity; unitsPerPage?: number }): UnitEstimate {
  const rate = p.unitsPerPage ?? UNIT_HEURISTICS.perusalUnitsPerPage[p.density];
  const units = Math.max(1, Math.ceil(p.pages * rate - 1e-9));
  return {
    units,
    rationale: `Perusal: ${p.pages} ${p.density === "certificate" ? "item" : "page"}${p.pages === 1 ? "" : "s"} (${p.density}) at ${rate} unit${rate === 1 ? "" : "s"} each`,
    ...(p.density === "certificate" ? { suggestedCategory: "CPL" as const } : {}),
    claimable: true,
  };
}

/** Drafting: dense pleadings or letters about 4 units a page plus settling; forms 1–2 units. */
export function estimateDraftingUnits(d: { kind: "dense"; pages: number; settlingUnits?: number } | { kind: "form"; complex?: boolean }): UnitEstimate {
  if (d.kind === "form") {
    const units = d.complex ? UNIT_HEURISTICS.formUnits.high : UNIT_HEURISTICS.formUnits.low;
    return { units, rationale: `Drafting a form (${units} unit${units === 1 ? "" : "s"})`, claimable: true };
  }
  const settling = d.settlingUnits ?? 0;
  const units = Math.max(1, Math.ceil(d.pages * UNIT_HEURISTICS.draftingUnitsPerPage.dense)) + settling;
  return { units, rationale: `Drafting ${d.pages} dense page${d.pages === 1 ? "" : "s"} at 4 units a page${settling ? ` plus ${settling} units settling` : ""}`, claimable: true };
}

// ---------------------------------------------------------------------------
// Time entries and the timesheet
// ---------------------------------------------------------------------------

export interface TimeEntry {
  id: string;
  tenantId: string;
  matterId: string;
  feeEarnerId: string;
  feeEarnerName?: string;
  category: FeeCategory;
  forum: Forum;
  date: IsoDate;
  units: number;
  description: string;
  /** Gmail message id, Box file id or similar evidence of the work. */
  sourceRef?: string;
  /** False for internal, administrative and automated work (shown shaded, never billed). */
  claimable: boolean;
  /** False for solicitor/client-only work (e.g. Legal Aid applications, counsel's retainer). */
  partyParty?: boolean;
  /** Table B item key (see scales.ts), e.g. "preparation". */
  scaleItem?: string;
  status: "proposed" | "approved";
  aiAssisted: boolean;
  /** Future attendance or unbilled work marked ESTIMATE. */
  estimate?: boolean;
  proposedBy: string;
  proposedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export type RateFn = (category: FeeCategory, workDate: IsoDate, forum: Forum) => RateLookup;

export interface TimesheetRow {
  entryId: string;
  date: IsoDate;
  feeEarner: string;
  category: FeeCategory;
  units: number;
  hours: number;
  rateCents: Cents;
  determinationId: string;
  amountCents: Cents;
  scaleItem: string;
  partyParty: boolean;
  description: string;
  sourceRef?: string;
  estimate: boolean;
}

export interface ItemSummary {
  forum: Forum;
  scaleItem: string;
  item?: TableBItem;
  units: number;
  valueCents: Cents;
  /** Hours equivalent in the cap's category (e.g. SP-equivalent), when the item has an hours cap. */
  capEquivalentHours?: number;
  capHours?: number;
  claimCents: Cents;
  reductionCents: Cents;
  notes: string[];
}

export interface TimesheetSummary {
  rows: TimesheetRow[];
  nonClaimable: TimesheetRow[];
  byFeeEarner: { feeEarner: string; category: FeeCategory; units: number; hours: number; valueCents: Cents }[];
  byItem: ItemSummary[];
  totals: {
    claimableValueCents: Cents;
    claimCents: Cents;
    capReductionCents: Cents;
    nonClaimableValueCents: Cents;
    partyPartyExcludedCents: Cents;
  };
  unverifiedRates: string[];
}

const UNALLOCATED = "unallocated";

export function timesheetSummary(entries: TimeEntry[], workDateRates: RateFn = rateFor): TimesheetSummary {
  const unverified = new Set<string>();
  const toRow = (e: TimeEntry): TimesheetRow => {
    const r = workDateRates(e.category, e.date, e.forum);
    if (!r.verified) unverified.add(r.determination);
    return {
      entryId: e.id,
      date: e.date,
      feeEarner: e.feeEarnerName ?? e.feeEarnerId,
      category: e.category,
      units: e.units,
      hours: e.units / 10,
      rateCents: r.rateCents,
      determinationId: r.determinationId,
      // Units are whole 6-minute units: amount = units x rate / 10.
      amountCents: roundDiv(e.units * r.rateCents, 10),
      scaleItem: e.scaleItem ?? UNALLOCATED,
      partyParty: e.partyParty ?? true,
      description: e.description,
      ...(e.sourceRef ? { sourceRef: e.sourceRef } : {}),
      estimate: e.estimate ?? false,
    };
  };
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.feeEarnerId.localeCompare(b.feeEarnerId));
  const rows = sorted.filter((e) => e.claimable).map(toRow);
  const nonClaimable = sorted.filter((e) => !e.claimable).map(toRow);
  const forumOf = new Map(sorted.map((e) => [e.id, e.forum]));

  const fe = new Map<string, TimesheetSummary["byFeeEarner"][number]>();
  for (const r of rows) {
    const k = `${r.feeEarner}|${r.category}`;
    const cur = fe.get(k) ?? { feeEarner: r.feeEarner, category: r.category, units: 0, hours: 0, valueCents: 0 };
    cur.units += r.units;
    cur.hours = cur.units / 10;
    cur.valueCents += r.amountCents;
    fe.set(k, cur);
  }

  const groups = new Map<string, TimesheetRow[]>();
  for (const r of rows) {
    const k = `${forumOf.get(r.entryId)}|${r.scaleItem}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const byItem: ItemSummary[] = [];
  for (const [k, group] of groups) {
    const [forum, scaleItem] = k.split("|") as [Forum, string];
    const value = group.reduce((s, r) => s + r.amountCents, 0);
    const units = group.reduce((s, r) => s + r.units, 0);
    const notes: string[] = [];
    // The cap of the Determination in force for the latest work on the item applies across all periods.
    const latest = group.reduce((a, b) => (a.date > b.date ? a : b));
    const det = determinationFor(latest.date, forum);
    const item = det?.items.find((i) => i.key === scaleItem);
    const summary: ItemSummary = { forum, scaleItem, units, valueCents: value, claimCents: value, reductionCents: 0, notes, ...(item ? { item } : {}) };
    if (scaleItem === UNALLOCATED) notes.push("No Table B item allocated.");
    else if (!item) notes.push(`Item ${scaleItem} not in ${det?.title ?? "the Determination"}.`);
    else if (item.max.kind === "hours" && !item.max.per) {
      const cap = item.max;
      // Convert each entry's value into hours of the cap category at its own Determination's rate.
      const eqHours = group.reduce((s, r) => s + r.amountCents / workDateRates(cap.category, r.date, forum).rateCents, 0);
      summary.capEquivalentHours = Math.round(eqHours * 100) / 100;
      summary.capHours = cap.hours;
      if (eqHours > cap.hours) {
        summary.claimCents = Math.round((value * cap.hours) / eqHours);
        summary.reductionCents = value - summary.claimCents;
        notes.push(`Capped at ${cap.hours} ${cap.category}-equivalent hours (item ${item.item}).`);
      }
      if (!item.verified) notes.push(`Item ${item.item} maximum unverified: check the Determination PDF.`);
    } else if (item.max.kind === "hours") {
      notes.push(`Item ${item.item} is capped at ${item.max.hours} ${item.max.category} hours per ${item.max.per}: apply per ${item.max.per} manually.`);
    } else if (item.max.kind === "not_party_party") {
      notes.push(`Item ${item.item} is solicitor/client only: not claimable party/party.`);
    } else if (item.max.kind === "unknown") {
      notes.push(`Item ${item.item} maximum not recorded: check the Determination.`);
    }
    byItem.push(summary);
  }

  const claimableValue = rows.reduce((s, r) => s + r.amountCents, 0);
  const claim = byItem.reduce((s, i) => s + i.claimCents, 0);
  return {
    rows,
    nonClaimable,
    byFeeEarner: [...fe.values()],
    byItem,
    totals: {
      claimableValueCents: claimableValue,
      claimCents: claim,
      capReductionCents: claimableValue - claim,
      nonClaimableValueCents: nonClaimable.reduce((s, r) => s + r.amountCents, 0),
      partyPartyExcludedCents: rows.filter((r) => !r.partyParty || byItem.find((i) => i.scaleItem === r.scaleItem)?.item?.max.kind === "not_party_party").reduce((s, r) => s + r.amountCents, 0),
    },
    unverifiedRates: [...unverified],
  };
}
