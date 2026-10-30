import { WA_CALENDAR, addWorkingDays, type IsoDate, type WorkingCalendar } from "../core/calendar.js";
import { fmtMoney, type Cents } from "../damages/money.js";

/** Legal Profession Uniform Law (WA) Part 4.3: costs disclosure and costs terms. */

export const DISCLOSURE_RULES = {
  noDisclosureBelowCents: { value: 75_000, source: "Legal Profession Uniform General Rules r 72A (under $750: no obligation; rule numbering unverified)", verified: true },
  standardFormBelowCents: { value: 300_000, source: "Legal Profession Uniform General Rules r 72A (under $3,000: Uniform Standard Disclosure Form; rule numbering unverified)", verified: true },
  upliftMaxPercent: { value: 25, source: "Legal Profession Uniform Law s 182 (uplift of at most 25% of legal costs, excluding disbursements)", verified: true },
  contingencyFeesProhibited: { value: true, source: "Legal Profession Uniform Law s 183", verified: true },
  coolingOffClearBusinessDays: { value: 5, source: "Legal Profession Uniform Law s 181 (cooling-off of at least 5 clear business days)", verified: false },
} as const;

export type DisclosureLevel = "none" | "standard_form" | "full_s174";

export interface DisclosureRequirement {
  level: DisclosureLevel;
  estimateCents: Cents;
  explanation: string;
  source: string;
}

/** Thresholds are on the estimated total legal costs (excluding GST, per r 72A; confirm). */
export function disclosureRequirement(estimateCents: Cents): DisclosureRequirement {
  const { noDisclosureBelowCents: none, standardFormBelowCents: std } = DISCLOSURE_RULES;
  if (estimateCents < none.value) {
    return { level: "none", estimateCents, explanation: `Estimate ${fmtMoney(estimateCents)} is under ${fmtMoney(none.value)}: no disclosure obligation.`, source: none.source };
  }
  if (estimateCents < std.value) {
    return { level: "standard_form", estimateCents, explanation: `Estimate ${fmtMoney(estimateCents)} is under ${fmtMoney(std.value)}: the Uniform Standard Disclosure Form may be used.`, source: std.source };
  }
  return { level: "full_s174", estimateCents, explanation: `Estimate ${fmtMoney(estimateCents)} is ${fmtMoney(std.value)} or more: full disclosure under s 174.`, source: "Legal Profession Uniform Law s 174" };
}

export const COSTS_BASES = ["conditional", "hourly", "scale", "fixed", "percentage_of_recovery"] as const;
export type CostsBasis = (typeof COSTS_BASES)[number];

export interface CostsTerms {
  upliftPercent?: number;
  basis: CostsBasis;
  /** Any fee calculated as a percentage of the recovery: a contingency fee. */
  percentageOfRecovery?: number;
}

export interface CostsTermsCheck {
  valid: boolean;
  errors: { code: "uplift_cap" | "uplift_not_conditional" | "contingency_fee"; message: string; source: string }[];
}

export function validateCostsTerms(terms: CostsTerms): CostsTermsCheck {
  const errors: CostsTermsCheck["errors"] = [];
  const uplift = terms.upliftPercent ?? 0;
  const cap = DISCLOSURE_RULES.upliftMaxPercent;
  if (uplift > cap.value) {
    errors.push({ code: "uplift_cap", message: `Uplift of ${uplift}% exceeds the ${cap.value}% cap (on legal costs, excluding disbursements).`, source: cap.source });
  }
  if (uplift > 0 && terms.basis !== "conditional") {
    errors.push({ code: "uplift_not_conditional", message: "An uplift fee is only permitted in a conditional costs agreement.", source: "Legal Profession Uniform Law ss 181–182" });
  }
  if (terms.basis === "percentage_of_recovery" || (terms.percentageOfRecovery ?? 0) > 0) {
    errors.push({ code: "contingency_fee", message: "A fee calculated as a percentage of the amount recovered (contingency fee) is prohibited.", source: DISCLOSURE_RULES.contingencyFeesProhibited.source });
  }
  return { valid: errors.length === 0, errors };
}

export interface EstimateCheck {
  usedCents: Cents;
  estimateCents: Cents;
  /** Null when the estimate is zero. */
  usedPercent: number | null;
  /** At or above the alert threshold. */
  approaching: boolean;
  exceeded: boolean;
  message: string;
}

/** WIP plus disbursements against the disclosed estimate: alert at `thresholdPct` (default 80%). */
export function estimateExceeded(i: { wipCents: Cents; disbursementsCents: Cents; estimateCents: Cents; thresholdPct?: number }): EstimateCheck {
  const used = i.wipCents + i.disbursementsCents;
  const threshold = i.thresholdPct ?? 80;
  const usedPercent = i.estimateCents > 0 ? Math.round((used / i.estimateCents) * 1000) / 10 : null;
  const exceeded = used > i.estimateCents;
  const approaching = usedPercent === null ? used > 0 : usedPercent >= threshold;
  return {
    usedCents: used,
    estimateCents: i.estimateCents,
    usedPercent,
    approaching,
    exceeded,
    message: exceeded
      ? `Work in progress and disbursements (${fmtMoney(used)}) exceed the estimate of ${fmtMoney(i.estimateCents)}: update the disclosure (s 174(3)).`
      : approaching
        ? `Work in progress and disbursements are ${usedPercent}% of the estimate: consider updating the disclosure.`
        : `Within the estimate (${usedPercent ?? 0}%).`,
  };
}

/**
 * Last day of the conditional costs agreement cooling-off period: 5 clear business
 * days after the agreement is made (the day it is made is not counted).
 */
export function coolingOffEnd(agreementDate: IsoDate, calendar: WorkingCalendar = WA_CALENDAR) {
  const rule = DISCLOSURE_RULES.coolingOffClearBusinessDays;
  return { endsOn: addWorkingDays(calendar, agreementDate, rule.value), verified: rule.verified, source: rule.source };
}
