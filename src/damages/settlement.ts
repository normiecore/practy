import { fmtMoney, fmtNumber, roundDiv, type Cents } from "./money.js";

/**
 * Authority to Settle figures: a faithful port of the firm's fill_authority.py.
 * Pure arithmetic and display strings only; filling the firm's .docx template is
 * a docgen concern (the template is a tenant asset, never in the repo).
 *
 * Rounding: the Medicare advance is 10% of the Total Offer rounded half-up to the
 * cent (Python's round() is half-even on binary floats; they can differ only when
 * the Total Offer ends in 5 cents).
 */

export interface AuthorityInput {
  clientName?: string;
  injuryDate?: string;
  solicitor?: string;
  /** A(a) settlement / self-rehabilitation / general damages sum to the client. */
  settlementOfferCents: Cents;
  /** A(b) contribution to legal costs, incl GST. */
  legalCostsCents?: Cents;
  /** A(c) */
  disbursementsCents?: Cents;
  /** A(d) */
  medicalAccountsCents?: Cents;
  /** A(e) usually 0: Medicare is a deduction, not a contribution. */
  medicareContributionCents?: Cents;
  /** B(b) reads "by me" and is not deducted. */
  medicalAccountsPaidByClient?: boolean;
  /** B(j) disbursements read "Nil"; the A(c) money goes back to the client. */
  clientPaidDisbursements?: boolean;
  taxCents?: Cents;
  /** B(e): text (default "to be ascertained") or a number of cents. */
  centrelink?: string | Cents;
  workersCompRefundCents?: Cents;
  /** B(f): null means "N/A". */
  legalAidRefundCents?: Cents | null;
  otherSolicitorsFeesCents?: Cents;
  otherDebtsCents?: Cents;
  residualTrustCents?: Cents;
  /** A(f) one short line. */
  otherTerms?: string;
  /** Label anchor for B(j) in the firm's form. */
  feesLabel?: string;
}

export interface AuthorityCell {
  label: string;
  display: string;
}

export interface AuthorityResult {
  totalOfferCents: Cents;
  medicareAdvanceCents: Cents;
  firmFeesCents: Cents;
  firmDisbursementsCents: Cents;
  medicalDeductionCents: Cents;
  centrelinkCents: Cents;
  legalAidCents: Cents;
  netInHandCents: Cents;
  plusMedicareCents: Cents;
  netTotalCents: Cents;
  /** In the order fill_authority.py walks the form. */
  cells: AuthorityCell[];
  /** The "including disbursements of $___" blank. */
  disbursementsBlank: string;
  otherTerms: string;
}

export const DEFAULT_CENTRELINK = "to be ascertained";
const DEFAULT_FEES_LABEL = "Soul Legal fees";

/** fill_authority.py amt(): "Nil" for zero unless told otherwise, "$" or "E$" prefix. */
function amt(cents: Cents, estimated: boolean, nilIfZero = true): string {
  if (cents === 0 && nilIfZero) return "Nil";
  return (estimated ? "E$" : "$") + fmtNumber(cents);
}

export function computeAuthority(input: AuthorityInput): AuthorityResult {
  const settlement = input.settlementOfferCents;
  const costs = input.legalCostsCents ?? 0;
  const disb = input.disbursementsCents ?? 0;
  const medical = input.medicalAccountsCents ?? 0;
  const medicareContrib = input.medicareContributionCents ?? 0;
  const medicalByClient = input.medicalAccountsPaidByClient ?? false;
  const disbByClient = input.clientPaidDisbursements ?? false;
  const tax = input.taxCents ?? 0;
  const workersComp = input.workersCompRefundCents ?? 0;
  const otherSol = input.otherSolicitorsFeesCents ?? 0;
  const otherDebts = input.otherDebtsCents ?? 0;
  const residual = input.residualTrustCents ?? 0;
  const legalAid = input.legalAidRefundCents === undefined ? null : input.legalAidRefundCents;
  const centrelink = input.centrelink ?? DEFAULT_CENTRELINK;

  const totalOffer = settlement + costs + disb + medical + medicareContrib;
  // 10% of everything the insurer pays, including costs and disbursements.
  const medicareAdv = roundDiv(totalOffer, 10);
  const slDisb = disbByClient ? 0 : disb;
  const fees = costs + slDisb;
  const medicalDed = medicalByClient ? 0 : medical;
  const centrelinkAmt = typeof centrelink === "number" ? centrelink : 0;
  const legalAidAmt = legalAid ?? 0;

  const netInHand = totalOffer - medicareAdv - fees - medicalDed - tax - centrelinkAmt - workersComp - otherSol - otherDebts - legalAidAmt;
  const plusMedicare = medicareAdv;
  const netTotal = netInHand + plusMedicare + residual;

  let cl: string;
  if (typeof centrelink === "string") {
    cl = ["", "nil"].includes(centrelink.trim().toLowerCase()) ? "Nil" : `E$ – ${centrelink}`;
  } else {
    cl = amt(centrelinkAmt, true);
  }

  const cells: AuthorityCell[] = [
    // Section A ("$")
    { label: "settlement offer", display: amt(settlement, false, false) },
    { label: "contribution towards legal costs", display: amt(costs, false) },
    { label: "contribution towards disbursements", display: amt(disb, false) },
    { label: "contribution towards medical accounts", display: amt(medical, false) },
    { label: "contribution towards Medicare Australia", display: amt(medicareContrib, false) },
    { label: "TOTAL OFFER", display: "$" + fmtNumber(totalOffer) },
    // Section B ("E$")
    { label: "workers compensation refund", display: amt(workersComp, true) },
    { label: "medical/other accounts", display: medicalByClient ? "by me" : amt(medical, true) },
    { label: "Medicare Australia [10%", display: amt(medicareAdv, true) },
    { label: "Tax (if applicable)", display: amt(tax, true) },
    { label: "Centrelink refund", display: cl },
    { label: "Legal Aid Refund", display: legalAid === null ? "N/A" : amt(legalAidAmt, true) },
    { label: "barrister", display: amt(otherSol, true) },
    { label: "other debts", display: amt(otherDebts, true) },
    { label: "outstanding disbursements to be paid", display: "Nil" },
    { label: input.feesLabel ?? DEFAULT_FEES_LABEL, display: amt(fees, true) },
    // Section C ("E$")
    { label: "estimated net in hand", display: amt(netInHand, true) },
    { label: "plus Medicare/other benefits", display: amt(plusMedicare, true) },
    { label: "plus residual balance held in trust", display: amt(residual, true) },
    { label: "total", display: amt(netTotal, true) },
  ];

  return {
    totalOfferCents: totalOffer,
    medicareAdvanceCents: medicareAdv,
    firmFeesCents: fees,
    firmDisbursementsCents: slDisb,
    medicalDeductionCents: medicalDed,
    centrelinkCents: centrelinkAmt,
    legalAidCents: legalAidAmt,
    netInHandCents: netInHand,
    plusMedicareCents: plusMedicare,
    netTotalCents: netTotal,
    cells,
    disbursementsBlank: disbByClient ? "Nil" : fmtNumber(slDisb),
    otherTerms: (input.otherTerms ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Settlement statement for the trust distribution
// ---------------------------------------------------------------------------

export interface PayeeAmount {
  payee: string;
  description: string;
  amountCents: Cents;
}

export interface SettlementStatementInput {
  authority: AuthorityInput;
  /** Amount received into trust; defaults to the Total Offer. */
  receiptCents?: Cents;
  /** Medicare notice of charge. Undefined/null: the 10% advance is held in trust instead. */
  medicareChargeCents?: Cents | null;
  /** Centrelink charge. Undefined: the authority's numeric figure, if any. */
  centrelinkChargeCents?: Cents | null;
  ndisRecoveryCents?: Cents | null;
  /** DVA, private health fund and other recoveries. */
  otherRecoveries?: PayeeAmount[];
  funder?: PayeeAmount;
  /** Professional costs to the firm; defaults to the authority's legal costs. */
  costsCents?: Cents;
  /** Disbursements paid out of the settlement; defaults to the authority's firm-borne disbursements. */
  disbursements?: PayeeAmount[];
  /** Outstanding medical accounts paid to providers when the client has not paid them. */
  medicalAccounts?: PayeeAmount[];
  clientName?: string;
}

export type StatementLineKind =
  | "medicare"
  | "medicare_advance_held"
  | "centrelink"
  | "ndis"
  | "other_recovery"
  | "medical_accounts"
  | "workers_comp_refund"
  | "tax"
  | "legal_aid"
  | "other_solicitors"
  | "other_debts"
  | "funder"
  | "costs"
  | "disbursements"
  | "client";

export interface StatementLine {
  kind: StatementLineKind;
  payee: string;
  description: string;
  amountCents: Cents;
  basis: "actual" | "estimate";
}

export interface SettlementStatement {
  receiptCents: Cents;
  lines: StatementLine[];
  distributedCents: Cents;
  clientBalanceCents: Cents;
  /** The distribution lines sum to the receipt and nothing is paid to the client from a shortfall. */
  balanced: boolean;
  /** Client balance against the Authority's estimated net in hand. */
  varianceFromAuthorityCents: Cents;
  issues: string[];
  notes: string[];
}

export function computeSettlementStatement(input: SettlementStatementInput): SettlementStatement {
  const a = input.authority;
  const auth = computeAuthority(a);
  const receipt = input.receiptCents ?? auth.totalOfferCents;
  const lines: StatementLine[] = [];
  const issues: string[] = [];
  const notes: string[] = [];
  const add = (kind: StatementLineKind, payee: string, description: string, amountCents: Cents, basis: StatementLine["basis"] = "actual") => {
    if (amountCents !== 0) lines.push({ kind, payee, description, amountCents, basis });
  };

  if (input.medicareChargeCents === undefined || input.medicareChargeCents === null) {
    add("medicare_advance_held", "Held in trust", "Medicare 10% advance pending the notice of charge", auth.medicareAdvanceCents, "estimate");
    issues.push("Medicare notice of charge not yet received: the 10% advance is held and the balance is refundable to the client once the charge is known.");
  } else {
    add("medicare", "Services Australia (Medicare)", "Medicare notice of charge", input.medicareChargeCents);
  }

  const centrelink = input.centrelinkChargeCents ?? (typeof a.centrelink === "number" ? a.centrelink : null);
  if (centrelink === null) {
    const text = typeof a.centrelink === "string" ? a.centrelink.trim().toLowerCase() : DEFAULT_CENTRELINK;
    if (!["", "nil"].includes(text)) issues.push("Centrelink charge not yet known: obtain the clearance before distributing.");
  } else {
    add("centrelink", "Services Australia (Centrelink)", "Centrelink compensation recovery charge", centrelink);
  }
  if (input.ndisRecoveryCents) add("ndis", "National Disability Insurance Agency", "NDIS compensation recovery", input.ndisRecoveryCents);
  for (const r of input.otherRecoveries ?? []) add("other_recovery", r.payee, r.description, r.amountCents);

  if (!a.medicalAccountsPaidByClient) {
    const accounts = input.medicalAccounts ?? (a.medicalAccountsCents ? [{ payee: "Medical providers", description: "Outstanding medical accounts", amountCents: a.medicalAccountsCents }] : []);
    for (const m of accounts) add("medical_accounts", m.payee, m.description, m.amountCents);
  } else if (a.medicalAccountsCents) {
    notes.push(`Medical accounts contribution of ${fmtMoney(a.medicalAccountsCents)} reimburses the client, who paid the accounts ("by me").`);
  }
  add("workers_comp_refund", "Workers' compensation insurer", "Workers' compensation refund", a.workersCompRefundCents ?? 0);
  add("tax", "Australian Taxation Office", "Tax", a.taxCents ?? 0);
  add("legal_aid", "Legal Aid WA", "Legal Aid refund", a.legalAidRefundCents ?? 0);
  add("other_solicitors", "Other solicitors / counsel", "Other solicitors' or barrister's fees", a.otherSolicitorsFeesCents ?? 0);
  add("other_debts", "Other creditors", "Other debts", a.otherDebtsCents ?? 0);
  if (input.funder) add("funder", input.funder.payee, input.funder.description, input.funder.amountCents);

  add("costs", "Firm (office account)", "Professional costs", input.costsCents ?? a.legalCostsCents ?? 0);
  const disbursements = input.disbursements ?? (auth.firmDisbursementsCents ? [{ payee: "Firm (office account)", description: "Disbursements", amountCents: auth.firmDisbursementsCents }] : []);
  for (const d of disbursements) add("disbursements", d.payee, d.description, d.amountCents);
  if (a.clientPaidDisbursements && a.disbursementsCents) {
    notes.push(`Disbursements contribution of ${fmtMoney(a.disbursementsCents)} reimburses the client, who paid the disbursement.`);
  }

  const distributed = lines.reduce((s, l) => s + l.amountCents, 0);
  const clientBalance = receipt - distributed;
  if (clientBalance < 0) issues.push(`Deductions exceed the receipt by ${fmtMoney(-clientBalance)}: a client ledger may not go into debit.`);
  else add("client", input.clientName ?? a.clientName ?? "Client", "Balance to the client", clientBalance, issues.length ? "estimate" : "actual");

  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  const expectedNet = auth.netInHandCents + (lines.some((l) => l.kind === "medicare_advance_held") ? 0 : auth.medicareAdvanceCents - (input.medicareChargeCents ?? 0));
  return {
    receiptCents: receipt,
    lines,
    distributedCents: total,
    clientBalanceCents: clientBalance,
    balanced: total === receipt && clientBalance >= 0,
    varianceFromAuthorityCents: clientBalance - expectedNet,
    issues,
    notes,
  };
}
